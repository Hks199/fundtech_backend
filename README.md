# FIFO inventory backend

TypeScript Express API and Kafka consumer for the inventory assignment in `project_guide.MD`. The frontend is a later project. This repository provides login, event publishing, stock summary, purchase batches, and a paginated transaction ledger.

## Requirements

- Node.js 24+
- PostgreSQL 17+
- Kafka broker (local Apache Kafka or Confluent Cloud)

## Local start

1. Run `docker compose up -d` to start local PostgreSQL and Kafka. The compose file binds PostgreSQL to localhost port 15432 and Kafka to localhost port 9092 for development.
2. Run `npm install` and `npm run build`. The build compiles TypeScript from `src/`, `scripts/`, and `test/` into `dist/`.
3. Run `npm run setup:local`. It creates `.env` from `.env.example`, generates credentials, and prints the local admin password once. Save that password. The command refuses to overwrite an existing `.env`. For manual setup, copy `.env.example`, generate a hash with `npm run auth:hash -- "your-long-password"`, and set `JWT_SECRET` to at least 32 random characters. Do not commit `.env`.
4. Run `npm run db:migrate` and `npm run kafka:setup`.
5. Start `npm run start:consumer` in one terminal and `npm start` in another.
6. Run `npm run simulate` to publish eight sample events for `PRD001`.

The API listens on `http://localhost:3000`. Login with the `ADMIN_USERNAME` and password configured in `.env`. Example:

Run `npm run typecheck` for a strict TypeScript check and `npm test` to rebuild and run the tests. After changing source files, run `npm run build` again before starting the API, consumer, or scripts.

```powershell
$body = @{ username = 'admin'; password = 'your-long-password' } | ConvertTo-Json
$login = Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/auth/login -ContentType application/json -Body $body
$headers = @{ Authorization = "Bearer $($login.access_token)" }
Invoke-RestMethod -Uri http://localhost:3000/api/products -Headers $headers
Invoke-RestMethod -Uri http://localhost:3000/api/ledger -Headers $headers
```

## API

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/auth/login` | Return a one-hour bearer token |
| POST | `/api/events` | Queue an event; returns `202` and its event ID |
| GET | `/api/events/:eventId` | Check applied or rejected status |
| GET | `/api/products` | Current quantity, remaining inventory cost, average unit cost |
| GET | `/api/products/:productId/batches` | Purchase batches and remaining quantities |
| GET | `/api/ledger?product_id=PRD001&limit=50&offset=0` | Purchases, sales, FIFO allocations, rejected events |
| GET | `/health/live`, `/health/ready` | Process and database health |

All `/api` routes except login require `Authorization: Bearer <token>`. Send this JSON to `POST /api/events`:

```json
{
  "product_id": "PRD001",
  "event_type": "purchase",
  "quantity": 50,
  "unit_price": 100.0,
  "timestamp": "2025-07-12T10:00:00Z"
}
```

For a sale, set `event_type` to `sale` and omit `unit_price`. The API generates `event_id` when omitted. Direct Kafka producers must supply a UUID `event_id` and set the Kafka key to `product_id`. Events for each product must be published in timestamp order. Older events are recorded as rejected because applying them would change earlier FIFO costs. If there is insufficient stock, the sale is rejected and inventory is unchanged. Event status is asynchronous; poll `/api/events/:eventId` after a `202` response. The ledger contains only processed events.

## FIFO and reliability

Each purchase creates a batch with a remaining quantity. Each sale locks its product and consumes batches ordered by purchase timestamp and batch ID. The consumer stores the sale's total cost and an allocation for every batch used. Costs use decimal arithmetic and PostgreSQL `NUMERIC`; money is returned as strings to preserve precision. The product lock serializes transactions for the same product. Database work commits before the Kafka offset, and `event_id` prevents duplicate application after a retry.

The stock summary returns `current_quantity` as a string because PostgreSQL's `BIGINT` may exceed JavaScript's safe integer range.

Malformed Kafka messages go to `inventory-events-invalid`. Database failures stop offset advancement so Kafka can retry. The consumer and API are separate processes from the same codebase. Start only one API process per configured `TRUST_PROXY` setup; consumer processes may scale as Kafka partitions allow.

## Deployment settings

For Aiven Kafka and Neon PostgreSQL, follow [Aiven Kafka and Neon setup](docs/aiven-neon.md). It includes the exact environment variables, CA certificate handling, topic setup, and migration steps. The earlier [Confluent Cloud guide](docs/managed-services.md) remains available if that provider is used instead.

Set `DATABASE_URL`, `KAFKA_BROKERS`, the managed Kafka SASL settings, `CORS_ORIGINS` to the frontend origin, admin credentials, and `JWT_SECRET` in your deployment's secret settings. Set `NODE_ENV=production`, `DATABASE_SSL=true`, and `KAFKA_SSL=true`. Run migrations and topic setup as deployment jobs, then deploy the API and consumer as long-running services. Put the API behind HTTPS and set `TRUST_PROXY=true` only when there is one trusted reverse proxy. Use separate low-privilege Kafka and database credentials in production.

The API logs structured JSON with request IDs and redacts authorization headers. It validates event bodies, limits request size and rates, allows configured browser origins, uses security response headers, parameterized SQL, a hashed admin password, and short-lived signed tokens. Store the token in frontend memory; avoid browser local storage. Do not expose the local compose services to the internet.

### Docker image and EC2

`Dockerfile` builds one image for both processes. The API is the default command; `compose.ec2.yaml` runs the same image a second time with the consumer command. Docker Compose's restart policy keeps each process running after failures or host restarts.

On EC2, create an `.env` with production secrets and reachable PostgreSQL and Kafka addresses. The local values `localhost:15432` and `localhost:9092` refer to the container itself when used inside Docker and will not reach the host services. Set `NODE_ENV=production`, `DATABASE_SSL=true`, and `KAFKA_SSL=true`; the production Compose file sets `NODE_ENV` for both services. Use a reverse proxy on the EC2 host for HTTPS; the API container binds to host loopback port 3000.

```bash
docker compose -f compose.ec2.yaml build
docker compose -f compose.ec2.yaml run --rm api node dist/scripts/migrate.js
docker compose -f compose.ec2.yaml run --rm api node dist/scripts/kafka-setup.js
docker compose -f compose.ec2.yaml up -d
docker compose -f compose.ec2.yaml ps
```

Keep `.env` out of the image and source control. The Docker build excludes it through `.dockerignore` and Compose injects it when containers start.

No public frontend or backend URL is configured yet. Those are deployment deliverables for the full project.

## Startup problems

- `Invalid configuration: ...`: create `.env` with `npm run setup:local` after building, or fill the required values manually. The setup command does not overwrite an existing `.env`.
- `ECONNREFUSED localhost:9092`: Kafka is not listening. Start Docker Desktop, run `docker compose up -d`, and check `docker compose ps`. If using Confluent Cloud, set `KAFKA_BROKERS`, `KAFKA_SSL`, and SASL credentials in `.env` instead.
- Database connection errors: check that PostgreSQL is listening on localhost port 15432 and run `npm run db:migrate` before starting the consumer.
