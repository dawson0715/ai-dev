import {healthController} from './controllers/health.controller.js'
import {projectsController} from './controllers/projects.controller.js'
import {jobsController} from './controllers/jobs.controller.js'
import {clientsController} from './controllers/clients.controller.js'
import {sprintsController} from './controllers/sprints.controller.js'
import {projectsService} from './services/projects.service.js'
import {jobsService} from './services/jobs.service.js'
import {clientsService} from './services/clients.service.js'
import {sprintsService} from './services/sprints.service.js'

export async function registerRoutes(app, db) {
    const jobs = jobsService(db)
    const projects = projectsService(db)
    const clients = clientsService(db)
    const sprints = sprintsService(db)

    await jobs.init()
    await clients.init()
    await sprints.init()

    const health = healthController()
    const projectsCtl = projectsController({projectsService: projects, jobsService: jobs})
    const jobsCtl = jobsController({jobsService: jobs})
    const clientsCtl = clientsController({clientsService: clients})
    const sprintsCtl = sprintsController({sprintsService: sprints})

    app.get('/health', health.get)

    app.get('/projects', projectsCtl.list)
    app.post('/projects', projectsCtl.create)
    app.get('/projects/:id', projectsCtl.get)
    app.patch('/projects/:id', projectsCtl.update)
    app.delete('/projects/:id', projectsCtl.remove)
    app.get('/projects/:id/jobs', projectsCtl.listJobs)
    app.post('/projects/:id/jobs', projectsCtl.createJob)
    app.post('/projects/:id/jobs/sync', projectsCtl.syncJobs)

    app.get('/jobs', jobsCtl.list)
    app.get('/jobs/billable', jobsCtl.billable)
    app.get('/jobs/:id', jobsCtl.get)
    app.post('/jobs/claim', jobsCtl.claim)
    app.patch('/jobs/:id', jobsCtl.update)
    app.post('/jobs/:id/retry', jobsCtl.retry)
    app.post('/jobs/:id/ask', jobsCtl.ask)
    app.post('/jobs/:id/complete', jobsCtl.complete)
    app.post('/jobs/:id/fail', jobsCtl.fail)

    app.get('/clients', clientsCtl.list)
    app.post('/clients/upsert', clientsCtl.upsert)
    app.get('/clients/:id', clientsCtl.get)

    app.get('/sprints', sprintsCtl.list)
    app.post('/sprints', sprintsCtl.create)
    app.get('/sprints/:id', sprintsCtl.get)

    // Endpoint pubblico (senza auth): vista cliente via token.
    app.get('/public/sprints/:token', sprintsCtl.publicByToken)
}
