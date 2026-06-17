import type { Counter, Node, NodeDiagnosis, Probe, Rule, RuleDiagnosis, RuleReport } from "../api/types";
import { Drawer, DrawerSection } from "./Drawer";
import { Badge, CodeBox } from "./ui";
import { FirewallBadge } from "./NodeTable";
import {
  fmtBytes,
  formatBytesPerSecond,
  formatPacketsPerSecond,
  formatTime,
} from "../lib/format";
import { applyStateText, applyStateTone, protocolText } from "../lib/labels";
import { counterTotal } from "../lib/traffic";
import { ruleRecommendations, rulesetFragment } from "../lib/ruleDiagnosis";

function ProbeRow({ probe }: { probe: Probe }) {
  return (
    <div>
      <Badge tone={probe.ok ? "ok" : "warn"}>
        {protocolText(probe.protocol)} {probe.ok ? "正常" : "失败"}
      </Badge>
      <span className="mono">
        {probe.target_host}:{probe.target_port}
      </span>
      <small>
        {probe.latency_ms || 0} ms {probe.error || ""}
      </small>
    </div>
  );
}

export function RuleDrawer({
  rule,
  node,
  report,
  diagnosis,
  nodeDiagnosis,
  counters,
  onClose,
}: {
  rule: Rule;
  node: Node | undefined;
  report: RuleReport | undefined;
  diagnosis: RuleDiagnosis | null;
  nodeDiagnosis: NodeDiagnosis | null;
  counters: Counter[];
  onClose: () => void;
}) {
  const ruleCounters = counters.filter((c) => c.rule_id === rule.id);
  const total = counterTotal(counters, rule.id);
  const probes: Probe[] = diagnosis?.probes?.length ? diagnosis.probes : report?.probes || [];
  const findings = diagnosis?.findings || [];
  const rates = diagnosis?.counter_rates || [];
  const targetHistory = diagnosis?.target_history || [];
  const ruleset = node?.last_ruleset || nodeDiagnosis?.ruleset || "";
  const fragment = rulesetFragment(ruleset, rule, report);
  const recommendations = ruleRecommendations(rule, node || {}, report, findings, total, probes);
  const applyState = rule.last_apply_state || report?.state;

  return (
    <Drawer
      title={rule.name}
      subtitle={`:${rule.listen_port} -> ${rule.target_host}:${rule.target_port}`}
      onClose={onClose}
    >
      <div className="detail-grid">
        <div>
          <span>节点</span>
          <strong>{node?.name || rule.node_id}</strong>
        </div>
        <div>
          <span>协议</span>
          <strong>{protocolText(rule.protocol)}</strong>
        </div>
        <div>
          <span>应用状态</span>
          <strong>
            <Badge tone={applyStateTone(applyState)}>{applyStateText(applyState)}</Badge>
          </strong>
        </div>
        <div>
          <span>防火墙</span>
          <strong>
            <FirewallBadge mode={node?.firewall_mode} />
          </strong>
        </div>
      </div>

      <DrawerSection title="应用报告">
        <CodeBox>
          {[
            report?.message || rule.last_error || "暂无应用报告",
            report?.target_ip ? `目标解析 IP=${report.target_ip}` : "",
            report?.counters?.length ? `计数器=${report.counters.join(", ")}` : "",
          ]
            .filter(Boolean)
            .join("\n")}
        </CodeBox>
      </DrawerSection>

      <DrawerSection title="Counter">
        {ruleCounters.length ? (
          <div className="mini-table">
            {ruleCounters.map((c, idx) => (
              <div key={idx}>
                <span>{protocolText(c.protocol)}</span>
                <strong>{fmtBytes(c.bytes)}</strong>
                <em>{c.packets} 次连接/包</em>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">暂无 counter 数据。可以从外部访问一次监听端口后再刷新。</p>
        )}
        <p className="muted">
          合计 {fmtBytes(total.bytes)} / {total.packets} 次连接/包
        </p>
        {rates.length ? (
          <div className="mini-table">
            {rates.map((rate, idx) => (
              <div key={idx}>
                <span>{protocolText(rate.protocol)} 速率</span>
                <strong>{formatBytesPerSecond(rate.bytes_per_second)}</strong>
                <em>
                  {formatPacketsPerSecond(rate.packets_per_second)} / {rate.window_seconds} 秒 / 增量{" "}
                  {fmtBytes(rate.bytes_delta)}
                </em>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">暂无 counter 速率，需要至少两次 Agent 心跳样本。</p>
        )}
      </DrawerSection>

      <DrawerSection title="目标探测">
        {probes.length ? (
          <div className="probe-list">
            {probes.map((p, idx) => (
              <ProbeRow key={idx} probe={p} />
            ))}
          </div>
        ) : (
          <p className="muted">暂无探测数据。Agent 上报后会自动补充。</p>
        )}
      </DrawerSection>

      <DrawerSection title="解析历史">
        {targetHistory.length ? (
          <div className="probe-list">
            {targetHistory
              .slice(-6)
              .reverse()
              .map((item, idx) => (
                <div key={idx}>
                  <span className="mono">{item.target_host}</span>
                  <strong>{item.target_ip}</strong>
                  <small>{formatTime(item.resolved_at)}</small>
                </div>
              ))}
          </div>
        ) : (
          <p className="muted">暂无 DNS/IP 变化记录</p>
        )}
      </DrawerSection>

      <DrawerSection title="可能原因">
        <div className="finding info">
          <strong>{diagnosis?.likely_cause || "暂无结论"}</strong>
          <p>基于 apply 状态、counter、探测、DNS 历史和节点趋势生成。</p>
        </div>
      </DrawerSection>

      <DrawerSection title="建议动作">
        <div className="finding-list">
          {recommendations.map((item, idx) => (
            <div key={idx} className={`finding ${item.tone}`}>
              <strong>{item.title}</strong>
              <p>{item.detail}</p>
            </div>
          ))}
        </div>
      </DrawerSection>

      <DrawerSection title="Ruleset 片段">
        {fragment ? <CodeBox>{fragment}</CodeBox> : <p className="muted">暂无匹配片段</p>}
      </DrawerSection>
    </Drawer>
  );
}
