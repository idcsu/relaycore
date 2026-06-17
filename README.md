# RelayCore

RelayCore is a lightweight multi-node port forwarding panel for small Linux VPS nodes.

The design goal is simple: the Agent should not copy traffic in user space. Forwarding is handled by Linux nftables/kernel NAT, while the Panel handles management, security, persistence, diagnostics, and UI.

## Status

RelayCore is currently an internal test release.

Verified on a disposable Ubuntu 24.04 VPS:

- Panel and Agent deployed with systemd.
- Real non-dry-run nftables TCP/UDP forwarding.
- Public TCP and UDP forwarding to local backends.
- Public TCP and UDP forwarding to external targets.
- Per-rule nftables counters synced back to the Panel.
- Diagnostics reported node health and rule traffic.
- `relaycore-agent rescue` cleaned RelayCore-managed nftables state.
- Strict firewall mode and rollback path verified.
- Docker/1Panel-style `FORWARD policy DROP` compatibility verified.

Verified on a disposable Debian 12 VPS:

- Panel and Agent deployed with systemd after installing `libsqlite3-0`.
- nftables 1.0.6 compatibility verified with numeric NAT priorities.
- Public TCP forwarding to local and external targets verified.
- Local UDP forwarding verified from the node.
- `relaycore-agent rescue` verified.
- Strict firewall mode verified.
- Public UDP packets did not reach nftables on that VPS, so public UDP ingress was treated as a provider/network limitation for that test node.

## Does It Need Docker?

No.

RelayCore does not require Docker for either the Panel or the Agent.

- Panel runs as a normal systemd service and stores data in SQLite.
- Agent runs as a systemd service on each node and manages nftables.
- Docker can exist on the same node. RelayCore includes compatibility for Docker/1Panel environments that set the system `FORWARD` chain to `DROP`.

## Components

- `relaycore-panel`: Web UI and API server.
- `relaycore-agent`: Node-side nftables manager and metrics reporter.
- `web/`: Local static frontend assets. No CDN.
- `scripts/`: Install and release scripts.
- `deploy/`: systemd service templates.
- `docs/`: Architecture, deployment, nftables, and progress notes.

## Features

- Local static web UI, no external CDN.
- SQLite-backed Panel storage.
- Login sessions with secure cookies.
- PBKDF2-SHA256 password hashing.
- TOTP two-factor authentication.
- User management and role checks.
- One-time Agent registration tokens.
- HMAC-signed Agent heartbeat with timestamp and nonce replay protection.
- IPv4 TCP/UDP port forwarding through nftables.
- nftables set/map based ruleset generation.
- Per-rule named counters.
- Rule-level apply reports.
- Target probes and diagnostics.
- Node metrics from `/proc`.
- Docker/1Panel `FORWARD` chain compatibility through RelayCore `ct mark`.
- Optional strict firewall mode with rollback.
- Rescue command for emergency cleanup.

## Requirements

Panel:

- Linux + systemd.
- `libsqlite3`.
- Reverse proxy with HTTPS recommended for production.

Agent:

- Linux + systemd.
- nftables.
- root or equivalent nftables permissions.
- `net.ipv4.ip_forward=1` for cross-host forwarding.

Minimal Debian/Ubuntu images may need:

```bash
apt-get update
apt-get install -y libsqlite3-0 nftables
```

## Build

```bash
make all
```

Build a release archive:

```bash
make release VERSION=0.1.0
```

Artifacts are written to `dist/`.

## Install Panel

On the Panel server:

```bash
tar -xzf relaycore-0.1.0-linux-amd64.tar.gz
cd relaycore-0.1.0-linux-amd64
sudo ./scripts/install-panel.sh
```

Panel listens on `127.0.0.1:10028` by default.

If no `ADMIN_PASSWORD` is configured, the initial admin password is printed to journal:

```bash
journalctl -u relaycore-panel -n 80 --no-pager
```

Put the Panel behind HTTPS with Nginx or Caddy before production use.

## Install Agent

Create a node token in the Panel, then run on the node:

```bash
tar -xzf relaycore-0.1.0-linux-amd64.tar.gz
cd relaycore-0.1.0-linux-amd64
sudo PANEL_URL=https://relaycore.example.com TOKEN=your-node-token ./scripts/install-agent.sh
```

The Agent stores its config at:

```bash
/etc/relaycore-agent/agent.json
```

The one-time token is cleared after successful registration.

## Strict Firewall Mode

Strict mode is optional.

```bash
RELAYCORE_FIREWALL_MODE=strict
RELAYCORE_SSH_PORTS=22
RELAYCORE_FIREWALL_ROLLBACK_SECONDS=60
```

Strict mode creates `table inet relaycore_guard`, keeps SSH open, allows current forwarding ports, allows RelayCore-marked DNAT connections, and rolls back if the Panel cannot confirm the Agent is still reachable.

## Rescue

If a node becomes misconfigured:

```bash
sudo relaycore-agent rescue
```

This removes RelayCore-managed nftables tables and its RelayCore `ct mark` compatibility rule. It does not clean unrelated system firewall rules.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Deployment](docs/DEPLOYMENT.md)
- [nftables strategy](docs/NFTABLES.md)
- [Progress notes](docs/PROGRESS.md)

## Current Caveats

- IPv4 forwarding only.
- SQLite storage is currently snapshot-style, not a normalized relational schema.
- UDP probes can only verify basic send-path behavior.
- More firewall combinations still need smoke testing.
- flowtable acceleration is not enabled yet.
