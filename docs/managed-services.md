# Confluent Cloud and Neon setup

This backend can run locally or on EC2 while Kafka is hosted by Confluent Cloud and PostgreSQL is hosted by Neon. `compose.yaml` is only for local Kafka and PostgreSQL, so it is not needed when both managed services are configured.

## 1. Neon PostgreSQL

Create a Neon project and database. In the Neon connection details, copy the **pooled** PostgreSQL connection string for `DATABASE_URL` and the **direct** connection string for `MIGRATION_DATABASE_URL`. Both can include `?sslmode=require`. The API and consumer use `DATABASE_URL`; the migration command uses `MIGRATION_DATABASE_URL` when provided. For a small deployment, the direct URL can also be used as `DATABASE_URL`.

Set `DATABASE_SSL=true`. The backend explicitly validates the server certificate. Do not use `sslmode=no-verify` or disable certificate checks. If you manually assemble a URL, encode any special characters in the database password; copying the URL from Neon is simpler.

## 2. Confluent Cloud Kafka

Create a Kafka cluster and copy its **bootstrap server** host and port from the cluster's Clients page. Create a **Kafka cluster API key and secret** for the application. This is different from a Confluent Cloud account API key. Set `KAFKA_BROKERS` to the bootstrap `host:port` without `https://`, `KAFKA_SSL=true`, and the key/secret as `KAFKA_SASL_USERNAME` and `KAFKA_SASL_PASSWORD`. The code uses SASL/PLAIN over TLS.

Create two topics in the Confluent Cloud console: `inventory-events` and `inventory-events-invalid`. Three partitions on each topic match the local setup. The first receives purchase/sale events; the second receives invalid messages. Give the Kafka API key's service account the permissions needed to write both topics, read `inventory-events`, and read the consumer group named by `KAFKA_GROUP_ID`. You can use `npm run kafka:setup` instead if its credentials have topic creation permission; otherwise create the topics in the console and skip that command.

## 3. Environment

Keep the actual values in `.env` locally and in private EC2 deployment settings. Preserve the existing `ADMIN_PASSWORD_HASH` and `JWT_SECRET` if they are already configured.

```dotenv
NODE_ENV=production
DATABASE_URL=postgresql://USER:PASSWORD@POOLED_HOST/DATABASE?sslmode=require
MIGRATION_DATABASE_URL=postgresql://USER:PASSWORD@DIRECT_HOST/DATABASE?sslmode=require
DATABASE_SSL=true
KAFKA_BROKERS=BOOTSTRAP_HOST:9092
KAFKA_SSL=true
KAFKA_SASL_USERNAME=KAFKA_CLUSTER_API_KEY
KAFKA_SASL_PASSWORD=KAFKA_CLUSTER_API_SECRET
KAFKA_TOPIC=inventory-events
KAFKA_GROUP_ID=inventory-consumer
CORS_ORIGINS=https://your-frontend.example
```

The existing `.env.example` lists the other required settings. The API and consumer use the same `.env`. The EC2 `compose.ec2.yaml` file reads it and runs both processes; it does not start local Kafka or PostgreSQL.

## 4. Initialize and run

From the project root, run `npm run build`, then `npm run db:migrate`. If you did not create topics in the Confluent console, run `npm run kafka:setup`. Start `npm run start:consumer` and `npm start` locally, or use the EC2 Docker Compose commands in the main README.

Check `GET /health/ready` after starting the API. Send a sample event with `npm run simulate` and inspect the ledger after the consumer processes it. The simulator uses the configured Confluent Cloud broker, so it will send events to the managed cluster.

The EC2 instance needs outbound connectivity to Neon PostgreSQL (normally TCP 5432) and the Confluent bootstrap/broker endpoints (normally TCP 9092). The managed services do not need inbound access to your EC2 instance. If either service is configured for private networking, the EC2 network must be connected to that private network.
