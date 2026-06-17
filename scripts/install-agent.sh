#!/usr/bin/env bash
set -euo pipefail

BIN="${BIN:-/usr/local/bin/relaycore-agent}"
DATA_DIR="${DATA_DIR:-/etc/relaycore-agent}"
ENV_FILE="${ENV_FILE:-${DATA_DIR}/agent.env}"
SERVICE="/etc/systemd/system/relaycore-agent.service"

if [ "$(id -u)" != "0" ]; then
  echo "请使用 root 用户运行"
  exit 1
fi

if [ ! -x "./relaycore-agent" ]; then
  echo "请先在项目目录执行：make agent"
  exit 1
fi

mkdir -p "$(dirname "$BIN")" "$DATA_DIR"
install -m 0755 ./relaycore-agent "$BIN"
chmod 0700 "$DATA_DIR"

if [ ! -f "$ENV_FILE" ]; then
  cat >"$ENV_FILE" <<ENV_EOF
RELAYCORE_AGENT_DATA=${DATA_DIR}
# 首次接入可填入面板生成的一次性 token，注册成功后 Agent 会保存 node_secret 并清空 token。
RELAYCORE_PANEL=${PANEL_URL:-}
RELAYCORE_TOKEN=${TOKEN:-}
RELAYCORE_NODE_NAME=${NODE_NAME:-}
RELAYCORE_DRY_RUN=${DRY_RUN:-0}
RELAYCORE_FIREWALL_MODE=${FIREWALL_MODE:-managed}
RELAYCORE_SSH_PORTS=${SSH_PORTS:-22}
RELAYCORE_FIREWALL_ROLLBACK_SECONDS=${ROLLBACK_SECONDS:-60}
ENV_EOF
  chmod 0600 "$ENV_FILE"
fi

cat >"$SERVICE" <<SERVICE_EOF
[Unit]
Description=RelayCore Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
EnvironmentFile=-${ENV_FILE}
ExecStart=${BIN}
Restart=always
RestartSec=3
LimitNOFILE=1048576
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=${DATA_DIR}
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK
CapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_RAW CAP_NET_BIND_SERVICE
AmbientCapabilities=CAP_NET_ADMIN CAP_NET_RAW CAP_NET_BIND_SERVICE
LockPersonality=true
SystemCallArchitectures=native

[Install]
WantedBy=multi-user.target
SERVICE_EOF

systemctl daemon-reload
systemctl enable --now relaycore-agent
echo "RelayCore Agent 已启动。首次接入请使用面板生成的 relaycore-agent -panel ... -token ... 命令运行一次。"
echo "也可以编辑 ${ENV_FILE} 填入 RELAYCORE_PANEL 和 RELAYCORE_TOKEN 后重启服务。"
