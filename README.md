# AI Dev Agent MVP

Sistema MVP per:

- leggere task da ClickUp
- creare feature branch
- generare codice tramite AI
- creare Merge Request GitLab
- salvare log su MongoDB

Stack:

- Node.js
- Fastify
- MongoDB
- Docker

## Avvio

```bash
docker compose up --build
```

API:

```http
POST /projects
```

Body:

```json
{
  "name": "Backend API",
  "gitlab_url": "git@gitlab.com:company/backend-api.git",
  "gitlab_token": "glpat-xxx",
  "clickup_list_id": "123456"
}
```
