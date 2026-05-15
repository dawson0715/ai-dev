const BASE = 'https://api.clickup.com/api/v2'

function headers(token) {
  return {
    'Authorization': token,
    'Content-Type': 'application/json'
  }
}

export async function listTodoTasks(token, listId) {
  const url = new URL(`${BASE}/list/${listId}/task`)
  url.searchParams.append('statuses[]', 'to do')
  url.searchParams.set('archived', 'false')
  url.searchParams.set('subtasks', 'false')

  const res = await fetch(url, { headers: headers(token) })

  if (!res.ok) {
    throw new Error(`ClickUp listTodoTasks ${listId} failed: ${res.status} ${await res.text()}`)
  }

  const body = await res.json()
  return body.tasks ?? []
}

export async function setTaskStatus(token, taskId, status) {
  const res = await fetch(`${BASE}/task/${taskId}`, {
    method: 'PUT',
    headers: headers(token),
    body: JSON.stringify({ status })
  })

  if (!res.ok) {
    throw new Error(`ClickUp setTaskStatus ${taskId} failed: ${res.status} ${await res.text()}`)
  }

  return res.json()
}
