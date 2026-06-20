import type { Counter, Node, Rule, TrafficOverview, TrafficSeriesPoint } from "../api/types";

export interface TrafficRuleSummary {
  rule_id: string;
  bytes: number;
  packets: number;
  rule?: Rule;
  name?: string;
  protocol?: string;
  listenPort?: number;
}

export interface TrafficNodeSummary {
  node_id: string;
  bytes: number;
  packets: number;
  ruleCount: number;
  enabledRuleCount: number;
  node?: Node;
}

export interface TrafficSummary {
  bytes: number;
  packets: number;
  byProtocol: { tcp: number; udp: number; other: number };
  byNode: TrafficNodeSummary[];
  topRules: TrafficRuleSummary[];
  series: TrafficSeriesPoint[];
  windowSeconds: number;
  source: "cumulative" | "current";
  topNode?: TrafficNodeSummary;
}

export function trafficSummaryFromOverview(overview: TrafficOverview | undefined, nodes: Node[], rules: Rule[]): TrafficSummary | null {
  if (!overview) return null;
  const nodeByID = new Map(nodes.map((n) => [n.id, n]));
  const ruleByID = new Map(rules.map((r) => [r.id, r]));
  const byNode = (overview.nodes || []).map((item) => ({
    node_id: item.node_id,
    bytes: Number(item.bytes || 0),
    packets: Number(item.packets || 0),
    ruleCount: Number(item.rule_count || 0),
    enabledRuleCount: Number(item.enabled_rule_count || 0),
    node: nodeByID.get(item.node_id) || (item.node_name ? ({ id: item.node_id, name: item.node_name } as Node) : undefined),
  }));
  const topRules = (overview.rules || []).map((item) => {
    const rule = ruleByID.get(item.rule_id);
    return {
      rule_id: item.rule_id,
      bytes: Number(item.bytes || 0),
      packets: Number(item.packets || 0),
      rule,
      name: item.rule_name,
      protocol: item.protocol,
      listenPort: item.listen_port,
    };
  });
  const byProtocol = overview.by_protocol || {};
  return {
    bytes: Number(overview.bytes || 0),
    packets: Number(overview.packets || 0),
    byProtocol: {
      tcp: Number(byProtocol.tcp || 0),
      udp: Number(byProtocol.udp || 0),
      other: Number(byProtocol.other || 0),
    },
    byNode,
    topRules,
    topNode: byNode[0],
    series: overview.series || [],
    windowSeconds: Number(overview.window_seconds || 0),
    source: "cumulative",
  };
}

export function trafficSummary(counters: Counter[], rules: Rule[], nodes: Node[] = []): TrafficSummary {
  const byRule = new Map<string, TrafficRuleSummary>();
  const ruleByID = new Map(rules.map((r) => [r.id, r]));
  const byNode = new Map<string, TrafficNodeSummary>();
  const byProtocol = { tcp: 0, udp: 0, other: 0 };
  let bytes = 0;
  let packets = 0;
  for (const node of nodes) {
    byNode.set(node.id, {
      node_id: node.id,
      bytes: 0,
      packets: 0,
      ruleCount: 0,
      enabledRuleCount: 0,
      node,
    });
  }
  for (const rule of rules) {
    const item = byNode.get(rule.node_id) || {
      node_id: rule.node_id,
      bytes: 0,
      packets: 0,
      ruleCount: 0,
      enabledRuleCount: 0,
      node: nodes.find((n) => n.id === rule.node_id),
    };
    item.ruleCount += 1;
    if (rule.enabled) item.enabledRuleCount += 1;
    byNode.set(rule.node_id, item);
  }
  for (const c of counters) {
    const b = Number(c.bytes || 0);
    const p = Number(c.packets || 0);
    bytes += b;
    packets += p;
    const proto = c.protocol === "tcp" || c.protocol === "udp" ? c.protocol : "other";
    byProtocol[proto] += b;
    const item = byRule.get(c.rule_id) || { rule_id: c.rule_id, bytes: 0, packets: 0 };
    item.bytes += b;
    item.packets += p;
    byRule.set(c.rule_id, item);
    const rule = ruleByID.get(c.rule_id);
    if (rule) {
      const nodeItem = byNode.get(rule.node_id) || {
        node_id: rule.node_id,
        bytes: 0,
        packets: 0,
        ruleCount: 0,
        enabledRuleCount: 0,
        node: nodes.find((n) => n.id === rule.node_id),
      };
      nodeItem.bytes += b;
      nodeItem.packets += p;
      byNode.set(rule.node_id, nodeItem);
    }
  }
  const topRules = [...byRule.values()]
    .map((item) => ({ ...item, rule: ruleByID.get(item.rule_id) }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 5);
  const nodeItems = [...byNode.values()]
    .map((item) => ({ ...item, node: item.node || nodes.find((n) => n.id === item.node_id) }))
    .sort((a, b) => b.bytes - a.bytes || a.node_id.localeCompare(b.node_id));
  return { bytes, packets, byProtocol, byNode: nodeItems, topRules, topNode: nodeItems[0], series: [], windowSeconds: 0, source: "current" };
}

export function counterTotal(counters: Counter[], ruleId: string): { bytes: number; packets: number } {
  return counters
    .filter((c) => c.rule_id === ruleId)
    .reduce(
      (acc, c) => {
        acc.bytes += Number(c.bytes || 0);
        acc.packets += Number(c.packets || 0);
        return acc;
      },
      { bytes: 0, packets: 0 },
    );
}
