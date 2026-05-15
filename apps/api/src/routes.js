import {healthController} from './controllers/health.controller.js'
import {projectsController} from './controllers/projects.controller.js'
import {jobsController} from './controllers/jobs.controller.js'
import {projectsService} from './services/projects.service.js'
import {jobsService} from './services/jobs.service.js'

export async function registerRoutes(app, db) {
    const jobs = jobsService(db)
    const projects = projectsService(db)

    await jobs.init()

    const health = healthController()
    const projectsCtl = projectsController({projectsService: projects, jobsService: jobs})
    const jobsCtl = jobsController({jobsService: jobs})

    app.get('/health', health.get)

    app.get('/projects', projectsCtl.list)
    app.post('/projects', projectsCtl.create)
    app.post('/projects/:id/jobs/sync', projectsCtl.syncJobs)

    app.post('/jobs/claim', jobsCtl.claim)
    app.patch('/jobs/:id', jobsCtl.update)
    app.post('/jobs/:id/ask', jobsCtl.ask)
    app.post('/jobs/:id/complete', jobsCtl.complete)
}
