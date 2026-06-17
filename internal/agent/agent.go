package agent

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"runtime"
	"strconv"
	"strings"
	"time"

	"relaycore/internal/common"
)

type Agent struct {
	cfg     Config
	client  *http.Client
	nft     *NFTManager
	stopCh  chan struct{}
	lastErr string
}

func New(cfg Config) *Agent {
	return &Agent{
		cfg:    cfg,
		client: &http.Client{Timeout: 20 * time.Second},
		nft: NewNFTManagerWithFirewall(cfg.DryRun, FirewallOptions{
			Mode:          cfg.FirewallMode,
			SSHPorts:      cfg.SSHPorts,
			RollbackDelay: time.Duration(cfg.RollbackSeconds) * time.Second,
		}),
		stopCh: make(chan struct{}),
	}
}

func (a *Agent) Stop() {
	select {
	case <-a.stopCh:
	default:
		close(a.stopCh)
	}
}

func (a *Agent) Run() error {
	if a.cfg.PanelURL == "" {
		return fmt.Errorf("missing panel URL")
	}
	a.cfg.PanelURL = strings.TrimRight(a.cfg.PanelURL, "/")
	if !strings.HasPrefix(a.cfg.PanelURL, "https://") {
		log.Printf("warning: panel URL is not HTTPS; use a reverse proxy with TLS in production")
	}
	if a.cfg.NodeID == "" || a.cfg.NodeSecret == "" {
		if err := a.Register(); err != nil {
			return err
		}
	}
	if err := a.SaveConfig(); err != nil {
		return err
	}
	log.Printf("%s agent started, node=%s panel=%s dry_run=%v", common.ProjectName, a.cfg.NodeID, a.cfg.PanelURL, a.cfg.DryRun)
	if err := a.heartbeatOnce(); err != nil {
		log.Printf("initial heartbeat failed: %v", err)
	}
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			if err := a.heartbeatOnce(); err != nil {
				a.lastErr = err.Error()
				log.Printf("heartbeat failed: %v", err)
			} else {
				a.lastErr = ""
			}
		case <-a.stopCh:
			log.Printf("agent shutting down")
			return nil
		}
	}
}

func (a *Agent) Register() error {
	if a.cfg.Token == "" {
		return fmt.Errorf("missing node token")
	}
	host, _ := os.Hostname()
	name := a.cfg.Name
	if name == "" {
		name = host
	}
	req := common.AgentRegisterRequest{
		Token:           a.cfg.Token,
		Name:            name,
		Hostname:        host,
		OS:              runtime.GOOS,
		Arch:            runtime.GOARCH,
		AgentVersion:    common.Version,
		PrivateIPs:      privateIPs(),
		FirewallMode:    a.cfg.FirewallMode,
		SSHPorts:        a.cfg.SSHPorts,
		RollbackSeconds: a.cfg.RollbackSeconds,
	}
	var resp common.AgentRegisterResponse
	if err := a.postJSON("/api/agent/register", req, &resp, false); err != nil {
		return err
	}
	a.cfg.NodeID = resp.NodeID
	a.cfg.NodeSecret = resp.NodeSecret
	a.cfg.Token = ""
	log.Printf("node registered: %s", resp.NodeID)
	return nil
}

func (a *Agent) heartbeatOnce() error {
	req := a.heartbeatRequest()
	var resp common.AgentHeartbeatResponse
	if err := a.postJSON("/api/agent/heartbeat", req, &resp, true); err != nil {
		return err
	}
	if a.applyPanelFirewallPolicy(resp.FirewallPolicy) {
		a.cfg.RuleVersion = -1
		if err := a.SaveConfig(); err != nil {
			return err
		}
	}
	if resp.RuleVersion != a.cfg.RuleVersion {
		applyErr := a.nft.Apply(resp.Rules)
		if applyErr != nil {
			a.lastErr = applyErr.Error()
		} else {
			a.lastErr = ""
			a.cfg.RuleVersion = resp.RuleVersion
			if err := a.SaveConfig(); err != nil {
				return err
			}
		}
		statusReq := a.heartbeatRequest()
		var statusResp common.AgentHeartbeatResponse
		if err := a.postJSON("/api/agent/heartbeat", statusReq, &statusResp, true); err != nil {
			if applyErr == nil {
				return err
			}
		} else if applyErr == nil {
			_ = a.applyPanelFirewallPolicy(statusResp.FirewallPolicy)
			a.nft.ConfirmReachable()
		}
		if applyErr != nil {
			return applyErr
		}
	}
	return nil
}

func (a *Agent) applyPanelFirewallPolicy(policy common.FirewallPolicy) bool {
	if strings.TrimSpace(policy.Mode) == "" {
		return false
	}
	options := normalizeFirewallOptions(FirewallOptions{
		Mode:          policy.Mode,
		SSHPorts:      policy.SSHPorts,
		RollbackDelay: time.Duration(policy.RollbackSeconds) * time.Second,
	})
	changed := a.nft.SetFirewallOptions(options)
	rollbackSeconds := int(options.RollbackDelay / time.Second)
	if a.cfg.FirewallMode != options.Mode || !samePorts(a.cfg.SSHPorts, options.SSHPorts) || a.cfg.RollbackSeconds != rollbackSeconds {
		a.cfg.FirewallMode = options.Mode
		a.cfg.SSHPorts = append([]int(nil), options.SSHPorts...)
		a.cfg.RollbackSeconds = rollbackSeconds
		changed = true
	}
	return changed
}

func samePorts(a, b []int) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func (a *Agent) heartbeatRequest() common.AgentHeartbeatRequest {
	host, _ := os.Hostname()
	return common.AgentHeartbeatRequest{
		NodeID:         a.cfg.NodeID,
		AgentVersion:   common.Version,
		Hostname:       host,
		OS:             runtime.GOOS,
		Arch:           runtime.GOARCH,
		PrivateIPs:     privateIPs(),
		Metrics:        CollectMetrics(a.nft.RuleCount()),
		Counters:       a.nft.Counters(),
		Diagnostics:    a.nft.Diagnostics(),
		RuleReports:    a.nft.Reports(),
		RulesetPreview: a.nft.RulesetPreview(),
		RuleVersion:    a.cfg.RuleVersion,
		ForwardingMode: "nftables",
		FirewallMode:   a.nft.FirewallMode(),
		LastError:      a.lastErr,
	}
}

func (a *Agent) postJSON(path string, payload any, out any, signed bool) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, a.cfg.PanelURL+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if signed {
		ts := strconv.FormatInt(time.Now().Unix(), 10)
		nonce, err := common.RandomToken(18)
		if err != nil {
			return err
		}
		req.Header.Set("X-Node-ID", a.cfg.NodeID)
		req.Header.Set("X-Timestamp", ts)
		req.Header.Set("X-Nonce", nonce)
		req.Header.Set("X-Signature", common.HMACSHA256Hex(a.cfg.NodeSecret, common.SignedBody(ts, nonce, body)))
	}
	res, err := a.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	resBody, _ := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if res.StatusCode >= 300 {
		var apiErr common.APIError
		if json.Unmarshal(resBody, &apiErr) == nil && apiErr.Error != "" {
			return fmt.Errorf("%s", apiErr.Error)
		}
		return fmt.Errorf("panel returned HTTP %d: %s", res.StatusCode, string(resBody))
	}
	if out != nil {
		return json.Unmarshal(resBody, out)
	}
	return nil
}

func privateIPs() []string {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	var out []string
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := iface.Addrs()
		for _, addr := range addrs {
			var ip net.IP
			switch v := addr.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}
			if ip == nil || ip.IsLoopback() {
				continue
			}
			out = append(out, ip.String())
		}
	}
	return out
}
