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
