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

        // Job fatturabili: completati, su un progetto del cliente, non ancora in uno sprint.
        findBillable(projectIds) {
            return collection
                .find(
                    {project_id: {$in: projectIds}, status: 'completed', sprint_id: {$exists: false}},
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
