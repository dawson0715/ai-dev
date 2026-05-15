import { MongoClient } from 'mongodb'
import { listTodoTasks } from './clickup.js'

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 30000)
const CLICKUP_TOKEN = process.env.CLICKUP_TOKEN

const mongo = new MongoClient(process.env.MONGO_URL)
await mongo.connect()
const db = mongo.db()

await db.collection('jobs').createIndex({ 'clickup.task_id': 1 }, { unique: true })

console.log('worker started')

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function ingestProject(project) {
  if (!CLICKUP_TOKEN) {
    console.warn('CLICKUP_TOKEN not set, skipping ingestion')
    return 0
  }

  const listId = project.clickup?.list_id
  if (!listId) return 0

  const tasks = await listTodoTasks(CLICKUP_TOKEN, listId)
  let created = 0

  for (const t of tasks) {
    const res = await db.collection('jobs').updateOne(
      { 'clickup.task_id': t.id },
      {
        $setOnInsert: {
          project_id: project._id,
          status: 'pending',
          clickup: {
            task_id: t.id,
            list_id: listId,
            title: t.name,
            url: t.url
          },
          created_at: new Date()
        }
      },
      { upsert: true }
    )
    if (res.upsertedCount > 0) created++
  }

  return created
}

async function pollAll() {
  const projects = await db.collection('projects').find({}).toArray()

  for (const p of projects) {
    try {
      const created = await ingestProject(p)
      if (created > 0) {
        console.log(`ingested ${created} new task(s) for project ${p._id}`)
      }
    } catch (err) {
      console.error(`ingestion failed for project ${p._id}:`, err.message)
    }
  }
}

async function processNextJob() {
  const job = await db.collection('jobs').findOneAndUpdate(
    { status: 'pending' },
    { $set: { status: 'running', started_at: new Date() } }
  )

  if (!job) return false

  console.log('processing job', job._id, job.clickup?.task_id)

  // TODO Fase 2: clone/worktree, Claude, commit, push, MR, update ClickUp
  await db.collection('jobs').updateOne(
    { _id: job._id },
    {
      $set: {
        status: 'completed',
        completed_at: new Date(),
        'execution.note': 'stub: processing not yet implemented'
      }
    }
  )

  return true
}

;(async function pollerLoop() {
  while (true) {
    try {
      await pollAll()
    } catch (err) {
      console.error('poll error:', err)
    }
    await sleep(POLL_INTERVAL_MS)
  }
})()

;(async function executorLoop() {
  while (true) {
    try {
      const processed = await processNextJob()
      if (!processed) await sleep(5000)
    } catch (err) {
      console.error('executor error:', err)
      await sleep(5000)
    }
  }
})()
