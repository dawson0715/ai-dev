import {ObjectId} from 'mongodb'
import {projectsModel} from '../models/projects.model.js'

function normalizeBranch(value) {
    return (value ?? '').trim() || 'main'
}

const TASK_SOURCES = ['clickup', 'gitlab_issues', 'manual']

function normalizeTaskSource(value) {
    return TASK_SOURCES.includes(value) ? value : 'clickup'
}

function normalizeClickupListId(taskSource, value) {
    if (taskSource !== 'clickup') return null

    const listId = String(value ?? '').trim()
    if (listId) return listId

    const err = new Error('clickup_list_id is required for ClickUp projects')
    err.statusCode = 400
    throw err
}

// Converte una stringa in ObjectId; '' / null / undefined -> null (cliente non assegnato).
function toClientId(value) {
    if (value === undefined || value === null || value === '') return null
    try {
        return new ObjectId(value)
    } catch {
        const err = new Error('invalid client_id')
        err.statusCode = 400
        throw err
    }
}

export function projectsService(db) {
    const model = projectsModel(db)

    return {
        async create({
            name,
            client_id,
            service_name,
            task_source,
            clickup_list_id,
            gitlab_url,
            gitlab_service_account,
            gitlab_default_branch
        }) {
            const normalizedTaskSource = normalizeTaskSource(task_source)
            const result = await model.insert({
                name,
                client_id: toClientId(client_id),
                service_name: service_name || null,
                task_source: normalizedTaskSource,
                clickup: {list_id: normalizeClickupListId(normalizedTaskSource, clickup_list_id)},
                gitlab: {
                    url: gitlab_url,
                    service_account: gitlab_service_account,
                    default_branch: normalizeBranch(gitlab_default_branch)
                },
                created_at: new Date()
            })
            return {project_id: result.insertedId.toString()}
        },

        findAll: () => model.findAll(),

        findById: (id) => model.findById(id),

        async update(id, fields) {
            const project = await model.findById(id)
            if (!project) return null

            const allowed = {}
            if (fields.name !== undefined) allowed.name = fields.name
            if (fields.client_id !== undefined) allowed.client_id = toClientId(fields.client_id)
            if (fields.service_name !== undefined) allowed.service_name = fields.service_name || null
            const taskSource = fields.task_source !== undefined
                ? normalizeTaskSource(fields.task_source)
                : (project.task_source ?? (project.clickup?.list_id ? 'clickup' : 'manual'))
            if (fields.task_source !== undefined) allowed.task_source = taskSource
            if (fields.task_source !== undefined || fields.clickup_list_id !== undefined) {
                const listId = fields.clickup_list_id !== undefined
                    ? fields.clickup_list_id
                    : project.clickup?.list_id
                allowed['clickup.list_id'] = normalizeClickupListId(taskSource, listId)
            }
            if (fields.gitlab_url !== undefined) allowed['gitlab.url'] = fields.gitlab_url
            if (fields.gitlab_service_account !== undefined) {
                allowed['gitlab.service_account'] = fields.gitlab_service_account
            }
            if (fields.gitlab_default_branch !== undefined) {
                allowed['gitlab.default_branch'] = normalizeBranch(fields.gitlab_default_branch)
            }
            await model.updateById(id, allowed)
            return model.findById(id)
        },

        delete: (id) => model.deleteById(id)
    }
}
