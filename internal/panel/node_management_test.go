package panel

import (
	"testing"

	"relaycore/internal/common"
)

func TestNodeUpdateAndDelete(t *testing.T) {
	store, actor := testUserStore(t)
	token, err := store.CreateNodeToken("node-a", 24)
	if err != nil {
		t.Fatalf("create node token: %v", err)
	}
	registered, err := store.RegisterNode(common.AgentRegisterRequest{
		Token:        token.PlainToken,
		Name:         "node-a",
		Hostname:     "relay-a",
		OS:           "linux",
		Arch:         "amd64",
		AgentVersion: "test",
	}, "203.0.113.10")
	if err != nil {
		t.Fatalf("register node: %v", err)
	}
	updated, err := store.UpdateNode(registered.NodeID, "renamed-node", actor, "127.0.0.1")
	if err != nil {
		t.Fatalf("update node: %v", err)
	}
	if updated.Name != "renamed-node" {
		t.Fatalf("unexpected node name: %q", updated.Name)
	}
	beforeFirewallVersion := store.RuleVersion()
	mode := "strict"
	rollback := 45
	updated, err = store.UpdateNodeSettings(registered.NodeID, NodeUpdate{
		DesiredFirewallMode:     &mode,
		FirewallSSHPorts:        []int{2222, 22, 2222},
		FirewallSSHPortsSet:     true,
		FirewallRollbackSeconds: &rollback,
	}, actor, "127.0.0.1")
	if err != nil {
		t.Fatalf("update node firewall settings: %v", err)
	}
	if updated.DesiredFirewallMode != "strict" {
		t.Fatalf("unexpected desired firewall mode: %q", updated.DesiredFirewallMode)
	}
	if got := updated.FirewallSSHPorts; len(got) != 2 || got[0] != 22 || got[1] != 2222 {
		t.Fatalf("unexpected ssh ports: %#v", got)
	}
	if updated.FirewallRollbackSeconds != rollback {
		t.Fatalf("unexpected rollback seconds: %d", updated.FirewallRollbackSeconds)
	}
	if store.RuleVersion() <= beforeFirewallVersion {
		t.Fatalf("firewall update should bump rule version")
	}
	rule, err := store.SaveRule(common.ForwardRule{
		Name:       "web",
		NodeID:     registered.NodeID,
		Protocol:   "tcp",
		ListenPort: 18080,
		TargetHost: "127.0.0.1",
		TargetPort: 8080,
	}, actor, "127.0.0.1")
	if err != nil {
		t.Fatalf("save rule: %v", err)
	}
	if err := store.DeleteNode(registered.NodeID, actor, "127.0.0.1"); err != nil {
		t.Fatalf("delete node: %v", err)
	}
	if nodes := store.ListNodes(); len(nodes) != 0 {
		t.Fatalf("expected no nodes after delete, got %d", len(nodes))
	}
	for _, r := range store.ListRules() {
		if r.ID == rule.ID {
			t.Fatalf("rule for deleted node should be removed")
		}
	}
}
