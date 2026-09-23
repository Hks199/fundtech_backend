# EC2 deployment with GitHub Actions

This setup runs the API and Kafka consumer continuously on one EC2 instance. Nginx handles public HTTPS; the API listens only on host loopback. PostgreSQL and Kafka remain your existing managed services. These files do not create AWS resources or deploy until you configure the host and GitHub.

## 1. Create the EC2 instance

Use Ubuntu Server 24.04 LTS, an x86_64 instance with at least 2 GB RAM for the on-host Docker build, and approximately 30 GB of disk. Attach an Elastic IP so DNS and SSH remain stable. Create an SSH key pair and keep its private key locally.

Security group inbound rules:

| Port | Source | Purpose |
| --- | --- | --- |
| 22 | Your IP and your CI runner's outbound IP/CIDR | SSH deployment |
| 80 | Internet | HTTP and certificate validation |
| 443 | Internet | HTTPS API |

Do not expose port 3000, PostgreSQL, or Kafka on this instance. Allow outbound connections to your managed services, package repositories, and certificate services. Configure provider network allowlists for the EC2 outbound address if required.

The workflow uses GitHub-hosted `ubuntu-latest` runners, whose outbound addresses vary. Your SSH rule must permit the actual runner. For a restricted production setup use a runner with static egress (and change `runs-on` to its label), or a separate self-hosted runner with network access to EC2. Do not assume allowing only your laptop IP permits Actions deployment. Broadly opening SSH is not necessary with a static-egress runner.

Point an API domain such as `api.example.com` at the Elastic IP. Connect:

```bash
ssh -i your-ec2-key.pem ubuntu@YOUR_EC2_IP
```

## 2. Provision the host once

From your local repository, copy the provisioning script and Nginx template:

```bash
scp -i your-ec2-key.pem deploy/provision-ec2.sh deploy/nginx.conf ubuntu@YOUR_EC2_IP:/home/ubuntu/
ssh -i your-ec2-key.pem ubuntu@YOUR_EC2_IP
sudo bash /home/ubuntu/provision-ec2.sh ubuntu
exit
```

Reconnect, then verify `docker version` and `docker compose version`. Compose must be version 2.30 or newer because the environment file uses raw values. Membership in the Docker group grants administrative control of the host; use a dedicated instance for this application.

## 3. Configure production secrets on EC2

On EC2:

```bash
umask 077
nano /opt/fundtech/shared/.env
chmod 600 /opt/fundtech/shared/.env
```

Use the values from your working managed-service configuration, not localhost services. Put raw `KEY=value` entries in this file, without quotes or inline comments. Docker reads it in raw mode so the `$` characters in password hashes stay intact.

```dotenv
NODE_ENV=production
PORT=3000
DATABASE_URL=YOUR_MANAGED_DATABASE_URL
DATABASE_SSL=true
KAFKA_BROKERS=YOUR_KAFKA_HOST:PORT
KAFKA_SSL=true
KAFKA_TOPIC=inventory-events
KAFKA_CLIENT_ID=inventory-ec2
KAFKA_GROUP_ID=inventory-consumer
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=YOUR_EXISTING_SCRYPT_HASH
JWT_SECRET=YOUR_RANDOM_SECRET_AT_LEAST_32_CHARACTERS
CORS_ORIGINS=https://your-frontend.example.com
TRUST_PROXY=true
LOG_LEVEL=info
```

Also add the Kafka SASL or base64 client-certificate settings used by your provider, and the base64 CA certificate if required. Use one authentication method. Add `MIGRATION_DATABASE_URL` when migrations need a direct database connection. Omit unused optional variables entirely. See [Aiven/Neon configuration](aiven-neon.md). Never commit this file or put the application secrets into the workflow YAML.

The workflow runs migrations and topic setup before replacing services. Its credentials therefore need those permissions. The current migration is an idempotent initial schema; future migrations must remain compatible with the running release during deployment.

## 4. Configure Nginx and HTTPS

On EC2, edit `/home/ubuntu/nginx.conf` and replace `api.example.com` with your actual API domain:

```bash
sudo cp /home/ubuntu/nginx.conf /etc/nginx/sites-available/fundtech
sudo ln -sfn /etc/nginx/sites-available/fundtech /etc/nginx/sites-enabled/fundtech
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d api.example.com
sudo certbot renew --dry-run
```

DNS must resolve to EC2 and port 80 must be reachable before requesting the certificate. Nginx can return 502 until the first application deployment finishes. Keep the default Nginx site if desired; use your configured domain to access the API. This template assumes Nginx is the sole reverse proxy immediately in front of Express.

## 5. Configure GitHub deployment access

Create a separate deployment SSH key on your local computer:

```bash
ssh-keygen -t ed25519 -f github-ec2-deploy -C github-actions-fundtech
```

Leave the passphrase empty for this automation key. Append the `.pub` file's single line to `/home/ubuntu/.ssh/authorized_keys` on EC2. Keep `.ssh` permission 700 and `authorized_keys` permission 600. Never commit either private key. Test the new key before continuing:

```bash
ssh -i github-ec2-deploy ubuntu@YOUR_EC2_IP 'docker compose version'
```

Create a GitHub environment named `production` under repository Settings → Environments. Restrict deployment branches to `dev-1`. Add these environment secrets (repository Actions secrets also work if environment secrets are unavailable for your repository/plan):

| Secret | Value |
| --- | --- |
| `EC2_HOST` | Elastic IP or SSH hostname, without `https://` |
| `EC2_USER` | `ubuntu` |
| `EC2_SSH_KEY` | Entire private `github-ec2-deploy` file, including BEGIN/END lines |
| `EC2_KNOWN_HOSTS` | Verified SSH host-key entry described below |

For `EC2_KNOWN_HOSTS`, use the EC2 console or an already trusted SSH connection to run:

```bash
cat /etc/ssh/ssh_host_ed25519_key.pub
```

Construct one line using the exact hostname/IP in `EC2_HOST`, followed by the first two fields from that public key:

```text
YOUR_EC2_IP ssh-ed25519 AAAA...actual-public-host-key...
```

This is the server's public host key, not your deployment key. The workflow requires strict host verification and does not blindly trust a key fetched during deployment.

## 6. Push and deploy

Commit the setup files and push to `dev-1`. GitHub Actions → Deploy backend to EC2 shows the run. Manual Run workflow requires this workflow to also exist on the repository default branch; select `dev-1` when running it. Push-triggered deployments do not require changing the default branch. If your branch has another name, update both `branches` and the deploy job's `if` condition in `.github/workflows/deploy.yml`.

The workflow tests on Node 24, uploads a Git archive of the commit over SSH, builds an image tagged with that commit, runs migrations/topic setup, and starts both containers. It waits for database readiness and checks that the consumer hasn't immediately crashed. It keeps `/opt/fundtech/current` and `/opt/fundtech/previous` release links after successful deployments. It does not delete old images/releases automatically; monitor disk usage and retain known-good releases when cleaning up.

## 7. Verify and switch the frontend

```bash
curl --fail https://api.example.com/health/live
curl --fail https://api.example.com/health/ready
```

Both should return `{"status":"ok"}`. `/` returns JSON 404 because this is an API without a homepage. Update the frontend API base URL (or its development proxy target) to `https://api.example.com`; rebuild/restart the frontend. Configure the frontend origin in the server's `CORS_ORIGINS`.

Log in, submit a new inventory event, and poll its event-status URL. Confirm it becomes `applied` or `rejected`. An HTTP health check alone does not prove Kafka processing. On EC2:

```bash
cd /opt/fundtech/current
export IMAGE_TAG="$(basename "$(pwd -P)" | cut -d- -f1)"
docker compose -p fundtech --env-file /dev/null -f compose.ec2.yaml ps
docker compose -p fundtech --env-file /dev/null -f compose.ec2.yaml logs --tail=100 consumer
```

Look for `Consumer started` and `Event processed`. Stop any old local consumer only once the EC2 worker is verified. Changes to the shared environment require recreating the containers, for example by triggering a new deployment.

## Failure handling and rollback

Build, migration, or topic-setup failures stop the deployment before service replacement. A failure after replacement can leave the new containers running; there is no automatic rollback. In Actions, find the failed release path, then inspect that release with `docker compose -p fundtech --env-file /dev/null -f compose.ec2.yaml logs --tail=100`. Do not print the environment file in logs.

To restore a retained, known-good release manually, select its absolute path from `/opt/fundtech/releases` and run on EC2:

```bash
cd /opt/fundtech/releases/GOOD_COMMIT-RUN_ID-ATTEMPT
export IMAGE_TAG="$(basename "$(pwd -P)" | cut -d- -f1)"
docker compose -p fundtech --env-file /dev/null -f compose.ec2.yaml up -d --no-build --wait --wait-timeout 180
ln -sfn "$(pwd -P)" /opt/fundtech/current
```

Coordinate manual rollback with Actions so they do not run simultaneously. Code rollback does not undo database migrations, topic changes, or environment edits. Deployments can briefly interrupt API requests on this single-host setup.

References: [Docker on Ubuntu](https://docs.docker.com/engine/install/ubuntu/), [GitHub Actions secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets).
