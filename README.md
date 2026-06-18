# RelayCore

RelayCore 是一个面向小型 Linux VPS 节点的轻量级多节点端口转发面板。

设计目标很直接：Agent 不在用户态搬运流量，转发尽量交给 Linux 内核和 nftables；Panel 负责管理、权限、安全、持久化、诊断和界面。

## 当前状态

RelayCore 目前已经进入可部署测试阶段。

已在一次性 Ubuntu 24.04 VPS 上验证：

- Panel 和 Agent 通过 systemd 部署。
- 真实非 dry-run 的 nftables TCP/UDP 转发。
- 公网 TCP 和 UDP 到本地后端转发。
- 公网 TCP 和 UDP 到外部目标转发。
- 每条规则的 nftables counter 能回传到 Panel。
- 诊断中心能汇总节点健康与规则流量。
- `relaycore-agent rescue` 可清理 RelayCore 管理的 nftables 状态。
- 严格防火墙模式和回滚链路已验证。
- Docker / 1Panel 风格的 `FORWARD policy DROP` 兼容性已验证。

已在一次性 Debian 12 VPS 上验证：

- Panel 和 Agent 通过 systemd 部署，补装 `libsqlite3-0` 后可运行。
- nftables 1.0.6 兼容数值化 NAT priority。
- 公网 TCP 转发到本地和外部目标均可用。
- 本地 UDP 转发可用。
- `relaycore-agent rescue` 可用。
- 严格防火墙模式已验证。
- 该测试机上的公网 UDP 入站受到了云厂商/网络侧限制，因此这一台机器上的公网 UDP 直接入站不作为项目问题。

## 是否需要 Docker

不需要。

RelayCore 的 Panel 和 Agent 都不依赖 Docker。

- Panel 作为普通 systemd 服务运行，数据存储在 SQLite。
- Agent 作为节点上的 systemd 服务运行，并直接管理 nftables。
- 节点上可以同时存在 Docker。RelayCore 已兼容 Docker / 1Panel 把系统 `FORWARD` 链默认设为 `DROP` 的环境。

## 组件

- `relaycore-panel`：Web UI 和 API 服务。
- `relaycore-agent`：节点侧 nftables 管理和指标上报程序。
- `frontend/`：React + Vite + TypeScript 前端源码。
- `web/`：Panel 直接提供的本地静态前端资源，不走 CDN。
- `scripts/`：安装脚本和 release 脚本。
- `deploy/`：systemd 服务模板。
- `docs/`：架构、部署、nftables 和进度文档。

## 功能

- 本地静态 Web UI，不依赖外部 CDN。
- SQLite 后端存储。
- 安全会话登录。
- PBKDF2-SHA256 密码哈希。
- TOTP 双因素认证。
- 用户管理和角色校验。
- Agent 一次性接入 token。
- Agent 心跳使用 HMAC 签名，带时间戳和 nonce 防重放。
- IPv4 TCP/UDP 端口转发。
- nftables set / map 规则生成。
- 每条规则的 named counter。
- 规则级应用报告。
- 目标探测和诊断。
- 从 `/proc` 采集节点指标。
- 对 Docker / 1Panel `FORWARD policy DROP` 的兼容处理。
- 可选严格防火墙模式，带回滚机制。
- 救援命令。

## 系统要求

Panel：

- Linux + systemd。
- 需要 `libsqlite3`。
- 生产环境建议放在 HTTPS 反向代理后面。

Agent：

- Linux + systemd。
- 需要 nftables。
- 需要 root 或等效的 nftables 权限。
- 跨主机转发需要 `net.ipv4.ip_forward=1`，Agent 安装脚本会自动开启。

Debian / Ubuntu 极简镜像常见依赖：

```bash
apt-get update
apt-get install -y libsqlite3-0 nftables
```

## 构建

构建全部内容：

```bash
make all
```

构建 release 包：

```bash
make release VERSION=0.1.1
```

产物会输出到 `dist/`。

## 前端

Panel 前端是 React + Vite + TypeScript 单页应用，源码在 `frontend/`，生产构建结果输出到 `web/` 并由 Panel 直接托管。

前端不使用运行时 CDN，全部资源都是同源本地文件。

`web/` 下的构建产物会一并提交到仓库，所以正式部署不需要 Node.js。每次修改前端源码后，请重新构建：

```bash
make web
```

或者：

```bash
cd frontend
npm install
npm run build
```

本地开发可直接运行 Vite：

```bash
cd frontend
npm install
npm run dev
```

如果 Panel 监听在别的地址，可覆盖代理目标：

```bash
VITE_PROXY_TARGET=http://127.0.0.1:10028 npm run dev
```

需要 Node.js 20+ 和 npm。

## 一键安装 Panel

从 GitHub Release 一键安装：

```bash
curl -fsSL https://raw.githubusercontent.com/idcsu/relaycore/main/scripts/install.sh | sudo bash -s -- install-panel --addr 0.0.0.0:10028
```

该脚本会自动安装依赖、下载最新 GitHub Release、写入 `/etc/relaycore/panel.env`、启用 systemd 并启动 Panel。

也可以手动解压 release 包后安装：

```bash
tar -xzf relaycore-0.1.1-linux-amd64.tar.gz
cd relaycore-0.1.1-linux-amd64
sudo ./scripts/install-panel.sh
```

Panel 默认监听 `127.0.0.1:10028`。

如果没有设置 `ADMIN_PASSWORD`，初始管理员密码会写入 journal：

```bash
journalctl -u relaycore-panel -n 80 --no-pager
```

生产环境请把 Panel 放到 Nginx 或 Caddy 后面，并启用 HTTPS。

## Panel 管理脚本

安装完成后，可以使用管理脚本进行日常维护：

```bash
curl -fsSL https://raw.githubusercontent.com/idcsu/relaycore/main/scripts/install.sh | sudo bash -s -- menu
```

或者直接下载到本地：

```bash
curl -fsSL https://raw.githubusercontent.com/idcsu/relaycore/main/scripts/install.sh -o /usr/local/bin/relaycore-manage
chmod +x /usr/local/bin/relaycore-manage
relaycore-manage menu
```

面板管理菜单功能：

1. 安装面板
2. 更新面板（自动备份旧版本二进制）
3. 卸载面板（可选清理数据和配置）
4. 查看面板状态
5. 查看面板日志
6. 重启面板
7. 备份数据（打包数据和配置到 /root/relaycore-backup/）
8. 恢复数据（支持 .tar.gz 和 .db 格式）
9. 重置管理员密码
10. 修改监听地址/端口

## 一键安装 Agent

先在 Panel 中创建节点 token，然后在节点上执行：

```bash
curl -fsSL https://raw.githubusercontent.com/idcsu/relaycore/main/scripts/install.sh | sudo bash -s -- install-agent --panel https://relaycore.example.com --token your-node-token
```

该脚本会自动安装依赖、开启 IPv4 转发、下载最新 GitHub Release、写入 `/etc/relaycore-agent/agent.env`、启用 systemd 并启动 Agent。

也可以手动从 release 包安装：

```bash
tar -xzf relaycore-0.1.1-linux-amd64.tar.gz
cd relaycore-0.1.1-linux-amd64
sudo PANEL_URL=https://relaycore.example.com TOKEN=your-node-token ./scripts/install-agent.sh
```

Agent 的配置会保存在：

```bash
/etc/relaycore-agent/agent.json
```

一次性 token 在注册成功后会被清空。

## Agent 管理脚本

在节点上可以使用 Agent 管理脚本进行维护：

```bash
curl -fsSL https://raw.githubusercontent.com/idcsu/relaycore/main/scripts/install.sh | sudo bash -s -- menu-agent
```

Agent 管理菜单功能：

1. 安装 Agent
2. 更新 Agent（自动备份旧版本二进制）
3. 卸载 Agent（可选清理 nftables 规则和数据）
4. 查看 Agent 状态
5. 查看 Agent 日志
6. 重启 Agent
7. 防火墙救援模式（清理 RelayCore 管理的 nftables 表）

## 严格防火墙模式

严格模式是可选项。

```bash
RELAYCORE_FIREWALL_MODE=strict
RELAYCORE_SSH_PORTS=22
RELAYCORE_FIREWALL_ROLLBACK_SECONDS=60
```

严格模式会创建 `table inet relaycore_guard`，保留 SSH，允许当前 IPv4 转发端口，并在 Panel 无法确认节点仍可达时自动回滚。IPv6 不会因为同名转发端口被额外放行。

## 救援

如果节点配置异常：

```bash
sudo relaycore-agent rescue
```

这个命令会移除 RelayCore 管理的 nftables 表和兼容规则，不会清理系统里其他防火墙规则。

## 文档

- [架构说明](docs/ARCHITECTURE.md)
- [部署指南](docs/DEPLOYMENT.md)
- [nftables 策略](docs/NFTABLES.md)
- [进度记录](docs/PROGRESS.md)

## 已知限制

- 目前仅支持 IPv4 转发。
- SQLite 存储还是快照式，不是完整的关系型归一化设计。
- UDP 探测只能验证发送路径，不是完整的应用层响应验证。
- 还需要补更多防火墙组合的冒烟测试。
- flowtable 加速还没有启用。
