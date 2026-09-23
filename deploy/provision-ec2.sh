#!/usr/bin/env bash
# Run once on a fresh Ubuntu 24.04 EC2 instance: sudo bash deploy/provision-ec2.sh ubuntu
set -euo pipefail
deploy_user="${1:-ubuntu}"
test "$(id -u)" -eq 0 || { echo 'Run with sudo.'; exit 1; }
id "$deploy_user" >/dev/null
. /etc/os-release
test "$ID" = ubuntu && test "$VERSION_ID" = 24.04 || { echo 'This script requires Ubuntu 24.04.'; exit 1; }
apt-get update
apt-get install -y ca-certificates curl nginx certbot python3-certbot-nginx
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' \
  "$(dpkg --print-architecture)" "$VERSION_CODENAME" > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
usermod -aG docker "$deploy_user"
install -d -m 750 -o "$deploy_user" -g "$(id -gn "$deploy_user")" \
  /opt/fundtech /opt/fundtech/shared /opt/fundtech/releases /opt/fundtech/uploads
systemctl enable --now docker nginx
echo 'Provisioned. Log out and reconnect for Docker group membership to apply.'
