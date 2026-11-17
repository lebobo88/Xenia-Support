#!/usr/bin/env bash
# Provision the Xenia voice bridge on a Linux host.
#
# Idempotent: safe to re-run. Generates secrets ONLY if .env does not already
# have them, so re-running never silently rotates a live token.
#
#   sudo ./deploy-bridge.sh /srv/xenia /opt/xenia-bridge
#
# Arg 1: the Xenia checkout whose hearth/tasks/ is the ticket store
# Arg 2: where to install the service

set -euo pipefail

XENIA_ROOT="${1:?usage: deploy-bridge.sh <xenia-root> <install-dir>}"
INSTALL_DIR="${2:?usage: deploy-bridge.sh <xenia-root> <install-dir>}"
SERVICE_USER="${SERVICE_USER:-xenia}"
PORT="${PORT:-8137}"

[[ -d "$XENIA_ROOT/hearth" ]] || { echo "no hearth/ under $XENIA_ROOT" >&2; exit 1; }

id -u "$SERVICE_USER" &>/dev/null || useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"

mkdir -p "$INSTALL_DIR"
cp app.py requirements.txt "$INSTALL_DIR/"

python3 -m venv "$INSTALL_DIR/venv"
"$INSTALL_DIR/venv/bin/pip" install --quiet --upgrade pip
"$INSTALL_DIR/venv/bin/pip" install --quiet -r "$INSTALL_DIR/requirements.txt"

ENV_FILE="$INSTALL_DIR/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "generating $ENV_FILE with fresh secrets"
  TOKEN=$(python3 -c "import secrets; print(secrets.token_urlsafe(48))")
  SALT=$(python3 -c "import secrets; print(secrets.token_urlsafe(48))")
  cat > "$ENV_FILE" <<ENVEOF
HYDRA_XENIA_ROOT=$XENIA_ROOT
XENIA_BRIDGE_TOKEN=$TOKEN
XENIA_IDENTITY_SALT=$SALT
XENIA_SCHEMA_VERIFIED=1
XENIA_TICKET_ID_WIDTH=6
XENIA_NOTIFY_TO=
XENIA_SMTP_HOST=
XENIA_SMTP_PORT=587
XENIA_SMTP_USER=
XENIA_SMTP_PASS=
XENIA_SMTP_FROM=
ENVEOF
else
  echo "$ENV_FILE exists; leaving secrets untouched"
fi

chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
chmod 600 "$ENV_FILE"
# The service must be able to write the ticket store.
chown -R "$SERVICE_USER:$SERVICE_USER" "$XENIA_ROOT/hearth/tasks" 2>/dev/null || \
  echo "warn: could not chown $XENIA_ROOT/hearth/tasks - check write access manually"

cat > /etc/systemd/system/xenia-bridge.service <<UNITEOF
[Unit]
Description=Xenia voice bridge
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$INSTALL_DIR/.env
# --workers 1: see README. Concurrency buys nothing on a phone line.
ExecStart=$INSTALL_DIR/venv/bin/uvicorn app:app --host 127.0.0.1 --port $PORT --workers 1
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=read-only
ReadWritePaths=$XENIA_ROOT/hearth

[Install]
WantedBy=multi-user.target
UNITEOF

systemctl daemon-reload
systemctl enable --now xenia-bridge
sleep 2
systemctl --no-pager --lines=5 status xenia-bridge || true

echo
echo "Local health check:"
curl -fsS "http://127.0.0.1:$PORT/healthz" && echo
echo
echo "Next: put nginx.conf.example in front of this on 443, then run:"
echo "  grep XENIA_BRIDGE_TOKEN $ENV_FILE"
echo "and paste that value into the ElevenLabs tool's Authorization header (type: Secret)."
