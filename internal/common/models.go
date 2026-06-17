package common

import "time"

const (
	ProjectName = "RelayCore"
	Version     = "0.1.1"
)

type Role string

const (
	RoleSuperAdmin Role = "super_admin"
	RoleAdmin      Role = "admin"
	RoleUser       Role = "user"
)

type User struct {
	ID           string    `json:"id"`
	Username     string    `json:"username"`
	PasswordHash string    `json:"password_hash,omitempty"`
	Role         Role      `json:"role"`
	Disabled     bool      `json:"disabled"`
	MustChange   bool      `json:"must_change"`
	TOTPEnabled  bool      `json:"totp_enabled"`
	TOTPSecret   string    `json:"totp_secret,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type Session struct {
	Token     string    `json:"token"`
	UserID    string    `json:"user_id"`
	IP        string    `json:"ip"`
	UserAgent string    `json:"user_agent"`
	ExpiresAt time.Time `json:"expires_at"`
	CreatedAt time.Time `json:"created_at"`
}

type Node struct {
	ID                      string      `json:"id"`
	Name                    string      `json:"name"`
	Secret                  string      `json:"secret,omitempty"`
	Status                  string      `json:"status"`
	Hostname                string      `json:"hostname"`
	OS                      string      `json:"os"`
	Arch                    string      `json:"arch"`
	AgentVersion            string      `json:"agent_version"`
	PublicIP                string      `json:"public_ip"`
	PrivateIPs              []string    `json:"private_ips"`
	ForwardingMode          string      `json:"forwarding_mode"`
	FirewallMode            string      `json:"firewall_mode"`
	DesiredFirewallMode     string      `json:"desired_firewall_mode"`
	FirewallSSHPorts        []int       `json:"firewall_ssh_ports"`
	FirewallRollbackSeconds int         `json:"firewall_rollback_seconds"`
	RuleVersion             int64       `json:"rule_version"`
	LastSeenAt              *time.Time  `json:"last_seen_at,omitempty"`
	LastMetrics             NodeMetrics `json:"last_metrics"`
	LastDiagnostics         []Finding   `json:"last_diagnostics,omitempty"`
	LastRuleset             string      `json:"last_ruleset,omitempty"`
	LastError               string      `json:"last_error"`
	CreatedAt               time.Time   `json:"created_at"`
	UpdatedAt               time.Time   `json:"updated_at"`
}

type NodeToken struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	TokenHash  string     `json:"token_hash"`
	PlainToken string     `json:"plain_token,omitempty"`
	UsedByNode string     `json:"used_by_node,omitempty"`
	UsedAt     *time.Time `json:"used_at,omitempty"`
	MaxUses    int        `json:"max_uses"`
	UsedCount  int        `json:"used_count"`
	ExpiresAt  time.Time  `json:"expires_at"`
	CreatedAt  time.Time  `json:"created_at"`
}

type ForwardRule struct {
	ID             string     `json:"id"`
	Name           string     `json:"name"`
	UserID         string     `json:"user_id"`
	NodeID         string     `json:"node_id"`
	Protocol       string     `json:"protocol"`
	ListenPort     int        `json:"listen_port"`
	TargetHost     string     `json:"target_host"`
	TargetPort     int        `json:"target_port"`
	Enabled        bool       `json:"enabled"`
	SourceCIDRs    []string   `json:"source_cidrs"`
	TrafficLimit   uint64     `json:"traffic_limit"`
	ExpireAt       *time.Time `json:"expire_at,omitempty"`
	Description    string     `json:"description"`
	Tags           []string   `json:"tags"`
	RuleVersion    int64      `json:"rule_version"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
	LastApplyState string     `json:"last_apply_state"`
	LastError      string     `json:"last_error"`
}

type RuleCounter struct {
	RuleID    string    `json:"rule_id"`
	Protocol  string    `json:"protocol"`
	Packets   uint64    `json:"packets"`
	Bytes     uint64    `json:"bytes"`
	UpdatedAt time.Time `json:"updated_at"`
}

type RuleApplyReport struct {
	RuleID    string            `json:"rule_id"`
	State     string            `json:"state"`
	Message   string            `json:"message"`
	TargetIP  string            `json:"target_ip,omitempty"`
	Counters  []string          `json:"counters,omitempty"`
	Probes    []RuleProbeResult `json:"probes,omitempty"`
	CheckedAt time.Time         `json:"checked_at"`
}

type RuleProbeResult struct {
	RuleID     string    `json:"rule_id"`
	Protocol   string    `json:"protocol"`
	TargetHost string    `json:"target_host"`
	TargetPort int       `json:"target_port"`
	OK         bool      `json:"ok"`
	LatencyMS  int       `json:"latency_ms"`
	Error      string    `json:"error,omitempty"`
	CheckedAt  time.Time `json:"checked_at"`
}

type NodeMetrics struct {
	Load1               float64 `json:"load1"`
	CPUPercent          float64 `json:"cpu_percent"`
	MemoryTotal         uint64  `json:"memory_total"`
	MemoryUsed          uint64  `json:"memory_used"`
	DiskTotal           uint64  `json:"disk_total"`
	DiskUsed            uint64  `json:"disk_used"`
	NetIn               uint64  `json:"net_in"`
	NetOut              uint64  `json:"net_out"`
	Uptime              uint64  `json:"uptime"`
	ConntrackCount      uint64  `json:"conntrack_count"`
	ConntrackMax        uint64  `json:"conntrack_max"`
	TCPRetransSegments  uint64  `json:"tcp_retrans_segments"`
	TCPOutSegments      uint64  `json:"tcp_out_segments"`
	ForwardingRuleCount int     `json:"forwarding_rule_count"`
}

type Finding struct {
	Severity  string    `json:"severity"`
	Code      string    `json:"code"`
	Title     string    `json:"title"`
	Detail    string    `json:"detail"`
	CreatedAt time.Time `json:"created_at"`
}

type AgentRegisterRequest struct {
	Token           string   `json:"token"`
	Name            string   `json:"name"`
	Hostname        string   `json:"hostname"`
	OS              string   `json:"os"`
	Arch            string   `json:"arch"`
	AgentVersion    string   `json:"agent_version"`
	PrivateIPs      []string `json:"private_ips"`
	FirewallMode    string   `json:"firewall_mode"`
	SSHPorts        []int    `json:"ssh_ports"`
	RollbackSeconds int      `json:"rollback_seconds"`
}

type AgentRegisterResponse struct {
	NodeID     string `json:"node_id"`
	NodeSecret string `json:"node_secret"`
	PanelName  string `json:"panel_name"`
	Version    string `json:"version"`
}

type AgentHeartbeatRequest struct {
	NodeID         string            `json:"node_id"`
	AgentVersion   string            `json:"agent_version"`
	Hostname       string            `json:"hostname"`
	OS             string            `json:"os"`
	Arch           string            `json:"arch"`
	PrivateIPs     []string          `json:"private_ips"`
	Metrics        NodeMetrics       `json:"metrics"`
	Counters       []RuleCounter     `json:"counters"`
	Diagnostics    []Finding         `json:"diagnostics"`
	RuleReports    []RuleApplyReport `json:"rule_reports"`
	RulesetPreview string            `json:"ruleset_preview,omitempty"`
	RuleVersion    int64             `json:"rule_version"`
	ForwardingMode string            `json:"forwarding_mode"`
	FirewallMode   string            `json:"firewall_mode"`
	LastError      string            `json:"last_error"`
}

type AgentHeartbeatResponse struct {
	ServerTime     time.Time      `json:"server_time"`
	RuleVersion    int64          `json:"rule_version"`
	Rules          []ForwardRule  `json:"rules"`
	FirewallPolicy FirewallPolicy `json:"firewall_policy"`
	Message        string         `json:"message"`
}

type FirewallPolicy struct {
	Mode            string `json:"mode"`
	SSHPorts        []int  `json:"ssh_ports"`
	RollbackSeconds int    `json:"rollback_seconds"`
}

type APIError struct {
	Error string `json:"error"`
}
