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
- `apps/worker` — Loop di polling long-running con `WORKER_CONCURRENCY` executor. Il claim atomico usa uno slot MongoDB univoco per progetto; repository diversi lavorano in parallelo, lo stesso repository resta seriale. Il flusso è `pending → running → awaiting_merge → merged`: lo slot viene liberato solo quando GitLab conferma il merge della MR.
- `mongo` — Singola istanza MongoDB. Il nome del DB viene dalla connection string (`MONGO_URL=mongodb://mongo:27017/agent`).
- `opt/` — Area di lavoro bind-mounted in entrambi i container su `/opt`:
  - `cache/<projectId>/` — clone completo, creato dall'API alla registrazione.
  - `worktrees/<jobId>/` — git worktree per task (non ancora cablato).

Comunicazione API↔worker **solo via MongoDB** (collection `jobs`). Nessun RPC diretto. Il worker è l'unico consumer.

## Schema MongoDB (target V1)

Tre collection principali. Lo schema attuale del codice è incompleto rispetto a questo; usalo come riferimento quando estendi:

- **`projects`**: `{ name, clickup.list_id, gitlab.{url,token,default_branch}, local_path, agent.{enabled,stack}, created_at }`.
- **`jobs`**: `{ status, project_slot, heartbeat_at, depends_on_job_ids[], liquibase_id, clickup.{task_id,list_id,title,url}, gitlab.{project_id,branch,mr_iid,mr_url,commit_sha}, agent.{provider,model,system_prompt,user_prompt,response,input_tokens,output_tokens}, execution.{started_at,completed_at,duration_ms,logs[],error} }`.
- **`chats`**: `{ project_id, job_id?, job_title?, title, session_id?, last_sha?, status: pending|running|idle|failed, mode?: draft_job, claimed_at, progress.{entries[],updated_at}, messages[{role: user|assistant, text, kind?: job_draft, job_draft?.{title,description}, activity[], error, cost_usd, input_tokens, output_tokens, duration_ms, created_at}], created_at, updated_at }`. Chat di sola lettura sul codice, aperta in un pannello laterale ("Chiedi all'agente") dalla pagina progetto o job. Il worker le claima con executor separati (`CHAT_CONCURRENCY`, default 2), indipendenti dallo slot progetto, e fa girare Claude con `--permission-mode dontAsk` + allowlist di soli tool di lettura. Le chat sul branch di default leggono direttamente il clone in `/opt/cache/<projectId>`, riallineato (fetch al più ogni `CHAT_FETCH_INTERVAL_MS`, default 60 s, poi `checkout --detach --force` solo se il commit è cambiato o ci sono modifiche) solo quando nessun'altra chat dello stesso progetto lo sta leggendo. Le chat legate a un job il cui branch esiste ancora usano un worktree detached `/opt/worktrees/chat-<chatId>` riusato tra le domande; quelli inattivi da più di `CHAT_WORKTREE_TTL_MS` (default 6 h) sono rimossi da uno sweep ogni 10 min. Le chat girano con `CLAUDE_CHAT_MODEL` (default `sonnet`) e un tetto di spesa per domanda `CLAUDE_CHAT_MAX_BUDGET_USD` (default 1, `--max-budget-usd`: superato, il CLI esce con `error_max_budget_usd` ma la sessione resta valida). Le regole sono in `--append-system-prompt`. Dalla seconda domanda la chat riprende la sessione del CLI (`--resume chats.session_id`, con nota se `last_sha` è cambiato) inviando solo la nuova domanda; le sessioni stanno in `CHAT_CLAUDE_CONFIG_DIR` (default `<WORKSPACE>/claude-chats`, passato come `CLAUDE_CONFIG_DIR`). Se la sessione non si trova (es. redeploy senza volume) si ripiega sul prompt completo con la cronologia. Il CLI legge da solo l'`AGENTS.md` dei repo target (cwd = radice del repo), sia nelle chat sia nei job. `mode: draft_job` fa produrre a Claude una bozza `{title, description}` da cui la UI crea un job manuale.
- **Attività live** (job e chat): `runClaude` usa `--output-format stream-json --verbose` e riassume gli eventi in voci `{kind: text|tool|denied, tool?, text, at}`. Il worker le invia al massimo ogni 2,5 s (`POST /jobs/:id/progress`, `POST /chats/:id/progress`) nel campo `progress`, che si svuota alla chiusura. Lo storico completo finisce in `execution.activity` (job) o `messages[].activity` (chat), anche in caso di timeout.
- **`merge_requests`**: `{ project_id, iid, title, description, author, web_url, source_branch, target_branch, draft, state: opened|merged|closed, sha, has_conflicts, merge_status, chat_id, review?.{sha, verdict: ok|issues|blocking|failed|unknown, reviewed_at, cost_usd}, decision?.{action: merged|closed, at}, created_at, updated_at }`, indice univoco `{project_id, iid}`. MR **esterne** (aperte da sviluppatori, non dall'agente: escluse quelle il cui `iid`/branch coincide con un job del progetto). Il worker chiama `POST /projects/:id/merge-requests/sync` ogni `MR_POLL_INTERVAL_MS` (default 10 min): l'API legge da GitLab le MR aperte, le aggiorna e, per quelle non draft con `sha !== review.sha`, accoda nella chat della MR (`chats.merge_request_id` + snapshot `chats.merge_request`) un messaggio utente `kind: mr_review` — review completa la prima volta, solo il delta `git diff <review.sha>..HEAD` ai push successivi; se la chat è occupata riprova al giro dopo. Il worker legge l'head della MR da `refs/merge-requests/<iid>/head` (fetch in un ref locale fuori da `refs/remotes`, così il `--prune` non lo cancella; funziona con i fork) in un worktree `chat-<chatId>`, con lo stesso modello/budget delle chat; la risposta chiude con `VERDETTO: ok|issues|blocking`, che l'API salva in `review` (anche una review fallita registra lo sha, per non riaccodarla a ogni giro). Merge e chiusura dalla UI (`POST /merge-requests/:id/merge|close`) chiamano direttamente GitLab; il merge è consentito solo se `review.sha === sha` e passa `sha` a GitLab, che lo rifiuta se nel frattempo sono arrivati commit. Le chat delle MR non compaiono nella lista chat del progetto.
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
Variabili richieste a deploy time: `IMAGE_TAG` (default `latest`, in prod usa `sha-...`), `CLICKUP_TOKEN`, `ANTHROPIC_API_KEY`. Il worker usa `WORKSPACE=/srv` su volume nominato `worker_srv` (cloni, worktree e sessioni Claude delle chat sopravvivono ai redeploy).

API e worker usano `node --test` tramite `npm test`; la web UI si verifica con `npm run build`.

## Convenzioni

- ESM ovunque (`"type": "module"`). Top-level `await` usato nei due entry point (es. `mongo.connect()` al load del modulo) — tienine conto quando rifattorizzi lo startup.
- Il checkout principale del clone in `/opt/cache/<projectId>` resta sempre in **detached HEAD** (`ensureClone`): un branch checked out lì non potrebbe essere aperto in un worktree (es. job con `direct_branch` sul branch di default). Non fare `pull` né checkout di branch nel clone in cache.
- I path nei container sono assoluti (`/opt/...`) e assumono il bind mount di `docker-compose.yml`. Se giri fuori da Docker, punta a un path esistente sull'host o adatta il codice.
- I token GitLab NON sono più nel documento `projects`: il progetto referenzia un `gitlab.service_account` e le credenziali vivono in env `GITLAB_SERVICE_ACCOUNTS` (mappa JSON nome→`"<user>:<password>"`), risolte in `apps/worker/src/services/git.service.js`. La risoluzione è cache in-process: una rotazione richiede il restart del worker.
- Al primo claim le migrazioni Liquibase ricevono una sequenza monotona per progetto `YYMMDDhhmmss_TASK-ID`, senza millisecondi e immutabile ai retry, usata sia nel nome file sia nel changeset.
