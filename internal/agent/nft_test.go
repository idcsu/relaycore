package agent

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"relaycore/internal/common"
)

func TestRenderNFTablesOmitsEmptyElements(t *testing.T) {
	got := RenderNFTables(nil)
	if strings.Contains(got, "elements = {  }") {
		t.Fatalf("empty elements should be omitted:\n%s", got)
	}
	if !strings.Contains(got, "map tcp_counters") {
		t.Fatalf("expected counter map in ruleset:\n%s", got)
	}
}

func TestRenderNFTablesUsesCounterMaps(t *testing.T) {
	got := RenderNFTables([]resolvedRule{{
		Rule: common.ForwardRule{
			ID:         "rul_test",
			Name:       "test",
			Protocol:   "tcp",
			ListenPort: 10028,
			TargetPort: 80,
			Enabled:    true,
		},
		TargetIP: "127.0.0.1",
	}})
	for _, want := range []string{
		"counter rc_rul_test_tcp",
		"map tcp_counters",
		"10028 : rc_rul_test_tcp",
		"type nat hook prerouting priority -100; policy accept;",
		"type nat hook output priority -100; policy accept;",
		"type nat hook postrouting priority 100; policy accept;",
		"ct mark set 0x00052435",
		"counter name tcp dport map @tcp_counters",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("ruleset missing %q:\n%s", want, got)
		}
	}
}

func TestRenderNFTablesMarksSourceCIDRRules(t *testing.T) {
	got := RenderNFTables([]resolvedRule{{
		Rule: common.ForwardRule{
			ID:          "rul_test",
			Name:        "test",
			Protocol:    "both",
			ListenPort:  10028,
			TargetPort:  80,
			Enabled:     true,
			SourceCIDRs: []string{"192.0.2.0/24"},
		},
		TargetIP: "198.51.100.10",
	}})
	for _, want := range []string{
		"ip saddr { 192.0.2.0/24 } tcp dport 10028 ct mark set 0x00052435",
		"ip saddr { 192.0.2.0/24 } udp dport 10028 ct mark set 0x00052435",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("ruleset missing %q:\n%s", want, got)
		}
	}
}

func TestRenderFirewallGuardPreservesSSHAndPublicPorts(t *testing.T) {
	got := RenderFirewallGuard([]resolvedRule{{
		Rule: common.ForwardRule{
			ID:         "rul_tcp",
			Name:       "tcp",
			Protocol:   "tcp",
			ListenPort: 10028,
			TargetPort: 80,
			Enabled:    true,
		},
		TargetIP: "127.0.0.1",
	}, {
		Rule: common.ForwardRule{
			ID:         "rul_udp",
			Name:       "udp",
			Protocol:   "udp",
			ListenPort: 10029,
			TargetPort: 53,
			Enabled:    true,
		},
		TargetIP: "127.0.0.1",
	}}, []int{2222, 22, 22})
	for _, want := range []string{
		"flush table inet relaycore_guard",
		"type filter hook input priority filter; policy drop;",
		"tcp dport { 22, 2222 } accept",
		"ct mark 0x00052435 accept",
		"elements = { 10028 }",
		"elements = { 10029 }",
		"ip protocol tcp tcp dport @tcp_public_ports accept",
		"ip protocol udp udp dport @udp_public_ports accept",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("guard ruleset missing %q:\n%s", want, got)
		}
	}
	for _, forbidden := range []string{
		"\n    tcp dport @tcp_public_ports accept",
		"\n    udp dport @udp_public_ports accept",
	} {
		if strings.Contains(got, forbidden) {
			t.Fatalf("guard ruleset should not allow IPv6 forwarding ports with %q:\n%s", forbidden, got)
		}
	}
}

func TestStrictDryRunIncludesFirewallGuardPreview(t *testing.T) {
	m := NewNFTManagerWithFirewall(true, FirewallOptions{Mode: "strict", SSHPorts: []int{2222}})
	err := m.Apply([]common.ForwardRule{{
		ID:         "rul_test",
		Name:       "test",
		Protocol:   "tcp",
		ListenPort: 10028,
		TargetHost: "127.0.0.1",
		TargetPort: 80,
		Enabled:    true,
	}})
	if err != nil {
		t.Fatalf("dry-run apply failed: %v", err)
	}
	preview := m.RulesetPreview()
	if !strings.Contains(preview, "table inet relaycore_guard") {
		t.Fatalf("strict dry-run preview missing guard table:\n%s", preview)
	}
	if m.FirewallMode() != "strict" {
		t.Fatalf("unexpected firewall mode: %s", m.FirewallMode())
	}
}

func TestParseNFTCounterOutput(t *testing.T) {
	got := parseNFTCounterOutput(`table ip relaycore {
	counter rc_rul_test_tcp {
		packets 12 bytes 3456
	}
}`)
	if got["rc_rul_test_tcp"].Packets != 12 || got["rc_rul_test_tcp"].Bytes != 3456 {
		t.Fatalf("unexpected counter parse: %#v", got)
	}
}

func TestRescueRelayCoreTableDeletesExistingTable(t *testing.T) {
	logPath := installFakeNFT(t, `case "$*" in
"-a list chain ip filter FORWARD")
	echo "Error: No such file or directory" >&2
	exit 1
	;;
"list table ip relaycore")
	echo "table ip relaycore {"
	echo "}"
	exit 0
	;;
"flush table ip relaycore")
	exit 0
	;;
"delete table ip relaycore")
	exit 0
	;;
"list table inet relaycore_guard")
	echo "table inet relaycore_guard {"
	echo "}"
	exit 0
	;;
"flush table inet relaycore_guard")
	exit 0
	;;
"delete table inet relaycore_guard")
	exit 0
	;;
*)
	echo "unexpected nft args: $*" >&2
	exit 2
	;;
esac
`)
	var out bytes.Buffer
	if err := RescueRelayCoreTable(&out); err != nil {
		t.Fatalf("rescue failed: %v", err)
	}
	gotCalls := string(mustReadFile(t, logPath))
	wantCalls := "-a list chain ip filter FORWARD\nlist table ip relaycore\nflush table ip relaycore\ndelete table ip relaycore\nlist table inet relaycore_guard\nflush table inet relaycore_guard\ndelete table inet relaycore_guard\n"
	if gotCalls != wantCalls {
		t.Fatalf("unexpected nft calls:\nwant %q\ngot  %q", wantCalls, gotCalls)
	}
	for _, want := range []string{
		"Listing current table ip relaycore before cleanup",
		"table ip relaycore",
		"table inet relaycore_guard",
		"RelayCore nftables tables removed",
	} {
		if !strings.Contains(out.String(), want) {
			t.Fatalf("rescue output missing %q:\n%s", want, out.String())
		}
	}
}

func TestRescueRelayCoreTableAllowsMissingTable(t *testing.T) {
	logPath := installFakeNFT(t, `case "$*" in
"-a list chain ip filter FORWARD")
	echo "Error: No such file or directory" >&2
	exit 1
	;;
"list table ip relaycore")
	echo "Error: No such file or directory" >&2
	exit 1
	;;
"list table inet relaycore_guard")
	echo "Error: No such file or directory" >&2
	exit 1
	;;
*)
	echo "unexpected nft args: $*" >&2
	exit 2
	;;
esac
`)
	var out bytes.Buffer
	if err := RescueRelayCoreTable(&out); err != nil {
		t.Fatalf("missing table should not fail: %v", err)
	}
	gotCalls := string(mustReadFile(t, logPath))
	wantCalls := "-a list chain ip filter FORWARD\nlist table ip relaycore\nlist table inet relaycore_guard\n"
	if gotCalls != wantCalls {
		t.Fatalf("unexpected nft calls:\nwant %q\ngot  %q", wantCalls, gotCalls)
	}
	if !strings.Contains(out.String(), "No table ip relaycore found") || !strings.Contains(out.String(), "No table inet relaycore_guard found") {
		t.Fatalf("missing table output not helpful:\n%s", out.String())
	}
}

func installFakeNFT(t *testing.T, body string) string {
	t.Helper()
	dir := t.TempDir()
	logPath := filepath.Join(dir, "calls.log")
	script := "#!/bin/sh\nprintf '%s\\n' \"$*\" >> " + shellQuote(logPath) + "\n" + body
	path := filepath.Join(dir, "nft")
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake nft: %v", err)
	}
	iptablesPath := filepath.Join(dir, "iptables")
	if err := os.WriteFile(iptablesPath, []byte("#!/bin/sh\nexit 1\n"), 0o755); err != nil {
		t.Fatalf("write fake iptables: %v", err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	return logPath
}

func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'"
}

func mustReadFile(t *testing.T, path string) []byte {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return b
}
