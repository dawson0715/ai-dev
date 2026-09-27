const BUSY_STATUSES = ['pending', 'running']

export function chatsModel(db) {
    const collection = db.collection('chats')

    return {
        init() {
            return collection.createIndex({project_id: 1, updated_at: -1})
        },

        insert(doc) {
            return collection.insertOne(doc)
        },

        findByProject(projectId, {jobId} = {}) {
            const filter = {project_id: projectId}
            if (jobId) filter.job_id = jobId
            return collection
                .find(filter, {projection: {messages: 0, progress: 0}})
                .sort({updated_at: -1})
                .toArray()
        },

        findById(id) {
            return collection.findOne({_id: id})
        },

        // Accoda un messaggio utente solo se la chat non sta già aspettando una
        // risposta: una domanda alla volta per conversazione.
        pushUserMessage(id, message) {
            return collection.findOneAndUpdate(
                {_id: id, status: {$nin: BUSY_STATUSES}},
                {
                    $push: {messages: message},
                    $set: {status: 'pending', updated_at: message.created_at},
                    $unset: {error: '', mode: ''}
                },
                {returnDocument: 'after'}
            )
        },

        // Richiesta di bozza job: nessun messaggio utente, il worker usa la
        // conversazione esistente con un prompt dedicato (mode: 'draft_job').
        requestMode(id, mode) {
            return collection.findOneAndUpdate(
                {_id: id, status: {$nin: BUSY_STATUSES}, 'messages.0': {$exists: true}},
                {$set: {status: 'pending', mode, updated_at: new Date()}, $unset: {error: ''}},
                {returnDocument: 'after'}
            )
        },

        // Claim FIFO. Recupera anche le chat rimaste 'running' oltre il cutoff
        // (worker morto a metà risposta).
        claimNext(staleCutoff) {
            return collection.findOneAndUpdate(
                {
                    $or: [
                        {status: 'pending'},
                        {status: 'running', claimed_at: {$lt: staleCutoff}}
                    ]
                },
                {$set: {status: 'running', claimed_at: new Date()}, $unset: {progress: ''}},
                {sort: {updated_at: 1}, returnDocument: 'after'}
            )
        },

        setProgress(id, entries) {
            return collection.updateOne(
                {_id: id, status: 'running'},
                {$set: {progress: {entries, updated_at: new Date()}}}
            )
        },

        // session_id/last_sha: sessione del CLI da riprendere con --resume alla
        // prossima domanda e commit su cui è stata data la risposta.
        pushReply(id, message, {error, sessionId, sha} = {}) {
            const update = {
                $push: {messages: message},
                $set: {status: error ? 'failed' : 'idle', updated_at: message.created_at},
                $unset: {claimed_at: '', progress: '', mode: ''}
            }
            if (sessionId) update.$set.session_id = sessionId
            if (sha) update.$set.last_sha = sha
            if (error) update.$set.error = error
            else update.$unset.error = ''
            return collection.updateOne({_id: id, status: 'running'}, update)
        },

        deleteById(id) {
            return collection.deleteOne({_id: id})
        }
    }
}
