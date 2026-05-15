export function jobsModel(db) {
    const collection = db.collection('jobs')

    return {
        init() {
            return collection.createIndex({'clickup.task_id': 1}, {unique: true})
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
        }
    }
}
