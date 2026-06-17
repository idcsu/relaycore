# RelayCore 架构草案

RelayCore 的目标是低配节点轻量运行，转发走 Linux 内核，Panel 负责管理和诊断分析。

## 组件

- Panel：Web/API、用户会话、节点管理、规则管理、审计、诊断聚合。
- Agent：注册、HMAC 心跳、轻量指标、nftables 规则应用、规则级 apply 报告。
- nftables：默认转发路径，Agent 不参与每个连接的数据复制。

## 当前 MVP

- SQLite-backed snapshot 存储：`relaycore.db`，无第三方 Go 依赖，后续可迁移为关系型 schema。
- 登录会话 Cookie：`HttpOnly`、`SameSite=Lax`、HTTPS 下启用 `Secure`。
- TOTP 两步验证：支持生成 otpauth URI、启用、停用和登录校验。
- Agent 注册：一次性 Token。
- Agent 心跳：HMAC-SHA256 + timestamp + nonce 防重放。
- Agent 救援命令：`relaycore-agent rescue` 可打印并清理 RelayCore 自己的 NAT/guard nftables 表。
- 转发：IPv4 nftables NAT，map/set 优先，per-rule named counter 低频解析。
- 严格防火墙：可选 `inet relaycore_guard` input drop 策略，保留 SSH 端口，并通过 Panel 心跳确认取消回滚。
- 规则闭环：Panel 保存规则后，Agent 拉取并 apply；规则变更后 Agent 会立即补发一次状态心跳，回传 `applied`、`dry_run`、`error` 等状态。
- 诊断中心：汇总节点健康、规则 apply 状态、目标探测、counter 和 Agent 错误。
- 前端：本地静态资源，无 CDN。
- 部署：release 包包含二进制、本地 web 资源、systemd 模板、安装脚本和部署文档；Panel 默认以 `relaycore` 系统用户运行，Agent 保留 root/nftables 权限并收紧 capability。

## 后续安全增强

- 细粒度 RBAC。
- 备份恢复。
- 更完整的审计查询。
- Agent 规则版本确认和回滚状态上报。

## 后续诊断增强

- conntrack 深度诊断。
- 更完整的目标端 TCP/UDP 连通性检测。
- flowtable 可用性检测和实验性启用。
- 迁移建议和更细的规则级延迟归因。
