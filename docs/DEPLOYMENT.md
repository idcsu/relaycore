# RelayCore 部署指南

## 系统要求

- Linux + systemd。
- Panel 需要 `libsqlite3`。
- Agent 需要 `nftables`，并且必须有管理 nftables 的权限。
- 跨主机转发需要 `net.ipv4.ip_forward=1`。
- 建议先在一次性 VPS 上测试非 dry-run nftables apply，再迁移生产节点。

Debian/Ubuntu 极简镜像可先安装：

```bash
apt-get update
apt-get install -y libsqlite3-0 nftables
```

## 构建 Release

在项目根目录执行：

```bash
make release VERSION=0.1.0
```

产物会生成在 `dist/`：

```bash
relaycore-0.1.0-linux-amd64.tar.gz
relaycore-0.1.0-linux-amd64.tar.gz.sha256
```

Panel 使用 CGO 链接系统 `libsqlite3`，跨平台构建时需要对应平台的 C 工具链。生产上最稳妥的方式是在目标架构机器上构建。

## Panel 安装

推荐使用 GitHub Release 一键安装：

```bash
curl -fsSL https://raw.githubusercontent.com/idcsu/relaycore/main/scripts/install.sh | sudo bash -s -- install-panel --addr 0.0.0.0:10028
```

脚本会自动安装依赖、下载最新 release、写入 `/etc/relaycore/panel.env`、启用 systemd 并启动服务。

解压 release 包后执行：

```bash
sudo ./scripts/install-panel.sh
```

默认安装路径：

- binary: `/usr/local/bin/relaycore-panel`
- web assets: `/opt/relaycore/web`
- data: `/var/lib/relaycore`
- env file: `/etc/relaycore/panel.env`
- systemd unit: `/etc/systemd/system/relaycore-panel.service`

Panel 默认监听：

```bash
127.0.0.1:10028
```

首次启动如果没有设置 `ADMIN_PASSWORD`，Panel 会生成初始管理员密码并写入 journal：

```bash
journalctl -u relaycore-panel -n 80 --no-pager
```

## Panel 配置

编辑：

```bash
sudoedit /etc/relaycore/panel.env
```

常用项：

```bash
RELAYCORE_ADDR=127.0.0.1:10028
RELAYCORE_DATA=/var/lib/relaycore
RELAYCORE_WEB=/opt/relaycore/web
ADMIN_USER=admin
# ADMIN_PASSWORD=
```

修改后重启：

```bash
sudo systemctl restart relaycore-panel
```

## 反向代理

生产环境必须把 Panel 放在 HTTPS 后面。Panel 会在 HTTPS 或 `X-Forwarded-Proto: https` 下设置 Secure Cookie。

### Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name relaycore.example.com;

    ssl_certificate /etc/letsencrypt/live/relaycore.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/relaycore.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:10028;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

### Caddy

```caddyfile
relaycore.example.com {
    reverse_proxy 127.0.0.1:10028
}
```

## Agent 安装

推荐在面板“节点接入”里生成命令，或者手动执行：

```bash
curl -fsSL https://raw.githubusercontent.com/idcsu/relaycore/main/scripts/install.sh | sudo bash -s -- install-agent --panel https://relaycore.example.com --token 面板生成的token
```

脚本会自动安装依赖、下载最新 release、写入 `/etc/relaycore-agent/agent.env`、启用 systemd 并启动服务。

在节点服务器上解压 release 包后执行：

```bash
sudo PANEL_URL=https://relaycore.example.com TOKEN=面板生成的token ./scripts/install-agent.sh
```

默认安装路径：

- binary: `/usr/local/bin/relaycore-agent`
- data/env: `/etc/relaycore-agent`
- systemd unit: `/etc/systemd/system/relaycore-agent.service`

安装脚本会写入：

```bash
/etc/relaycore-agent/agent.env
```

常用项：

```bash
RELAYCORE_AGENT_DATA=/etc/relaycore-agent
RELAYCORE_PANEL=https://relaycore.example.com
RELAYCORE_TOKEN=
RELAYCORE_NODE_NAME=
RELAYCORE_DRY_RUN=0
RELAYCORE_FIREWALL_MODE=managed
RELAYCORE_SSH_PORTS=22
RELAYCORE_FIREWALL_ROLLBACK_SECONDS=60
```

注册成功后 Agent 会把 node secret 保存到 `agent.json`，并清空一次性 token。

## 转发链兼容

RelayCore 的 NAT 数据面在 `table ip relaycore` 中管理。对于 Docker、1Panel 等把系统 `FORWARD` 链默认策略改成 `DROP` 的节点，Agent 会给命中 RelayCore 监听端口的连接设置固定 `ct mark`，并尝试在现有 `ip filter FORWARD` 链顶部放行该 mark。

这个兼容规则只放行 RelayCore 管理的连接，不会把整条 `FORWARD` 链改成 accept。若节点使用自定义 nftables base chain 在其他位置 drop 转发流量，需要管理员额外接入该防火墙策略。

## 严格防火墙模式

默认 `RELAYCORE_FIREWALL_MODE=managed` 只管理 NAT 转发表。

启用 strict 前，确认 SSH 端口正确：

```bash
RELAYCORE_FIREWALL_MODE=strict
RELAYCORE_SSH_PORTS=22,2222
RELAYCORE_FIREWALL_ROLLBACK_SECONDS=60
```

strict 模式会应用 `table inet relaycore_guard`，并在 Panel 确认节点仍可达前保持回滚计时器。guard input 链会放行 RelayCore `ct mark`，因此 DNAT 到本机后端时不需要额外开放后端端口。建议先在 disposable VPS 上验证。

## 救援

如果规则误配或 strict 模式导致异常，在节点上执行：

```bash
sudo relaycore-agent rescue
```

该命令只清理 RelayCore 管理的 nftables 表：

- `table ip relaycore`
- `table inet relaycore_guard`

如果 Agent 曾插入过 RelayCore `ct mark` 的 `FORWARD` 兼容规则，rescue 也会尝试清理。

## 备份

Panel 当前使用 SQLite-backed snapshot。备份时保存：

```bash
sudo systemctl stop relaycore-panel
sudo tar -czf relaycore-backup.tgz /var/lib/relaycore /etc/relaycore
sudo systemctl start relaycore-panel
```

恢复时保持目录 owner：

```bash
sudo chown -R relaycore:relaycore /var/lib/relaycore
sudo systemctl restart relaycore-panel
```
