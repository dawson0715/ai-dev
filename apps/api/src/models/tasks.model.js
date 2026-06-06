export function tasksModel(db) {
    const collection = db.collection('tasks')

    return {
        async init() {
            await collection.createIndex({client_id: 1})
            await collection.createIndex({sprint_id: 1})
        },

        insert(doc) {
            return collection.insertOne(doc)
        },

        find(filter = {}) {
            return collection.find(filter).sort({created_at: -1}).toArray()
        },

        findById(id) {
            return collection.findOne({_id: id})
        },

        findByIds(ids) {
            return collection.find({_id: {$in: ids}}).toArray()
        },

        updateById(id, fields) {
            return collection.updateOne({_id: id}, {$set: fields})
        },

        // Assegna un gruppo di task a uno sprint (usato in fase di creazione sprint).
        assignToSprint(ids, sprintId) {
            return collection.updateMany(
                {_id: {$in: ids}},
                {$set: {sprint_id: sprintId, status: 'approvato'}}
            )
        },

        deleteById(id) {
            return collection.deleteOne({_id: id})
        }
    }
}