import { useDiagnostics } from "../api/hooks";
import type { CounterRate, NodeDiagnosis, Probe, RuleDiagnosis } from "../api/types";
import { Badge, Bar, CodeBox, EmptyState, FindingList, HelperCard, Metric, SectionHead, Spinner } from "../components/ui";
import { fmtBytes, fmtSigned, formatBytesPerSecond, formatPacketsPerSecond, formatRatio, pct, pctValue } from "../lib/format";
import { applyStateText, applyStateTone, protocolText } from "../lib/labels";
import type { Tone } from "../lib/labels";

function NodeDiagnosisCard({ node }: { node: NodeDiagnosis }) {
  const health = Number(node.health || 0);
  const tone: Tone = health >= 90 ? "ok" : health >= 65 ? "warn" : "danger";
  const trend = node.trend || {};
  return (
    <div className="panel pad diag-card">
      <div className="diag-head">
        <div>
          <strong>{node.node_name}</strong>
          <span>{node.status === "online" ? "在线" : "离线"}</span>
        </div>
        <Badge tone={tone}>{node.health}</Badge>
      </div>
      <div className="healthbar">
        <Bar value={pctValue(health, 100)} />
      </div>
      <p>{node.summary}</p>
      <div className="diag-mini">
        <span>负载 {Number(node.metrics?.load1 || 0).toFixed(2)}</span>
        <span>内存 {pct(node.metrics?.memory_used, node.metrics?.memory_total)}</span>
        <span>CT {pct(node.metrics?.conntrack_count, node.metrics?.conntrack_max)}</span>
        <span>CT Δ {fmtSigned(trend.conntrack_delta)}</span>
        <span>TCP 重传 {formatRatio(trend.tcp_retrans_ratio)}</span>
      </div>
      {node.ruleset && (
        <details className="ruleset-details">
          <summary>nftables ruleset</summary>
          <CodeBox>{node.ruleset}</CodeBox>
        </details>
      )}
    </div>
  );
}

function Probes({ probes }: { probes: Probe[] }) {
  if (!probes.length) return <span className="muted">-</span>;
  return (
    <div className="probe-stack">
      {probes.map((p, idx) => (
        <div key={idx}>
          <Badge tone={p.ok ? "ok" : "warn"}>
            {protocolText(p.protocol)} {p.ok ? "正常" : "失败"}
          </Badge>
          <span className="muted">{p.latency_ms || 0} ms</span>
        </div>
      ))}
    </div>
  );
}

function CounterRates({ rates }: { rates: CounterRate[] }) {
  if (!rates.length) return <span className="muted">速率等待样本</span>;
  return (
    <div className="rate-stack">
      {rates.map((rate, idx) => (
        <span className="muted" key={idx}>
          {protocolText(rate.protocol)} {formatBytesPerSecond(rate.bytes_per_second)} /{" "}
          {formatPacketsPerSecond(rate.packets_per_second)}
        </span>
      ))}
    </div>
  );
}

function RuleDiagnosisTable({ rules }: { rules: RuleDiagnosis[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>规则</th>
            <th>节点</th>
            <th>监听</th>
            <th>目标</th>
            <th>应用</th>
            <th>counter</th>
            <th>探测</th>
            <th>可能原因</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => {
            const total = (r.counters || []).reduce(
              (acc, c) => ({
                packets: acc.packets + Number(c.packets || 0),
                bytes: acc.bytes + Number(c.bytes || 0),
              }),
              { packets: 0, bytes: 0 },
            );
            return (
              <tr key={r.rule_id}>
                <td>
                  <strong>{r.rule_name}</strong>
                  <div className="cell-badges">
                    <Badge tone="info">{protocolText(r.protocol)}</Badge>
                    {r.enabled ? <Badge tone="ok">已启用</Badge> : <Badge tone="warn">已停用</Badge>}
                  </div>
                </td>
                <td>{r.node_name || r.node_id}</td>
                <td className="mono">:{r.listen}</td>
                <td className="mono">
                  {r.target}
                  {r.target_ip && (
                    <>
                      <br />
                      <span className="muted">{r.target_ip}</span>
                    </>
                  )}
                </td>
                <td>
                  <Badge tone={applyStateTone(r.apply_state)}>{applyStateText(r.apply_state)}</Badge>
                  <div className="muted">{r.apply_message || ""}</div>
                </td>
                <td>
                  {fmtBytes(total.bytes)}
                  <br />
                  <span className="muted">{total.packets} 次连接/包</span>
                  <CounterRates rates={r.counter_rates || []} />
                </td>
                <td>
                  <Probes probes={r.probes || []} />
                </td>
                <td>
                  <span className="muted">{r.likely_cause || "暂无结论"}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function DiagnosticsPage() {
  const { data, isLoading } = useDiagnostics(true);

  if (isLoading) return <Spinner />;

  const d = data || { findings: [], nodes: [], rules: [] };
  const findings = d.findings || [];
  const nodes = d.nodes || [];
  const rules = d.rules || [];

  return (
    <>
      <HelperCard
        title="转发慢或不通时先看这里"
        detail="诊断中心会把节点资源、规则下发、counter、目标探测和 DNS 解析历史放在一起看。"
        steps={[
          { title: "先看关键结论", detail: "严重问题优先处理，比如节点离线、规则应用失败、目标不可达。" },
          { title: "再看 counter", detail: "counter 为 0 通常说明流量没有到节点，可能是安全组、公网 IP 或端口问题。" },
          { title: "最后看资源", detail: "conntrack、内存、负载过高时，低配节点可能会表现为卡顿。" },
        ]}
      />

      <div className="grid cols-3">
        <Metric label="全局风险" value={findings.length} sub="按严重程度排序" />
        <Metric label="节点报告" value={nodes.length} sub="健康分和瓶颈归因" />
        <Metric label="规则报告" value={rules.length} sub="counter 和规则风险" />
      </div>

      <SectionHead title="关键结论" />
      {findings.length ? (
        <FindingList findings={findings} />
      ) : (
        <EmptyState
          title="暂无诊断风险"
          detail="当前采集到的数据没有明显异常。可以在访问一次转发端口后再刷新。"
        />
      )}

      <SectionHead title="节点健康" />
      {nodes.length ? (
        <div className="grid cols-3">
          {nodes.map((n) => (
            <NodeDiagnosisCard key={n.node_id} node={n} />
          ))}
        </div>
      ) : (
        <EmptyState title="暂无节点诊断" detail="接入节点并等待一次心跳后，这里会显示节点健康分。" />
      )}

      <SectionHead title="规则诊断" />
      {rules.length ? (
        <RuleDiagnosisTable rules={rules} />
      ) : (
        <EmptyState
          title="暂无规则诊断"
          detail="创建并启用转发规则后，这里会显示规则下发、计数器和目标探测结果。"
        />
      )}
    </>
  );
}
