# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project purpose

MVP per un "AI dev agent": legge task da ClickUp → l'agente AI (Claude) analizza → crea feature branch + commit → apre Merge Request su GitLab → aggiorna lo stato del task ClickUp a "In Progress" → salva prompt/log/risultato su MongoDB. README in italiano.

## Decisioni architetturali (vincolanti)

Queste scelte sono state prese esplicitamente nella conversazione di progettazione; mantienile finché non vengono riviste:

**Stack obbligato**: Node.js (Node 22, ESM), Fastify, MongoDB, Docker + Docker Compose, simple-git, Claude come provider AI.

**Da NON introdurre**: RabbitMQ/altri broker (MongoDB è la coda), Redis, Kubernetes, ORM. L'architettura deve restare leggera e gestibile in single-host.

**Niente backoffice/frontend in V1.** L'agente legge e scrive su ClickUp; l'utente ispeziona il DB direttamente (Mongo Express / Compass). Una dashboard Svelte è stata discussa ma rinviata.

**Token ClickUp unico globale** (env), valido per tutte le liste. **Auth GitLab via service account**: il progetto salva solo `projects.gitlab.service_account` (nome del service account, per convenzione il path del gruppo GitLab top-level); le credenziali vere NON sono su Mongo ma in env `GITLAB_SERVICE_ACCOUNTS`, una mappa JSON `{ nome_service_account: "<user>:<password>" }` letta dal worker (senza `:` il valore è un token con username `oauth2`). (Revisione della scelta iniziale "token GitLab per progetto in `projects.gitlab.token`".)

**Mapping progetto = una lista ClickUp ↔ un repo GitLab.** Creato a runtime via `POST /projects` (URL GitLab, token GitLab, list_id ClickUp), non da file di config.

**Path di lavoro per id, non per nome**: `/opt/cache/<projectId>` per il clone permanente, `/opt/worktrees/<jobId>` per il workspace isolato del singolo task. Evita rename/collisioni/caratteri.

**Workflow ClickUp comune a tutte le liste**: stati `Todo → In Progress → Review`. L'agente prende task in `Todo` e li sposta in `In Progress` quando apre la MR.

**Deploy**: api e worker su **Docker Swarm** (Linux single-host MVP), immagini su **ghcr.io** via GitHub Actions. La web-ui (quando arriverà, vedi sotto su V1) sarà uno **statico su Firebase Hosting** — solo hosting, nessuna Cloud Function / Firestore. Il repo di **questo** codice (`api` + `worker`) è su **GitHub** (`github.com/dawson0715/ai-dev`); le menzioni a "GitLab" nel resto del documento si riferiscono ai repo *target* gestiti dall'agente, non a dove vive il codice dell'agente stesso.

## Architettura corrente

Due servizi Node.js (ESM, Node 22) che condividono una MongoDB e un volume scratch montato dall'host:

- `apps/api` — Server HTTP Fastify (port 3000). Possiede la registrazione progetti: `POST /projects` inserisce un documento in `projects`, clona il repo GitLab in `/opt/cache/<projectId>` e scrive `local_path` nel doc. `GET /health` per liveness.
- `apps/worker` — Loop di polling long-running. Claim atomico di un job `pending` via `findOneAndUpdate` (transizione `pending → running → completed`). Sleep 5s tra poll vuoti. Il corpo dell'esecuzione del job è ancora uno stub.
- `mongo` — Singola istanza MongoDB. Il nome del DB viene dalla connection string (`MONGO_URL=mongodb://mongo:27017/agent`).
- `opt/` — Area di lavoro bind-mounted in entrambi i container su `/opt`:
  - `cache/<projectId>/` — clone completo, creato dall'API alla registrazione.
  - `worktrees/<jobId>/` — git worktree per task (non ancora cablato).

Comunicazione API↔worker **solo via MongoDB** (collection `jobs`). Nessun RPC diretto. Il worker è l'unico consumer.

## Schema MongoDB (target V1)

Tre collection principali. Lo schema attuale del codice è incompleto rispetto a questo; usalo come riferimento quando estendi:

- **`projects`**: `{ name, clickup.list_id, gitlab.{url,token,default_branch}, local_path, agent.{enabled,stack}, created_at }`.
- **`jobs`**: `{ status, clickup.{task_id,list_id,title,url}, gitlab.{project_id,branch,mr_url,commit_sha}, agent.{provider,model,system_prompt,user_prompt,response,input_tokens,output_tokens}, execution.{started_at,completed_at,duration_ms,logs[],error} }`.
- **`executions`** (opzionale, log dettagliato dei prompt AI separato da `jobs` se serve audit/replay).

## Running

**Dev locale** (`docker-compose.yml`):
```bash
docker compose up --build
```
Attualmente è scommentato **solo `mongo`**. I blocchi `api` e `worker` esistono come commento — scommentali per girare lo stack pieno in Docker, oppure lancia ciascun servizio localmente con `MONGO_URL=mongodb://localhost:27017/agent npm start` da `apps/api` o `apps/worker` (mongo deve essere già up).

**Build immagini** (`.github/workflows/build-push.yml`): matrix `[api, worker]`, push su `ghcr.io/dawson0715/ai-dev/{api,worker}` con tag `sha-<short>`, nome branch, e `latest` su `main`. Trigger su push a `main` + dispatch manuale.

**Deploy prod** (`stack.yml`): file separato per Swarm, NON il compose di dev. Uso:
```bash
docker stack deploy -c stack.yml agent --with-registry-auth
```
Variabili richieste a deploy time: `IMAGE_TAG` (default `latest`, in prod usa `sha-...`), `CLICKUP_TOKEN`, `ANTHROPIC_API_KEY`. Bind mount `/opt` su `${WORKSPACE_DIR:-/var/lib/ai-dev-agent/opt}` dell'host.

Nessun test/lint/build js configurato. L'unico npm script per app è `start`.

## Convenzioni

- ESM ovunque (`"type": "module"`). Top-level `await` usato nei due entry point (es. `mongo.connect()` al load del modulo) — tienine conto quando rifattorizzi lo startup.
- I path nei container sono assoluti (`/opt/...`) e assumono il bind mount di `docker-compose.yml`. Se giri fuori da Docker, punta a un path esistente sull'host o adatta il codice.
- I token GitLab NON sono più nel documento `projects`: il progetto referenzia un `gitlab.service_account` e le credenziali vivono in env `GITLAB_SERVICE_ACCOUNTS` (mappa JSON nome→`"<user>:<password>"`), risolte in `apps/worker/src/services/git.service.js`. La risoluzione è cache in-process: una rotazione richiede il restart del worker.
- Bug noto in `apps/worker/src/index.js`: con `mongodb` v6 `findOneAndUpdate` restituisce direttamente il documento (no wrapper `.value`) salvo `includeResultMetadata: true`. Il codice attuale fa `job?.value._id`, quindi tratterà ogni risultato come "nessun job". Da sistemare quando il worker viene reso funzionante.
