# Deploy the API to Vercel

The HTTP API runs as a Node.js Vercel Function. The Kafka consumer must run on a separate, continuously running host, such as your existing EC2 Docker setup. Without that consumer, event submission returns `202` but inventory and the ledger never update.

## 1. Prepare production services

Use reachable managed PostgreSQL and Kafka services with TLS. Localhost addresses from `.env.example` cannot work in Vercel. Follow [the managed-service guide](aiven-neon.md) for broker authentication and database setup.

Build locally, then run the following with environment variables pointing at the intended production services:

```bash
npm ci
npm run build
npm run db:migrate
npm run kafka:setup
```

Migrations and topic creation are explicit operator steps, not Vercel build steps. Use the direct database URL in `MIGRATION_DATABASE_URL` for migrations and a pooled connection URL for the API where available.

## 2. Import the repository

Push these changes to your Git repository, import it into Vercel, and use:

| Setting | Value |
| --- | --- |
| Root Directory | Repository root |
| Framework Preset | Other |
| Node.js Version | 24.x |
| Install Command | `npm ci --include=dev` (configured in `vercel.json`) |
| Build Command | `npm run build` (configured in `vercel.json`) |
| Output Directory | `public` (configured in `vercel.json`) |

`public` is intentionally empty; the API is bundled from `api/index.ts`. The catch-all rewrite preserves existing `/api/*` and `/health/*` routes. Do not select `dist` as the output directory or use `npm start` as a build command.

The install command explicitly includes development dependencies because TypeScript and `@types/node` are needed during the build, even with `NODE_ENV=production`. The Node.js engine is pinned to `24.x` to prevent automatic major upgrades. TypeScript resolves type packages from the repository's `node_modules/@types` directory.

If an earlier deployment failed with `TS2688: Cannot find type definition file for 'node'`, push the updated `package.json`, `package-lock.json`, `tsconfig.json`, and `vercel.json`, then redeploy with the existing build cache disabled. Remove any dashboard Install Command override that omits development dependencies, or set it to `npm ci --include=dev`.

## 3. Add environment variables before deploying

In the Vercel project's environment settings, add these values for Production. Configure Preview separately with test services and credentials if you use preview deployments. Paste raw values without surrounding quotes.

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Managed PostgreSQL connection URL |
| `DATABASE_SSL` | `true` |
| `KAFKA_BROKERS` | Provider broker host and port; comma-separated for multiple brokers |
| `KAFKA_SSL` | `true` |
| `KAFKA_TOPIC` | Existing inventory topic; defaults to `inventory-events` |
| `KAFKA_CLIENT_ID` | `inventory-vercel-api` |
| `ADMIN_USERNAME` | Your admin login name |
| `ADMIN_PASSWORD_HASH` | Output of `npm run auth:hash -- "your-long-password"` |
| `JWT_SECRET` | A secret with at least 32 random characters |
| `CORS_ORIGINS` | Exact frontend origin(s), comma-separated, without trailing slashes |
| `TRUST_PROXY` | `true` for requests arriving through Vercel's proxy |
| `LOG_LEVEL` | `info` |

For SASL authentication, also set `KAFKA_SASL_MECHANISM`, `KAFKA_SASL_USERNAME`, and `KAFKA_SASL_PASSWORD`. For client-certificate authentication, set `KAFKA_CLIENT_CERT_BASE64` and `KAFKA_CLIENT_KEY_BASE64` instead. Set `KAFKA_CA_CERT_BASE64` when your provider requires its own CA. Copy the base64 certificate contents, not local file paths. Do not set unused optional variables to empty strings.

Keep secrets in Vercel environment settings. `.vercelignore` excludes local environment files and certificates from CLI uploads. Redeploy after changing environment variables.

With `TRUST_PROXY=true`, Express uses Vercel's `X-Forwarded-For` header for client IP rate limits. The limiters intentionally ignore the additional `Forwarded` header and disable only its warning; default IPv6 grouping and other validation remain enabled. See [Vercel request headers](https://vercel.com/docs/headers/request-headers).

## 4. Run the consumer separately

On a persistent Node.js host, build this repository and run `npm run start:consumer` under a process supervisor, or use the existing Docker image with `node dist/src/consumer.js` as its command. Configure the same production database, Kafka topic, and authentication, plus `KAFKA_GROUP_ID=inventory-consumer`. The shared configuration currently also requires admin credentials and `JWT_SECRET` for the consumer.

Do not launch `src/consumer.ts` from a Vercel request handler or a cron request. It continuously consumes Kafka messages and needs a persistent process.

## 5. Deploy and verify

Click Deploy in Vercel. Alternatively, after linking the project and configuring its environment, run `npx vercel --prod` from the repository root.

Check `https://YOUR-PROJECT.vercel.app/health/live` for `{"status":"ok"}`, then `/health/ready` to verify database connectivity. `/` intentionally returns the API's JSON 404. Readiness checks PostgreSQL only; verify Kafka and the worker by logging in, submitting an event, and polling its `/api/events/:eventId` URL until processed. The README contains login and API examples; replace the localhost base URL with your deployment URL.

The producer connects on the first event submission and reuses that connection in warm invocations. Publication finishes before the API returns `202`; login and read routes do not need a Kafka connection. Database pools and rate-limit counters are per function instance. Budget database connections for scaling, and use a shared rate-limit store or platform controls if you need limits enforced across all instances.

References: [Vercel Node.js Functions](https://vercel.com/docs/functions/runtimes/node-js), [Vercel function limits](https://vercel.com/docs/functions/limitations).
