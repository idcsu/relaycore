package agent

import (
	"bytes"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"relaycore/internal/common"
)

const (
	nftTable                  = "relaycore"
	firewallTable             = "relaycore_guard"
	relaycoreForwardMark      = "0x00052435"
	relaycoreForwardMarkShort = "0x52435"
)

type FirewallOptions struct {
	Mode          string
	SSHPorts      []int
	RollbackDelay time.Duration
}

type firewallSnapshot struct {
	Exists  bool
	Ruleset string
}

type NFTManager struct {
	mu           sync.Mutex
	dryRun       bool
	firewall     FirewallOptions
	rules        []common.ForwardRule
	lastRuleset  string
	lastError    string
	lastFindings []common.Finding
	lastReports  []common.RuleApplyReport
	lastApplied  time.Time

	rollbackCancel   chan struct{}
	rollbackDeadline time.Time
}

type resolvedRule struct {
	Rule     common.ForwardRule
	TargetIP string
}

func NewNFTManager(dryRun bool) *NFTManager {
	return NewNFTManagerWithFirewall(dryRun, FirewallOptions{})
}

func NewNFTManagerWithFirewall(dryRun bool, firewall FirewallOptions) *NFTManager {
	return &NFTManager{dryRun: dryRun, firewall: normalizeFirewallOptions(firewall)}
}

func (m *NFTManager) SetFirewallOptions(firewall FirewallOptions) bool {
	next := normalizeFirewallOptions(firewall)
	m.mu.Lock()
	defer m.mu.Unlock()
	if firewallOptionsEqual(m.firewall, next) {
		return false
	}
	m.firewall = next
	if next.Mode != "strict" {
		m.cancelFirewallRollbackLocked()
	}
	return true
}

func (m *NFTManager) FirewallMode() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	mode := m.firewall.Mode
	if mode == "" {
		mode = "managed"
	}
	if mode == "strict" && m.rollbackCancel != nil {
		return "strict_pending"
	}
	return mode
}

func firewallOptionsEqual(a, b FirewallOptions) bool {
	a = normalizeFirewallOptions(a)
	b = normalizeFirewallOptions(b)
	if a.Mode != b.Mode || a.RollbackDelay != b.RollbackDelay || len(a.SSHPorts) != len(b.SSHPorts) {
		return false
	}
	for i := range a.SSHPorts {
		if a.SSHPorts[i] != b.SSHPorts[i] {
			return false
		}
	}
	return true
}

func (m *NFTManager) ConfirmReachable() {
	m.mu.Lock()
	cancel := m.rollbackCancel
	m.rollbackCancel = nil
	m.rollbackDeadline = time.Time{}
	m.mu.Unlock()
	if cancel != nil {
		close(cancel)
	}
}

func RescueRelayCoreTable(w io.Writer) error {
	if w == nil {
		w = io.Discard
	}
	fmt.Fprintf(w, "RelayCore nftables rescue\n")
	if err := removeForwardCompatibility(); err != nil {
		fmt.Fprintf(w, "Forward compatibility cleanup warning: %v\n", err)
	}
	if err := rescueNFTTable(w, "ip", nftTable); err != nil {
		return err
	}
	if err := rescueNFTTable(w, "inet", firewallTable); err != nil {
		return err
	}
	fmt.Fprintf(w, "RelayCore nftables tables removed.\n")
	return nil
}

func rescueNFTTable(w io.Writer, family, table string) error {
	fmt.Fprintf(w, "Listing current table %s %s before cleanup:\n", family, table)
	raw, err := exec.Command("nft", "list", "table", family, table).CombinedOutput()
	if err != nil {
		if isMissingNFTTableOutput(string(raw)) {
			fmt.Fprintf(w, "No table %s %s found; nothing to clean up.\n", family, table)
			return nil
		}
		return fmt.Errorf("nft list table %s %s failed: %w: %s", family, table, err, strings.TrimSpace(string(raw)))
	}
	if len(raw) > 0 {
		if _, err := w.Write(raw); err != nil {
			return err
		}
		if raw[len(raw)-1] != '\n' {
			fmt.Fprintln(w)
		}
	}
	fmt.Fprintf(w, "Flushing table %s %s...\n", family, table)
	if err := runNFTCommand("flush", "table", family, table); err != nil {
		return err
	}
	fmt.Fprintf(w, "Deleting table %s %s...\n", family, table)
	if err := runNFTCommand("delete", "table", family, table); err != nil {
		return err
	}
	return nil
}

func (m *NFTManager) Apply(rules []common.ForwardRule) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	resolved, findings := resolveRules(rules)
	ruleset := RenderNFTables(resolved)
	preview := ruleset
	if m.firewall.Mode == "strict" {
		preview += "\n" + RenderFirewallGuard(resolved, m.firewall.SSHPorts)
	}
	m.lastFindings = findings
	probes := probeResolvedRules(resolved)
	if m.dryRun {
		m.rules = append([]common.ForwardRule(nil), rules...)
		m.lastRuleset = preview
		m.lastApplied = time.Now()
		m.lastError = ""
		m.lastReports = buildApplyReports(rules, resolved, probes, "dry_run", m.lastError)
		log.Printf("dry-run nftables ruleset:\n%s", preview)
		return nil
	}
	if err := ensureTable(); err != nil {
		m.lastError = err.Error()
		m.lastReports = buildApplyReports(rules, resolved, probes, "error", m.lastError)
		return err
	}
	if err := runNFTFile("-c", ruleset); err != nil {
		m.lastError = "nftables check failed: " + err.Error()
		m.lastReports = buildApplyReports(rules, resolved, probes, "error", m.lastError)
		return fmt.Errorf("%s", m.lastError)
	}
	if err := runNFTFile("", ruleset); err != nil {
		m.lastError = "nftables apply failed: " + err.Error()
		m.lastReports = buildApplyReports(rules, resolved, probes, "error", m.lastError)
		return fmt.Errorf("%s", m.lastError)
	}
	if len(resolved) > 0 {
		if err := ensureForwardCompatibility(); err != nil {
			finding := common.Finding{
				Severity:  "warn",
				Code:      "forward.compat_failed",
				Title:     "FORWARD 链兼容规则未应用",
				Detail:    err.Error(),
				CreatedAt: time.Now(),
			}
			m.lastFindings = append(m.lastFindings, finding)
			log.Printf("forward compatibility warning: %v", err)
		}
	} else if err := removeForwardCompatibility(); err != nil {
		log.Printf("forward compatibility cleanup warning: %v", err)
	}
	if err := m.applyFirewallPolicy(resolved); err != nil {
		m.lastError = err.Error()
		m.lastReports = buildApplyReports(rules, resolved, probes, "error", m.lastError)
		return err
	}
	m.rules = append([]common.ForwardRule(nil), rules...)
	m.lastRuleset = preview
	m.lastApplied = time.Now()
	m.lastError = ""
	m.lastReports = buildApplyReports(rules, resolved, probes, "applied", "")
	return nil
}

func (m *NFTManager) RuleCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.rules)
}

func (m *NFTManager) Counters() []common.RuleCounter {
	m.mu.Lock()
	rules := append([]common.ForwardRule(nil), m.rules...)
	dryRun := m.dryRun
	m.mu.Unlock()
	if dryRun {
		return zeroCounters(rules)
	}
	raw, err := exec.Command("nft", "list", "counters", "table", "ip", nftTable).Output()
	if err != nil {
		return zeroCounters(rules)
	}
	values := parseNFTCounterOutput(string(raw))
	now := time.Now()
	out := []common.RuleCounter{}
	for _, r := range rules {
		for _, proto := range ruleProtocols(r.Protocol) {
			name := counterName(r.ID, proto)
			v := values[name]
			out = append(out, common.RuleCounter{
				RuleID:    r.ID,
				Protocol:  proto,
				Packets:   v.Packets,
				Bytes:     v.Bytes,
				UpdatedAt: now,
			})
		}
	}
	return out
}

func (m *NFTManager) Reports() []common.RuleApplyReport {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]common.RuleApplyReport(nil), m.lastReports...)
}

func (m *NFTManager) RulesetPreview() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	const maxPreview = 64 * 1024
	if len(m.lastRuleset) > maxPreview {
		return m.lastRuleset[:maxPreview] + "\n# truncated"
	}
	return m.lastRuleset
}

func (m *NFTManager) Diagnostics() []common.Finding {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := append([]common.Finding(nil), m.lastFindings...)
	for _, report := range m.lastReports {
		for _, probe := range report.Probes {
			if probe.OK || probe.Protocol == "udp" {
				continue
			}
			out = append(out, common.Finding{
				Severity:  "warn",
				Code:      "target.tcp_unreachable",
				Title:     "目标 TCP 端口不可达",
				Detail:    fmt.Sprintf("%s:%d 连接失败：%s", probe.TargetHost, probe.TargetPort, probe.Error),
				CreatedAt: probe.CheckedAt,
			})
		}
	}
	if m.lastError == "" {
		return out
	}
	out = append(out, common.Finding{
		Severity:  "critical",
		Code:      "nft.apply_failed",
		Title:     "nftables 规则应用失败",
		Detail:    m.lastError,
		CreatedAt: time.Now(),
	})
	return out
}

func (m *NFTManager) applyFirewallPolicy(rules []resolvedRule) error {
	if m.firewall.Mode != "strict" {
		m.cancelFirewallRollbackLocked()
		return deleteNFTTableIfExists("inet", firewallTable)
	}
	snapshot, err := snapshotNFTTable("inet", firewallTable)
	if err != nil {
		return err
	}
	if err := ensureNFTTable("inet", firewallTable); err != nil {
		return fmt.Errorf("ensure strict firewall table failed: %w", err)
	}
	ruleset := RenderFirewallGuard(rules, m.firewall.SSHPorts)
	if err := runNFTFile("-c", ruleset); err != nil {
		return fmt.Errorf("strict firewall check failed: %w", err)
	}
	if err := runNFTFile("", ruleset); err != nil {
		return fmt.Errorf("strict firewall apply failed: %w", err)
	}
	m.armFirewallRollbackLocked(snapshot)
	return nil
}

func RenderNFTables(rules []resolvedRule) string {
	tcpMap := map[int]resolvedRule{}
	udpMap := map[int]resolvedRule{}
	linear := []resolvedRule{}
	targetIPs := map[string]struct{}{}
	for _, rr := range rules {
		if rr.TargetIP == "" || !rr.Rule.Enabled {
			continue
		}
		targetIPs[rr.TargetIP] = struct{}{}
		if len(rr.Rule.SourceCIDRs) > 0 {
			linear = append(linear, rr)
			continue
		}
		switch rr.Rule.Protocol {
		case "tcp":
			tcpMap[rr.Rule.ListenPort] = rr
		case "udp":
			udpMap[rr.Rule.ListenPort] = rr
		case "both":
			tcpMap[rr.Rule.ListenPort] = rr
			udpMap[rr.Rule.ListenPort] = rr
		}
	}

	var b strings.Builder
	b.WriteString("flush table ip " + nftTable + "\n")
	b.WriteString("table ip " + nftTable + " {\n")
	writeCounterObjects(&b, rules)
	writePortSet(&b, "tcp_ports", tcpMap)
	writePortSet(&b, "udp_ports", udpMap)
	writeDNATMap(&b, "tcp_dnat", tcpMap)
	writeDNATMap(&b, "udp_dnat", udpMap)
	writeCounterMap(&b, "tcp_counters", "tcp", tcpMap)
	writeCounterMap(&b, "udp_counters", "udp", udpMap)
	writeIPSet(&b, "target_ips", targetIPs)
	b.WriteString("  chain prerouting {\n")
	b.WriteString("    type nat hook prerouting priority -100; policy accept;\n")
	writeDNATChain(&b, "tcp", "tcp_ports", "tcp_counters", "tcp_dnat")
	writeDNATChain(&b, "udp", "udp_ports", "udp_counters", "udp_dnat")
	writeLinearRules(&b, linear)
	b.WriteString("  }\n")
	b.WriteString("  chain output {\n")
	b.WriteString("    type nat hook output priority -100; policy accept;\n")
	writeDNATChain(&b, "tcp", "tcp_ports", "tcp_counters", "tcp_dnat")
	writeDNATChain(&b, "udp", "udp_ports", "udp_counters", "udp_dnat")
	b.WriteString("  }\n")
	b.WriteString("  chain postrouting {\n")
	b.WriteString("    type nat hook postrouting priority 100; policy accept;\n")
	if len(targetIPs) > 0 {
		b.WriteString("    ip daddr @target_ips counter masquerade\n")
	}
	b.WriteString("  }\n")
	b.WriteString("}\n")
	return b.String()
}

func RenderFirewallGuard(rules []resolvedRule, sshPorts []int) string {
	tcpPorts := map[int]struct{}{}
	udpPorts := map[int]struct{}{}
	for _, rr := range rules {
		if rr.TargetIP == "" || !rr.Rule.Enabled {
			continue
		}
		switch rr.Rule.Protocol {
		case "tcp":
			tcpPorts[rr.Rule.ListenPort] = struct{}{}
		case "udp":
			udpPorts[rr.Rule.ListenPort] = struct{}{}
		case "both":
			tcpPorts[rr.Rule.ListenPort] = struct{}{}
			udpPorts[rr.Rule.ListenPort] = struct{}{}
		}
	}
	sshPorts = normalizePorts(sshPorts)
	var b strings.Builder
	b.WriteString("flush table inet " + firewallTable + "\n")
	b.WriteString("table inet " + firewallTable + " {\n")
	writeInetServiceSet(&b, "tcp_public_ports", sortedPortSet(tcpPorts))
	writeInetServiceSet(&b, "udp_public_ports", sortedPortSet(udpPorts))
	b.WriteString("  chain input {\n")
	b.WriteString("    type filter hook input priority filter; policy drop;\n")
	b.WriteString("    iifname \"lo\" accept\n")
	b.WriteString("    ct state established,related accept\n")
	b.WriteString("    ct state invalid drop\n")
	b.WriteString("    ct mark " + relaycoreForwardMark + " accept\n")
	b.WriteString("    ip protocol icmp accept\n")
	b.WriteString("    ip6 nexthdr ipv6-icmp accept\n")
	b.WriteString("    tcp dport { " + joinPorts(sshPorts) + " } accept\n")
	if len(tcpPorts) > 0 {
		b.WriteString("    tcp dport @tcp_public_ports accept\n")
	}
	if len(udpPorts) > 0 {
		b.WriteString("    udp dport @udp_public_ports accept\n")
	}
	b.WriteString("    counter drop\n")
	b.WriteString("  }\n")
	b.WriteString("  chain forward {\n")
	b.WriteString("    type filter hook forward priority filter; policy accept;\n")
	b.WriteString("  }\n")
	b.WriteString("}\n")
	return b.String()
}

func resolveRules(rules []common.ForwardRule) ([]resolvedRule, []common.Finding) {
	out := make([]resolvedRule, 0, len(rules))
	findings := []common.Finding{}
	now := time.Now()
	for _, r := range rules {
		if !r.Enabled {
			continue
		}
		ip := resolveIPv4(r.TargetHost)
		if ip == "" {
			findings = append(findings, common.Finding{
				Severity:  "critical",
				Code:      "target.resolve_failed",
				Title:     "目标地址解析失败",
				Detail:    fmt.Sprintf("%s target %s cannot resolve to IPv4", r.Name, r.TargetHost),
				CreatedAt: now,
			})
			continue
		}
		out = append(out, resolvedRule{Rule: r, TargetIP: ip})
	}
	return out, findings
}

func buildApplyReports(rules []common.ForwardRule, resolved []resolvedRule, probes map[string][]common.RuleProbeResult, state string, applyError string) []common.RuleApplyReport {
	now := time.Now()
	resolvedByID := map[string]resolvedRule{}
	for _, rr := range resolved {
		resolvedByID[rr.Rule.ID] = rr
	}
	out := make([]common.RuleApplyReport, 0, len(rules))
	for _, r := range rules {
		report := common.RuleApplyReport{
			RuleID:    r.ID,
			State:     state,
			CheckedAt: now,
			Probes:    probes[r.ID],
		}
		if !r.Enabled {
			report.State = "skipped"
			report.Message = "rule disabled"
			out = append(out, report)
			continue
		}
		rr, ok := resolvedByID[r.ID]
		if !ok {
			report.State = "error"
			report.Message = "target cannot resolve to IPv4"
			out = append(out, report)
			continue
		}
		report.TargetIP = rr.TargetIP
		for _, proto := range ruleProtocols(r.Protocol) {
			report.Counters = append(report.Counters, counterName(r.ID, proto))
		}
		switch state {
		case "dry_run":
			report.Message = "nftables ruleset generated but not applied"
		case "applied":
			report.Message = "nftables ruleset applied"
		case "error":
			report.Message = applyError
		default:
			report.Message = state
		}
		out = append(out, report)
	}
	return out
}

func resolveIPv4(host string) string {
	if ip := net.ParseIP(host); ip != nil {
		if v4 := ip.To4(); v4 != nil {
			return v4.String()
		}
		return ""
	}
	ips, err := net.LookupIP(host)
	if err != nil {
		return ""
	}
	for _, ip := range ips {
		if v4 := ip.To4(); v4 != nil {
			return v4.String()
		}
	}
	return ""
}

func writePortSet(b *strings.Builder, name string, rules map[int]resolvedRule) {
	b.WriteString("  set " + name + " {\n")
	b.WriteString("    type inet_service\n")
	ports := sortedPorts(rules)
	if len(ports) > 0 {
		b.WriteString("    elements = { ")
		for i, p := range ports {
			if i > 0 {
				b.WriteString(", ")
			}
			b.WriteString(strconv.Itoa(p))
		}
		b.WriteString(" }\n")
	}
	b.WriteString("  }\n")
}

func writeDNATMap(b *strings.Builder, name string, rules map[int]resolvedRule) {
	b.WriteString("  map " + name + " {\n")
	b.WriteString("    type inet_service : ipv4_addr . inet_service\n")
	ports := sortedPorts(rules)
	if len(ports) > 0 {
		b.WriteString("    elements = { ")
		for i, p := range ports {
			if i > 0 {
				b.WriteString(", ")
			}
			rr := rules[p]
			b.WriteString(fmt.Sprintf("%d : %s . %d", p, rr.TargetIP, rr.Rule.TargetPort))
		}
		b.WriteString(" }\n")
	}
	b.WriteString("  }\n")
}

func writeCounterObjects(b *strings.Builder, rules []resolvedRule) {
	names := map[string]struct{}{}
	for _, rr := range rules {
		for _, proto := range ruleProtocols(rr.Rule.Protocol) {
			names[counterName(rr.Rule.ID, proto)] = struct{}{}
		}
	}
	items := make([]string, 0, len(names))
	for name := range names {
		items = append(items, name)
	}
	sort.Strings(items)
	for _, name := range items {
		b.WriteString("  counter " + name + " {}\n")
	}
}

func writeCounterMap(b *strings.Builder, name, proto string, rules map[int]resolvedRule) {
	b.WriteString("  map " + name + " {\n")
	b.WriteString("    type inet_service : counter\n")
	ports := sortedPorts(rules)
	if len(ports) > 0 {
		b.WriteString("    elements = { ")
		for i, p := range ports {
			if i > 0 {
				b.WriteString(", ")
			}
			rr := rules[p]
			b.WriteString(fmt.Sprintf("%d : %s", p, counterName(rr.Rule.ID, proto)))
		}
		b.WriteString(" }\n")
	}
	b.WriteString("  }\n")
}

func writeIPSet(b *strings.Builder, name string, ips map[string]struct{}) {
	b.WriteString("  set " + name + " {\n")
	b.WriteString("    type ipv4_addr\n")
	items := make([]string, 0, len(ips))
	for ip := range ips {
		items = append(items, ip)
	}
	sort.Strings(items)
	if len(items) > 0 {
		b.WriteString("    elements = { ")
		for i, ip := range items {
			if i > 0 {
				b.WriteString(", ")
			}
			b.WriteString(ip)
		}
		b.WriteString(" }\n")
	}
	b.WriteString("  }\n")
}

func writeDNATChain(b *strings.Builder, proto, setName, counterMapName, dnatMapName string) {
	b.WriteString(fmt.Sprintf("    %s dport @%s ct mark set %s counter name %s dport map @%s dnat ip to %s dport map @%s\n", proto, setName, relaycoreForwardMark, proto, counterMapName, proto, dnatMapName))
}

func writeLinearRules(b *strings.Builder, rules []resolvedRule) {
	for _, rr := range rules {
		cidrs := normalizeCIDRs(rr.Rule.SourceCIDRs)
		if len(cidrs) == 0 {
			continue
		}
		if rr.Rule.Protocol == "tcp" || rr.Rule.Protocol == "both" {
			b.WriteString(fmt.Sprintf("    ip saddr { %s } tcp dport %d ct mark set %s counter name %s dnat ip to %s:%d\n", strings.Join(cidrs, ", "), rr.Rule.ListenPort, relaycoreForwardMark, counterName(rr.Rule.ID, "tcp"), rr.TargetIP, rr.Rule.TargetPort))
		}
		if rr.Rule.Protocol == "udp" || rr.Rule.Protocol == "both" {
			b.WriteString(fmt.Sprintf("    ip saddr { %s } udp dport %d ct mark set %s counter name %s dnat ip to %s:%d\n", strings.Join(cidrs, ", "), rr.Rule.ListenPort, relaycoreForwardMark, counterName(rr.Rule.ID, "udp"), rr.TargetIP, rr.Rule.TargetPort))
		}
	}
}

type parsedCounter struct {
	Packets uint64
	Bytes   uint64
}

func parseNFTCounterOutput(raw string) map[string]parsedCounter {
	out := map[string]parsedCounter{}
	var current string
	for _, line := range strings.Split(raw, "\n") {
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) >= 2 && fields[0] == "counter" {
			current = fields[1]
			continue
		}
		if current == "" || len(fields) < 4 {
			continue
		}
		for i := 0; i+1 < len(fields); i++ {
			if fields[i] == "packets" {
				packets, _ := strconv.ParseUint(fields[i+1], 10, 64)
				v := out[current]
				v.Packets = packets
				out[current] = v
			}
			if fields[i] == "bytes" {
				bytes, _ := strconv.ParseUint(fields[i+1], 10, 64)
				v := out[current]
				v.Bytes = bytes
				out[current] = v
			}
		}
	}
	return out
}

func zeroCounters(rules []common.ForwardRule) []common.RuleCounter {
	now := time.Now()
	out := []common.RuleCounter{}
	for _, r := range rules {
		for _, proto := range ruleProtocols(r.Protocol) {
			out = append(out, common.RuleCounter{RuleID: r.ID, Protocol: proto, UpdatedAt: now})
		}
	}
	return out
}

func ruleProtocols(protocol string) []string {
	switch protocol {
	case "tcp":
		return []string{"tcp"}
	case "udp":
		return []string{"udp"}
	case "both":
		return []string{"tcp", "udp"}
	default:
		return nil
	}
}

func counterName(ruleID, protocol string) string {
	var b strings.Builder
	b.WriteString("rc_")
	for _, r := range ruleID {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		} else {
			b.WriteByte('_')
		}
	}
	b.WriteByte('_')
	b.WriteString(protocol)
	return b.String()
}

func sortedPorts(rules map[int]resolvedRule) []int {
	ports := make([]int, 0, len(rules))
	for p := range rules {
		ports = append(ports, p)
	}
	sort.Ints(ports)
	return ports
}

func sortedPortSet(ports map[int]struct{}) []int {
	out := make([]int, 0, len(ports))
	for p := range ports {
		out = append(out, p)
	}
	sort.Ints(out)
	return out
}

func writeInetServiceSet(b *strings.Builder, name string, ports []int) {
	b.WriteString("  set " + name + " {\n")
	b.WriteString("    type inet_service\n")
	if len(ports) > 0 {
		b.WriteString("    elements = { " + joinPorts(ports) + " }\n")
	}
	b.WriteString("  }\n")
}

func joinPorts(ports []int) string {
	parts := make([]string, 0, len(ports))
	for _, port := range ports {
		parts = append(parts, strconv.Itoa(port))
	}
	return strings.Join(parts, ", ")
}

func normalizePorts(in []int) []int {
	seen := map[int]struct{}{}
	out := []int{}
	for _, port := range in {
		if port < 1 || port > 65535 {
			continue
		}
		if _, ok := seen[port]; ok {
			continue
		}
		seen[port] = struct{}{}
		out = append(out, port)
	}
	if len(out) == 0 {
		out = append(out, 22)
	}
	sort.Ints(out)
	return out
}

func normalizeFirewallOptions(in FirewallOptions) FirewallOptions {
	mode := strings.ToLower(strings.TrimSpace(in.Mode))
	if mode != "strict" {
		mode = "managed"
	}
	rollbackDelay := in.RollbackDelay
	if rollbackDelay <= 0 {
		rollbackDelay = 60 * time.Second
	}
	if rollbackDelay < 15*time.Second {
		rollbackDelay = 15 * time.Second
	}
	if rollbackDelay > 10*time.Minute {
		rollbackDelay = 10 * time.Minute
	}
	return FirewallOptions{
		Mode:          mode,
		SSHPorts:      normalizePorts(in.SSHPorts),
		RollbackDelay: rollbackDelay,
	}
}

func normalizeCIDRs(in []string) []string {
	out := []string{}
	for _, v := range in {
		v = strings.TrimSpace(v)
		if v == "" {
			continue
		}
		if _, _, err := net.ParseCIDR(v); err == nil {
			out = append(out, v)
		}
	}
	sort.Strings(out)
	return out
}

func ensureTable() error {
	return ensureNFTTable("ip", nftTable)
}

func ensureNFTTable(family, table string) error {
	if err := exec.Command("nft", "list", "table", family, table).Run(); err == nil {
		return nil
	}
	return exec.Command("nft", "add", "table", family, table).Run()
}

func snapshotNFTTable(family, table string) (firewallSnapshot, error) {
	raw, err := exec.Command("nft", "list", "table", family, table).CombinedOutput()
	if err != nil {
		if isMissingNFTTableOutput(string(raw)) {
			return firewallSnapshot{}, nil
		}
		return firewallSnapshot{}, fmt.Errorf("nft list table %s %s failed: %w: %s", family, table, err, strings.TrimSpace(string(raw)))
	}
	return firewallSnapshot{Exists: true, Ruleset: string(raw)}, nil
}

func deleteNFTTableIfExists(family, table string) error {
	if err := runNFTCommand("delete", "table", family, table); err != nil {
		if isMissingNFTTableOutput(err.Error()) {
			return nil
		}
		return err
	}
	return nil
}

func restoreFirewallSnapshot(snapshot firewallSnapshot) error {
	if err := deleteNFTTableIfExists("inet", firewallTable); err != nil {
		return err
	}
	if !snapshot.Exists {
		return nil
	}
	return runNFTFile("", snapshot.Ruleset)
}

func (m *NFTManager) cancelFirewallRollbackLocked() {
	cancel := m.rollbackCancel
	m.rollbackCancel = nil
	m.rollbackDeadline = time.Time{}
	if cancel != nil {
		close(cancel)
	}
}

func (m *NFTManager) armFirewallRollbackLocked(snapshot firewallSnapshot) {
	m.cancelFirewallRollbackLocked()
	cancel := make(chan struct{})
	delay := m.firewall.RollbackDelay
	deadline := time.Now().Add(delay)
	m.rollbackCancel = cancel
	m.rollbackDeadline = deadline
	go func() {
		timer := time.NewTimer(delay)
		defer timer.Stop()
		select {
		case <-timer.C:
			m.rollbackFirewall(cancel, snapshot, deadline)
		case <-cancel:
		}
	}()
}

func (m *NFTManager) rollbackFirewall(cancel chan struct{}, snapshot firewallSnapshot, deadline time.Time) {
	m.mu.Lock()
	if m.rollbackCancel != cancel {
		m.mu.Unlock()
		return
	}
	m.rollbackCancel = nil
	m.rollbackDeadline = time.Time{}
	now := time.Now()
	m.lastError = "strict firewall rollback triggered because Panel confirmation did not arrive before " + deadline.Format(time.RFC3339)
	m.lastFindings = append(m.lastFindings, common.Finding{
		Severity:  "critical",
		Code:      "firewall.rollback",
		Title:     "严格防火墙已自动回滚",
		Detail:    m.lastError,
		CreatedAt: now,
	})
	m.mu.Unlock()

	if err := restoreFirewallSnapshot(snapshot); err != nil {
		m.mu.Lock()
		m.lastError = "strict firewall rollback failed: " + err.Error()
		m.lastFindings = append(m.lastFindings, common.Finding{
			Severity:  "critical",
			Code:      "firewall.rollback_failed",
			Title:     "严格防火墙回滚失败",
			Detail:    m.lastError,
			CreatedAt: time.Now(),
		})
		m.mu.Unlock()
	}
}

func ensureForwardCompatibility() error {
	if !nftChainExists("ip", "filter", "FORWARD") {
		return nil
	}
	if forwardCompatibilityExists() {
		return nil
	}
	if err := ensureForwardCompatibilityWithIPTables(); err == nil {
		return nil
	} else if nftErr := ensureForwardCompatibilityWithNFT(); nftErr != nil {
		return fmt.Errorf("iptables/nft forward mark accept failed: iptables=%v; nft=%v", err, nftErr)
	}
	return nil
}

func removeForwardCompatibility() error {
	var errs []string
	if path, err := exec.LookPath("iptables"); err == nil {
		for {
			if err := runProgram(path, "-D", "FORWARD", "-m", "connmark", "--mark", relaycoreForwardMark, "-j", "ACCEPT"); err != nil {
				break
			}
		}
	}
	handles, err := forwardCompatibilityHandles()
	if err != nil {
		errs = append(errs, err.Error())
	}
	for _, handle := range handles {
		if err := runNFTCommand("delete", "rule", "ip", "filter", "FORWARD", "handle", handle); err != nil {
			errs = append(errs, err.Error())
		}
	}
	if len(errs) > 0 {
		return fmt.Errorf("%s", strings.Join(errs, "; "))
	}
	return nil
}

func ensureForwardCompatibilityWithIPTables() error {
	path, err := exec.LookPath("iptables")
	if err != nil {
		return err
	}
	checkArgs := []string{"-C", "FORWARD", "-m", "connmark", "--mark", relaycoreForwardMark, "-j", "ACCEPT"}
	if exec.Command(path, checkArgs...).Run() == nil {
		return nil
	}
	return runProgram(path, "-I", "FORWARD", "1", "-m", "connmark", "--mark", relaycoreForwardMark, "-j", "ACCEPT")
}

func ensureForwardCompatibilityWithNFT() error {
	return runNFTCommand("insert", "rule", "ip", "filter", "FORWARD", "ct", "mark", relaycoreForwardMark, "accept")
}

func nftChainExists(family, table, chain string) bool {
	return exec.Command("nft", "list", "chain", family, table, chain).Run() == nil
}

func forwardCompatibilityExists() bool {
	handles, err := forwardCompatibilityHandles()
	return err == nil && len(handles) > 0
}

func forwardCompatibilityHandles() ([]string, error) {
	raw, err := exec.Command("nft", "-a", "list", "chain", "ip", "filter", "FORWARD").CombinedOutput()
	if err != nil {
		if isMissingNFTTableOutput(string(raw)) {
			return nil, nil
		}
		return nil, fmt.Errorf("nft list chain ip filter FORWARD failed: %w: %s", err, strings.TrimSpace(string(raw)))
	}
	handles := []string{}
	for _, line := range strings.Split(string(raw), "\n") {
		if !hasRelayCoreForwardMark(line) || !strings.Contains(line, " accept") {
			continue
		}
		idx := strings.LastIndex(line, "# handle ")
		if idx < 0 {
			continue
		}
		handle := strings.TrimSpace(line[idx+len("# handle "):])
		if handle != "" {
			handles = append(handles, strings.Fields(handle)[0])
		}
	}
	return handles, nil
}

func hasRelayCoreForwardMark(line string) bool {
	line = strings.ToLower(line)
	return strings.Contains(line, "ct mark "+relaycoreForwardMark) || strings.Contains(line, "ct mark "+relaycoreForwardMarkShort)
}

func runNFTFile(checkFlag string, ruleset string) error {
	tmp, err := os.CreateTemp("", "relaycore-*.nft")
	if err != nil {
		return err
	}
	path := tmp.Name()
	if _, err := tmp.WriteString(ruleset); err != nil {
		_ = tmp.Close()
		_ = os.Remove(path)
		return err
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(path)
		return err
	}
	defer os.Remove(path)

	args := []string{}
	if checkFlag != "" {
		args = append(args, checkFlag)
	}
	args = append(args, "-f", path)
	cmd := exec.Command("nft", args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("%w: %s", err, strings.TrimSpace(stderr.String()))
	}
	return nil
}

func runNFTCommand(args ...string) error {
	return runProgram("nft", args...)
}

func runProgram(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("%s %s failed: %w: %s", name, strings.Join(args, " "), err, strings.TrimSpace(stderr.String()))
	}
	return nil
}

func isMissingNFTTableOutput(raw string) bool {
	raw = strings.ToLower(raw)
	return strings.Contains(raw, "no such file") || strings.Contains(raw, "does not exist")
}
