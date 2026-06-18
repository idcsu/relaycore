package panel

import (
	"errors"
	"strings"
	"testing"

	"relaycore/internal/common"
)

func TestSaveRuleRejectsConflictingListenPort(t *testing.T) {
	store, actor := testUserStore(t)
	nodeID := registerTestNode(t, store, "node-conflict")

	tcpRule, err := store.SaveRule(common.ForwardRule{
		Name:       "web-tcp",
		NodeID:     nodeID,
		Protocol:   "tcp",
		ListenPort: 18080,
		TargetHost: "127.0.0.1",
		TargetPort: 8080,
	}, actor, "127.0.0.1")
	if err != nil {
		t.Fatalf("save tcp rule: %v", err)
	}

	if _, err := store.SaveRule(common.ForwardRule{
		Name:       "web-udp",
		NodeID:     nodeID,
		Protocol:   "udp",
		ListenPort: 18080,
		TargetHost: "127.0.0.1",
		TargetPort: 8081,
	}, actor, "127.0.0.1"); err != nil {
		t.Fatalf("tcp and udp should be allowed to share a port: %v", err)
	}

	_, err = store.SaveRule(common.ForwardRule{
		Name:       "web-tcp-duplicate",
		NodeID:     nodeID,
		Protocol:   "tcp",
		ListenPort: 18080,
		TargetHost: "127.0.0.1",
		TargetPort: 8082,
	}, actor, "127.0.0.1")
	if !errors.Is(err, ErrBadRequest) || !strings.Contains(err.Error(), "已被规则") {
		t.Fatalf("expected duplicate tcp port to be rejected, got %v", err)
	}

	_, err = store.SaveRule(common.ForwardRule{
		Name:       "web-both",
		NodeID:     nodeID,
		Protocol:   "both",
		ListenPort: 18080,
		TargetHost: "127.0.0.1",
		TargetPort: 8083,
	}, actor, "127.0.0.1")
	if !errors.Is(err, ErrBadRequest) {
		t.Fatalf("expected both protocol conflict to be rejected, got %v", err)
	}

	tcpRule.Name = "web-tcp-renamed"
	if _, err := store.SaveRule(tcpRule, actor, "127.0.0.1"); err != nil {
		t.Fatalf("updating the same rule should not conflict: %v", err)
	}
}

func registerTestNode(t *testing.T, store *Store, name string) string {
	t.Helper()
	token, err := store.CreateNodeToken(name, 24)
	if err != nil {
		t.Fatalf("create node token: %v", err)
	}
	registered, err := store.RegisterNode(common.AgentRegisterRequest{
		Token:        token.PlainToken,
		Name:         name,
		Hostname:     name,
		OS:           "linux",
		Arch:         "amd64",
		AgentVersion: "test",
	}, "203.0.113.20")
	if err != nil {
		t.Fatalf("register node: %v", err)
	}
	return registered.NodeID
}
