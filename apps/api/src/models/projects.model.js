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
        }
    }
}
