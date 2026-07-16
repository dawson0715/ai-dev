import {healthController} from './controllers/health.controller.js'
import {projectsController} from './controllers/projects.controller.js'
import {jobsController} from './controllers/jobs.controller.js'
import {clientsController} from './controllers/clients.controller.js'
import {sprintsController} from './controllers/sprints.controller.js'
import {supportController} from './controllers/support.controller.js'
import {gitlabController} from './controllers/gitlab.controller.js'
import {projectsService} from './services/projects.service.js'
import {jobsService} from './services/jobs.service.js'
import {clientsService} from './services/clients.service.js'
import {sprintsService} from './services/sprints.service.js'
import {supportService} from './services/support.service.js'

export async function registerRoutes(app, db) {
    const jobs = jobsService(db)
    const projects = projectsService(db)
    const clients = clientsService(db)
    const sprints = sprintsService(db)
    const support = supportService(db)

    await projects.init()
    await jobs.init()
    await clients.init()
    await sprints.init()

    const health = healthController()
    const projectsCtl = projectsController({projectsService: projects, jobsService: jobs})
    const jobsCtl = jobsController({jobsService: jobs})
    const clientsCtl = clientsController({clientsService: clients})
    const sprintsCtl = sprintsController({sprintsService: sprints})
    const supportCtl = supportController({supportService: support})
    const gitlabCtl = gitlabController()

    app.get('/health', health.get)

    app.get('/projects', projectsCtl.list)
    app.post('/projects', projectsCtl.create)
    app.get('/projects/:id', projectsCtl.get)
    app.patch('/projects/:id', projectsCtl.update)
    app.delete('/projects/:id', projectsCtl.remove)
    app.get('/projects/:id/jobs', projectsCtl.listJobs)
    app.post('/projects/:id/jobs', projectsCtl.createJob)
    app.post('/projects/:id/jobs/sync', projectsCtl.syncJobs)

    app.get('/gitlab/service-accounts', gitlabCtl.listServiceAccounts)

    app.get('/jobs', jobsCtl.list)
    app.get('/jobs/billable', jobsCtl.billable)
    app.get('/jobs/:id', jobsCtl.get)
    app.post('/jobs/claim', jobsCtl.claim)
    app.patch('/jobs/:id', jobsCtl.update)
    app.post('/jobs/:id/comments', jobsCtl.addComment)
    app.post('/jobs/:id/retry', jobsCtl.retry)
    app.post('/jobs/:id/ask', jobsCtl.ask)
    app.post('/jobs/:id/complete', jobsCtl.complete)
    app.post('/jobs/:id/heartbeat', jobsCtl.heartbeat)
    app.post('/jobs/:id/merged', jobsCtl.merged)
    app.post('/jobs/:id/fail', jobsCtl.fail)

    app.get('/clients', clientsCtl.list)
    app.post('/clients', clientsCtl.create)
    app.post('/clients/upsert', clientsCtl.upsert)
    app.get('/clients/:id', clientsCtl.get)
    app.patch('/clients/:id', clientsCtl.update)
    app.delete('/clients/:id', clientsCtl.remove)

    app.get('/sprints', sprintsCtl.list)
    app.post('/sprints', sprintsCtl.create)
    app.get('/sprints/:id', sprintsCtl.get)
    app.patch('/sprints/:id', sprintsCtl.update)
    app.post('/sprints/:id/invoice', sprintsCtl.invoice)
    app.post('/sprints/:id/invoice/update', sprintsCtl.invoiceUpdate)

    // Ingest chiamate di supporto: { calls: [{number, duration, date, type}] }.
    // Crea un job di supporto remoto billable per ogni chiamata da numero registrato.
    app.post('/support/calls', supportCtl.ingest)

    // Endpoint pubblico (senza auth): vista cliente via token.
    app.get('/public/sprints/:token', sprintsCtl.publicByToken)
}
