package agent

import (
	"fmt"
	"net"
	"time"

	"relaycore/internal/common"
)

const maxProbeRules = 16

func probeResolvedRules(rules []resolvedRule) map[string][]common.RuleProbeResult {
	out := map[string][]common.RuleProbeResult{}
	for i, rr := range rules {
		if i >= maxProbeRules {
			break
		}
		for _, proto := range ruleProtocols(rr.Rule.Protocol) {
			out[rr.Rule.ID] = append(out[rr.Rule.ID], probeTarget(rr.Rule, proto))
		}
	}
	return out
}

func probeTarget(rule common.ForwardRule, protocol string) common.RuleProbeResult {
	start := time.Now()
	result := common.RuleProbeResult{
		RuleID:     rule.ID,
		Protocol:   protocol,
		TargetHost: rule.TargetHost,
		TargetPort: rule.TargetPort,
		CheckedAt:  start,
	}
	addr := fmt.Sprintf("%s:%d", rule.TargetHost, rule.TargetPort)
	switch protocol {
	case "tcp":
		conn, err := net.DialTimeout("tcp", addr, 800*time.Millisecond)
		result.LatencyMS = int(time.Since(start).Milliseconds())
		if err != nil {
			result.Error = err.Error()
			return result
		}
		_ = conn.Close()
		result.OK = true
	case "udp":
		conn, err := net.DialTimeout("udp", addr, 800*time.Millisecond)
		result.LatencyMS = int(time.Since(start).Milliseconds())
		if err != nil {
			result.Error = err.Error()
			return result
		}
		_ = conn.SetDeadline(time.Now().Add(800 * time.Millisecond))
		if _, err := conn.Write([]byte{0}); err != nil {
			result.Error = err.Error()
			_ = conn.Close()
			return result
		}
		_ = conn.Close()
		result.OK = true
	default:
		result.Error = "unsupported protocol"
	}
	return result
}
