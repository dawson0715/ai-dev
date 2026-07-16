import test from 'node:test'
import assert from 'node:assert/strict'
import {pollProjectJobs, shouldSyncProject} from '../src/services/project-sync.service.js'

test('skips ClickUp and legacy projects without a ClickUp list id', async () => {
    const syncedProjectIds = []
    const api = {
        async syncProjectJobs(projectId) {
            syncedProjectIds.push(projectId)
            return {created: 0}
        }
    }

    await pollProjectJobs([
        {_id: 'clickup-missing', task_source: 'clickup'},
        {_id: 'clickup-empty', task_source: 'clickup', clickup: {list_id: '   '}},
        {_id: 'legacy-missing'},
        {_id: 'manual', task_source: 'manual'},
        {_id: 'clickup-configured', task_source: 'clickup', clickup: {list_id: '901234'}}
    ], api)

    assert.deepEqual(syncedProjectIds, ['clickup-configured'])
})

test('keeps syncing GitLab issue projects without a ClickUp list id', async () => {
    assert.equal(shouldSyncProject({_id: 'gitlab', task_source: 'gitlab_issues'}), true)
})
