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
  "gitlab_url": "https://gitlab.com/company/backend-api.git",
  "gitlab_service_account": "company",
  "clickup_list_id": "123456"
}
```

`gitlab_service_account` è il nome del service account (per convenzione il path del
gruppo top-level del repo). Le credenziali vere non vengono salvate su Mongo: il worker
le risolve a runtime dalla env `GITLAB_SERVICE_ACCOUNTS`, una mappa JSON
`{ nome_service_account: "<user>:<password>" }` (senza `:` il valore è un token con
username `oauth2`).

## Generare projects.json da GitLab

Lo script `scripts/gen-projects.mjs` interroga l'API GitLab con un access token
(chiesto in input) ed emette un `projects.json` con un'entry `{ name, url,
service_account }` per progetto, dove `service_account` è il path del gruppo
top-level. Stampa anche uno scaffold pronto per `GITLAB_SERVICE_ACCOUNTS`.

```bash
node scripts/gen-projects.mjs --base https://gitlab.com --out projects.json
# --all per includere tutti i progetti visibili (default: solo quelli di cui sei membro)
```
