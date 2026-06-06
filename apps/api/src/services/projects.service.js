import {ObjectId} from 'mongodb'
import {projectsModel} from '../models/projects.model.js'

function normalizeBranch(value) {
    return (value ?? '').trim() || 'main'
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
        async create({name, client_id, clickup_list_id, gitlab_url, gitlab_service_account, gitlab_default_branch}) {
            const result = await model.insert({
                name,
                client_id: toClientId(client_id),
                clickup: {list_id: clickup_list_id},
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
            const allowed = {}
            if (fields.name !== undefined) allowed.name = fields.name
            if (fields.client_id !== undefined) allowed.client_id = toClientId(fields.client_id)
            if (fields.clickup_list_id !== undefined) {
                allowed['clickup.list_id'] = fields.clickup_list_id
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
