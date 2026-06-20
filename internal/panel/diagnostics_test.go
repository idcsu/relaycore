package panel

import (
	"testing"
	"time"

	"relaycore/internal/common"
)

func TestBuildNodeTrend(t *testing.T) {
	now := time.Now()
	got := buildNodeTrend([]NodeMetricSample{
		{At: now.Add(-2 * time.Minute), Metrics: common.NodeMetrics{ConntrackCount: 100, TCPRetransSegments: 10, TCPOutSegments: 1000, NetIn: 1000, NetOut: 2000}},
		{At: now, Metrics: common.NodeMetrics{ConntrackCount: 140, TCPRetransSegments: 16, TCPOutSegments: 1100, NetIn: 2200, NetOut: 4400}},
	}, now)
	if got.ConntrackDelta != 40 || got.ConntrackDirection != "rising" {
		t.Fatalf("unexpected conntrack trend: %#v", got)
	}
	if got.TCPRetransDelta != 6 || got.TCPOutDelta != 100 {
		t.Fatalf("unexpected tcp delta: %#v", got)
	}
	if got.TCPRetransRatio < 0.059 || got.TCPRetransRatio > 0.061 {
		t.Fatalf("unexpected retrans ratio: %#v", got)
	}
	if got.NetInBytesPerSec < 9.9 || got.NetInBytesPerSec > 10.1 {
		t.Fatalf("unexpected net rate: %#v", got)
	}
}

func TestBuildRuleCounterRates(t *testing.T) {
	now := time.Now()
	history := map[string][]RuleCounterSample{
		"rul_test|tcp": {
			{At: now.Add(-60 * time.Second), RuleID: "rul_test", Protocol: "tcp", Packets: 100, Bytes: 1000},
			{At: now, RuleID: "rul_test", Protocol: "tcp", Packets: 160, Bytes: 2200},
		},
	}
	got := buildRuleCounterRates("rul_test", history, now)
	if len(got) != 1 {
		t.Fatalf("expected one rate, got %#v", got)
	}
	if got[0].PacketsDelta != 60 || got[0].BytesDelta != 1200 {
		t.Fatalf("unexpected counter delta: %#v", got[0])
	}
	if got[0].PacketsPerSecond < 0.99 || got[0].PacketsPerSecond > 1.01 {
		t.Fatalf("unexpected packet rate: %#v", got[0])
	}
}

func TestTrafficOverviewAccumulatesCounterDeltasAcrossReset(t *testing.T) {
	store, actor := testUserStore(t)
	nodeID := registerTestNode(t, store, "traffic-node")
	rule, err := store.SaveRule(common.ForwardRule{
		Name:       "traffic-rule",
		NodeID:     nodeID,
		Protocol:   "tcp",
		ListenPort: 18080,
		TargetHost: "127.0.0.1",
		TargetPort: 8080,
	}, actor, "127.0.0.1")
	if err != nil {
		t.Fatalf("save rule: %v", err)
	}
	for _, c := range []common.RuleCounter{
		{RuleID: rule.ID, Protocol: "tcp", Packets: 10, Bytes: 100},
		{RuleID: rule.ID, Protocol: "tcp", Packets: 16, Bytes: 160},
		{RuleID: rule.ID, Protocol: "tcp", Packets: 2, Bytes: 20},
	} {
		if _, _, err := store.UpdateHeartbeat(common.AgentHeartbeatRequest{
			NodeID:         nodeID,
			Hostname:       "traffic-node",
			AgentVersion:   "test",
			ForwardingMode: "nftables",
			FirewallMode:   "managed",
			Counters:       []common.RuleCounter{c},
		}, "203.0.113.40"); err != nil {
			t.Fatalf("heartbeat: %v", err)
		}
	}
	traffic := store.TrafficOverview()
	if traffic.Bytes != 180 || traffic.Packets != 18 {
		t.Fatalf("unexpected traffic total: %#v", traffic)
	}
	if traffic.ByProtocol["tcp"] != 180 {
		t.Fatalf("unexpected tcp total: %#v", traffic.ByProtocol)
	}
	if len(traffic.Nodes) != 1 || traffic.Nodes[0].Bytes != 180 {
		t.Fatalf("unexpected node totals: %#v", traffic.Nodes)
	}
	if len(traffic.Rules) != 1 || traffic.Rules[0].RuleID != rule.ID || traffic.Rules[0].Bytes != 180 {
		t.Fatalf("unexpected rule totals: %#v", traffic.Rules)
	}
}

func TestLikelyRuleCauseNoTraffic(t *testing.T) {
	got := likelyRuleCause(
		common.ForwardRule{ID: "rul_test", Name: "test", Enabled: true},
		common.Node{ID: "nod_test", Status: "online"},
		common.RuleApplyReport{State: "applied"},
		[]common.RuleCounter{{RuleID: "rul_test", Protocol: "tcp"}},
		nil,
		nil,
		nil,
	)
	if got == "" || got == "暂无足够趋势样本，等待更多 Agent 心跳和 counter 数据。" {
		t.Fatalf("expected actionable no-traffic cause, got %q", got)
	}
}
