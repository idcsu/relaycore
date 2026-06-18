#!/usr/bin/env bash
set -euo pipefail

# RelayCore 一键安装 + 管理脚本
# 参照 RelayGuard 管理脚本设计，适配 RelayCore 架构（Panel + Agent + nftables）

REPO="${RELAYCORE_REPO:-idcsu/relaycore}"
VERSION="${RELAYCORE_VERSION:-latest}"
TMP_DIR=""

# Panel 路径
PANEL_BIN="${RELAYCORE_BIN:-/usr/local/bin/relaycore-panel}"
PANEL_WEB_DIR="${RELAYCORE_WEB_DIR:-/opt/relaycore/web}"
PANEL_DATA_DIR="${RELAYCORE_DATA_DIR:-/var/lib/relaycore}"
PANEL_CONFIG_DIR="${RELAYCORE_CONFIG_DIR:-/etc/relaycore}"
PANEL_ENV_FILE="${RELAYCORE_ENV_FILE:-${PANEL_CONFIG_DIR}/panel.env}"
PANEL_SERVICE="relaycore-panel.service"
PANEL_RUN_USER="relaycore"
PANEL_DEFAULT_ADDR="0.0.0.0"
PANEL_DEFAULT_PORT="10028"

# Agent 路径
AGENT_BIN="${RELAYCORE_AGENT_BIN:-/usr/local/bin/relaycore-agent}"
AGENT_DATA_DIR="${RELAYCORE_AGENT_DATA_DIR:-/etc/relaycore-agent}"
AGENT_ENV_FILE="${RELAYCORE_AGENT_ENV_FILE:-${AGENT_DATA_DIR}/agent.env}"
AGENT_SERVICE="relaycore-agent.service"

# ---------- 颜色 ----------
red(){ printf '\033[31m%s\033[0m\n' "$*"; }
green(){ printf '\033[32m%s\033[0m\n' "$*"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$*"; }
blue(){ printf '\033[1;34m[RelayCore]\033[0m %s\n' "$*"; }

# ---------- 交互读取 ----------
read_tty(){
  local __var="$1"; shift
  local __prompt="$*"
  if [ -r /dev/tty ]; then
    IFS= read -r -p "$__prompt" "$__var" < /dev/tty
  else
    IFS= read -r -p "$__prompt" "$__var"
  fi
}

read_tty_secret(){
  local __var="$1"; shift
  local __prompt="$*"
  if [ -r /dev/tty ]; then
    IFS= read -r -s -p "$__prompt" "$__var" < /dev/tty
  else
    IFS= read -r -s -p "$__prompt" "$__var"
  fi
  echo
}

need_root(){
  [ "$(id -u)" = "0" ] || { red "请使用 root 用户运行"; exit 1; }
}

# ---------- 架构检测 ----------
detect_arch(){
  case "$(uname -m)" in
    x86_64|amd64) echo "amd64" ;;
    *) red "当前 GitHub Release 暂只提供 linux/amd64 安装包"; exit 1 ;;
  esac
}

# ---------- 依赖安装 ----------
install_deps_panel(){
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    apt-get install -y curl ca-certificates tar gzip libsqlite3-0
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y curl ca-certificates tar gzip sqlite-libs
  elif command -v yum >/dev/null 2>&1; then
    yum install -y curl ca-certificates tar gzip sqlite
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache curl ca-certificates tar gzip sqlite-libs
  else
    command -v curl >/dev/null 2>&1 || { red "请先安装 curl"; exit 1; }
    command -v tar >/dev/null 2>&1 || { red "请先安装 tar"; exit 1; }
  fi
}

install_deps_agent(){
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    apt-get install -y curl ca-certificates tar gzip nftables iproute2
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y curl ca-certificates tar gzip nftables iproute
  elif command -v yum >/dev/null 2>&1; then
    yum install -y curl ca-certificates tar gzip nftables iproute
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache curl ca-certificates tar gzip nftables iproute2
  else
    command -v curl >/dev/null 2>&1 || { red "请先安装 curl"; exit 1; }
    command -v tar >/dev/null 2>&1 || { red "请先安装 tar"; exit 1; }
  fi
}

enable_ipv4_forwarding(){
  mkdir -p /etc/sysctl.d
  if [ -f /etc/sysctl.d/99-relaycore.conf ]; then
    if grep -q '^net.ipv4.ip_forward=' /etc/sysctl.d/99-relaycore.conf; then
      sed -i 's/^net.ipv4.ip_forward=.*/net.ipv4.ip_forward=1/' /etc/sysctl.d/99-relaycore.conf
    else
      printf '\nnet.ipv4.ip_forward=1\n' >>/etc/sysctl.d/99-relaycore.conf
    fi
  else
    printf 'net.ipv4.ip_forward=1\n' >/etc/sysctl.d/99-relaycore.conf
  fi
  if sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1; then
    green "已开启 IPv4 转发：net.ipv4.ip_forward=1"
  else
    yellow "IPv4 转发开启失败，请手动检查：sysctl net.ipv4.ip_forward"
  fi
}

# ---------- 下载 release ----------
release_base_url(){
  if [ "$VERSION" = "latest" ]; then
    echo "https://github.com/${REPO}/releases/latest/download"
    return
  fi
  local tag="$VERSION"
  case "$tag" in
    v*) ;;
    *) tag="v${tag}" ;;
  esac
  echo "https://github.com/${REPO}/releases/download/${tag}"
}

download_release(){
  local arch
  arch="$(detect_arch)"
  TMP_DIR="$(mktemp -d)"
  trap 'if [ -n "${TMP_DIR}" ]; then rm -rf "${TMP_DIR}"; fi' EXIT
  local base
  base="$(release_base_url)"
  local archive="${TMP_DIR}/relaycore-linux-${arch}.tar.gz"
  yellow "下载 RelayCore release：${base}/relaycore-linux-${arch}.tar.gz"
  curl -fL "${base}/relaycore-linux-${arch}.tar.gz" -o "$archive"
  if curl -fsL "${base}/SHA256SUMS" -o "${TMP_DIR}/SHA256SUMS" 2>/dev/null; then
    (cd "$TMP_DIR" && sha256sum -c --ignore-missing SHA256SUMS) && green "SHA256 校验通过" || yellow "SHA256 校验跳过"
  fi
  mkdir -p "${TMP_DIR}/release"
  tar -xzf "$archive" -C "${TMP_DIR}/release" --strip-components=1
}

# ---------- 写 Panel env ----------
write_panel_env(){
  local addr="$1"
  local admin_user="$2"
  local admin_password="$3"
  mkdir -p "$PANEL_CONFIG_DIR"
  {
    printf 'RELAYCORE_ADDR=%s\n' "$addr"
    printf 'RELAYCORE_DATA=%s\n' "$PANEL_DATA_DIR"
    printf 'RELAYCORE_WEB=%s\n' "$PANEL_WEB_DIR"
    printf 'ADMIN_USER=%s\n' "$admin_user"
    if [ -n "$admin_password" ]; then
      printf 'ADMIN_PASSWORD=%s\n' "$admin_password"
    else
      printf '# ADMIN_PASSWORD=\n'
    fi
  } >"$PANEL_ENV_FILE"
  chown root:"$PANEL_RUN_USER" "$PANEL_ENV_FILE" 2>/dev/null || true
  chmod 0640 "$PANEL_ENV_FILE"
}

# ---------- 写 Agent env ----------
write_agent_env(){
  local panel="$1"
  local token="$2"
  local node_name="$3"
  local dry_run="$4"
  local firewall_mode="$5"
  local ssh_ports="$6"
  local rollback_seconds="$7"
  mkdir -p "$AGENT_DATA_DIR"
  {
    printf 'RELAYCORE_AGENT_DATA=%s\n' "$AGENT_DATA_DIR"
    printf 'RELAYCORE_PANEL=%s\n' "$panel"
    printf 'RELAYCORE_TOKEN=%s\n' "$token"
    printf 'RELAYCORE_NODE_NAME=%s\n' "$node_name"
    printf 'RELAYCORE_DRY_RUN=%s\n' "$dry_run"
    printf 'RELAYCORE_FIREWALL_MODE=%s\n' "$firewall_mode"
    printf 'RELAYCORE_SSH_PORTS=%s\n' "$ssh_ports"
    printf 'RELAYCORE_FIREWALL_ROLLBACK_SECONDS=%s\n' "$rollback_seconds"
  } >"$AGENT_ENV_FILE"
  chmod 0600 "$AGENT_ENV_FILE"
}

# ---------- Panel systemd 服务 ----------
write_panel_service(){
  cat >"/etc/systemd/system/${PANEL_SERVICE}" <<SERVICE_EOF
[Unit]
Description=RelayCore Panel
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${PANEL_RUN_USER}
Group=${PANEL_RUN_USER}
WorkingDirectory=/opt/relaycore
EnvironmentFile=-${PANEL_ENV_FILE}
ExecStart=${PANEL_BIN}
Restart=always
RestartSec=3
LimitNOFILE=1048576
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${PANEL_DATA_DIR}
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
LockPersonality=true
MemoryDenyWriteExecute=true
SystemCallArchitectures=native

[Install]
WantedBy=multi-user.target
SERVICE_EOF
  systemctl daemon-reload
}

# ---------- Agent systemd 服务 ----------
write_agent_service(){
  cat >"/etc/systemd/system/${AGENT_SERVICE}" <<SERVICE_EOF
[Unit]
Description=RelayCore Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
EnvironmentFile=-${AGENT_ENV_FILE}
ExecStart=${AGENT_BIN}
Restart=always
RestartSec=3
LimitNOFILE=1048576
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=${AGENT_DATA_DIR}
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK
CapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_RAW CAP_NET_BIND_SERVICE
AmbientCapabilities=CAP_NET_ADMIN CAP_NET_RAW CAP_NET_BIND_SERVICE
LockPersonality=true
SystemCallArchitectures=native

[Install]
WantedBy=multi-user.target
SERVICE_EOF
  systemctl daemon-reload
}

# ---------- 提示信息 ----------
panel_public_hint(){
  local addr="$1"
  local host="${addr%:*}"
  local port="${addr##*:}"
  if [ "$host" = "0.0.0.0" ] || [ "$host" = "::" ]; then
    echo "http://服务器公网IP:${port}"
  else
    echo "http://${addr}"
  fi
}

show_panel_hint(){
  local addr="$1"
  green "Panel 监听地址：${addr}"
  yellow "浏览器访问：$(panel_public_hint "$addr")"
  yellow "配置文件：${PANEL_ENV_FILE}"
  if echo "$addr" | grep -q '^127\.0\.0\.1\|^localhost'; then
    yellow "当前仅监听本机回环地址，公网无法直接访问。推荐使用 Nginx / Caddy 反向代理。"
  fi
}

# ---------- 读取当前 Panel 监听地址 ----------
current_panel_addr(){
  if [ -f "$PANEL_ENV_FILE" ]; then
    grep '^RELAYCORE_ADDR=' "$PANEL_ENV_FILE" 2>/dev/null | cut -d= -f2- || true
  fi
}

# ---------- SSH 端口自动检测 ----------
detect_ssh_ports(){
  local ports=""

  if [ -n "${SSH_CONNECTION:-}" ]; then
    local p
    p=$(echo "$SSH_CONNECTION" | awk '{print $4}')
    [ -n "$p" ] && ports="$p"
  fi

  if command -v ss >/dev/null 2>&1; then
    local ss_ports
    ss_ports=$(ss -ltnp 2>/dev/null | awk '/sshd/ {split($4,a,":"); print a[length(a)]}' | sort -n | uniq | paste -sd, - || true)
    [ -n "$ss_ports" ] && ports="${ports:+$ports,}$ss_ports"
  fi

  if [ -f /etc/ssh/sshd_config ]; then
    local cfg_ports
    cfg_ports=$(awk 'tolower($1)=="port" {print $2}' /etc/ssh/sshd_config | sort -n | uniq | paste -sd, - || true)
    [ -n "$cfg_ports" ] && ports="${ports:+$ports,}$cfg_ports"
  fi

  if [ -z "$ports" ]; then
    ports="22"
  fi

  echo "$ports" | tr ',' '\n' | awk '/^[0-9]+$/ && $1>=1 && $1<=65535 {print $1}' | sort -n | uniq | paste -sd, -
}

# ==========================================
# Panel 安装
# ==========================================
install_panel(){
  need_root
  install_deps_panel

  local addr="${PANEL_DEFAULT_ADDR}:${PANEL_DEFAULT_PORT}"
  local admin_user="admin"
  local admin_password=""

  # 命令行参数
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --addr) addr="${2:-}"; shift 2 ;;
      --admin-user) admin_user="${2:-}"; shift 2 ;;
      --admin-password) admin_password="${2:-}"; shift 2 ;;
      --version) VERSION="${2:-latest}"; shift 2 ;;
      --repo) REPO="${2:-$REPO}"; shift 2 ;;
      -h|--help) usage_panel; return 0 ;;
      *) red "未知参数：$1"; usage_panel; return 1 ;;
    esac
  done

  download_release

  # 安装二进制
  mkdir -p "$(dirname "$PANEL_BIN")" "$PANEL_WEB_DIR" "$PANEL_DATA_DIR" "$PANEL_CONFIG_DIR" /opt/relaycore

  # 创建系统用户
  if ! id "$PANEL_RUN_USER" >/dev/null 2>&1; then
    useradd --system --home-dir "$PANEL_DATA_DIR" --shell /usr/sbin/nologin "$PANEL_RUN_USER"
  fi

  install -m 0755 "${TMP_DIR}/release/relaycore-panel" "$PANEL_BIN"
  cp -a "${TMP_DIR}/release/web/." "$PANEL_WEB_DIR/"
  chown -R root:root "$PANEL_WEB_DIR" /opt/relaycore
  chown -R "$PANEL_RUN_USER:$PANEL_RUN_USER" "$PANEL_DATA_DIR"
  chmod 0755 "$PANEL_WEB_DIR" /opt/relaycore
  chmod 0700 "$PANEL_DATA_DIR"

  write_panel_env "$addr" "$admin_user" "$admin_password"
  write_panel_service

  systemctl enable --now "$PANEL_SERVICE"

  green "Panel 已安装并启动"
  show_panel_hint "$addr"
  if [ -z "$admin_password" ]; then
    yellow "初始管理员密码已写入 journal，请查看："
    echo "  journalctl -u ${PANEL_SERVICE} -n 80 --no-pager"
  fi
}

# ==========================================
# Panel 更新
# ==========================================
update_panel(){
  need_root
  install_deps_panel

  local tmp_backup="${PANEL_BIN}.bak.$(date +%Y%m%d-%H%M%S)"

  yellow "正在下载新版本..."
  download_release

  yellow "正在停止面板服务..."
  systemctl stop "$PANEL_SERVICE" 2>/dev/null || true
  sleep 1

  if [ -f "$PANEL_BIN" ]; then
    cp -f "$PANEL_BIN" "$tmp_backup"
    yellow "旧版本已备份：$tmp_backup"
  fi

  install -m 0755 "${TMP_DIR}/release/relaycore-panel" "$PANEL_BIN"
  cp -a "${TMP_DIR}/release/web/." "$PANEL_WEB_DIR/"
  chown -R root:root "$PANEL_WEB_DIR"

  systemctl daemon-reload
  systemctl start "$PANEL_SERVICE"

  green "Panel 更新完成"
  "$PANEL_BIN" -version 2>/dev/null || true
  systemctl status "$PANEL_SERVICE" --no-pager 2>/dev/null || true
}

# ==========================================
# Panel 卸载
# ==========================================
uninstall_panel(){
  need_root

  systemctl stop "$PANEL_SERVICE" 2>/dev/null || true
  systemctl disable "$PANEL_SERVICE" 2>/dev/null || true
  rm -f "/etc/systemd/system/${PANEL_SERVICE}"
  systemctl daemon-reload

  rm -f "$PANEL_BIN"

  local confirm=""
  read_tty confirm "是否删除 Web 资源目录 ${PANEL_WEB_DIR}？输入 YES 确认: "
  [ "$confirm" = "YES" ] && rm -rf "$PANEL_WEB_DIR" /opt/relaycore

  read_tty confirm "是否删除数据目录 ${PANEL_DATA_DIR}？输入 YES 确认: "
  [ "$confirm" = "YES" ] && rm -rf "$PANEL_DATA_DIR"

  read_tty confirm "是否删除配置文件 ${PANEL_ENV_FILE}？输入 YES 确认: "
  [ "$confirm" = "YES" ] && rm -rf "$PANEL_CONFIG_DIR"

  # 删除系统用户
  if id "$PANEL_RUN_USER" >/dev/null 2>&1; then
    userdel "$PANEL_RUN_USER" 2>/dev/null || true
  fi

  green "Panel 卸载完成"
}

# ==========================================
# Panel 重置管理员密码
# ==========================================
reset_panel_password(){
  need_root

  local admin_user="admin"
  read_tty admin_user "管理员用户名 [admin]: "
  admin_user="${admin_user:-admin}"

  local admin_pass=""
  read_tty_secret admin_pass "请输入新密码（留空则自动生成）: "

  systemctl stop "$PANEL_SERVICE" 2>/dev/null || true
  local rc=0
  if [ -n "$admin_pass" ]; then
    "$PANEL_BIN" -data "$PANEL_DATA_DIR" -admin-user "$admin_user" -admin-password "$admin_pass" -reset-admin-password || rc=$?
  else
    "$PANEL_BIN" -data "$PANEL_DATA_DIR" -admin-user "$admin_user" -reset-admin-password || rc=$?
  fi
  systemctl start "$PANEL_SERVICE" 2>/dev/null || true

  if [ "$rc" -ne 0 ]; then
    red "管理员密码重置失败，Panel 服务已尝试重新启动"
    return "$rc"
  fi

  green "管理员密码已重置，旧登录会话已失效"
}

# ==========================================
# Panel 修改监听地址
# ==========================================
configure_panel_listen(){
  need_root

  local old_addr current_addr bind_addr port
  current_addr="$(current_panel_addr || true)"
  current_addr="${current_addr:-${PANEL_DEFAULT_ADDR}:${PANEL_DEFAULT_PORT}}"

  local old_bind="${current_addr%:*}"
  local old_port="${current_addr##*:}"

  read_tty bind_addr "请输入面板监听地址 [${old_bind}]（反代同机推荐 127.0.0.1；公网直连可填 0.0.0.0）: "
  bind_addr="${bind_addr:-$old_bind}"

  read_tty port "请输入面板监听端口 [${old_port}]: "
  port="${port:-$old_port}"

  local addr="${bind_addr}:${port}"

  # 更新 env 文件中的监听地址
  if [ -f "$PANEL_ENV_FILE" ]; then
    sed -i "s|^RELAYCORE_ADDR=.*|RELAYCORE_ADDR=${addr}|" "$PANEL_ENV_FILE"
  else
    write_panel_env "$addr" "admin" ""
  fi

  systemctl restart "$PANEL_SERVICE"

  green "监听地址已更新"
  show_panel_hint "$addr"
}

# ==========================================
# Panel 备份
# ==========================================
backup_panel(){
  need_root
  mkdir -p /root/relaycore-backup

  systemctl stop "$PANEL_SERVICE" 2>/dev/null || true
  local backup_file="/root/relaycore-backup/relaycore-$(date +%F-%H%M%S).tar.gz"
  tar czf "$backup_file" "$PANEL_DATA_DIR" "$PANEL_CONFIG_DIR" 2>/dev/null || true
  systemctl start "$PANEL_SERVICE" 2>/dev/null || true

  green "备份已保存到：$backup_file"
  yellow "备份目录：/root/relaycore-backup/"
}

# ==========================================
# Panel 恢复
# ==========================================
restore_panel(){
  need_root

  echo "可恢复完整数据包（.tar.gz）或 SQLite 数据库备份（.db）。"
  local backup_file=""
  read_tty backup_file "请输入备份文件完整路径: "
  [ -f "$backup_file" ] || { red "备份文件不存在"; return; }

  local confirm=""
  read_tty confirm "恢复会覆盖当前数据，脚本会先自动备份当前数据。输入 确认恢复 继续: "
  [ "$confirm" = "确认恢复" ] || { yellow "已取消恢复"; return; }

  local pre_backup="/root/relaycore-backup/relaycore-pre-restore-$(date +%F-%H%M%S).tar.gz"
  mkdir -p /root/relaycore-backup "$PANEL_DATA_DIR"

  systemctl stop "$PANEL_SERVICE" 2>/dev/null || true
  tar czf "$pre_backup" "$PANEL_DATA_DIR" "$PANEL_CONFIG_DIR" 2>/dev/null || true

  case "$backup_file" in
    *.tar.gz|*.tgz)
      tar xzf "$backup_file" -C /
      ;;
    *.db)
      cp -f "$backup_file" "$PANEL_DATA_DIR/relaycore.db"
      rm -f "$PANEL_DATA_DIR/relaycore.db-wal" "$PANEL_DATA_DIR/relaycore.db-shm"
      chmod 600 "$PANEL_DATA_DIR/relaycore.db"
      chown "$PANEL_RUN_USER:$PANEL_RUN_USER" "$PANEL_DATA_DIR/relaycore.db"
      ;;
    *)
      systemctl start "$PANEL_SERVICE" 2>/dev/null || true
      red "仅支持 .tar.gz/.tgz 或 .db 备份文件"
      return
      ;;
  esac

  chown -R "$PANEL_RUN_USER:$PANEL_RUN_USER" "$PANEL_DATA_DIR"
  systemctl start "$PANEL_SERVICE" 2>/dev/null || true
  green "恢复完成。恢复前备份已保存：$pre_backup"
}

# ==========================================
# Agent 安装
# ==========================================
install_agent(){
  need_root

  local panel=""
  local token=""
  local node_name=""
  local dry_run="0"
  local firewall_mode="managed"
  local ssh_ports=""
  local rollback_seconds="60"

  # 命令行参数
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --panel) panel="${2:-}"; shift 2 ;;
      --token) token="${2:-}"; shift 2 ;;
      --node-name) node_name="${2:-}"; shift 2 ;;
      --dry-run) dry_run="1"; shift ;;
      --firewall-mode) firewall_mode="${2:-managed}"; shift 2 ;;
      --ssh-ports) ssh_ports="${2:-}"; shift 2 ;;
      --rollback-seconds) rollback_seconds="${2:-60}"; shift 2 ;;
      --version) VERSION="${2:-latest}"; shift 2 ;;
      --repo) REPO="${2:-$REPO}"; shift 2 ;;
      -h|--help) usage_agent; return 0 ;;
      *) red "未知参数：$1"; usage_agent; return 1 ;;
    esac
  done

  # 交互补全缺失参数
  [ -n "$panel" ] || read_tty panel "请输入面板地址，例如 https://panel.example.com: "
  [ -n "$token" ] || read_tty token "请输入节点注册 Token: "
  [ -n "$ssh_ports" ] || ssh_ports=$(detect_ssh_ports)

  if [ -z "$panel" ] || [ -z "$token" ]; then
    red "install-agent 需要 --panel 和 --token"
    return 1
  fi

  install_deps_agent
  enable_ipv4_forwarding
  download_release

  # 安装二进制
  mkdir -p "$(dirname "$AGENT_BIN")" "$AGENT_DATA_DIR"
  install -m 0755 "${TMP_DIR}/release/relaycore-agent" "$AGENT_BIN"
  chmod 0700 "$AGENT_DATA_DIR"

  write_agent_env "$panel" "$token" "$node_name" "$dry_run" "$firewall_mode" "$ssh_ports" "$rollback_seconds"
  write_agent_service

  systemctl enable --now "$AGENT_SERVICE"

  green "Agent 已安装并启动"
  yellow "SSH 保留端口：${ssh_ports}"
  yellow "回到面板的"节点"页面查看上线状态"
  yellow "查看状态：systemctl status ${AGENT_SERVICE} --no-pager"
  yellow "查看日志：journalctl -u ${AGENT_SERVICE} -f"
}

# ==========================================
# Agent 更新
# ==========================================
update_agent(){
  need_root
  install_deps_agent
  enable_ipv4_forwarding

  yellow "正在下载新版本..."
  download_release

  local tmp_backup="${AGENT_BIN}.bak.$(date +%Y%m%d-%H%M%S)"

  systemctl stop "$AGENT_SERVICE" 2>/dev/null || true
  sleep 1

  if [ -f "$AGENT_BIN" ]; then
    cp -f "$AGENT_BIN" "$tmp_backup"
    yellow "旧版本已备份：$tmp_backup"
  fi

  install -m 0755 "${TMP_DIR}/release/relaycore-agent" "$AGENT_BIN"

  systemctl daemon-reload
  systemctl start "$AGENT_SERVICE"

  green "Agent 更新完成"
  "$AGENT_BIN" -version 2>/dev/null || true
  systemctl status "$AGENT_SERVICE" --no-pager 2>/dev/null || true
}

# ==========================================
# Agent 卸载
# ==========================================
uninstall_agent(){
  need_root

  systemctl stop "$AGENT_SERVICE" 2>/dev/null || true
  systemctl disable "$AGENT_SERVICE" 2>/dev/null || true

  # 询问是否清理 nftables 规则
  if [ -x "$AGENT_BIN" ]; then
    local fw_confirm=""
    read_tty fw_confirm "是否清理 RelayCore 管理的 nftables 规则？输入 YES 确认: "
    [ "$fw_confirm" = "YES" ] && "$AGENT_BIN" rescue || true
  fi

  rm -f "/etc/systemd/system/${AGENT_SERVICE}"
  systemctl daemon-reload
  rm -f "$AGENT_BIN"

  local confirm=""
  read_tty confirm "是否删除 Agent 数据目录 ${AGENT_DATA_DIR}？输入 YES 确认: "
  [ "$confirm" = "YES" ] && rm -rf "$AGENT_DATA_DIR"

  green "Agent 卸载完成"
}

# ==========================================
# Agent 救援模式
# ==========================================
agent_rescue(){
  need_root
  if [ ! -x "$AGENT_BIN" ]; then
    red "未找到 Agent 二进制：$AGENT_BIN"
    return
  fi
  yellow "正在执行 nftables 救援清理..."
  "$AGENT_BIN" rescue
  green "救援清理完成"
}

# ==========================================
# 用法
# ==========================================
usage_panel(){
  cat <<'USAGE'
RelayCore Panel 安装参数：
  install-panel [--addr 0.0.0.0:10028] [--admin-user admin] [--admin-password PASSWORD]
  install-panel [--version 0.1.1] [--repo idcsu/relaycore]

环境变量：
  RELAYCORE_REPO=idcsu/relaycore
  RELAYCORE_VERSION=latest | 0.1.1 | v0.1.1
USAGE
}

usage_agent(){
  cat <<'USAGE'
RelayCore Agent 安装参数：
  install-agent --panel URL --token TOKEN [--node-name NAME]
                [--ssh-ports 22] [--firewall-mode managed|strict]
                [--rollback-seconds 60] [--dry-run]
  install-agent [--version 0.1.1] [--repo idcsu/relaycore]

环境变量：
  RELAYCORE_REPO=idcsu/relaycore
  RELAYCORE_VERSION=latest | 0.1.1 | v0.1.1
USAGE
}

usage(){
  cat <<'USAGE'
RelayCore 一键安装 + 管理脚本

直接安装（非交互）：
  install.sh install-panel [--addr 0.0.0.0:10028] [--admin-user admin] [--admin-password PASSWORD]
  install.sh install-agent --panel URL --token TOKEN [--node-name NAME] [--ssh-ports 22]

管理菜单（交互）：
  install.sh menu          — 面板管理菜单
  install.sh menu-agent    — Agent 节点管理菜单
  install.sh               — 默认显示面板管理菜单

环境变量：
  RELAYCORE_REPO=idcsu/relaycore
  RELAYCORE_VERSION=latest | 0.1.1 | v0.1.1
USAGE
}

# ==========================================
# Panel 管理菜单
# ==========================================
panel_menu(){
  clear 2>/dev/null || true
  echo "========================================"
  echo "       RelayCore 面板管理脚本"
  echo "========================================"
  echo " 1. 安装面板"
  echo " 2. 更新面板"
  echo " 3. 卸载面板"
  echo " 4. 查看面板状态"
  echo " 5. 查看面板日志"
  echo " 6. 重启面板"
  echo " 7. 备份数据"
  echo " 8. 恢复数据"
  echo " 9. 重置管理员密码"
  echo "10. 修改监听地址/端口"
  echo " 0. 退出"
  echo "========================================"
  local n=""
  read_tty n "请输入选项: "

  case "$n" in
    1) install_panel ;;
    2) update_panel ;;
    3) uninstall_panel ;;
    4) systemctl status "$PANEL_SERVICE" --no-pager 2>/dev/null || yellow "面板未安装" ;;
    5) journalctl -u "$PANEL_SERVICE" -f 2>/dev/null || yellow "面板未安装" ;;
    6) need_root; systemctl restart "$PANEL_SERVICE" 2>/dev/null && green "已重启" || yellow "面板未安装" ;;
    7) backup_panel ;;
    8) restore_panel ;;
    9) reset_panel_password ;;
    10) configure_panel_listen ;;
    0) exit 0 ;;
    *) red "无效选项" ;;
  esac
}

# ==========================================
# Agent 管理菜单
# ==========================================
agent_menu(){
  clear 2>/dev/null || true
  echo "========================================"
  echo "     RelayCore Agent 节点管理脚本"
  echo "========================================"
  echo " 1. 安装 Agent"
  echo " 2. 更新 Agent"
  echo " 3. 卸载 Agent"
  echo " 4. 查看 Agent 状态"
  echo " 5. 查看 Agent 日志"
  echo " 6. 重启 Agent"
  echo " 7. 防火墙救援模式（清理 nftables）"
  echo " 0. 退出"
  echo "========================================"
  local n=""
  read_tty n "请输入选项: "

  case "$n" in
    1) install_agent ;;
    2) update_agent ;;
    3) uninstall_agent ;;
    4) systemctl status "$AGENT_SERVICE" --no-pager 2>/dev/null || yellow "Agent 未安装" ;;
    5) journalctl -u "$AGENT_SERVICE" -f 2>/dev/null || yellow "Agent 未安装" ;;
    6) need_root; systemctl restart "$AGENT_SERVICE" 2>/dev/null && green "已重启" || yellow "Agent 未安装" ;;
    7) agent_rescue ;;
    0) exit 0 ;;
    *) red "无效选项" ;;
  esac
}

# ==========================================
# 主入口
# ==========================================
main(){
  local cmd="${1:-}"

  if [ -z "$cmd" ] || [ "$cmd" = "-h" ] || [ "$cmd" = "--help" ]; then
    usage
    [ -z "$cmd" ] && panel_menu
    exit 0
  fi

  shift || true

  case "$cmd" in
    install-panel) install_panel "$@" ;;
    install-agent) install_agent "$@" ;;
    menu) panel_menu ;;
    menu-agent) agent_menu ;;
    panel-menu) panel_menu ;;
    agent-menu) agent_menu ;;
    update-panel) update_panel ;;
    update-agent) update_agent ;;
    uninstall-panel) uninstall_panel ;;
    uninstall-agent) uninstall_agent ;;
    status) systemctl status "$PANEL_SERVICE" --no-pager 2>/dev/null || yellow "面板未安装" ;;
    logs) journalctl -u "$PANEL_SERVICE" -f 2>/dev/null || yellow "面板未安装" ;;
    restart) need_root; systemctl restart "$PANEL_SERVICE" 2>/dev/null && green "已重启" || yellow "面板未安装" ;;
    backup) backup_panel ;;
    restore) restore_panel ;;
    reset-password) reset_panel_password ;;
    configure-listen) configure_panel_listen ;;
    rescue) agent_rescue ;;
    *) red "未知命令：$cmd"; usage; exit 1 ;;
  esac
}

main "$@"
