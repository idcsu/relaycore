# RelayCore 进度记录

最后更新：2026-06-17

## 方向

RelayCore 正在被打造为一个面向小型 VPS 节点的低开销多节点端口转发面板，适合 1 核 1G 这类机器。

核心原则：

- Agent 保持轻量。
- 默认走 Linux nftables / kernel NAT 转发。
- Panel 负责管理、安全、持久化、诊断和界面。
- 前端资源只保留本地文件，不依赖 CDN。
- 安全和可观测性从一开始就内置。

## 当前架构

- Panel 二进制：`cmd/relaycore-panel`
- Agent 二进制：`cmd/relaycore-agent`
- 共享模型和安全辅助：`internal/common`
- Panel API / 存储：`internal/panel`
- Agent nftables / 指标 / 探测逻辑：`internal/agent`
- 前端源码：`frontend`
- 已构建静态 UI：`web`
- 部署模板和脚本：`deploy`、`scripts`
- 部署指南：`docs/DEPLOYMENT.md`

## 已完成

### Panel

- 使用 HttpOnly + SameSite 的 session cookie 登录。
- 登录失败限流。
- 基础安全响应头和 Origin 校验。
- 通过 CGO 使用系统 `libsqlite3` 的 SQLite-backed snapshot 存储。
- 支持从 `relaycore.json` 迁移到 `relaycore.db`。
- 节点一次性 token 注册。
- 节点管理：
  - 节点改名
  - 在 Panel 里设置节点防火墙策略
  - 严格模式目标、保留 SSH 端口和回滚秒数
  - 删除节点
  - 删除节点时同步移除该节点的转发规则和相关 counter / report 历史
- 带时间戳和 nonce 防重放的 HMAC Agent 心跳。
- 规则增删改查。
- 节点列表。
- 节点 token 列表和创建。
- 用户管理：
  - 用户列表和创建
  - 角色更新
  - 禁用用户
  - 重置密码
  - 非管理员只能看到自己创建的规则
  - 防止自禁用 / 自降权
  - 防止最后一个 `super_admin` 被禁用
- 事件 / 审计列表。
- 总览摘要。
- 诊断 API。

### 安全

- PBKDF2-SHA256 密码哈希。
- TOTP 生成和校验。
- 启用 TOTP 需要当前密码。
- TOTP QR 码在浏览器本地渲染。
- 启用 TOTP 需要服务端生成的 pending secret。
- TOTP 登录使用时间计数器防重放。
- 停用 TOTP 需要密码和当前验证码。

### Agent

- 一次性 token 注册。
- 节点配置按 `0600` 权限保存。
- HMAC 心跳。
- 轻量 `/proc` 指标：
  - load
  - memory
  - disk
  - net I/O
  - uptime
  - conntrack count / max
  - TCP retrans / out segment counters
- nftables 规则集渲染。
- dry-run 模式。
- 规则版本变化后立即补发一次状态心跳。
- 规则级应用报告：
  - `applied`
  - `dry_run`
  - `error`
  - `skipped`
- 规则级轻量目标探测：
  - TCP 连接探测
  - UDP 发送探测
- dry-run 或正常模式下都会把 ruleset preview 回传给 Panel。
- 救援命令：
  - `relaycore-agent rescue`
  - 清理前打印 RelayCore 管理的 nftables 表
  - flush / delete `table ip relaycore`
  - flush / delete `table inet relaycore_guard`
  - 某张表不存在时也能正常退出
- 严格防火墙模式：
  - 可由 Panel 按节点控制
  - Agent 初始环境也可通过 `-firewall strict` 手动启用
  - 通过 `-ssh-ports` 保留指定 SSH 端口
  - 在 NAT 规则后应用 `inet relaycore_guard`
  - 允许 RelayCore `ct mark`，确保 DNAT 到本机后端时还能通过严格输入过滤
  - 等待 Panel 确认时上报 `strict_pending`
  - 只有 Panel 心跳确认成功后才取消回滚
  - 如果确认超时，则恢复旧 guard 表或删除新建表

### nftables

- IPv4 NAT 表：`ip relaycore`。
- 可选严格防火墙表：`inet relaycore_guard`。
- 使用 nftables `set` 存监听端口。
- 使用 nftables `map` 存端口到目标 IP / 端口的映射。
- 每条规则 / 协议都使用 named counter。
- 使用端口到 counter 对象的 map。
- 对 RelayCore 管理的连接打 `ct mark`。
- 如果存在 `ip filter FORWARD` 链，会尽量在上面添加一条只放行该 mark 的规则，兼容 Docker / 1Panel。
- 应用前先执行 `nft -c -f`。
- 再用批量 `nft -f` 统一应用。
- 避免生成空的 `elements = { }`，因为 nftables 不接受。
- 使用数值化 NAT priorities，以兼容 Debian 12 / nftables 1.0.6。

### 诊断

Panel 诊断目前包含：

- 节点在线 / 离线状态。
- 节点健康分数。
- conntrack 压力。
- 内存压力。
- TCP 重传比。
- Agent 错误。
- Agent 上报的 nft / apply 错误。
- 规则应用状态。
- Agent 解析后的目标 IP。
- 规则目标探测结果。
- 规则 counter 总量。
- 规则 counter 增量 / 速率。
- 目标 DNS / IP 历史。
- 节点 conntrack 趋势。
- 节点 TCP 重传变化量。
- 每条规则的可能原因摘要。
- counter 过期告警。
- 无 counter / 无流量提示。
- 每个节点的 ruleset 预览。

### 前端

- `frontend/` 中的 React + Vite + TypeScript 单页应用。
- 生产构建输出到 `web/`，由 Panel 直接以同源静态资源方式提供。
- 不使用 CDN 或任何外部运行时资源。
- `web/` 的构建产物会提交到仓库，因此正式部署不需要 Node.js。
- 面向新手的简体中文 UI。
- 针对首次使用、规则创建、诊断、节点接入、用户和 TOTP 的辅助卡片。
- 节点状态、规则启用 / 应用状态、防火墙模式、探测结果、用户角色都使用中文状态标签。
- 规则创建和节点接入都提供字段级帮助说明。
- 视觉上使用蓝 / 靛蓝风格，支持响应式布局、本地字体栈、状态颜色、渐变和过渡动画，不依赖外部资源。
- 节点和规则的管理操作通过表格 / 卡片动作和抽屉完成。
- 节点设置弹窗支持 Panel 控制的严格防火墙，以及 SSH 端口和回滚秒数。
- 危险操作使用本地 CSS 确认弹窗，不再用浏览器原生 confirm。
- 大尺寸弹窗顶部对齐，并带内部滚动，长表单也能完整操作。
- 总览流量面板显示：
  - RelayCore counter 总字节数
  - 总包数 / 连接数
  - TCP / UDP 拆分
  - 最高流量规则
- 页面包括：
  - 登录
  - 总览
  - 节点
  - 规则
  - 诊断
  - 节点接入
  - 安全 / TOTP
  - 审计事件
- 规则页展示：
  - 响应式规则卡片
  - 协议
  - 监听端口
  - 目标
  - 节点
  - 所属用户
  - counter 总量
  - 应用状态 / 信息
  - 编辑
  - 启用 / 禁用
  - 删除
  - 规则详情抽屉，包含应用报告、探测、counter、建议操作和 ruleset 片段
- 用户页展示：
  - 用户
  - 角色
  - 禁用状态
  - TOTP 状态
  - 重置密码
- 安全页展示：
  - 本地 TOTP QR 码
  - 手动 secret 兜底
  - otpauth URI 兜底
- 节点页展示：
  - 资源使用
  - conntrack 压力
  - 转发 / 防火墙模式
  - 管理员可执行节点改名 / 删除
  - 严格防火墙说明和节点侧配置提示
  - 节点详情抽屉，包含指标、TCP 重传比、最近错误、私网 IP、分配规则和 ruleset 预览
- 诊断页展示：
  - 全局发现项
  - 节点健康卡片
  - 可展开的 nftables ruleset
  - 规则诊断表
  - 目标探测结果
  - counter 速率
  - 节点趋势变化
  - 可能原因摘要
- 审计事件页展示：
  - 简体中文操作 / 详情标签
  - auth、users、nodes、rules、system、other 分类过滤

### 部署

- Panel 和 Agent 都有加固过的 systemd 模板。
- Panel 安装脚本：
  - 创建 `relaycore` 系统用户
  - 安装二进制和本地 web 资源
  - 创建 `/etc/relaycore/panel.env`
  - 将数据存放在 `/var/lib/relaycore`
  - 以非 root 用户运行 Panel
  - 安装 / 升级后自动重启服务，让新二进制立即生效
- Agent 安装脚本：
  - 安装二进制
  - 创建 `/etc/relaycore-agent/agent.env`
  - 通过环境变量支持 Panel 地址、token、dry-run 和严格防火墙设置
  - 通过 systemd capability 限制只保留网络管理所需权限
  - 安装 / 升级后自动重启服务，让新二进制立即生效
- Release 构建脚本：
  - `scripts/build-release.sh`
  - `make release VERSION=...`
  - 会打包二进制、本地 web 资源、部署文件、脚本和文档
- GitHub 一键安装脚本：
  - `scripts/install.sh install-panel`
  - `scripts/install.sh install-agent`
  - 自动安装依赖
  - 自动下载 GitHub Release 资源
  - 自动写入 env 文件
  - 自动启用并重启 systemd 服务
- GitHub Actions release workflow 会在版本 tag 上构建并上传 linux/amd64 release 包。
- 部署指南包含：
  - Panel 安装
  - Agent 安装
  - Nginx / Caddy 反向代理示例
  - 严格防火墙说明
  - 救援命令
  - 备份 / 恢复

## 已验证

通过的命令：

```bash
cd frontend && npm run build
cd frontend && npm audit
sh -n scripts/install.sh
sh -n scripts/install-panel.sh
sh -n scripts/install-agent.sh
CGO_ENABLED=1 go test ./...
CGO_ENABLED=1 go vet ./...
make all
make release
```

其他检查：

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
- Node management store helpers unit-tested.
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
- Debian 12 public UI preview:
  - Panel kept publicly reachable at `http://83.228.227.152:10028` for user review.
  - Latest local UI assets deployed with the release archive.
  - Public HTTP check returned `200`.
  - Public built CSS asset confirmed the local CSS design.
  - Public built JS asset confirmed the Simplified Chinese beginner guidance.
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
- UI visual review is pending user feedback from the Debian public preview.
- Disposable VPS validation has been done on Ubuntu 24.04 and Debian 12; more firewall stacks should still be tested before broad production rollout.

## Next Recommended Steps

1. Review the updated Simplified Chinese UI on the Debian preview panel and adjust spacing, wording, or workflow pain points from feedback.

2. Broaden integration testing:
   - Ubuntu without Docker/1Panel
   - a node with native nftables-only firewall chains
   - target behind private network/VPN

3. Evaluate flowtable acceleration:
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
cd frontend && npm run build
cd frontend && npm audit
CGO_ENABLED=1 go test ./...
CGO_ENABLED=1 go vet ./...
```

Use `/usr/local/go/bin/go` if `go` is not in PATH.
