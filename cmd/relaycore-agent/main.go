package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"

	"relaycore/internal/agent"
	"relaycore/internal/common"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "rescue" {
		runRescue(os.Args[2:])
		return
	}

	panelURL := flag.String("panel", env("RELAYCORE_PANEL", ""), "panel URL")
	token := flag.String("token", env("RELAYCORE_TOKEN", ""), "one-time node token")
	dataDir := flag.String("data", env("RELAYCORE_AGENT_DATA", "./agent-data"), "agent data directory")
	name := flag.String("name", env("RELAYCORE_NODE_NAME", ""), "node name")
	dryRun := flag.Bool("dry-run", env("RELAYCORE_DRY_RUN", "") == "1", "generate nftables rules without applying them")
	firewallMode := flag.String("firewall", env("RELAYCORE_FIREWALL_MODE", "managed"), "firewall mode: managed or strict")
	sshPorts := flag.String("ssh-ports", env("RELAYCORE_SSH_PORTS", "22"), "comma-separated SSH ports preserved in strict firewall mode")
	rollbackSeconds := flag.Int("rollback-seconds", envInt("RELAYCORE_FIREWALL_ROLLBACK_SECONDS", 60), "strict firewall rollback timer in seconds")
	version := flag.Bool("version", false, "print version")
	flag.Parse()

	if *version {
		fmt.Println(common.ProjectName, "agent", common.Version)
		return
	}

	cfg, _ := agent.LoadConfig(*dataDir)
	previousFirewallSignature := firewallConfigSignature(cfg)
	cfg.DataDir = *dataDir
	if *panelURL != "" {
		cfg.PanelURL = *panelURL
	}
	if *token != "" {
		cfg.Token = *token
	}
	if *name != "" {
		cfg.Name = *name
	}
	cfg.DryRun = *dryRun
	cfg.FirewallMode = normalizeFirewallMode(*firewallMode)
	cfg.SSHPorts = parsePortList(*sshPorts)
	cfg.RollbackSeconds = *rollbackSeconds
	if cfg.FirewallMode == "strict" || previousFirewallSignature != "" && previousFirewallSignature != firewallConfigSignature(cfg) {
		cfg.RuleVersion = -1
	}

	a := agent.New(cfg)
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		a.Stop()
	}()
	if err := a.Run(); err != nil {
		log.Fatalf("agent stopped with error: %v", err)
	}
}

func runRescue(args []string) {
	fs := flag.NewFlagSet("rescue", flag.ExitOnError)
	fs.Usage = func() {
		fmt.Fprintf(fs.Output(), "Usage: relaycore-agent rescue\n\n")
		fmt.Fprintf(fs.Output(), "Print and remove nftables tables managed by RelayCore: ip relaycore and inet relaycore_guard.\n")
	}
	_ = fs.Parse(args)
	if fs.NArg() > 0 {
		log.Fatalf("unexpected rescue argument: %s", fs.Arg(0))
	}
	if err := agent.RescueRelayCoreTable(os.Stdout); err != nil {
		log.Fatalf("rescue failed: %v", err)
	}
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return n
}

func parsePortList(raw string) []int {
	seen := map[int]struct{}{}
	out := []int{}
	for _, part := range strings.Split(raw, ",") {
		n, err := strconv.Atoi(strings.TrimSpace(part))
		if err != nil || n < 1 || n > 65535 {
			continue
		}
		if _, ok := seen[n]; ok {
			continue
		}
		seen[n] = struct{}{}
		out = append(out, n)
	}
	if len(out) == 0 {
		return []int{22}
	}
	return out
}

func normalizeFirewallMode(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "strict":
		return "strict"
	default:
		return "managed"
	}
}

func firewallConfigSignature(cfg agent.Config) string {
	if cfg.FirewallMode == "" {
		return ""
	}
	parts := make([]string, 0, len(cfg.SSHPorts)+2)
	parts = append(parts, cfg.FirewallMode, strconv.Itoa(cfg.RollbackSeconds))
	for _, port := range cfg.SSHPorts {
		parts = append(parts, strconv.Itoa(port))
	}
	return strings.Join(parts, "|")
}
