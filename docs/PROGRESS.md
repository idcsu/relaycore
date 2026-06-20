# RelayCore 进度记录

最后更新：2026-06-18

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
  - 当前转发数据面是 IPv4 only，因此严格模式只按 IPv4 放行转发监听端口，不在 IPv6 上额外开放同端口
  - 等待 Panel 确认时上报 `strict_pending`
  - 只有 Panel 心跳确认成功后才取消回滚
  - 如果确认超时，则恢复旧 guard 表或删除新建表
- 节点身份恢复：
  - 如果面板返回 `unknown node` 且 Agent 仍有注册 token，会清空旧 node_id/node_secret 并尝试重新注册

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
  - 自动开启 `net.ipv4.ip_forward=1`
  - 使用新节点 token 接入时会备份旧 `agent.json`，避免复用已被面板删除的旧节点身份
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
- Disposable VPS validation has been done on Ubuntu 24.04 and Debian 12; more firewall stacks should still be tested before broad production rollout.

## 前端修复记录

### 2026-06-18：弹窗/抽屉遮挡 + Ruleset 显示不全修复

问题：

1. Modal 弹窗（新增规则、编辑规则、节点设置等）半边屏幕被遮挡，显示不全。
2. Drawer 抽屉（节点详情、规则详情）在中小屏幕上宽度过大，内容被遮挡。
3. 节点详情和规则详情中的 Ruleset 片段/预览内容过长时显示不全，无法滚动查看。

原因：

- **根因**：`.content` 上有 `animation: fadeUp 0.24s ease-out both`，fadeUp 动画的 `to` 状态包含 `transform: translateY(0)`。`both` 填充模式让动画结束后永久保留 `transform: translateY(0)`，导致 `.content` 成为 `position: fixed` 子元素（`.modal-backdrop`、`.drawer-backdrop`）的包含块。fixed 定位不再相对于视口，而是相对于 `.content`（在 268px 侧边栏右侧），弹窗因此被限制在主内容区宽度内，左半边被侧边栏遮挡。
- 980px 中等宽度断点缺少对 `.modal-backdrop` padding 和 `.drawer` 宽度的响应式调整。
- 720px 小屏断点缺少 `.drawer` 全宽规则。
- `.codebox` 在 Drawer 内使用时没有 `max-height` 和 `overflow` 限制，长内容撑开整个抽屉。

修复（`frontend/src/styles/index.css`）：

1. `.modal` 加 `margin: auto` — 弹窗在视口中正确居中，内容超出时可滚动。
2. 980px 断点新增：`.modal-backdrop` padding 从 `40px 20px` 减至 `24px 12px`；`.drawer` 宽度从 `min(760px, 100%)` 减至 `min(560px, 100%)`。
3. 720px 断点新增：`.drawer` 宽度设为 `100%`（全宽）。
4. 新增 `.drawer .codebox { max-height: 320px; overflow: auto; }` — 抽屉内的代码片段限高 320px 并支持滚动。
5. **根因修复**：新增 `@keyframes fadeIn`（仅 opacity，不含 transform），`.content` 改用 `fadeIn` 替代 `fadeUp`，消除 `transform: translateY(0)` 对 fixed 定位的影响。弹窗和抽屉现在正确相对于视口定位，不再被侧边栏遮挡。
6. **层叠上下文修复**：`Modal` 和 `Drawer` 组件改用 `createPortal` 渲染到 `document.body`，脱离 `.content` 的层叠上下文。`.content` 的 `animation` 属性会创建层叠上下文，导致弹窗的 `z-index:25` 被限制在 `.content` 内，无法超过同级的 `.topbar`（`z-index:4`），弹窗顶部被 topbar 遮挡。Portal 后弹窗直接在 body 层级，z-index 正确生效。

已重新构建前端，产物输出到 `web/`。

### 2026-06-18：安装脚本完善 + Panel 密码重置功能

问题：

原 install.sh 仅支持 install-panel 和 install-agent 两个子命令，缺少更新、卸载、备份、恢复、重置密码、修改监听、状态查看、日志查看、重启、救援等管理功能。参照 RelayGuard 的管理脚本，需要完善为完整的交互式管理工具。

改动：

1. `cmd/relaycore-panel/main.go`：
   - 新增 `-reset-admin-password` 标志，支持从命令行重置管理员密码后退出（不启动服务）。
   - 重置逻辑：打开 store → 按 username 查找 super_admin → 调用 ResetUserPassword → 打印新密码。
   - 如果找不到指定用户名的 super_admin，则回退到第一个 super_admin。

2. `scripts/install.sh`（完整重写）：
   - 新增 Panel 管理菜单（10 项）：安装、更新、卸载、状态、日志、重启、备份、恢复、重置密码、修改监听。
   - 新增 Agent 管理菜单（7 项）：安装、更新、卸载、状态、日志、重启、nftables 救援。
   - 新增交互式参数补全：缺少 --panel/--token 时自动提示输入。
   - 新增 SSH 端口自动检测（从 SSH_CONNECTION、ss、sshd_config 三处检测）。
   - 新增 SHA256 校验（下载 release 时验证完整性）。
   - 新增更新功能：下载新版本 → 停止服务 → 备份旧二进制 → 替换 → 重启。
   - 新增卸载功能：停止/禁用服务 → 可选清理 nftables → 删除二进制/数据/配置。
   - 新增备份/恢复：打包数据+配置到 /root/relaycore-backup/，恢复支持 .tar.gz 和 .db 格式。
   - 新增重置密码：停止 Panel → 调用 -reset-admin-password → 重启。
   - 新增修改监听地址：交互输入新地址 → 更新 env 文件 → 重启。
   - 当前 GitHub Release 安装包限定 linux/amd64，避免在未发布 arm64 包时误导用户。
   - 保留原有的非交互模式：install-panel / install-agent 直接传参安装。
   - 新增快捷命令：update-panel、update-agent、uninstall-panel、uninstall-agent、status、logs、restart、backup、restore、reset-password、configure-listen、rescue。

3. `scripts/install-panel.sh` 和 `scripts/install-agent.sh`：保持作为 release 包内安装脚本，格式对齐。

4. `README.md`：新增 Panel 管理脚本和 Agent 管理脚本的使用说明。

### 2026-06-18：版本号从 tag 自动注入

问题：

版本号硬编码在 `internal/common/models.go` 的 `const Version = "0.1.0"` 中，每次发版需要手动改代码才能更新版本号。v0.1.1 首次发版时遗漏了这一步，导致二进制虽然是从 v0.1.1 tag 构建的，但 `-version` 仍输出 0.1.0。

改动：

1. `internal/common/models.go`：`Version` 从 `const` 改为 `var`，默认值 `"dev"`（未注入时的兜底）。
2. `Makefile`：新增 `LDFLAGS := -X relaycore/internal/common.Version=$(VERSION)`，panel 和 agent 编译时通过 `-ldflags` 注入版本号。
3. `scripts/build-release.sh`：构建 release 包时同样通过 `-ldflags` 注入 `VERSION`。

效果：

- CI 打 tag（如 `v0.2.0`）时，workflow 提取 `${GITHUB_REF_NAME#v}` 得到 `0.2.0`，传给 `make release VERSION=0.2.0`，编译时注入到二进制。
- 本地开发不传 VERSION 时默认显示 `dev`。
- 以后发版只需 `git tag vX.Y.Z && git push origin vX.Y.Z`，不再需要手动改代码。

### 2026-06-20：前端易用性增强

本次目标：

1. 节点接入记录可清理，避免未绑定节点的一次性接入记录长期堆在页面里。
2. 转发规则数量变多后更容易查找和管理。
3. 总览页增加按节点维度的流量分析，但不增加 Agent 采集频率，不影响转发性能。

改动：

1. 节点接入：
   - 新增 `DELETE /api/node-tokens/{id}`。
   - Store 层新增 `DeleteNodeToken`，只允许删除未绑定节点的接入记录。
   - 节点接入页增加“删除记录”按钮和自定义确认弹窗。
   - 审计日志增加 `node_token.delete` 中文动作和详情映射。

2. 转发规则：
   - 新增规则搜索框，支持按规则名称、监听端口、目标地址、节点名、归属用户和应用状态搜索。
   - 新增状态筛选：全部、启用、停用、异常。
   - 新增分组方式：按节点、按状态、按协议、不分组。
   - 分组标题显示规则数量和简短说明，规则多时更容易定位。

3. 总览流量：
   - `trafficSummary` 从原来的规则维度扩展到节点维度。
   - 总览页显示总使用流量、有流量节点数、最高流量节点、节点流量占比、规则流量排行。
   - 数据来源仍是 Agent 低频上报的 nftables counter，只在 Panel/浏览器侧聚合展示。

验证：

```bash
PATH=/usr/local/go/bin:$PATH GOCACHE=/tmp/relaycore-go-cache go test ./...
PATH=/usr/local/go/bin:$PATH GOCACHE=/tmp/relaycore-go-cache go vet ./...
cd frontend && npm run build
git diff --check
```

### 2026-06-20：流量统计修正和 UI 对齐

问题：

1. 总览页直接使用当前 nftables counter 值展示累计流量。由于规则重建、Agent 重启或 nftables 表重建会让 counter 归零，累计值会偏低或跳变。
2. 节点列表“转发”栏把 flex 样式直接加在 `td` 上，部分浏览器里标签位置偏上。
3. 规则页状态筛选的“全部 / 启用 / 停用 / 异常”按钮在筛选区域内不够居中。

改动：

1. 后端新增 `traffic_totals` 持久化字段。
   - 每次 Agent 心跳时按 rule/protocol 计算 counter 增量。
   - 如果新 counter 小于旧 counter，按 counter 重置处理，把新值作为本轮新增。
   - 老数据升级时，会把已有 `counters` 作为 `traffic_totals` 初始值。

2. Dashboard API 新增 `traffic` 字段：
   - 累计 bytes / packets
   - TCP / UDP 协议占比
   - 节点流量汇总
   - 规则流量排行
   - 最近 1 小时、每 5 分钟聚合的新增流量曲线

3. 总览页流量面板：
   - 优先使用 Dashboard 返回的累计流量。
   - 增加最近 1 小时新增流量曲线。
   - 文案说明统计口径：Panel 根据 Agent 心跳里的 counter 增量累计，不增加 Agent 采集频率，不进入转发链路。

4. UI 对齐：
   - 节点表格“转发”栏改为 `td` 内部嵌套 `.cell-badges`，避免改变表格单元格布局。
   - `.cell-badges` 增加垂直居中。
   - 规则页 `.rules-filter .segment` 增加居中和按钮最小宽度。

验证：

```bash
PATH=/usr/local/go/bin:$PATH GOCACHE=/tmp/relaycore-go-cache go test ./...
PATH=/usr/local/go/bin:$PATH GOCACHE=/tmp/relaycore-go-cache go vet ./...
cd frontend && npm run build
git diff --check
```

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
