import type { Counter, Rule } from "../api/types";

export interface TrafficRuleSummary {
  rule_id: string;
  bytes: number;
  packets: number;
  rule?: Rule;
}

export interface TrafficSummary {
  bytes: number;
  packets: number;
  byProtocol: { tcp: number; udp: number; other: number };
  topRules: TrafficRuleSummary[];
}

export function trafficSummary(counters: Counter[], rules: Rule[]): TrafficSummary {
  const byRule = new Map<string, TrafficRuleSummary>();
  const byProtocol = { tcp: 0, udp: 0, other: 0 };
  let bytes = 0;
  let packets = 0;
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
  }
  const topRules = [...byRule.values()]
    .map((item) => ({ ...item, rule: rules.find((r) => r.id === item.rule_id) }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 5);
  return { bytes, packets, byProtocol, topRules };
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
