import type { Counter, Node, Rule, RuleReport } from "../api/types";
import { Badge } from "./ui";
import { fmtBytes } from "../lib/format";
import { applyStateText, applyStateTone, protocolText } from "../lib/labels";
import { counterTotal } from "../lib/traffic";

function ApplyBadge({ state }: { state?: string }) {
  return <Badge tone={applyStateTone(state)}>{applyStateText(state)}</Badge>;
}

export function RuleCard({
  rule,
  node,
  counters,
  report,
  ownerName,
  isAdmin,
  onOpen,
  onEdit,
  onToggle,
  onDelete,
}: {
  rule: Rule;
  node?: Node;
  counters: Counter[];
  report?: RuleReport;
  ownerName: string;
  isAdmin: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const total = counterTotal(counters, rule.id);
  const listen = `${node?.public_ip || node?.hostname || "节点公网 IP"}:${rule.listen_port}`;
  const applyState = rule.last_apply_state || report?.state;

  return (
    <article className="rule-card panel">
      <div className="rule-main">
        <div className="rule-title">
          <strong>{rule.name}</strong>
          <p>{rule.description || "无备注"}</p>
        </div>
        <div className="rule-badges">
          <Badge tone="info">{protocolText(rule.protocol)}</Badge>
          {rule.enabled ? <Badge tone="ok">已启用</Badge> : <Badge tone="warn">已停用</Badge>}
          <ApplyBadge state={applyState} />
        </div>
      </div>
      <div className="rule-path">
        <div>
          <span>监听地址</span>
          <strong className="mono">{listen}</strong>
        </div>
        <i />
        <div>
          <span>目标地址</span>
          <strong className="mono">
            {rule.target_host}:{rule.target_port}
          </strong>
        </div>
      </div>
      <div className="rule-meta">
        <div>
          <span>节点</span>
          <strong>{node?.name || rule.node_id}</strong>
        </div>
        <div>
          <span>归属</span>
          <strong>{ownerName}</strong>
        </div>
        <div>
          <span>累计流量</span>
          <strong>{fmtBytes(total.bytes)}</strong>
          <em>{total.packets} 次连接/包</em>
        </div>
        <div>
          <span>应用消息</span>
          <strong>{rule.last_error || report?.message || "正常"}</strong>
        </div>
      </div>
      <div className="rule-actions row-actions">
        <button className="btn" type="button" onClick={onOpen}>
          详情
        </button>
        {isAdmin && (
          <>
            <button className="btn" type="button" onClick={onEdit}>
              编辑
            </button>
            <button className="btn" type="button" onClick={onToggle}>
              {rule.enabled ? "停用" : "启用"}
            </button>
            <button className="btn danger" type="button" onClick={onDelete}>
              删除
            </button>
          </>
        )}
      </div>
    </article>
  );
}
