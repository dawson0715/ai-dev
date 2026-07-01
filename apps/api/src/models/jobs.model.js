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
        },

        insertManual({projectId, title, description, estimate = 0}) {
            return collection.insertOne({
                project_id: projectId,
                status: 'pending',
                source: 'manual',
                title,
                description,
                estimate,
                created_at: new Date()
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
                        created_at: new Date()
                    }
                },
                {upsert: true}
            )
        },

        upsertFromGitlabIssue(projectId, issue) {
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
                        created_at: new Date()
                    }
                },
                {upsert: true}
            )
        },

        claimNext() {
            return collection.findOneAndUpdate(
                {status: 'pending'},
                {$set: {status: 'running', started_at: new Date()}}
            )
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
                {$push: {comments: comment}, $set: {status: 'pending', started_at: null}}
            )
        },

        // Modifica testo (titolo/descrizione) di un job nato da ClickUp: da questo
        // punto diverge dalla card ClickUp e diventa un job manuale a tutti gli effetti.
        detachAndUpdate(id, fields) {
            return collection.updateOne(
                {_id: id},
                {
                    $set: {...fields, source: 'manual', status: 'pending', started_at: null},
                    $unset: {clickup: ''}
                }
            )
        },

        pushExecution(id, execution, setFields) {
            return collection.updateOne(
                {_id: id},
                {
                    $push: {executions: execution},
                    $set: setFields
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
                    {status: 'completed', sprint_id: {$exists: false}, $or: or},
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

        findAll({limit = 100} = {}) {
            return collection
                .find({}, {projection: {executions: 0}})
                .sort({created_at: -1})
                .limit(limit)
                .toArray()
        }
    }
}
