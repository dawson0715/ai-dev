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

        findAll: () => model.findAll()
    }
}
