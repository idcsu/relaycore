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
