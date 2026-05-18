import {projectsModel} from '../models/projects.model.js'

export function projectsService(db) {
    const model = projectsModel(db)

    return {
        async create({name, clickup_list_id, gitlab_url, gitlab_token}) {
            const result = await model.insert({
                name,
                clickup: {list_id: clickup_list_id},
                gitlab: {url: gitlab_url, token: gitlab_token},
                created_at: new Date()
            })
            return {project_id: result.insertedId.toString()}
        },

        findAll: () => model.findAll(),

        findById: (id) => model.findById(id),

        async update(id, fields) {
            const allowed = {}
            if (fields.name !== undefined) allowed.name = fields.name
            if (fields.clickup_list_id !== undefined) {
                allowed['clickup.list_id'] = fields.clickup_list_id
            }
            if (fields.gitlab_url !== undefined) allowed['gitlab.url'] = fields.gitlab_url
            if (fields.gitlab_token !== undefined) allowed['gitlab.token'] = fields.gitlab_token
            if (fields.gitlab_default_branch !== undefined) {
                allowed['gitlab.default_branch'] = fields.gitlab_default_branch
            }
            await model.updateById(id, allowed)
            return model.findById(id)
        },

        delete: (id) => model.deleteById(id)
    }
}
