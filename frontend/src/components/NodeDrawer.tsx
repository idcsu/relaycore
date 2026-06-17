import type { Counter, Finding, Node, NodeDiagnosis, Rule, RuleReport } from "../api/types";
import { Drawer, DrawerSection } from "./Drawer";
import { Badge, CodeBox, FindingList } from "./ui";
import { FirewallBadge } from "./NodeTable";
import {
  fmtBytes,
  fmtDuration,
  fmtSigned,
  formatBytesPerSecond,
  pct,
  tcpRetransRatio,
} from "../lib/format";
import { applyStateText, firewallText, protocolText } from "../lib/labels";
import { counterTotal } from "../lib/traffic";

function nodeFindings(node: Node, diag: NodeDiagnosis | null, assigned: Rule[]): Finding[] {
  const out: Finding[] = [...(diag?.findings || []), ...(node.last_diagnostics || [])];
  if (node.last_error) {
    out.unshift({ severity: "critical", title: "Agent 错误", detail: node.last_error });
  }
  if (node.status && node.status !== "online") {
    out.unshift({ severity: "critical", title: "节点离线", detail: "最近 90 秒内没有收到 Agent 心跳。" });
  }
  const pending = assigned.filter((r) => (r.last_apply_state || "pending") === "pending").length;
  if (pending) {
    out.push({ severity: "warn", title: "存在待应用规则", detail: `${pending} 条规则仍在等待下发。` });
  }
  const seen = new Set<string>();
  return out.filter((f) => {
    const key = `${f.severity}|${f.title}|${f.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function NodeDrawer({
  node,
  diagnosis,
  rules,
  counters,
  reports,
  onClose,
}: {
  node: Node;
  diagnosis: NodeDiagnosis | null;
  rules: Rule[];
  counters: Counter[];
  reports: RuleReport[];
  onClose: () => void;
}) {
  const m = node.last_metrics || {};
  const trend = diagnosis?.trend || {};
  const assigned = rules.filter((r) => r.node_id === node.id);
  const ruleset = node.last_ruleset || diagnosis?.ruleset || "";
  const findings = nodeFindings(node, diagnosis, assigned);

  return (
    <Drawer
      title={node.name}
      subtitle={`${node.hostname || node.id}${node.public_ip ? ` / ${node.public_ip}` : ""}`}
      onClose={onClose}
    >
      <div className="detail-grid">
        <div>
          <span>状态</span>
          <strong>{node.status === "online" ? <Badge tone="ok">在线</Badge> : <Badge tone="danger">离线</Badge>}</strong>
        </div>
        <div>
          <span>健康</span>
          <strong>{diagnosis?.health ?? "-"}</strong>
        </div>
        <div>
          <span>转发</span>
          <strong>
            <Badge tone="info">{node.forwarding_mode || "nftables"}</Badge>
          </strong>
        </div>
        <div>
          <span>防火墙</span>
          <strong>
            <FirewallBadge mode={node.firewall_mode} />
          </strong>
        </div>
      </div>

      <DrawerSection title="防火墙模式说明">
        <div className="notice-panel">
          <strong>当前：{firewallText(node.firewall_mode)}</strong>
          <p>
            这个状态由节点服务器上的 Agent 配置上报。要切换严格防火墙，需要在节点的{" "}
            <span className="mono">/etc/relaycore-agent/agent.env</span> 中设置{" "}
            <span className="mono">RELAYCORE_FIREWALL_MODE=strict</span>，并确认{" "}
            <span className="mono">RELAYCORE_SSH_PORTS</span> 包含你的 SSH 端口，然后重启{" "}
            <span className="mono">relaycore-agent</span>。
          </p>
          <p>
            如果配置错误导致规则异常，可在节点执行 <span className="mono">relaycore-agent rescue</span> 清理 RelayCore
            管理的 nftables 表。
          </p>
        </div>
      </DrawerSection>

      <DrawerSection title="资源">
        <div className="metric-strip">
          <div>
            <span>1 分钟负载</span>
            <strong>{Number(m.load1 || 0).toFixed(2)}</strong>
          </div>
          <div>
            <span>内存</span>
            <strong>{pct(m.memory_used, m.memory_total)}</strong>
            <em>
              {fmtBytes(m.memory_used)} / {fmtBytes(m.memory_total)}
            </em>
          </div>
          <div>
            <span>磁盘</span>
            <strong>{pct(m.disk_used, m.disk_total)}</strong>
            <em>
              {fmtBytes(m.disk_used)} / {fmtBytes(m.disk_total)}
            </em>
          </div>
          <div>
            <span>运行</span>
            <strong>{fmtDuration(m.uptime)}</strong>
          </div>
        </div>
      </DrawerSection>

      <DrawerSection title="conntrack / TCP">
        <div className="metric-strip">
          <div>
            <span>conntrack</span>
            <strong>{pct(m.conntrack_count, m.conntrack_max)}</strong>
            <em>
              {m.conntrack_count || 0} / {m.conntrack_max || 0} / Δ {fmtSigned(trend.conntrack_delta)}
            </em>
          </div>
          <div>
            <span>TCP 重传</span>
            <strong>{tcpRetransRatio(m)}</strong>
            <em>近期 Δ {trend.tcp_retrans_delta || 0}</em>
          </div>
          <div>
            <span>入站</span>
            <strong>{fmtBytes(m.net_in)}</strong>
            <em>{formatBytesPerSecond(trend.net_in_bytes_per_sec)}</em>
          </div>
          <div>
            <span>出站</span>
            <strong>{fmtBytes(m.net_out)}</strong>
            <em>{formatBytesPerSecond(trend.net_out_bytes_per_sec)}</em>
          </div>
        </div>
        <p className="muted">
          趋势窗口 {trend.window_seconds || 0} 秒，样本 {trend.sample_count || 0} 个。
        </p>
      </DrawerSection>

      <DrawerSection title="最近错误">
        {findings.length ? <FindingList findings={findings} /> : <p className="muted">暂无错误或风险提示</p>}
      </DrawerSection>

      <DrawerSection title="关联规则">
        {assigned.length ? (
          <div className="mini-table rule-mini-table">
            {assigned.map((r) => {
              const total = counterTotal(counters, r.id);
              const report = reports.find((x) => x.rule_id === r.id);
              const state = report?.state || r.last_apply_state || "pending";
              return (
                <div key={r.id}>
                  <span>
                    {protocolText(r.protocol)} :{r.listen_port}
                  </span>
                  <strong>{r.name}</strong>
                  <em>
                    {r.target_host}:{r.target_port} / {fmtBytes(total.bytes)} / {applyStateText(state)}
                  </em>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="muted">暂无关联规则</p>
        )}
      </DrawerSection>

      <DrawerSection title="私网地址">
        {node.private_ips?.length ? (
          <div className="chip-list">
            {node.private_ips.map((ip) => (
              <span key={ip} className="mono">
                {ip}
              </span>
            ))}
          </div>
        ) : (
          <p className="muted">暂无私网地址</p>
        )}
      </DrawerSection>

      <DrawerSection title="Ruleset 预览">
        {ruleset ? <CodeBox>{ruleset}</CodeBox> : <p className="muted">暂无 ruleset 预览</p>}
      </DrawerSection>
    </Drawer>
  );
}
