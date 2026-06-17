#!/usr/bin/env bash
set -euo pipefail

REPO="${RELAYCORE_REPO:-idcsu/relaycore}"
VERSION="${RELAYCORE_VERSION:-latest}"
TMP_DIR=""

usage() {
  cat <<'USAGE'
RelayCore one-click installer

Usage:
  install.sh install-panel [--addr 0.0.0.0:10028] [--admin-user admin] [--admin-password PASSWORD]
  install.sh install-agent --panel URL --token TOKEN [--node-name NAME] [--ssh-ports 22] [--firewall-mode managed|strict]

Environment:
  RELAYCORE_REPO=idcsu/relaycore
  RELAYCORE_VERSION=latest | 0.1.0 | v0.1.0
USAGE
}

log() { printf '\033[1;34m[RelayCore]\033[0m %s\n' "$*"; }
ok() { printf '\033[1;32m[RelayCore]\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m[RelayCore]\033[0m %s\n' "$*" >&2; }

need_root() {
  if [ "$(id -u)" != "0" ]; then
    err "请使用 root 用户运行"
    exit 1
  fi
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo "amd64" ;;
    *) err "当前一键脚本暂只提供 linux/amd64 release 包"; exit 1 ;;
  esac
}

install_packages() {
  role="$1"
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    if [ "$role" = "panel" ]; then
      apt-get install -y curl ca-certificates tar gzip libsqlite3-0
    else
      apt-get install -y curl ca-certificates tar gzip nftables iproute2
    fi
    return
  fi
  if command -v dnf >/dev/null 2>&1; then
    if [ "$role" = "panel" ]; then
      dnf install -y curl ca-certificates tar gzip sqlite-libs
    else
      dnf install -y curl ca-certificates tar gzip nftables iproute
    fi
    return
  fi
  if command -v yum >/dev/null 2>&1; then
    if [ "$role" = "panel" ]; then
      yum install -y curl ca-certificates tar gzip sqlite
    else
      yum install -y curl ca-certificates tar gzip nftables iproute
    fi
    return
  fi
  if command -v apk >/dev/null 2>&1; then
    if [ "$role" = "panel" ]; then
      apk add --no-cache curl ca-certificates tar gzip sqlite-libs
    else
      apk add --no-cache curl ca-certificates tar gzip nftables iproute2
    fi
    return
  fi
  command -v curl >/dev/null 2>&1 || { err "未找到 curl，请先安装 curl"; exit 1; }
  command -v tar >/dev/null 2>&1 || { err "未找到 tar，请先安装 tar"; exit 1; }
}

release_base_url() {
  if [ "$VERSION" = "latest" ]; then
    echo "https://github.com/${REPO}/releases/latest/download"
    return
  fi
  tag="$VERSION"
  case "$tag" in
    v*) ;;
    *) tag="v${tag}" ;;
  esac
  echo "https://github.com/${REPO}/releases/download/${tag}"
}

download_release() {
  arch="$(detect_arch)"
  TMP_DIR="$(mktemp -d)"
  trap 'if [ -n "${TMP_DIR}" ]; then rm -rf "${TMP_DIR}"; fi' EXIT
  base="$(release_base_url)"
  archive="${TMP_DIR}/relaycore-linux-${arch}.tar.gz"
  log "下载 RelayCore release：${base}/relaycore-linux-${arch}.tar.gz"
  curl -fL "${base}/relaycore-linux-${arch}.tar.gz" -o "$archive"
  if curl -fsL "${base}/SHA256SUMS" -o "${TMP_DIR}/SHA256SUMS" 2>/dev/null; then
    (cd "$TMP_DIR" && sha256sum -c --ignore-missing SHA256SUMS)
  fi
  mkdir -p "${TMP_DIR}/release"
  tar -xzf "$archive" -C "${TMP_DIR}/release" --strip-components=1
}

write_panel_env() {
  addr="$1"
  admin_user="$2"
  admin_password="$3"
  data_dir="${RELAYCORE_DATA_DIR:-/var/lib/relaycore}"
  web_dir="${RELAYCORE_WEB_DIR:-/opt/relaycore/web}"
  config_dir="${RELAYCORE_CONFIG_DIR:-/etc/relaycore}"
  env_file="${RELAYCORE_ENV_FILE:-${config_dir}/panel.env}"
  mkdir -p "$config_dir"
  {
    printf 'RELAYCORE_ADDR=%s\n' "$addr"
    printf 'RELAYCORE_DATA=%s\n' "$data_dir"
    printf 'RELAYCORE_WEB=%s\n' "$web_dir"
    printf 'ADMIN_USER=%s\n' "$admin_user"
    if [ -n "$admin_password" ]; then
      printf 'ADMIN_PASSWORD=%s\n' "$admin_password"
    else
      printf '# ADMIN_PASSWORD=\n'
    fi
  } >"$env_file"
  chown root:relaycore "$env_file" 2>/dev/null || true
  chmod 0640 "$env_file"
}

panel_public_hint() {
  addr="$1"
  host="${addr%:*}"
  port="${addr##*:}"
  if [ "$host" = "0.0.0.0" ] || [ "$host" = "::" ]; then
    echo "http://服务器公网IP:${port}"
    return
  fi
  echo "http://${addr}"
}

write_agent_env() {
  panel="$1"
  token="$2"
  node_name="$3"
  dry_run="$4"
  firewall_mode="$5"
  ssh_ports="$6"
  rollback_seconds="$7"
  data_dir="${RELAYCORE_AGENT_DATA_DIR:-/etc/relaycore-agent}"
  env_file="${RELAYCORE_AGENT_ENV_FILE:-${data_dir}/agent.env}"
  mkdir -p "$data_dir"
  {
    printf 'RELAYCORE_AGENT_DATA=%s\n' "$data_dir"
    printf 'RELAYCORE_PANEL=%s\n' "$panel"
    printf 'RELAYCORE_TOKEN=%s\n' "$token"
    printf 'RELAYCORE_NODE_NAME=%s\n' "$node_name"
    printf 'RELAYCORE_DRY_RUN=%s\n' "$dry_run"
    printf 'RELAYCORE_FIREWALL_MODE=%s\n' "$firewall_mode"
    printf 'RELAYCORE_SSH_PORTS=%s\n' "$ssh_ports"
    printf 'RELAYCORE_FIREWALL_ROLLBACK_SECONDS=%s\n' "$rollback_seconds"
  } >"$env_file"
  chmod 0600 "$env_file"
}

install_panel() {
  need_root
  addr="0.0.0.0:10028"
  admin_user="admin"
  admin_password=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --addr) addr="${2:-}"; shift 2 ;;
      --admin-user) admin_user="${2:-}"; shift 2 ;;
      --admin-password) admin_password="${2:-}"; shift 2 ;;
      --version) VERSION="${2:-latest}"; shift 2 ;;
      --repo) REPO="${2:-$REPO}"; shift 2 ;;
      -h|--help) usage; exit 0 ;;
      *) err "未知参数：$1"; usage; exit 1 ;;
    esac
  done
  install_packages panel
  download_release
  (cd "${TMP_DIR}/release" && bash scripts/install-panel.sh)
  write_panel_env "$addr" "$admin_user" "$admin_password"
  systemctl restart relaycore-panel
  ok "Panel 已安装并启动。本机监听：${addr}"
  ok "浏览器访问：$(panel_public_hint "$addr")"
  ok "配置文件：/etc/relaycore/panel.env"
}

install_agent() {
  need_root
  panel=""
  token=""
  node_name=""
  dry_run="0"
  firewall_mode="managed"
  ssh_ports="22"
  rollback_seconds="60"
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --panel) panel="${2:-}"; shift 2 ;;
      --token) token="${2:-}"; shift 2 ;;
      --node-name) node_name="${2:-}"; shift 2 ;;
      --dry-run) dry_run="1"; shift ;;
      --firewall-mode) firewall_mode="${2:-managed}"; shift 2 ;;
      --ssh-ports) ssh_ports="${2:-22}"; shift 2 ;;
      --rollback-seconds) rollback_seconds="${2:-60}"; shift 2 ;;
      --version) VERSION="${2:-latest}"; shift 2 ;;
      --repo) REPO="${2:-$REPO}"; shift 2 ;;
      -h|--help) usage; exit 0 ;;
      *) err "未知参数：$1"; usage; exit 1 ;;
    esac
  done
  if [ -z "$panel" ] || [ -z "$token" ]; then
    err "install-agent 需要 --panel 和 --token"
    usage
    exit 1
  fi
  install_packages agent
  download_release
  PANEL_URL="$panel" TOKEN="$token" NODE_NAME="$node_name" DRY_RUN="$dry_run" FIREWALL_MODE="$firewall_mode" SSH_PORTS="$ssh_ports" ROLLBACK_SECONDS="$rollback_seconds" \
    bash -c 'cd "$0" && bash scripts/install-agent.sh' "${TMP_DIR}/release"
  write_agent_env "$panel" "$token" "$node_name" "$dry_run" "$firewall_mode" "$ssh_ports" "$rollback_seconds"
  systemctl restart relaycore-agent
  ok "Agent 已安装并启动。回到面板的“节点”页面查看上线状态。"
}

main() {
  cmd="${1:-}"
  if [ -z "$cmd" ] || [ "$cmd" = "-h" ] || [ "$cmd" = "--help" ]; then
    usage
    exit 0
  fi
  shift || true
  case "$cmd" in
    install-panel) install_panel "$@" ;;
    install-agent) install_agent "$@" ;;
    *) err "未知命令：$cmd"; usage; exit 1 ;;
  esac
}

main "$@"
