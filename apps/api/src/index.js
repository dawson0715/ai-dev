import Fastify from 'fastify'
import { MongoClient } from 'mongodb'
import simpleGit from 'simple-git'
import fs from 'fs/promises'

const app = Fastify({ logger: true })

const workspace = process.env.WORKSPACE || 3000

const mongo = new MongoClient(process.env.MONGO_URL)
await mongo.connect()

const db = mongo.db()

app.get('/health', async () => {
  return { ok: true }
})

app.post('/projects', async (req, reply) => {
  const body = req.body

  const result = await db.collection('projects').insertOne({
    name: body.name,
    clickup: {
      list_id: body.clickup_list_id
    },
    gitlab: {
      url: body.gitlab_url,
      token: body.gitlab_token
    },
    created_at: new Date()
  })

  const projectId = result.insertedId.toString()

  const repoPath = `${workspace}/opt/computer/cache/${projectId}`

  await fs.mkdir(repoPath, { recursive: true })

  const git = simpleGit()

  await git.clone(body.gitlab_url, repoPath)

  await db.collection('projects').updateOne(
    { _id: result.insertedId },
    {
      $set: {
        local_path: repoPath
      }
    }
  )

  return {
    ok: true,
    project_id: projectId
  }
})

app.listen({
  port: 3000,
  host: '0.0.0.0'
})
