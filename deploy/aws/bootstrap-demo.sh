#!/usr/bin/env bash
set -Eeuo pipefail

# LoanOS synthetic-data demo bootstrap for Ubuntu 24.04.
# This intentionally installs one tenant-bound Rust runtime and PostgreSQL on
# the same encrypted demo VM. It is not a production topology.

: "${LOANOS_SOURCE_REPOSITORY:?LOANOS_SOURCE_REPOSITORY is required}"
: "${LOANOS_SOURCE_REF:=main}"
: "${LOANOS_STACK_NAME:?LOANOS_STACK_NAME is required}"
: "${LOANOS_AWS_REGION:?LOANOS_AWS_REGION is required}"

STATUS_PARAMETER="/loanos-demo/${LOANOS_STACK_NAME}/status"
CREDENTIALS_PARAMETER="/loanos-demo/${LOANOS_STACK_NAME}/credentials"
APP_DIR=/opt/loanos/app
STATE_DIR=/var/lib/loanos
RULES_PORT=47311

put_status() {
  aws ssm put-parameter \
    --region "$LOANOS_AWS_REGION" \
    --name "$STATUS_PARAMETER" \
    --type String \
    --overwrite \
    --value "$1" >/dev/null
}

on_error() {
  local line=$1
  local code=$2
  put_status "FAILED at bootstrap line ${line} (exit ${code}); inspect /var/log/loanos-bootstrap.log" || true
  exit "$code"
}
trap 'on_error "$LINENO" "$?"' ERR

apt-get update
apt-get install -y \
  build-essential ca-certificates curl git jq libssl-dev nginx \
  pkg-config postgresql postgresql-contrib unzip

if ! command -v aws >/dev/null; then
  curl --fail --show-error --silent --location \
    https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip \
    -o /tmp/awscliv2.zip
  rm -rf /tmp/aws
  unzip -q /tmp/awscliv2.zip -d /tmp
  /tmp/aws/install
  rm -rf /tmp/aws /tmp/awscliv2.zip
fi

put_status STARTED

# Ubuntu 24.04 ships Node 18, while LoanOS requires Node 20+.
curl --fail --show-error --silent --location \
  https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
node -e 'if (Number(process.versions.node.split(".")[0]) < 20) process.exit(1)'

if ! command -v cargo >/dev/null; then
  curl --proto '=https' --tlsv1.2 --fail --show-error --silent \
    https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable
fi
export PATH="/root/.cargo/bin:$PATH"

install -d -m 0750 /opt/loanos "$STATE_DIR" "$STATE_DIR/audit"
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" fetch --depth 1 origin "$LOANOS_SOURCE_REF"
  git -C "$APP_DIR" checkout --force FETCH_HEAD
else
  rm -rf "$APP_DIR"
  git clone --depth 1 --branch "$LOANOS_SOURCE_REF" \
    "$LOANOS_SOURCE_REPOSITORY" "$APP_DIR"
fi

cd "$APP_DIR"
npm ci --omit=dev
cargo build --manifest-path rules/Cargo.toml --release \
  --package rules-service --package rules-fleet

DB_PASSWORD=$(openssl rand -hex 24)
PLATFORM_ADMIN_KEY=$(openssl rand -hex 32)
PLATFORM_ADMIN_PASSWORD=$(openssl rand -hex 24)
TENANT_API_KEY=$(openssl rand -hex 32)
TENANT_ADMIN_PASSWORD=$(openssl rand -hex 24)
RULES_ADMIN_TOKEN=$(openssl rand -hex 32)
MASTER_KEY=$(openssl rand -hex 32)

systemctl enable --now postgresql
sudo -u postgres psql -v ON_ERROR_STOP=1 -f "$APP_DIR/db/schema.sql"
sudo -u postgres psql -v ON_ERROR_STOP=1 \
  --set=role_password="$DB_PASSWORD" <<'SQL'
ALTER ROLE loanos_control_plane WITH PASSWORD :'role_password';
SQL

install -d -m 0750 /etc/loanos
cat > /etc/loanos/api.env <<EOF
NODE_ENV=demo
PORT=3040
LOANOS_STORAGE_DRIVER=postgres
DATABASE_URL=postgres://loanos_control_plane:${DB_PASSWORD}@127.0.0.1:5432/postgres
LOANOS_DATABASE_ENCRYPTION_AT_REST=true
LOANOS_MASTER_KEYS='{"demo-key-v1":"${MASTER_KEY}"}'
LOANOS_ACTIVE_MASTER_KEY_ID=demo-key-v1
LOANOS_RULES_ENGINE=active
LOANOS_RULES_ENGINE_URLS='{"dev":"http://127.0.0.1:${RULES_PORT}"}'
LOANOS_EMAIL_PROVIDER=mock
LOANOS_DEV_TENANT_KEY=${TENANT_API_KEY}
LOANOS_DEV_ADMIN_PASSWORD=${TENANT_ADMIN_PASSWORD}
LOANOS_PLATFORM_ADMIN_KEY=${PLATFORM_ADMIN_KEY}
LOANOS_PLATFORM_ADMIN_PASSWORD=${PLATFORM_ADMIN_PASSWORD}
EOF
chmod 0640 /etc/loanos/api.env

# These checked-in keys are deliberately development-only. They sign only
# synthetic demo bundles generated on this VM and must never be promoted.
RULES_SIGNING_KEY=00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff
RULES_VERIFYING_KEY=3ccd241cffc9b3618044b97d036d8614593d8b017c340f1dee8773385517654b
RULES_FLEET="$APP_DIR/rules/target/release/rules-fleet"

"$RULES_FLEET" sign --kind platform \
  --label demo-platform-r1 --effective "2026-07-01T00:00:00+05:30" \
  --author demo-maker --approver demo-checker \
  --signing-key "$RULES_SIGNING_KEY" \
  --out "$STATE_DIR/platform-bundle.json" \
  "$APP_DIR/rules/fixtures/guardrail-eligibility.json" \
  "$APP_DIR/rules/fixtures/guardrail-collections-contact.json"

"$RULES_FLEET" sign --kind tenant --tenant dev \
  --label demo-tenant-r1 --effective "2026-07-01T00:00:00+05:30" \
  --author demo-maker --approver demo-checker \
  --signing-key "$RULES_SIGNING_KEY" \
  --out "$STATE_DIR/tenant-bundle.json" \
  "$APP_DIR/rules/fixtures/lending-eligibility.json"

cat > /etc/loanos/rules.env <<EOF
RULES_TENANT_ID=dev
RULES_INSTANCE_ID=demo-dev-1
RULES_PORT=${RULES_PORT}
RULES_VERIFYING_KEY=${RULES_VERIFYING_KEY}
RULES_TENANT_BUNDLE=${STATE_DIR}/tenant-bundle.json
RULES_PLATFORM_BUNDLE=${STATE_DIR}/platform-bundle.json
RULES_KILL_TTL_SECONDS=90
RULES_ADMIN_TOKEN=${RULES_ADMIN_TOKEN}
RULES_AUDIT_PATH=${STATE_DIR}/audit/dev-decisions.jsonl
EOF
chmod 0640 /etc/loanos/rules.env

cat > /usr/local/sbin/loanos-refresh-kill-switch <<EOF
#!/usr/bin/env bash
set -euo pipefail
curl --fail --silent --show-error \
  -H 'content-type: application/json' \
  -H 'x-control-plane-token: ${RULES_ADMIN_TOKEN}' \
  --data-binary "{\"as_of\":\"\$(date --iso-8601=seconds)\",\"global\":{\"active\":false},\"models\":{\"cibil_gateway\":\"active\"}}" \
  http://127.0.0.1:${RULES_PORT}/v1/admin/kill-switch
EOF
chmod 0750 /usr/local/sbin/loanos-refresh-kill-switch

cat > /etc/systemd/system/loanos-rules.service <<EOF
[Unit]
Description=LoanOS tenant-bound Rust decision engine (synthetic demo)
After=network.target

[Service]
Type=simple
EnvironmentFile=/etc/loanos/rules.env
ExecStart=${APP_DIR}/rules/target/release/rules-service
Restart=on-failure
RestartSec=3
User=root
WorkingDirectory=${APP_DIR}

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/loanos-kill-switch.service <<'EOF'
[Unit]
Description=Refresh LoanOS demo kill-switch cache
After=loanos-rules.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/loanos-refresh-kill-switch
EOF

cat > /etc/systemd/system/loanos-kill-switch.timer <<'EOF'
[Unit]
Description=Keep LoanOS demo kill-switch state fresh

[Timer]
OnBootSec=10
OnUnitActiveSec=30
AccuracySec=2
Unit=loanos-kill-switch.service

[Install]
WantedBy=timers.target
EOF

cat > /etc/systemd/system/loanos-api.service <<EOF
[Unit]
Description=LoanOS Node API and static applications (synthetic demo)
After=network.target postgresql.service loanos-rules.service
Requires=postgresql.service loanos-rules.service

[Service]
Type=simple
EnvironmentFile=/etc/loanos/api.env
ExecStart=/usr/bin/node apps/api/src/server.js
Restart=on-failure
RestartSec=3
User=root
WorkingDirectory=${APP_DIR}

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/nginx/sites-available/loanos-demo <<'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    client_max_body_size 4m;

    add_header X-LoanOS-Environment "synthetic-demo" always;
    location / {
        proxy_pass http://127.0.0.1:3040;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF
rm -f /etc/nginx/sites-enabled/default
ln -sfn /etc/nginx/sites-available/loanos-demo /etc/nginx/sites-enabled/loanos-demo
nginx -t

systemctl daemon-reload
systemctl enable --now loanos-rules.service
for _ in $(seq 1 30); do
  curl --fail --silent "http://127.0.0.1:${RULES_PORT}/health" >/dev/null && break
  sleep 1
done
/usr/local/sbin/loanos-refresh-kill-switch
systemctl enable --now loanos-kill-switch.timer
systemctl enable --now loanos-api.service
systemctl restart nginx

for _ in $(seq 1 60); do
  curl --fail --silent http://127.0.0.1:3040/health >/dev/null && break
  sleep 1
done
curl --fail --silent http://127.0.0.1:3040/health >/dev/null
curl --fail --silent "http://127.0.0.1:${RULES_PORT}/health" | jq -e '.kill_switch_fresh == true' >/dev/null

CREDENTIALS_JSON=$(jq -n \
  --arg environment "synthetic-demo-only" \
  --arg tenantId "dev" \
  --arg tenantAdminEmail "admin@dev.loanos.local" \
  --arg tenantAdminPassword "$TENANT_ADMIN_PASSWORD" \
  --arg tenantApiKey "$TENANT_API_KEY" \
  --arg platformAdminEmail "admin@loanos.local" \
  --arg platformAdminPassword "$PLATFORM_ADMIN_PASSWORD" \
  --arg platformAdminKey "$PLATFORM_ADMIN_KEY" \
  '{environment:$environment, tenantId:$tenantId, tenantAdminEmail:$tenantAdminEmail, tenantAdminPassword:$tenantAdminPassword, tenantApiKey:$tenantApiKey, platformAdminEmail:$platformAdminEmail, platformAdminPassword:$platformAdminPassword, platformAdminKey:$platformAdminKey}')

aws ssm put-parameter \
  --region "$LOANOS_AWS_REGION" \
  --name "$CREDENTIALS_PARAMETER" \
  --description "Generated credentials for the LoanOS synthetic demo" \
  --type SecureString \
  --overwrite \
  --value "$CREDENTIALS_JSON" >/dev/null
aws ssm add-tags-to-resource \
  --region "$LOANOS_AWS_REGION" \
  --resource-type Parameter \
  --resource-id "$CREDENTIALS_PARAMETER" \
  --tags Key=LoanOS-Environment,Value=demo >/dev/null

put_status COMPLETE
trap - ERR
