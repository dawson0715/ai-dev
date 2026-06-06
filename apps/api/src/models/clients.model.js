export function clientsModel(db) {
    const collection = db.collection('clients')

    return {
        async init() {
            // external_id: id del cliente nel vecchio backoffice (sorgente dell'upsert).
            await collection.createIndex({external_id: 1}, {unique: true})
            await collection.createIndex(
                {token: 1},
                {unique: true, partialFilterExpression: {token: {$exists: true}}}
            )
        },

        upsertByExternalId(externalId, set, setOnInsert) {
            return collection.findOneAndUpdate(
                {external_id: externalId},
                {$set: set, $setOnInsert: setOnInsert},
                {upsert: true, returnDocument: 'after'}
            )
        },

        findAll() {
            return collection.find({}).sort({name: 1}).toArray()
        },

        findById(id) {
            return collection.findOne({_id: id})
        },

        findByToken(token) {
            return collection.findOne({token})
        }
    }
}