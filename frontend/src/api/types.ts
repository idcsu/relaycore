export type Role = "user" | "admin" | "super_admin";

export interface User {
  id: string;
  username: string;
  role: Role;
  disabled?: boolean;
  totp_enabled?: boolean;
  created_at?: string;
}

export interface MeResponse {
  user: User;
  version?: string;
}

export interface Finding {
  severity: "info" | "warn" | "critical" | string;
  title: string;
  detail: string;
}

export interface NodeMetrics {
  load1?: number;
  memory_used?: number;
  memory_total?: number;
  disk_used?: number;
  disk_total?: number;
  uptime?: number;
  net_in?: number;
  net_out?: number;
  conntrack_count?: number;
  conntrack_max?: number;
  tcp_out_segments?: number;
  tcp_retrans_segments?: number;
  forwarding_rule_count?: number;
}

export interface Node {
  id: string;
  name: string;
  hostname?: string;
  status?: "online" | "offline" | string;
  public_ip?: string;
  private_ips?: string[];
  forwarding_mode?: string;
  firewall_mode?: string;
  desired_firewall_mode?: string;
  firewall_ssh_ports?: number[];
  firewall_rollback_seconds?: number;
  last_metrics?: NodeMetrics;
  last_ruleset?: string;
  last_error?: string;
  last_diagnostics?: Finding[];
}

export type Protocol = "tcp" | "udp" | "both";
export type ApplyState = "applied" | "dry_run" | "error" | "skipped" | "pending" | string;

export interface Rule {
  id: string;
  name: string;
  description?: string;
  protocol: Protocol;
  enabled: boolean;
  node_id: string;
  user_id?: string;
  listen_port: number;
  target_host: string;
  target_port: number;
  source_cidrs?: string[];
  last_apply_state?: ApplyState;
  last_error?: string;
}

export interface Counter {
  rule_id: string;
  protocol?: Protocol;
  bytes?: number;
  packets?: number;
}

export interface Probe {
  protocol?: Protocol;
  ok?: boolean;
  target_host?: string;
  target_port?: number;
  latency_ms?: number;
  error?: string;
}

export interface RuleReport {
  rule_id: string;
  state?: ApplyState;
  message?: string;
  target_ip?: string;
  counters?: string[];
  probes?: Probe[];
}

export interface RulesResponse {
  items: Rule[];
  counters?: Counter[];
  reports?: RuleReport[];
}

export interface DashboardResponse {
  nodes?: number;
  online_nodes?: number;
  rules?: number;
  enabled_rules?: number;
  rule_version?: number;
  findings?: Finding[];
  traffic?: TrafficOverview;
}

export interface TrafficOverview {
  bytes?: number;
  packets?: number;
  by_protocol?: { tcp?: number; udp?: number; other?: number };
  nodes?: TrafficNodeOverview[];
  rules?: TrafficRuleOverview[];
  series?: TrafficSeriesPoint[];
  window_seconds?: number;
}

export interface TrafficNodeOverview {
  node_id: string;
  node_name?: string;
  bytes?: number;
  packets?: number;
  rule_count?: number;
  enabled_rule_count?: number;
}

export interface TrafficRuleOverview {
  rule_id: string;
  rule_name?: string;
  node_id?: string;
  node_name?: string;
  protocol?: Protocol | string;
  listen_port?: number;
  bytes?: number;
  packets?: number;
}

export interface TrafficSeriesPoint {
  at: string;
  bytes?: number;
  packets?: number;
}

export interface NodeTrend {
  window_seconds?: number;
  sample_count?: number;
  conntrack_delta?: number;
  tcp_retrans_ratio?: number;
  tcp_retrans_delta?: number;
  net_in_bytes_per_sec?: number;
  net_out_bytes_per_sec?: number;
}

export interface NodeDiagnosis {
  node_id: string;
  node_name: string;
  status?: string;
  health?: number;
  summary?: string;
  metrics?: NodeMetrics;
  trend?: NodeTrend;
  ruleset?: string;
  findings?: Finding[];
}

export interface CounterRate {
  protocol?: Protocol;
  bytes_per_second?: number;
  packets_per_second?: number;
  window_seconds?: number;
  bytes_delta?: number;
}

export interface TargetHistoryEntry {
  target_host?: string;
  target_ip?: string;
  resolved_at?: string;
}

export interface RuleDiagnosis {
  rule_id: string;
  rule_name: string;
  protocol?: Protocol;
  enabled?: boolean;
  node_id?: string;
  node_name?: string;
  listen?: string | number;
  target?: string;
  target_ip?: string;
  apply_state?: ApplyState;
  apply_message?: string;
  counters?: Counter[];
  counter_rates?: CounterRate[];
  probes?: Probe[];
  likely_cause?: string;
  findings?: Finding[];
  target_history?: TargetHistoryEntry[];
}

export interface DiagnosticsResponse {
  findings?: Finding[];
  nodes?: NodeDiagnosis[];
  rules?: RuleDiagnosis[];
}

export interface NodeToken {
  id: string;
  name: string;
  used_count?: number;
  max_uses?: number;
  expires_at?: string;
  used_by_node?: string;
}

export interface AuditEvent {
  created_at?: string;
  action: string;
  actor_id?: string;
  target?: string;
  ip?: string;
  detail?: string;
}

export interface TOTPSetup {
  uri: string;
  secret: string;
}

export interface ListResponse<T> {
  items: T[];
}
