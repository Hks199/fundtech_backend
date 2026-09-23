#!/usr/bin/env bash
set -euo pipefail

release="${1:?Release directory required}"
revision="${2:?Commit SHA required}"
[[ "$revision" =~ ^[a-f0-9]{40}$ ]] || exit 1
release="$(realpath "$release")"
[[ "$release" == /opt/fundtech/releases/* ]] || exit 1

# Serialize manual deployments as well as Actions deployments.
exec 9>/opt/fundtech/deploy.lock
flock -w 900 9
if [ -n "${3:-}" ]; then
  incoming_env="$(realpath "$3")"
  [[ "$incoming_env" == /opt/fundtech/uploads/env-* ]] || exit 1
  test -s "$incoming_env" || { echo 'Uploaded application configuration is empty.'; exit 1; }
  # Normalize Windows line endings without interpreting $, quotes, or shell code.
  umask 077
  staged_env="$(mktemp /opt/fundtech/shared/.env.XXXXXX)"
  trap 'rm -f -- "$staged_env"' EXIT
  sed 's/\r$//' "$incoming_env" > "$staged_env"
  chmod 600 "$staged_env"
  mv -f "$staged_env" /opt/fundtech/shared/.env
  rm -f -- "$incoming_env"
fi
test -s /opt/fundtech/shared/.env || { echo 'Deploy through GitHub Actions with the individual application secrets configured.'; exit 1; }
cd "$release"
ln -s /opt/fundtech/shared/.env .env
export IMAGE_TAG="$revision"
compose=(docker compose --project-name fundtech --env-file /dev/null -f compose.ec2.yaml)
"${compose[@]}" build api
# These complete before replacing the existing running services.
"${compose[@]}" run --rm --no-deps api node dist/scripts/migrate.js
"${compose[@]}" run --rm --no-deps api node dist/scripts/kafka-setup.js
"${compose[@]}" up -d --no-build --wait --wait-timeout 180
curl --fail --silent --show-error http://127.0.0.1:3000/health/ready
printf '\n'
# Catch immediate consumer crashes; this does not prove event processing.
sleep 10
consumer_id="$("${compose[@]}" ps -q consumer)"
test -n "$consumer_id"
test "$(docker inspect --format '{{.State.Running}} {{.RestartCount}}' "$consumer_id")" = 'true 0'
if [ -L /opt/fundtech/current ]; then
  ln -sfn "$(readlink /opt/fundtech/current)" /opt/fundtech/previous
fi
ln -sfn "$release" /opt/fundtech/current
echo "Deployed $revision. Verify a submitted event reaches processed status."
