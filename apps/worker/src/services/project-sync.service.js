function hasClickUpListId(project) {
    return String(project.clickup?.list_id ?? '').trim().length > 0
}

export function shouldSyncProject(project) {
    const source = project.task_source ?? (hasClickUpListId(project) ? 'clickup' : 'manual')

    if (source === 'gitlab_issues') return true
    if (source !== 'clickup') return false

    return hasClickUpListId(project)
}

export async function pollProjectJobs(projects, api, logger = console) {
    for (const project of projects) {
        if (!shouldSyncProject(project)) continue

        try {
            const {created, warning} = await api.syncProjectJobs(project._id)
            if (warning) logger.warn(`sync warning for project ${project._id}: ${warning}`)
            if (created > 0) logger.log(`ingested ${created} new task(s) for project ${project._id}`)
        } catch (err) {
            logger.error(`sync failed for project ${project._id}:`, err.message)
        }
    }
}
