import type { Node } from "../api/types";
import { Badge, EmptyState } from "./ui";
import { fmtBytes, pct } from "../lib/format";
import { firewallText, firewallTone } from "../lib/labels";

function NodeStatusBadge({ status }: { status?: string }) {
  return status === "online" ? <Badge tone="ok">在线</Badge> : <Badge tone="danger">离线</Badge>;
}

export function FirewallBadge({ mode, desired }: { mode?: string; desired?: string }) {
  const text = desired && desired !== mode ? `${firewallText(mode)} / 目标 ${firewallText(desired)}` : firewallText(mode);
  return <Badge tone={firewallTone(mode)}>{text}</Badge>;
}

export function NodeTable({
  nodes,
  isAdmin,
  onOpen,
  onEdit,
  onDelete,
  relatedRuleCount,
}: {
  nodes: Node[];
  isAdmin: boolean;
  onOpen: (id: string) => void;
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
  relatedRuleCount: (id: string) => number;
}) {
  if (!nodes.length) {
    return (
      <EmptyState
        title="还没有接入节点"
        detail="先到“节点接入”生成命令，然后在准备做转发的 VPS 上执行。"
        action="节点上线后会自动出现在这里。"
      />
    );
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>节点</th>
            <th>状态</th>
            <th>资源</th>
            <th>conntrack</th>
            <th>转发</th>
            <th>公网 IP</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {nodes.map((n) => {
            const m = n.last_metrics || {};
            return (
              <tr key={n.id}>
                <td>
                  <strong>{n.name}</strong>
                  <div className="mono">{n.hostname || n.id}</div>
                </td>
                <td>
                  <NodeStatusBadge status={n.status} />
                  <div className="muted">{n.status === "online" ? "Agent 正在上报" : "请检查 Agent 服务"}</div>
                </td>
                <td>
                  负载 {Number(m.load1 || 0).toFixed(2)}
                  <br />
                  {fmtBytes(m.memory_used)} / {fmtBytes(m.memory_total)}
                </td>
                <td>
                  {m.conntrack_count || 0} / {m.conntrack_max || 0}
                  <br />
                  {pct(m.conntrack_count, m.conntrack_max)}
                </td>
                <td className="cell-badges">
                  <Badge tone="info">{n.forwarding_mode || "nftables"}</Badge>
                  <FirewallBadge mode={n.firewall_mode} desired={n.desired_firewall_mode} />
                  <Badge tone="ok">{m.forwarding_rule_count || 0} 条规则</Badge>
                </td>
                <td className="mono">{n.public_ip || "-"}</td>
                <td>
                  <div className="row-actions">
                    <button className="btn" type="button" onClick={() => onOpen(n.id)}>
                      详情
                    </button>
                    {isAdmin && (
                      <>
                        <button className="btn" type="button" onClick={() => onEdit?.(n.id)}>
                          设置
                        </button>
                        <button className="btn danger" type="button" onClick={() => onDelete?.(n.id)}>
                          删除
                        </button>
                      </>
                    )}
                  </div>
                  {isAdmin && relatedRuleCount(n.id) > 0 && (
                    <div className="muted">关联 {relatedRuleCount(n.id)} 条规则</div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
