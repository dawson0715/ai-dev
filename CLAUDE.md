# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project purpose

MVP per un "AI dev agent": legge task da ClickUp → l'agente AI (Claude) analizza → crea feature branch + commit → apre Merge Request su GitLab → aggiorna lo stato del task ClickUp a "In Progress" → salva prompt/log/risultato su MongoDB. README in italiano.

## Decisioni architetturali (vincolanti)

Queste scelte sono state prese esplicitamente nella conversazione di progettazione; mantienile finché non vengono riviste:

**Stack obbligato**: Node.js (Node 22, ESM), Fastify, MongoDB, Docker + Docker Compose, simple-git, Claude come provider AI.

**Da NON introdurre**: RabbitMQ/altri broker (MongoDB è la coda), Redis, Kubernetes, ORM. L'architettura deve restare leggera e gestibile in single-host.

**Niente backoffice/frontend in V1.** L'agente legge e scrive su ClickUp; l'utente ispeziona il DB direttamente (Mongo Express / Compass). Una dashboard Svelte è stata discussa ma rinviata.

**Token ClickUp unico globale** (env), valido per tutte le liste. I token GitLab sono **per progetto** (in `projects.gitlab.token`).

**Mapping progetto = una lista ClickUp ↔ un repo GitLab.** Creato a runtime via `POST /projects` (URL GitLab, token GitLab, list_id ClickUp), non da file di config.

**Path di lavoro per id, non per nome**: `/opt/cache/<projectId>` per il clone permanente, `/opt/worktrees/<jobId>` per il workspace isolato del singolo task. Evita rename/collisioni/caratteri.

**Workflow ClickUp comune a tutte le liste**: stati `Todo → In Progress → Review`. L'agente prende task in `Todo` e li sposta in `In Progress` quando apre la MR.

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

```bash
docker compose up --build
```

Nota: in `docker-compose.yml` attualmente è scommentato **solo `mongo`**. I blocchi `api` e `worker` esistono come commento — scommentali per girare lo stack pieno in Docker, oppure lancia ciascun servizio localmente con `MONGO_URL=mongodb://localhost:27017/agent npm start` da `apps/api` o `apps/worker` (mongo deve essere già up).

Nessun test/lint/build configurato. L'unico npm script per app è `start`.

## Convenzioni

- ESM ovunque (`"type": "module"`). Top-level `await` usato nei due entry point (es. `mongo.connect()` al load del modulo) — tienine conto quando rifattorizzi lo startup.
- I path nei container sono assoluti (`/opt/...`) e assumono il bind mount di `docker-compose.yml`. Se giri fuori da Docker, punta a un path esistente sull'host o adatta il codice.
- I token GitLab sono in chiaro nel documento `projects` (scope MVP) — segnalalo se introduci code path che li espongono.
- Bug noto in `apps/worker/src/index.js`: con `mongodb` v6 `findOneAndUpdate` restituisce direttamente il documento (no wrapper `.value`) salvo `includeResultMetadata: true`. Il codice attuale fa `job?.value._id`, quindi tratterà ogni risultato come "nessun job". Da sistemare quando il worker viene reso funzionante.
