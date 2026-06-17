#!/usr/bin/env bash
set -euo pipefail

# RelayCore Panel 安装脚本（release 包内使用）
# 由 install.sh 下载 release 后调用，也可手动从 release 包执行

BIN="${BIN:-/usr/local/bin/relaycore-panel}"
WEB_DIR="${WEB_DIR:-/opt/relaycore/web}"
DATA_DIR="${DATA_DIR:-/var/lib/relaycore}"
CONFIG_DIR="${CONFIG_DIR:-/etc/relaycore}"
ENV_FILE="${ENV_FILE:-${CONFIG_DIR}/panel.env}"
RUN_USER="${RUN_USER:-relaycore}"
SERVICE="/etc/systemd/system/relaycore-panel.service"

if [ "$(id -u)" != "0" ]; then
  echo "请使用 root 用户运行"
  exit 1
fi

if [ ! -x "./relaycore-panel" ]; then
  echo "请先在项目目录执行：make panel"
  exit 1
fi

# 创建系统用户
if ! id "$RUN_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$RUN_USER"
fi

mkdir -p "$(dirname "$BIN")" "$WEB_DIR" "$DATA_DIR" "$CONFIG_DIR" /opt/relaycore
install -m 0755 ./relaycore-panel "$BIN"
cp -a ./web/. "$WEB_DIR/"
chown -R root:root "$WEB_DIR" /opt/relaycore
chown -R "$RUN_USER:$RUN_USER" "$DATA_DIR"
chmod 0755 "$WEB_DIR" /opt/relaycore
chmod 0700 "$DATA_DIR"

if [ ! -f "$ENV_FILE" ]; then
  cat >"$ENV_FILE" <<ENV_EOF
RELAYCORE_ADDR=127.0.0.1:10028
RELAYCORE_DATA=${DATA_DIR}
RELAYCORE_WEB=${WEB_DIR}
ADMIN_USER=admin
# ADMIN_PASSWORD=
ENV_EOF
  chown root:"$RUN_USER" "$ENV_FILE"
  chmod 0640 "$ENV_FILE"
fi

cat >"$SERVICE" <<SERVICE_EOF
[Unit]
Description=RelayCore Panel
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${RUN_USER}
Group=${RUN_USER}
WorkingDirectory=/opt/relaycore
EnvironmentFile=-${ENV_FILE}
ExecStart=${BIN}
Restart=always
RestartSec=3
LimitNOFILE=1048576
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${DATA_DIR}
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
LockPersonality=true
MemoryDenyWriteExecute=true
SystemCallArchitectures=native

[Install]
WantedBy=multi-user.target
SERVICE_EOF

systemctl daemon-reload
systemctl enable relaycore-panel
systemctl restart relaycore-panel
echo "RelayCore Panel 已启动：http://127.0.0.1:10028"
echo "配置文件：${ENV_FILE}"
echo "生产环境建议通过 Nginx/Caddy 反向代理并启用 HTTPS。"
