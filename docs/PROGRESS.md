# RelayCore Progress

Last updated: 2026-06-17

## Direction

RelayCore is being built as a low-overhead multi-node port forwarding panel for small VPS nodes such as 1 core / 1 GB RAM.

Core principles:

- Agent stays lightweight.
- Forwarding goes through Linux nftables/kernel NAT by default.
- Panel handles management, security, persistence, diagnostics, and UI.
- Frontend assets are local only. No CDN.
- Security and observability are built in from the beginning.

## Current Architecture

- Panel binary: `cmd/relaycore-panel`
- Agent binary: `cmd/relaycore-agent`
- Shared models/security helpers: `internal/common`
- Panel API/store: `internal/panel`
- Agent nftables/metrics/probe logic: `internal/agent`
- Local static UI: `web`
- Deployment templates/scripts: `deploy`, `scripts`
- Deployment guide: `docs/DEPLOYMENT.md`

## Implemented

### Panel

- Login with HttpOnly SameSite session cookie.
- Login failure throttling.
- Basic security headers and Origin check.
- SQLite-backed snapshot storage using system `libsqlite3` through CGO.
- Legacy import path from `relaycore.json` to `relaycore.db`.
- Node registration with one-time token.
- HMAC-signed Agent heartbeat with timestamp + nonce replay protection.
- Rule CRUD.
- Node list.
- Node token list/create.
- User management:
  - user list/create
  - role update
  - disabled users
  - password reset
  - non-admin rule list is filtered to owned rules
  - self-disable/self-demotion protection
  - last enabled `super_admin` protection
- Event/audit list.
- Dashboard summary.
- Diagnostics API.

### Security

- Password hashing with PBKDF2-SHA256.
- TOTP generation and verification.
- TOTP setup requires current password.
- TOTP QR code is rendered locally in the browser.
- TOTP enable requires a pending server-generated secret.
- TOTP login replay protection by time counter.
- TOTP disable requires password and current code.

### Agent

- Register with one-time token.
- Store node config with `0600` permissions.
- HMAC heartbeat.
- Lightweight `/proc` metrics:
  - load
  - memory
  - disk
  - net I/O
  - uptime
  - conntrack count/max
  - TCP retrans/out segment counters
- nftables ruleset rendering.
- dry-run mode.
- Immediate post-apply status heartbeat after rule version changes.
- Rule-level apply reports:
  - `applied`
  - `dry_run`
  - `error`
  - `skipped`
- Rule-level lightweight target probes:
  - TCP dial check
  - UDP send check
- Ruleset preview returned to Panel in dry-run or normal mode.
- Rescue command:
  - `relaycore-agent rescue`
  - prints RelayCore-managed nftables tables before cleanup
  - flushes/deletes `table ip relaycore`
  - flushes/deletes `table inet relaycore_guard`
  - exits cleanly when a table does not exist
- Strict firewall mode:
  - opt-in with `-firewall strict`
  - preserves configured SSH ports with `-ssh-ports`
  - applies `inet relaycore_guard` after NAT rules
  - allows RelayCore `ct mark` so DNAT-to-local targets still work under strict input filtering
  - reports `strict_pending` while waiting for Panel confirmation
  - cancels rollback only after the post-apply Panel heartbeat succeeds
  - restores the previous guard table, or deletes the new one, if confirmation times out

### nftables

- IPv4 NAT table: `ip relaycore`.
- Optional strict firewall table: `inet relaycore_guard`.
- Uses nftables `set` for listener ports.
- Uses nftables `map` for port to target IP/port mapping.
- Uses named counter objects per rule/protocol.
- Uses port to counter object maps.
- Marks RelayCore-managed connections with `ct mark`.
- Attempts to add a narrow `FORWARD` accept rule for that mark when an existing `ip filter FORWARD` chain is present.
- Uses `nft -c -f` before apply.
- Uses batch `nft -f` apply.
- Avoids empty `elements = { }`, which nftables rejects.
- Uses numeric NAT priorities for Debian 12 / nftables 1.0.6 compatibility.

### Diagnostics

Panel diagnostics currently includes:

- Node online/offline status.
- Node health score.
- conntrack pressure.
- memory pressure.
- TCP retransmission ratio.
- Agent errors.
- Agent-sent nft/apply errors.
- Rule apply state.
- Rule target IP after Agent resolution.
- Rule target probe results.
- Rule counter totals.
- Rule counter delta/rate.
- Target DNS/IP history.
- Node conntrack trend.
- Node TCP retransmission delta.
- Likely cause summary per rule.
- stale counter warning.
- no-counter/no-traffic informational findings.
- ruleset preview per node.

### Frontend

- Local `index.html`, `styles.css`, `app.js`.
- No CDN.
- Pages:
  - login
  - dashboard
  - nodes
  - rules
  - diagnostics
  - node token onboarding
  - security / TOTP
  - audit events
- Rules page shows:
  - protocol
  - listen port
  - target
  - node
  - owner user
  - counter total
  - apply state/message
  - rule detail drawer with apply report, probes, counters, recommended actions, and ruleset fragment
- Users page shows:
  - users
  - roles
  - disabled state
  - TOTP state
  - password reset
- Security page shows:
  - local TOTP QR code
  - manual secret fallback
  - otpauth URI fallback
- Nodes page shows:
  - resource usage
  - conntrack pressure
  - forwarding/firewall mode
  - node detail drawer with metrics, TCP retransmission ratio, last errors, private IPs, assigned rules, and ruleset preview
- Diagnostics page shows:
  - global findings
  - node health cards
  - expandable nftables ruleset
  - rule diagnostics table
  - target probe results
  - counter rates
  - node trend deltas
  - likely cause summaries

### Deployment

- Hardened systemd templates for Panel and Agent.
- Panel install script:
  - creates `relaycore` system user
  - installs binary and local web assets
  - creates `/etc/relaycore/panel.env`
  - stores data under `/var/lib/relaycore`
  - runs Panel as non-root
- Agent install script:
  - installs binary
  - creates `/etc/relaycore-agent/agent.env`
  - supports Panel URL/token/dry-run/strict firewall settings through env
  - constrains systemd capabilities to network administration needs
- Release build script:
  - `scripts/build-release.sh`
  - `make release VERSION=...`
  - packages binaries, web assets, deploy files, scripts, and docs
- Deployment guide includes:
  - Panel install
  - Agent install
  - Nginx/Caddy reverse proxy examples
  - strict firewall notes
  - rescue command
  - backup/restore

## Verified

Commands that passed:

```bash
node --check web/app.js
sh -n scripts/install-panel.sh
sh -n scripts/install-agent.sh
node --check web/qr.js
CGO_ENABLED=1 go test ./...
CGO_ENABLED=1 go vet ./...
make all
make release
```

Additional checks:

- nftables empty set/map syntax verified with `nft -c`.
- nftables named counter map syntax verified with `nft -c`.
- strict firewall guard syntax verified with `nft -c`.
- strict firewall empty-rule guard syntax verified with `nft -c`.
- Panel health check verified.
- Login and dashboard API verified.
- Temporary Panel UI/API smoke check verified:
  - health endpoint
  - HTML shell
  - login
  - rules API
- TOTP setup/enable verified.
- TOTP QR generator smoke-tested locally.
- TOTP login behavior verified:
  - without code: `401`
  - with current code: `200`
- dry-run Agent registration and heartbeat verified.
- Agent rescue command unit-tested with fake `nft`.
- Diagnostics trend/rate helpers unit-tested.
- User management store helpers unit-tested.
- User management API smoke-checked:
  - list users
  - create user
  - reset password
  - disable user
  - self-disable guard
- Release archive build verified.
- Disposable VPS non-dry-run integration verified:
  - Ubuntu 24.04 / Linux 6.8 / nftables 1.0.9.
  - Panel installed under systemd.
  - Agent installed under systemd and registered.
  - Real nftables NAT table applied.
  - Public TCP forwarding to local backend returned `200`.
  - Public UDP forwarding to local echo backend returned the echoed payload.
  - Public TCP forwarding to external target returned `403` from the target service, proving connection path.
  - Public UDP forwarding to external DNS target returned a DNS response.
  - Per-rule nftables counters incremented and synced to Panel.
  - Diagnostics reported one online node and four applied rules.
  - Diagnostics reported health `100` and no global findings after strict validation.
  - `relaycore-agent rescue` removed `table ip relaycore`, tolerated missing `table inet relaycore_guard`, and cleaned the RelayCore `FORWARD` mark rule.
  - strict rollback was verified with a fake local Panel that accepted the first heartbeat and failed confirmation; `inet relaycore_guard` was removed after timeout.
  - strict mode was verified with real Panel confirmation; node reported `strict`.
  - Docker/1Panel `FORWARD policy DROP` blocked forwarding to external targets until RelayCore `ct mark` compatibility was added and validated.
  - strict input filtering blocked DNAT-to-local targets until RelayCore `ct mark` input allow was added and validated.
- Debian 12 disposable VPS integration verified:
  - Debian 12 / Linux 6.1 / nftables 1.0.6.
  - Minimal image required `libsqlite3-0`, `curl`, and `python3` for this test flow.
  - Panel installed under systemd.
  - Agent installed under systemd and registered.
  - Initial nftables apply failed because Debian nftables 1.0.6 rejected `output priority dstnat`.
  - Agent was fixed to render numeric NAT priorities; rules then applied successfully.
  - Public TCP forwarding to local backend returned `200`.
  - Public TCP forwarding to external target returned `403` from the target service, proving connection path.
  - Local UDP forwarding through RelayCore worked from the node.
  - Public UDP packets did not hit RelayCore counters on this VPS, including direct backend UDP, indicating provider/network UDP ingress filtering.
  - Per-rule nftables counters synced to Panel.
  - Diagnostics reported health `100` and no global findings.
  - `relaycore-agent rescue` removed `table ip relaycore` and tolerated missing `table inet relaycore_guard`.
  - strict mode was verified with real Panel confirmation; node reported `strict`.
  - strict public TCP forwarding to local and external targets worked.
- Full rule loop verified:
  - Panel created rule.
  - Agent pulled rule.
  - Agent generated dry-run nftables ruleset.
  - Agent returned rule apply report.
  - Panel showed `dry_run`.
  - Diagnostics showed ruleset and probe.

Last rule-loop validation result:

```json
{"rule_state":"dry_run","report_state":"dry_run","probes":1,"ruleset":true,"diag_rules":1}
```

## Current Caveats

- Storage is SQLite-backed snapshot, not normalized relational schema yet.
- nftables forwarding is IPv4 only.
- UDP probe can only confirm send-path basics, not true application-layer response.
- flowtable acceleration is not implemented.
- Disposable VPS validation has been done on Ubuntu 24.04 and Debian 12; more firewall stacks should still be tested before broad production rollout.

## Next Recommended Steps

1. Broaden integration testing:
   - Ubuntu without Docker/1Panel
   - a node with native nftables-only firewall chains
   - target behind private network/VPN

2. Evaluate flowtable acceleration:
   - detect kernel/nft support
   - keep disabled by default
   - document risk and rollback

## Notes for Future Sessions

If continuing in a new chat, start by reading:

```bash
sed -n '1,240p' docs/PROGRESS.md
sed -n '1,220p' docs/ARCHITECTURE.md
sed -n '1,220p' docs/NFTABLES.md
```

Then run:

```bash
git status --short
node --check web/app.js
CGO_ENABLED=1 go test ./...
CGO_ENABLED=1 go vet ./...
```

Use `/usr/local/go/bin/go` if `go` is not in PATH.
