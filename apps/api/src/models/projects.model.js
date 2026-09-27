export function projectsModel(db) {
    const collection = db.collection('projects')

    return {
        removeLegacyServiceName() {
            return collection.updateMany(
                {service_name: {$exists: true}},
                {$unset: {service_name: ''}}
            )
        },
        insert(doc) {
            return collection.insertOne(doc)
        },
        // I progetti archiviati sono esclusi salvo `includeArchived`.
        findAll({includeArchived = false} = {}) {
            const filter = includeArchived ? {} : {archived: {$ne: true}}
            return collection.find(filter).toArray()
        },
        findArchivedIds() {
            return collection.distinct('_id', {archived: true})
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
