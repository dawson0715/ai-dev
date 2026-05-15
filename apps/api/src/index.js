import Fastify from 'fastify'
import {connectMongo} from './db.js'
import {registerRoutes} from './routes.js'

const app = Fastify({logger: true})

const db = await connectMongo(process.env.MONGO_URL)
await registerRoutes(app, db)

app.listen({
    port: 3000,
    host: '0.0.0.0'
})
