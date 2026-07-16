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
            // numbers: numeri di telefono registrati al cliente (normalizzati), usati per
            // associare le chiamate di supporto in ingresso al cliente giusto.
            await collection.createIndex({numbers: 1})
        },

        upsertByExternalId(externalId, set, setOnInsert) {
            return collection.findOneAndUpdate(
                {external_id: externalId},
                {$set: set, $setOnInsert: setOnInsert},
                {upsert: true, returnDocument: 'after'}
            )
        },

        insert(doc) {
            return collection.insertOne(doc)
        },

        findAll() {
            return collection.find({}).sort({name: 1}).toArray()
        },

        findById(id) {
            return collection.findOne({_id: id})
        },

        findByToken(token) {
            return collection.findOne({token})
        },

        // number deve essere gia' normalizzato (vedi clientsService.normalizeNumber).
        findByNumber(number) {
            return collection.findOne({numbers: number})
        },

        updateById(id, fields) {
            return collection.findOneAndUpdate(
                {_id: id},
                {$set: fields},
                {returnDocument: 'after'}
            )
        },

        deleteById(id) {
            return collection.deleteOne({_id: id})
        }
    }
}
