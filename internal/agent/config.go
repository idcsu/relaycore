package agent

import (
	"encoding/json"
	"os"
	"path/filepath"
)

type Config struct {
	PanelURL        string `json:"panel_url"`
	Token           string `json:"token,omitempty"`
	NodeID          string `json:"node_id"`
	NodeSecret      string `json:"node_secret"`
	Name            string `json:"name"`
	DataDir         string `json:"-"`
	DryRun          bool   `json:"dry_run"`
	RuleVersion     int64  `json:"rule_version"`
	FirewallMode    string `json:"firewall_mode"`
	SSHPorts        []int  `json:"ssh_ports"`
	RollbackSeconds int    `json:"rollback_seconds"`
}

func LoadConfig(dataDir string) (Config, error) {
	b, err := os.ReadFile(filepath.Join(dataDir, "agent.json"))
	if err != nil {
		return Config{}, err
	}
	var cfg Config
	if err := json.Unmarshal(b, &cfg); err != nil {
		return Config{}, err
	}
	cfg.DataDir = dataDir
	return cfg, nil
}

func (a *Agent) SaveConfig() error {
	if err := os.MkdirAll(a.cfg.DataDir, 0700); err != nil {
		return err
	}
	b, err := json.MarshalIndent(a.cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(a.cfg.DataDir, "agent.json"), b, 0600)
}
