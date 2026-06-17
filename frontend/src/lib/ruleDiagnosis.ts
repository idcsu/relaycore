import type { Finding, Node, Probe, Rule, RuleReport } from "../api/types";

export function rulesetFragment(ruleset: string, rule: Rule, report?: RuleReport): string {
  if (!ruleset) return "";
  const needles = [String(rule.listen_port || ""), report?.target_ip || "", ...(report?.counters || [])].filter(
    Boolean,
  );
  const lines = String(ruleset).split("\n");
  const matched = lines.filter((line) => needles.some((needle) => line.includes(needle)));
  return matched.slice(0, 60).join("\n");
}

export interface Recommendation {
  tone: string;
  title: string;
  detail: string;
}

export function ruleRecommendations(
  rule: Rule,
  node: Partial<Node>,
  report: RuleReport | undefined,
  findings: Finding[],
  total: { packets: number; bytes: number },
  probes: Probe[],
): Recommendation[] {
  const items: Recommendation[] = [];
  if (node.status && node.status !== "online") {
    items.push({ tone: "critical", title: "节点离线", detail: "先恢复 Agent 心跳，再判断转发规则是否异常。" });
  }
  if ((rule.last_apply_state || report?.state) === "error") {
    items.push({
      tone: "critical",
      title: "规则应用失败",
      detail: report?.message || rule.last_error || "检查 nftables 语法、权限和目标地址解析。",
    });
  }
  if (node.firewall_mode === "strict_pending") {
    items.push({
      tone: "warn",
      title: "严格防火墙等待确认",
      detail: "Agent 已进入回滚保护窗口，等待面板心跳确认后会变为严格防火墙模式。",
    });
  }
  const failedTCP = probes.find((p) => p.protocol === "tcp" && !p.ok);
  if (failedTCP) {
    items.push({
      tone: "warn",
      title: "目标 TCP 不可达",
      detail: `${failedTCP.target_host}:${failedTCP.target_port} 探测失败，优先检查目标服务、防火墙和路由。`,
    });
  }
  if (
    Number(total.packets || 0) === 0 &&
    rule.enabled &&
    (rule.last_apply_state === "applied" || report?.state === "applied")
  ) {
    items.push({
      tone: "warn",
      title: "暂无入口流量",
      detail: "规则已应用但 counter 仍为 0，优先检查云安全组、公网 IP、监听端口和上游访问路径。",
    });
  }
  for (const finding of findings || []) {
    items.push({ tone: finding.severity || "warn", title: finding.title, detail: finding.detail });
  }
  if (!items.length) {
    items.push({
      tone: "info",
      title: "未发现明显异常",
      detail: "当前 apply、探测和 counter 没有暴露出高优先级风险。",
    });
  }
  return items;
}
