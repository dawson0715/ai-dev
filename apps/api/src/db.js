import {MongoClient} from 'mongodb'

export async function connectMongo(url) {
    const client = new MongoClient(url)
    await client.connect()
    return client.db()
}
