import {ObjectId} from 'mongodb'

const SUCCESSFUL_DEPENDENCY_STATUSES = ['merged', 'completed']

export function jobsModel(db) {
    const collection = db.collection('jobs')

    const taskIdIndex = {
        key: {'clickup.task_id': 1},
        options: {
            unique: true,
            // I job manuali non hanno clickup.task_id: l'indice partial evita
            // che più documenti senza task_id collidano sul valore null.
            partialFilterExpression: {'clickup.task_id': {$exists: true}}
        }
    }

    return {
        async init() {
            try {
                await collection.createIndex(taskIdIndex.key, taskIdIndex.options)
            } catch (err) {
                // Indice preesistente con opzioni diverse (vecchia unique senza
                // partialFilterExpression): lo ricreo con la nuova definizione.
                if (err.code === 85 || err.code === 86) {
                    await collection.dropIndex('clickup.task_id_1')
                    await collection.createIndex(taskIdIndex.key, taskIdIndex.options)
                } else {
                    throw err
                }
            }
            // support.call_key: rende idempotente l'ingest delle chiamate di supporto
            // (stessa chiamata inviata due volte non crea un job duplicato). Partial
            // perche' solo i job di supporto hanno questo campo.
            await collection.createIndex(
                {'support.call_key': 1},
                {unique: true, partialFilterExpression: {'support.call_key': {$exists: true}}}
            )
            // gitlab_issue.issue_id: id globale issue GitLab, univoco sull'istanza.
            // Partial perche' solo i job importati da GitLab issues hanno questo campo.
            await collection.createIndex(
                {'gitlab_issue.issue_id': 1},
                {unique: true, partialFilterExpression: {'gitlab_issue.issue_id': {$exists: true}}}
            )
            // Lo slot viene mantenuto sia durante l'esecuzione sia mentre la MR
            // aspetta il merge. L'indice rende il vincolo atomico anche con più
            // executor o più istanze del worker.
            await collection.createIndex(
                {project_id: 1},
                {
                    name: 'one_active_job_per_project',
                    unique: true,
                    partialFilterExpression: {project_slot: true}
                }
            )
            await collection.createIndex({status: 1, created_at: 1})
        },

        insertManual({projectId, title, description, estimate = 0, dependsOnJobIds = []}) {
            const _id = new ObjectId()
            const createdAt = new Date()
            return collection.insertOne({
                _id,
                project_id: projectId,
                status: 'pending',
                source: 'manual',
                title,
                description,
                estimate,
                depends_on_job_ids: dependsOnJobIds,
                created_at: createdAt
            })
        },

        // Job di supporto remoto da una chiamata. Nasce gia' 'completed' (la chiamata
        // e' lavoro svolto) e billable; non e' legato a un progetto/repo ma direttamente
        // al cliente (client_id). Idempotente su support.call_key.
        insertSupport({clientId, number, duration, minutes, date, type, title, callKey}) {
            return collection.updateOne(
                {'support.call_key': callKey},
                {
                    $setOnInsert: {
                        client_id: clientId,
                        status: 'completed',
                        source: 'support',
                        title,
                        minutes,
                        estimate: 0,
                        cost_usd: 0,
                        support: {call_key: callKey, number, duration, date, type},
                        created_at: new Date(),
                        completed_at: new Date()
                    }
                },
                {upsert: true}
            )
        },

        upsertFromTask(projectId, listId, task) {
            const createdAt = new Date()
            return collection.updateOne(
                {'clickup.task_id': task.id},
                {
                    $setOnInsert: {
                        project_id: projectId,
                        status: 'pending',
                        clickup: {
                            task_id: task.id,
                            list_id: listId,
                            title: task.name,
                            description: task.description ?? task.text_content ?? '',
                            url: task.url
                        },
                        created_at: createdAt
                    }
                },
                {upsert: true}
            )
        },

        upsertFromGitlabIssue(projectId, issue) {
            const createdAt = new Date()
            return collection.updateOne(
                {'gitlab_issue.issue_id': issue.id},
                {
                    $setOnInsert: {
                        project_id: projectId,
                        status: 'pending',
                        source: 'gitlab_issue',
                        gitlab_issue: {
                            issue_id: issue.id,
                            iid: issue.iid,
                            title: issue.title,
                            description: issue.description ?? '',
                            url: issue.web_url
                        },
                        created_at: createdAt
                    }
                },
                {upsert: true}
            )
        },

        // Un solo candidato FIFO per progetto: un job bloccato da una dipendenza
        // impedisce ai job successivi dello stesso progetto di scavalcarlo.
        findActiveProjectIds() {
            return collection.distinct('project_id', {project_slot: true})
        },

        findClaimCandidates(limit = 100, activeProjectIds = []) {
            return collection.aggregate([
                {
                    $match: {
                        status: 'pending',
                        project_id: {
                            $exists: true,
                            ...(activeProjectIds.length ? {$nin: activeProjectIds} : {})
                        }
                    }
                },
                {$sort: {created_at: 1, _id: 1}},
                {$group: {_id: '$project_id', job: {$first: '$$ROOT'}}},
                {$replaceRoot: {newRoot: '$job'}},
                {$sort: {created_at: 1, _id: 1}},
                {$limit: limit}
            ]).toArray()
        },

        claimById(id, liquibaseId) {
            return collection.findOneAndUpdate(
                {_id: id, status: 'pending'},
                {
                    $set: {
                        status: 'running',
                        project_slot: true,
                        started_at: new Date(),
                        heartbeat_at: new Date(),
                        liquibase_id: liquibaseId
                    }
                },
                {returnDocument: 'after'}
            )
        },

        findDependencies(ids) {
            return collection
                .find(
                    {_id: {$in: ids}},
                    {projection: {_id: 1, status: 1}}
                )
                .toArray()
        },

        async findLatestLiquibaseId(projectId) {
            const job = await collection
                .find(
                    {project_id: projectId, liquibase_id: {$exists: true}},
                    {projection: {liquibase_id: 1}}
                )
                .sort({liquibase_id: -1})
                .limit(1)
                .next()
            return job?.liquibase_id ?? null
        },

        dependenciesAreSuccessful(dependencies, expectedCount) {
            return dependencies.length === expectedCount
                && dependencies.every((job) => SUCCESSFUL_DEPENDENCY_STATUSES.includes(job.status))
        },

        findById(id) {
            return collection.findOne({_id: id})
        },

        update(id, fields) {
            return collection.updateOne({_id: id}, {$set: fields})
        },

        // Aggiunge un commento libero al job e lo rimette in coda (retry con più
        // contesto per l'agente), senza toccare il legame ClickUp.
        pushComment(id, comment) {
            return collection.updateOne(
                {_id: id},
                {
                    $push: {comments: comment},
                    $set: {status: 'pending', started_at: null},
                    $unset: {project_slot: '', heartbeat_at: ''}
                }
            )
        },

        // Modifica testo (titolo/descrizione) di un job nato da ClickUp: da questo
        // punto diverge dalla card ClickUp e diventa un job manuale a tutti gli effetti.
        detachAndUpdate(id, fields) {
            return collection.updateOne(
                {_id: id},
                {
                    $set: {...fields, source: 'manual', status: 'pending', started_at: null},
                    $unset: {clickup: '', project_slot: '', heartbeat_at: ''}
                }
            )
        },

        pushExecution(id, execution, setFields, {
            releaseProject = false,
            expectedStatuses = null,
            requireProjectSlot = false
        } = {}) {
            const update = {
                $push: {executions: execution},
                $set: setFields
            }
            if (releaseProject) update.$unset = {project_slot: '', heartbeat_at: ''}

            const filter = {_id: id}
            if (expectedStatuses) filter.status = {$in: expectedStatuses}
            if (requireProjectSlot) filter.project_slot = true

            return collection.updateOne(
                filter,
                update
            )
        },

        requeue(id) {
            return collection.updateOne(
                {_id: id},
                {
                    $set: {status: 'pending', started_at: null},
                    $unset: {project_slot: '', heartbeat_at: '', completed_at: ''}
                }
            )
        },

        // Segna la richiesta di merge manuale: il worker esegue davvero il merge
        // su GitLab al prossimo giro di polling (nessun RPC diretto api->worker).
        requestMerge(id) {
            return collection.findOneAndUpdate(
                {_id: id, status: 'awaiting_merge'},
                {$set: {merge_requested_at: new Date()}},
                {returnDocument: 'after'}
            )
        },

        // Rilascia lo slot progetto senza cambiare stato: la MR resta in attesa
        // di merge (monitorata dal worker) ma il prossimo task in coda può partire.
        releaseForManualReview(id) {
            return collection.findOneAndUpdate(
                {_id: id, status: 'awaiting_merge', project_slot: true},
                {
                    $set: {manual_review_at: new Date()},
                    $unset: {project_slot: '', heartbeat_at: ''}
                },
                {returnDocument: 'after'}
            )
        },

        markMerged(id, gitlab) {
            return collection.findOneAndUpdate(
                {_id: id, status: 'awaiting_merge'},
                {
                    $set: {
                        status: 'merged',
                        completed_at: new Date(),
                        ...(gitlab ? {gitlab} : {})
                    },
                    $unset: {project_slot: '', heartbeat_at: ''}
                },
                {returnDocument: 'after'}
            )
        },

        heartbeat(id) {
            return collection.updateOne(
                {_id: id, status: 'running', project_slot: true},
                {$set: {heartbeat_at: new Date()}}
            )
        },

        recoverStaleRunning(cutoff) {
            return collection.updateMany(
                {
                    status: 'running',
                    project_slot: true,
                    $or: [
                        {heartbeat_at: {$lt: cutoff}},
                        {heartbeat_at: {$exists: false}, started_at: {$lt: cutoff}}
                    ]
                },
                {
                    $set: {
                        status: 'pending',
                        started_at: null,
                        recovered_at: new Date()
                    },
                    $unset: {project_slot: '', heartbeat_at: ''}
                }
            )
        },

        findByProject(projectId) {
            return collection
                .find({project_id: projectId}, {projection: {executions: 0}})
                .sort({created_at: -1})
                .toArray()
        },

        findByIds(ids) {
            return collection.find({_id: {$in: ids}}, {projection: {executions: 0}}).toArray()
        },

        findBySprint(sprintId) {
            return collection
                .find({sprint_id: sprintId}, {projection: {executions: 0}})
                .sort({created_at: -1})
                .toArray()
        },

        findBySprintIds(sprintIds) {
            return collection
                .find({sprint_id: {$in: sprintIds}}, {projection: {executions: 0}})
                .sort({created_at: -1})
                .toArray()
        },

        // Job fatturabili: completati e non ancora in uno sprint. Include sia i job
        // sui progetti del cliente sia i job di supporto remoto agganciati direttamente
        // al cliente (che non hanno project_id).
        findBillable({projectIds = [], clientId} = {}) {
            const or = []
            if (projectIds.length) or.push({project_id: {$in: projectIds}})
            if (clientId) or.push({client_id: clientId, source: 'support'})
            if (!or.length) return Promise.resolve([])
            return collection
                .find(
                    {status: {$in: ['completed', 'merged']}, sprint_id: {$exists: false}, $or: or},
                    {projection: {executions: 0}}
                )
                .sort({created_at: -1})
                .toArray()
        },

        // Assegna un gruppo di job a uno sprint (in fase di creazione sprint).
        assignToSprint(ids, sprintId) {
            return collection.updateMany(
                {_id: {$in: ids}},
                {$set: {sprint_id: sprintId}}
            )
        },

        findAll({limit = 100, status} = {}) {
            return collection
                .find(status ? {status} : {}, {projection: {executions: 0}})
                .sort({created_at: -1})
                .limit(limit)
                .toArray()
        }
    }
}
