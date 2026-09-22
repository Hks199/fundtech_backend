# Aiven Kafka and Neon PostgreSQL

This backend can use Aiven for Apache Kafka and Neon PostgreSQL while the API and consumer run locally or on EC2. When both managed services are configured, do not start the local `compose.yaml` Kafka and PostgreSQL services.

The backend supports both Aiven authentication choices: SASL/SCRAM and client-certificate mTLS. Configure one of them, not both.

## Aiven Kafka

1. Create an Aiven for Apache Kafka service.
2. Open **Quick connect**, choose Node.js, select **SASL**, and create or select a service user.
3. Create the topics `inventory-events` and `inventory-events-invalid`. Use two partitions on Aiven Free tier; larger plans can use three. Grant the service user `readwrite` access to both topics. Aiven ACLs automatically cover consumer groups. The built-in `avnadmin` user works for initial setup but a dedicated service user is better for the deployed application.
4. Copy the SASL host and port, username, and password. Use the SASL endpoint because Aiven's certificate-authentication endpoint uses a different port.
5. Aiven recommends `SCRAM-SHA-256`. Set `KAFKA_SASL_MECHANISM=scram-sha-256`.

Aiven's default SASL endpoint uses the Aiven project CA. Download `ca.pem` from Quick connect and convert it to a one-line base64 value:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("ca.pem"))
```

Put the result in `KAFKA_CA_CERT_BASE64`. As an alternative, enable Aiven's `letsencrypt_sasl` setting and use the public-CA SASL endpoint shown by Aiven; then leave `KAFKA_CA_CERT_BASE64` empty because Node trusts Let's Encrypt.

Do not include `https://` in `KAFKA_BROKERS`. Use Aiven's exact SASL port, for example `service-project.aivencloud.com:12345`.

### Client-certificate authentication

If Aiven shows **Access key**, **Access certificate**, and **CA certificate**, you are viewing the client-certificate endpoint. Download all three files, typically named `service.key`, `service.cert`, and `ca.pem`. Convert each file to base64 in PowerShell:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("ca.pem"))
[Convert]::ToBase64String([IO.File]::ReadAllBytes("service.cert"))
[Convert]::ToBase64String([IO.File]::ReadAllBytes("service.key"))
```

Use the resulting values as `KAFKA_CA_CERT_BASE64`, `KAFKA_CLIENT_CERT_BASE64`, and `KAFKA_CLIENT_KEY_BASE64`, respectively. Leave the SASL username and password empty. The private access key is a secret; do not commit it or paste it into chat.

```dotenv
KAFKA_BROKERS=kafka-312762ab-fundtech1998-595.f.aivencloud.com:11802
KAFKA_SSL=true
KAFKA_SASL_USERNAME=
KAFKA_SASL_PASSWORD=
KAFKA_CA_CERT_BASE64=BASE64_OF_CA_PEM
KAFKA_CLIENT_CERT_BASE64=BASE64_OF_SERVICE_CERT
KAFKA_CLIENT_KEY_BASE64=BASE64_OF_SERVICE_KEY
```

The `KAFKA_SASL_MECHANISM` value is ignored when SASL credentials are empty. Use the exact client-certificate service URI shown by Aiven because its port differs from the SASL endpoint.

## Neon PostgreSQL

Create a Neon project and database. Copy its pooled connection string into `DATABASE_URL` and its direct connection string into `MIGRATION_DATABASE_URL`. Set `DATABASE_SSL=true`. The application uses the pooled URL, while database setup uses the direct URL when it is present.

## Environment example

Keep the real values in `.env` or an EC2 secret store and never commit them:

```dotenv
NODE_ENV=production

DATABASE_URL=postgresql://USER:PASSWORD@POOLED_HOST/DATABASE?sslmode=require
MIGRATION_DATABASE_URL=postgresql://USER:PASSWORD@DIRECT_HOST/DATABASE?sslmode=require
DATABASE_SSL=true

KAFKA_BROKERS=AIVEN_SASL_HOST:AIVEN_SASL_PORT
KAFKA_SSL=true
KAFKA_SASL_MECHANISM=scram-sha-256
KAFKA_SASL_USERNAME=AIVEN_SERVICE_USER
KAFKA_SASL_PASSWORD=AIVEN_SERVICE_PASSWORD
KAFKA_CA_CERT_BASE64=BASE64_ENCODED_CA_PEM
KAFKA_TOPIC=inventory-events
# Aiven Free tier permits at most two partitions per topic.
KAFKA_TOPIC_PARTITIONS=2
KAFKA_GROUP_ID=inventory-consumer

CORS_ORIGINS=https://your-frontend.example
```

Keep the existing `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `JWT_SECRET`, `PORT`, and logging settings. If you are testing locally, `NODE_ENV=development` is fine while both managed connections still use TLS.

## Initialize and verify

```powershell
npm run build
npm run db:migrate
npm run kafka:setup
```

Skip `npm run kafka:setup` if you already created both topics in Aiven. It requires topic creation permission; ordinary `readwrite` topic access is insufficient for cluster-level topic creation.

Start the consumer and API in separate terminals:

```powershell
npm run start:consumer
```

```powershell
npm start
```

Check `http://localhost:3000/health/ready`, then run `npm run simulate`. A successful consumer log should show each event being applied. On EC2, use `compose.ec2.yaml`; both containers receive the same managed-service settings from `.env`.
