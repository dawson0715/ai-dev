export function sprintsModel(db) {
    const collection = db.collection('sprints')

    return {
        async init() {
            await collection.createIndex({client_id: 1})
        },

        insert(doc) {
            return collection.insertOne(doc)
        },

        find(filter = {}) {
            return collection.find(filter).sort({created_at: -1}).toArray()
        },

        findById(id) {
            return collection.findOne({_id: id})
        }
    }
}
