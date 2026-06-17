# nftables 转发策略

RelayCore 默认使用 nftables 做 IPv4 NAT 转发，目标是让 1 核 1G 节点的 Agent 尽量不进入数据面。

## 设计点

- 使用 `set` 保存监听端口。
- 使用 `map` 保存监听端口到目标 IP/端口的映射。
- 为每条规则/协议生成 named counter。
- 使用端口到 counter 对象的 map 做低成本 per-rule 计数。
- 命中 RelayCore 监听端口的连接会设置固定 `ct mark`。
- 如果系统存在 `ip filter FORWARD` 链，Agent 会尝试放行该 `ct mark`，兼容 Docker/1Panel 等把 `FORWARD` 默认改成 `DROP` 的环境。
- 使用 `nft -c -f` 预检查。
- 使用 `nft -f` 批量应用。
- 先确保 `ip relaycore` 表存在，再 flush 并重建项目表。
- postrouting 对目标 IP 集合做 masquerade。

## 限制

- 当前 MVP 只渲染 IPv4 NAT。
- 域名目标会在 Agent 侧解析为 IPv4。
- 带源 CIDR 白名单的规则先走显式规则，普通规则走 map。
- counter 由 Agent 心跳低频读取，不进入用户态转发数据面。
- 当前 counter 统计以端口维度为准，本机 OUTPUT 链访问同一转发端口也会被计入。
- `FORWARD` 兼容规则只放行 RelayCore 设置的 `ct mark`，不会把系统 `FORWARD` 链整体改成 accept。
- 如果系统使用非标准 nftables filter 表/链并在其他 base chain 里 drop 转发流量，仍需要管理员显式接入或调整防火墙策略。

## dry-run

Agent 使用 `-dry-run` 时不会执行 `nft -f`，但仍会：

- 生成完整 ruleset。
- 做目标端轻量探测。
- 回传规则级 `dry_run` apply 报告。
- 在诊断中心展示 ruleset 预览。

## rescue

节点上可执行：

```bash
relaycore-agent rescue
```

该命令不会连接 Panel，也不读取节点密钥。它只处理 RelayCore 自己管理的表：

- `table ip relaycore`
- `table inet relaycore_guard`

1. 先执行 `nft list table ip relaycore` 并打印当前表内容。
2. 再执行 `nft list table inet relaycore_guard` 并打印当前表内容。
3. 如果某张表不存在，跳过该表并继续处理另一张表。
4. 如果表存在，先 `flush table`，再 `delete table`。

这个命令用于规则误配、Panel 不可达、Agent 反复 apply 失败等场景下快速撤掉 RelayCore 的转发规则。它不会清理系统里其他 nftables 表。

如果 Agent 曾经为了兼容现有 `FORWARD` 链插入过 RelayCore `ct mark` 放行规则，`rescue` 会同时尝试清理该规则。

## strict firewall

默认模式是 `managed`，只管理 `table ip relaycore` NAT 转发表，不改变系统默认防火墙策略。

节点可显式启用严格模式：

```bash
relaycore-agent -firewall strict -ssh-ports 22,2222 -rollback-seconds 60
```

严格模式会额外管理 `table inet relaycore_guard`：

- input 链默认 `policy drop`。
- 保留 loopback。
- 保留 established/related 连接。
- 丢弃 invalid 连接。
- 放行 ICMP/IPv6 ICMP。
- 放行 RelayCore `ct mark`，用于 DNAT 后仍能识别并允许本项目管理的连接。
- 放行 `-ssh-ports` 指定的 SSH 端口，默认 `22`。
- 放行当前转发规则的公网监听端口。
- forward 链保持 `policy accept`，避免破坏内核 NAT 转发路径。

安全流：

1. Agent 先应用 NAT 表。
2. 严格模式下再应用 `inet relaycore_guard`。
3. Agent 进入 `strict_pending` 并启动回滚定时器。
4. Agent 立即向 Panel 发送第二次状态心跳。
5. 只有 Panel 成功响应后，Agent 才取消回滚。
6. 如果超时前没有收到 Panel 确认，Agent 自动恢复之前的 guard 表；如果之前不存在，则删除新建的 guard 表。

如果 strict 配置导致节点不可达，可优先尝试：

```bash
relaycore-agent rescue
```
