export function mergeRequestsModel(db) {
    const collection = db.collection('merge_requests')

    return {
        init() {
            return collection.createIndex({project_id: 1, iid: 1}, {unique: true})
        },

        findById(id) {
            return collection.findOne({_id: id})
        },

        findOpenByProject(projectId) {
            return collection.find({project_id: projectId, state: 'opened'}).sort({iid: -1}).toArray()
        },

        // Aggiorna i dati letti da GitLab, senza toccare review/chat/decisione.
        upsert(projectId, view) {
            const now = new Date()
            return collection.findOneAndUpdate(
                {project_id: projectId, iid: view.iid},
                {$set: {...view, updated_at: now}, $setOnInsert: {created_at: now}},
                {upsert: true, returnDocument: 'after'}
            )
        },

        setState(id, state) {
            return collection.updateOne({_id: id}, {$set: {state, updated_at: new Date()}})
        },

        setChat(id, chatId) {
            return collection.updateOne({_id: id}, {$set: {chat_id: chatId}})
        },

        setReview(id, review) {
            return collection.updateOne({_id: id}, {$set: {review, updated_at: new Date()}})
        },

        setDecision(id, action, view) {
            const now = new Date()
            return collection.findOneAndUpdate(
                {_id: id},
                {$set: {...view, decision: {action, at: now}, updated_at: now}},
                {returnDocument: 'after'}
            )
        }
    }
}
