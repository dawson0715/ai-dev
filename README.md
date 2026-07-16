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
  "task_source": "clickup",
  "gitlab_url": "https://gitlab.com/company/backend-api.git",
  "gitlab_service_account": "company",
  "clickup_list_id": "123456"
}
```

`gitlab_service_account` è il nome del service account (per convenzione il path del
gruppo top-level del repo). Le credenziali vere non vengono salvate su Mongo: API e
worker le risolvono a runtime dalla env `GITLAB_SERVICE_ACCOUNTS`, una mappa JSON
`{ nome_service_account: "<user>:<password>" }` (senza `:` il valore è un token con
username `oauth2`).

Per un progetto senza board ClickUp usa `"task_source": "manual"` e ometti
`clickup_list_id`. I job verranno creati manualmente dalla dashboard. La web UI carica
il menu dei service account da `GET /gitlab/service-accounts`: la risposta contiene
soltanto le chiavi della mappa, mai le credenziali.

## Concorrenza e ordine dei job

`WORKER_CONCURRENCY` controlla quanti job il worker può eseguire contemporaneamente
(default `4`). Il claim MongoDB riserva però uno slot univoco per progetto: repository
diversi procedono in parallelo, mentre nello stesso repository parte un solo job.

Dopo il push il job passa a `awaiting_merge` e continua a occupare lo slot. Il worker
apre o individua la Merge Request GitLab e libera il progetto soltanto quando GitLab la
segnala come `merged`. Il job successivo viene quindi creato dall'ultimo branch base
remoto già aggiornato. Un job può inoltre dichiarare dipendenze esplicite:

```json
{
  "title": "Usa la nuova tabella clienti",
  "depends_on_job_ids": ["66a012345678901234567890"]
}
```

Le dipendenze devono appartenere allo stesso progetto e risultare `merged` (oppure
`completed` per compatibilità con i dati esistenti) prima del claim.

Durante l'esecuzione il worker rinnova `heartbeat_at`. Un job `running` senza heartbeat
da `RUNNING_JOB_STALE_MS` (default un'ora) viene recuperato e rimesso in coda; i job
`awaiting_merge` non scadono automaticamente.

## Migrazioni Liquibase

Al primo claim ogni job riceve un identificativo immutabile nel formato
`YYMMDDhhmmss_TASK-ID`, senza millisecondi. La sequenza è monotona per progetto anche
quando due claim cadono nello stesso secondo e non viene rigenerata ai retry. Il prompt
dell'agente richiede di usarla come prefisso del file e come changeset, per esempio:

```text
260716143522_TASK-184_add_customer_status.sql
--changeset ai-worker:260716143522_TASK-184
```

## Generare projects.json da GitLab

Lo script `scripts/gen-projects.mjs` interroga l'API GitLab con un access token
(chiesto in input) ed emette un `projects.json` con un'entry `{ name, url,
service_account }` per progetto, dove `service_account` è il path del gruppo
top-level. Stampa anche uno scaffold pronto per `GITLAB_SERVICE_ACCOUNTS`.

```bash
node scripts/gen-projects.mjs --base https://gitlab.com --out projects.json
# --all per includere tutti i progetti visibili (default: solo quelli di cui sei membro)
```
