export function projectsModel(db) {
    const collection = db.collection('projects')

    return {
        insert(doc) {
            return collection.insertOne(doc)
        },
        findAll() {
            return collection.find({}).toArray()
        },
        findById(id) {
            return collection.findOne({_id: id})
        },
        findByIds(ids) {
            return collection.find({_id: {$in: ids}}).toArray()
        },
        findByClient(clientId) {
            return collection.find({client_id: clientId}).toArray()
        },
        updateById(id, fields) {
            return collection.updateOne({_id: id}, {$set: fields})
        },
        deleteById(id) {
            return collection.deleteOne({_id: id})
        }
    }
}
