package panel

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"relaycore/internal/common"
)

const defaultSessionTTL = 24 * time.Hour

const (
	maxNodeMetricSamples  = 240
	maxRuleCounterSamples = 240
	maxTargetIPSamples    = 50
	trendWindow           = 5 * time.Minute
)

var (
	ErrNotFound     = errors.New("not found")
	ErrUnauthorized = errors.New("unauthorized")
	ErrBadRequest   = errors.New("bad request")
)

type Store struct {
	mu         sync.Mutex
	path       string
	legacyJSON string
	db         *sqliteDB
	data       Data
}

type Data struct {
	Users          map[string]common.User            `json:"users"`
	Sessions       map[string]common.Session         `json:"sessions"`
	Nodes          map[string]common.Node            `json:"nodes"`
	NodeTokens     map[string]common.NodeToken       `json:"node_tokens"`
	Rules          map[string]common.ForwardRule     `json:"rules"`
	Counters       map[string]common.RuleCounter     `json:"counters"`
	RuleReports    map[string]common.RuleApplyReport `json:"rule_reports"`
	MetricHistory  map[string][]NodeMetricSample     `json:"metric_history"`
	CounterHistory map[string][]RuleCounterSample    `json:"counter_history"`
	TargetHistory  map[string][]TargetIPSample       `json:"target_history"`
	Events         []Event                           `json:"events"`
	Settings       map[string]string                 `json:"settings"`
	RuleVersion    int64                             `json:"rule_version"`
	SeenNonces     map[string]time.Time              `json:"seen_nonces"`
	TOTPReplay     map[string]int64                  `json:"totp_replay"`
	InitializedAt  time.Time                         `json:"initialized_at"`
}

type Event struct {
	ID        string    `json:"id"`
	ActorID   string    `json:"actor_id"`
	Action    string    `json:"action"`
	Target    string    `json:"target"`
	IP        string    `json:"ip"`
	Detail    string    `json:"detail"`
	CreatedAt time.Time `json:"created_at"`
}

type DiagnosisReport struct {
	GeneratedAt time.Time        `json:"generated_at"`
	Findings    []common.Finding `json:"findings"`
	Nodes       []NodeDiagnosis  `json:"nodes"`
	Rules       []RuleDiagnosis  `json:"rules"`
}

type NodeDiagnosis struct {
	NodeID   string             `json:"node_id"`
	NodeName string             `json:"node_name"`
	Status   string             `json:"status"`
	Health   int                `json:"health"`
	Summary  string             `json:"summary"`
	Metrics  common.NodeMetrics `json:"metrics"`
	Trend    NodeTrend          `json:"trend"`
	Ruleset  string             `json:"ruleset,omitempty"`
	Findings []common.Finding   `json:"findings"`
}

type RuleDiagnosis struct {
	RuleID        string                   `json:"rule_id"`
	RuleName      string                   `json:"rule_name"`
	NodeID        string                   `json:"node_id"`
	NodeName      string                   `json:"node_name"`
	Protocol      string                   `json:"protocol"`
	Listen        int                      `json:"listen"`
	Target        string                   `json:"target"`
	Enabled       bool                     `json:"enabled"`
	ApplyState    string                   `json:"apply_state"`
	ApplyMessage  string                   `json:"apply_message"`
	TargetIP      string                   `json:"target_ip,omitempty"`
	Counters      []common.RuleCounter     `json:"counters"`
	CounterRates  []RuleCounterRate        `json:"counter_rates"`
	Probes        []common.RuleProbeResult `json:"probes"`
	TargetHistory []TargetIPSample         `json:"target_history"`
	LikelyCause   string                   `json:"likely_cause"`
	Findings      []common.Finding         `json:"findings"`
}

type NodeMetricSample struct {
	At      time.Time          `json:"at"`
	Metrics common.NodeMetrics `json:"metrics"`
}

type RuleCounterSample struct {
	At       time.Time `json:"at"`
	RuleID   string    `json:"rule_id"`
	Protocol string    `json:"protocol"`
	Packets  uint64    `json:"packets"`
	Bytes    uint64    `json:"bytes"`
}

type TargetIPSample struct {
	ResolvedAt time.Time `json:"resolved_at"`
	RuleID     string    `json:"rule_id"`
	TargetHost string    `json:"target_host"`
	TargetIP   string    `json:"target_ip"`
}

type NodeTrend struct {
	SampleCount        int     `json:"sample_count"`
	WindowSeconds      int64   `json:"window_seconds"`
	ConntrackDelta     int64   `json:"conntrack_delta"`
	ConntrackDirection string  `json:"conntrack_direction"`
	TCPRetransDelta    uint64  `json:"tcp_retrans_delta"`
	TCPOutDelta        uint64  `json:"tcp_out_delta"`
	TCPRetransRatio    float64 `json:"tcp_retrans_ratio"`
	NetInBytesPerSec   float64 `json:"net_in_bytes_per_sec"`
	NetOutBytesPerSec  float64 `json:"net_out_bytes_per_sec"`
}

type RuleCounterRate struct {
	Protocol         string  `json:"protocol"`
	WindowSeconds    int64   `json:"window_seconds"`
	PacketsDelta     uint64  `json:"packets_delta"`
	BytesDelta       uint64  `json:"bytes_delta"`
	PacketsPerSecond float64 `json:"packets_per_second"`
	BytesPerSecond   float64 `json:"bytes_per_second"`
}

func OpenStore(path, adminUser, adminPassword string) (*Store, string, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, "", err
	}
	legacyJSON := ""
	if strings.HasSuffix(path, ".json") {
		legacyJSON = path
		path = strings.TrimSuffix(path, ".json") + ".db"
	} else if strings.HasSuffix(path, ".db") {
		legacyJSON = strings.TrimSuffix(path, ".db") + ".json"
	}
	db, err := openSQLite(path)
	if err != nil {
		return nil, "", err
	}
	_ = os.Chmod(path, 0600)
	s := &Store{path: path, legacyJSON: legacyJSON, db: db}
	if err := s.load(); err != nil {
		_ = db.close()
		return nil, "", err
	}
	initialPassword := ""
	if len(s.data.Users) == 0 {
		plain := adminPassword
		if plain == "" {
			var err error
			plain, err = common.RandomToken(18)
			if err != nil {
				return nil, "", err
			}
			initialPassword = plain
		}
		hash, err := common.HashPassword(plain)
		if err != nil {
			return nil, "", err
		}
		now := time.Now()
		u := common.User{
			ID:           common.RandomID("usr"),
			Username:     strings.TrimSpace(adminUser),
			PasswordHash: hash,
			Role:         common.RoleSuperAdmin,
			MustChange:   adminPassword == "",
			CreatedAt:    now,
			UpdatedAt:    now,
		}
		if u.Username == "" {
			u.Username = "admin"
		}
		s.data.Users[u.ID] = u
		s.addEventLocked(u.ID, "system.bootstrap", "user:"+u.ID, "127.0.0.1", "created initial administrator")
		if err := s.saveLocked(); err != nil {
			return nil, "", err
		}
	}
	return s, initialPassword, nil
}

func (s *Store) load() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data = Data{}
	if raw, ok, err := s.db.getKV("data"); err != nil {
		return err
	} else if ok && raw != "" {
		if err := json.Unmarshal([]byte(raw), &s.data); err != nil {
			return fmt.Errorf("read data store: %w", err)
		}
	} else if s.legacyJSON != "" {
		if b, err := os.ReadFile(s.legacyJSON); err == nil && len(b) > 0 {
			if err := json.Unmarshal(b, &s.data); err != nil {
				return fmt.Errorf("import legacy json store: %w", err)
			}
		} else if err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	s.ensureDataLocked()
	return s.saveLocked()
}

func (s *Store) ensureDataLocked() {
	if s.data.Users == nil {
		s.data.Users = map[string]common.User{}
	}
	if s.data.Sessions == nil {
		s.data.Sessions = map[string]common.Session{}
	}
	if s.data.Nodes == nil {
		s.data.Nodes = map[string]common.Node{}
	}
	if s.data.NodeTokens == nil {
		s.data.NodeTokens = map[string]common.NodeToken{}
	}
	if s.data.Rules == nil {
		s.data.Rules = map[string]common.ForwardRule{}
	}
	if s.data.Counters == nil {
		s.data.Counters = map[string]common.RuleCounter{}
	}
	if s.data.RuleReports == nil {
		s.data.RuleReports = map[string]common.RuleApplyReport{}
	}
	if s.data.MetricHistory == nil {
		s.data.MetricHistory = map[string][]NodeMetricSample{}
	}
	if s.data.CounterHistory == nil {
		s.data.CounterHistory = map[string][]RuleCounterSample{}
	}
	if s.data.TargetHistory == nil {
		s.data.TargetHistory = map[string][]TargetIPSample{}
	}
	if s.data.Settings == nil {
		s.data.Settings = map[string]string{}
	}
	if s.data.SeenNonces == nil {
		s.data.SeenNonces = map[string]time.Time{}
	}
	if s.data.TOTPReplay == nil {
		s.data.TOTPReplay = map[string]int64{}
	}
	if s.data.InitializedAt.IsZero() {
		s.data.InitializedAt = time.Now()
	}
}

func (s *Store) saveLocked() error {
	b, err := json.MarshalIndent(s.data, "", "  ")
	if err != nil {
		return err
	}
	return s.db.putKV("data", string(b))
}

func (s *Store) Login(username, password, totpCode string) (common.User, bool, string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	for _, u := range s.data.Users {
		if strings.EqualFold(u.Username, strings.TrimSpace(username)) && !u.Disabled {
			if !common.VerifyPassword(password, u.PasswordHash) {
				break
			}
			if u.TOTPEnabled {
				counter, ok := common.VerifyTOTP(u.TOTPSecret, totpCode, now)
				if !ok {
					return common.User{}, false, "两步验证码错误"
				}
				if last := s.data.TOTPReplay[u.ID]; counter <= last {
					return common.User{}, false, "两步验证码已使用，请等待下一组验证码"
				}
				s.data.TOTPReplay[u.ID] = counter
				_ = s.saveLocked()
			}
			return sanitizeUser(u), true, ""
		}
	}
	s.addEventLocked("", "auth.failed", "user:"+strings.TrimSpace(username), "", "login failed at "+now.Format(time.RFC3339))
	_ = s.saveLocked()
	return common.User{}, false, "用户名或密码错误"
}

func (s *Store) CreateSession(user common.User, ip, ua string) (common.Session, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	token, err := common.RandomToken(40)
	if err != nil {
		return common.Session{}, err
	}
	now := time.Now()
	sess := common.Session{
		Token:     token,
		UserID:    user.ID,
		IP:        ip,
		UserAgent: ua,
		ExpiresAt: now.Add(defaultSessionTTL),
		CreatedAt: now,
	}
	s.data.Sessions[token] = sess
	s.addEventLocked(user.ID, "auth.login", "session", ip, "session created")
	return sess, s.saveLocked()
}

func (s *Store) DeleteSession(token string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.data.Sessions, token)
	return s.saveLocked()
}

func (s *Store) UserBySession(token string) (common.User, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, ok := s.data.Sessions[token]
	if !ok || time.Now().After(sess.ExpiresAt) {
		if ok {
			delete(s.data.Sessions, token)
			_ = s.saveLocked()
		}
		return common.User{}, false
	}
	u, ok := s.data.Users[sess.UserID]
	if !ok || u.Disabled {
		return common.User{}, false
	}
	return sanitizeUser(u), true
}

func (s *Store) ListUsers() []common.User {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]common.User, 0, len(s.data.Users))
	for _, u := range s.data.Users {
		out = append(out, sanitizeUser(u))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Username < out[j].Username })
	return out
}

func (s *Store) CreateUser(username, password string, role common.Role, actor common.User, ip string) (common.User, string, error) {
	username = strings.TrimSpace(username)
	if username == "" {
		return common.User{}, "", fmt.Errorf("%w: username is required", ErrBadRequest)
	}
	role, err := normalizeRole(role)
	if err != nil {
		return common.User{}, "", err
	}
	if role == common.RoleSuperAdmin && actor.Role != common.RoleSuperAdmin {
		return common.User{}, "", fmt.Errorf("%w: only super_admin can create super_admin users", ErrUnauthorized)
	}
	generated := ""
	password = strings.TrimSpace(password)
	if password == "" {
		var err error
		password, err = common.RandomToken(18)
		if err != nil {
			return common.User{}, "", err
		}
		generated = password
	}
	if len(password) < 10 {
		return common.User{}, "", fmt.Errorf("%w: password must be at least 10 characters", ErrBadRequest)
	}
	hash, err := common.HashPassword(password)
	if err != nil {
		return common.User{}, "", err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, existing := range s.data.Users {
		if strings.EqualFold(existing.Username, username) {
			return common.User{}, "", fmt.Errorf("%w: username already exists", ErrBadRequest)
		}
	}
	now := time.Now()
	u := common.User{
		ID:           common.RandomID("usr"),
		Username:     username,
		PasswordHash: hash,
		Role:         role,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	s.data.Users[u.ID] = u
	s.addEventLocked(actor.ID, "user.create", "user:"+u.ID, ip, "created user "+u.Username)
	if err := s.saveLocked(); err != nil {
		return common.User{}, "", err
	}
	return sanitizeUser(u), generated, nil
}

func (s *Store) UpdateUser(id string, role common.Role, disabled bool, actor common.User, ip string) (common.User, error) {
	role, err := normalizeRole(role)
	if err != nil {
		return common.User{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	u, ok := s.data.Users[id]
	if !ok {
		return common.User{}, ErrNotFound
	}
	if actor.Role != common.RoleSuperAdmin && (u.Role == common.RoleSuperAdmin || role == common.RoleSuperAdmin) {
		return common.User{}, fmt.Errorf("%w: only super_admin can modify super_admin users", ErrUnauthorized)
	}
	if actor.ID == id && (disabled || role != u.Role) {
		return common.User{}, fmt.Errorf("%w: cannot change your own role or disabled state", ErrBadRequest)
	}
	if u.Role == common.RoleSuperAdmin && role != common.RoleSuperAdmin && s.superAdminCountLocked() <= 1 {
		return common.User{}, fmt.Errorf("%w: cannot demote the last super_admin", ErrBadRequest)
	}
	if u.Role == common.RoleSuperAdmin && disabled && s.enabledSuperAdminCountLocked() <= 1 {
		return common.User{}, fmt.Errorf("%w: cannot disable the last enabled super_admin", ErrBadRequest)
	}
	u.Role = role
	u.Disabled = disabled
	u.UpdatedAt = time.Now()
	s.data.Users[id] = u
	if disabled {
		s.deleteSessionsForUserLocked(id)
	}
	s.addEventLocked(actor.ID, "user.update", "user:"+id, ip, fmt.Sprintf("role=%s disabled=%v", role, disabled))
	if err := s.saveLocked(); err != nil {
		return common.User{}, err
	}
	return sanitizeUser(u), nil
}

func (s *Store) ResetUserPassword(id, password string, actor common.User, ip string) (common.User, string, error) {
	password = strings.TrimSpace(password)
	generated := ""
	if password == "" {
		var err error
		password, err = common.RandomToken(18)
		if err != nil {
			return common.User{}, "", err
		}
		generated = password
	}
	if len(password) < 10 {
		return common.User{}, "", fmt.Errorf("%w: password must be at least 10 characters", ErrBadRequest)
	}
	hash, err := common.HashPassword(password)
	if err != nil {
		return common.User{}, "", err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	u, ok := s.data.Users[id]
	if !ok {
		return common.User{}, "", ErrNotFound
	}
	if actor.Role != common.RoleSuperAdmin && u.Role == common.RoleSuperAdmin {
		return common.User{}, "", fmt.Errorf("%w: only super_admin can reset super_admin users", ErrUnauthorized)
	}
	u.PasswordHash = hash
	u.UpdatedAt = time.Now()
	s.data.Users[id] = u
	s.deleteSessionsForUserLocked(id)
	s.addEventLocked(actor.ID, "user.reset_password", "user:"+id, ip, "password reset")
	if err := s.saveLocked(); err != nil {
		return common.User{}, "", err
	}
	return sanitizeUser(u), generated, nil
}

func (s *Store) GetUserInternal(id string) (common.User, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	u, ok := s.data.Users[id]
	return u, ok
}

func (s *Store) VerifyUserPassword(userID, password string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	u, ok := s.data.Users[userID]
	return ok && common.VerifyPassword(password, u.PasswordHash)
}

func (s *Store) SetUserTOTP(userID, secret string, enabled bool) (common.User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	u, ok := s.data.Users[userID]
	if !ok {
		return common.User{}, ErrNotFound
	}
	u.TOTPSecret = secret
	u.TOTPEnabled = enabled
	if !enabled {
		u.TOTPSecret = ""
		delete(s.data.TOTPReplay, userID)
	}
	u.UpdatedAt = time.Now()
	s.data.Users[userID] = u
	s.addEventLocked(userID, "account.totp", "user:"+userID, "", fmt.Sprintf("totp enabled=%v", enabled))
	if err := s.saveLocked(); err != nil {
		return common.User{}, err
	}
	return sanitizeUser(u), nil
}

func (s *Store) ListNodes() []common.Node {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]common.Node, 0, len(s.data.Nodes))
	for _, n := range s.data.Nodes {
		n.Secret = ""
		if n.LastSeenAt == nil || time.Since(*n.LastSeenAt) > 90*time.Second {
			n.Status = "offline"
		} else {
			n.Status = "online"
		}
		out = append(out, n)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

func (s *Store) GetNode(id string) (common.Node, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	n, ok := s.data.Nodes[id]
	if ok {
		n.Secret = ""
	}
	return n, ok
}

func (s *Store) NodeSecret(id string) (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	n, ok := s.data.Nodes[id]
	if !ok || n.Secret == "" {
		return "", false
	}
	return n.Secret, true
}

func (s *Store) UpdateNode(id, name string, actor common.User, ip string) (common.Node, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return common.Node{}, fmt.Errorf("%w: node name is required", ErrBadRequest)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	n, ok := s.data.Nodes[id]
	if !ok {
		return common.Node{}, ErrNotFound
	}
	n.Name = name
	n.UpdatedAt = time.Now()
	s.data.Nodes[id] = n
	s.addEventLocked(actor.ID, "node.update", "node:"+id, ip, "updated node "+name)
	if err := s.saveLocked(); err != nil {
		return common.Node{}, err
	}
	n.Secret = ""
	return n, nil
}

func (s *Store) DeleteNode(id string, actor common.User, ip string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.data.Nodes[id]; !ok {
		return ErrNotFound
	}
	delete(s.data.Nodes, id)
	for tokenID, token := range s.data.NodeTokens {
		if token.UsedByNode == id {
			token.UsedByNode = ""
			s.data.NodeTokens[tokenID] = token
		}
	}
	removedRules := 0
	for ruleID, rule := range s.data.Rules {
		if rule.NodeID != id {
			continue
		}
		s.deleteRuleLocked(ruleID)
		removedRules++
	}
	delete(s.data.MetricHistory, id)
	s.data.RuleVersion++
	s.addEventLocked(actor.ID, "node.delete", "node:"+id, ip, fmt.Sprintf("deleted node and %d rule(s)", removedRules))
	return s.saveLocked()
}

func (s *Store) CreateNodeToken(name string, hours int) (common.NodeToken, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if hours <= 0 || hours > 24*30 {
		hours = 24
	}
	plain, err := common.RandomToken(32)
	if err != nil {
		return common.NodeToken{}, err
	}
	now := time.Now()
	tok := common.NodeToken{
		ID:         common.RandomID("ntk"),
		Name:       strings.TrimSpace(name),
		TokenHash:  common.HashToken(plain),
		PlainToken: plain,
		MaxUses:    1,
		ExpiresAt:  now.Add(time.Duration(hours) * time.Hour),
		CreatedAt:  now,
	}
	if tok.Name == "" {
		tok.Name = "new-node"
	}
	s.data.NodeTokens[tok.ID] = tok
	s.addEventLocked("", "node_token.create", "node-token:"+tok.ID, "", "created node token")
	return tok, s.saveLocked()
}

func (s *Store) ListNodeTokens() []common.NodeToken {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]common.NodeToken, 0, len(s.data.NodeTokens))
	for _, t := range s.data.NodeTokens {
		t.PlainToken = ""
		out = append(out, t)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out
}

func (s *Store) ConsumeNodeToken(plain string) (common.NodeToken, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	hash := common.HashToken(strings.TrimSpace(plain))
	for id, t := range s.data.NodeTokens {
		if t.TokenHash == hash {
			if now.After(t.ExpiresAt) {
				return common.NodeToken{}, fmt.Errorf("%w: token expired", ErrUnauthorized)
			}
			if t.UsedCount >= t.MaxUses {
				return common.NodeToken{}, fmt.Errorf("%w: token already used", ErrUnauthorized)
			}
			t.UsedCount++
			t.UsedAt = &now
			s.data.NodeTokens[id] = t
			return t, s.saveLocked()
		}
	}
	return common.NodeToken{}, ErrUnauthorized
}

func (s *Store) RegisterNode(req common.AgentRegisterRequest, remoteIP string) (common.AgentRegisterResponse, error) {
	tok, err := s.ConsumeNodeToken(req.Token)
	if err != nil {
		return common.AgentRegisterResponse{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	secret, err := common.RandomToken(48)
	if err != nil {
		return common.AgentRegisterResponse{}, err
	}
	now := time.Now()
	nodeID := common.RandomID("nod")
	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = tok.Name
	}
	n := common.Node{
		ID:             nodeID,
		Name:           name,
		Secret:         secret,
		Status:         "online",
		Hostname:       req.Hostname,
		OS:             req.OS,
		Arch:           req.Arch,
		AgentVersion:   req.AgentVersion,
		PublicIP:       remoteIP,
		PrivateIPs:     req.PrivateIPs,
		ForwardingMode: "nftables",
		FirewallMode:   "managed",
		RuleVersion:    s.data.RuleVersion,
		LastSeenAt:     &now,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	s.data.Nodes[nodeID] = n
	tok.UsedByNode = nodeID
	s.data.NodeTokens[tok.ID] = tok
	s.addEventLocked("", "node.register", "node:"+nodeID, remoteIP, "agent registered")
	if err := s.saveLocked(); err != nil {
		return common.AgentRegisterResponse{}, err
	}
	return common.AgentRegisterResponse{NodeID: nodeID, NodeSecret: secret, PanelName: common.ProjectName, Version: common.Version}, nil
}

func (s *Store) ListRules() []common.ForwardRule {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]common.ForwardRule, 0, len(s.data.Rules))
	for _, r := range s.data.Rules {
		out = append(out, r)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out
}

func (s *Store) RulesForNode(nodeID string) []common.ForwardRule {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []common.ForwardRule{}
	now := time.Now()
	for _, r := range s.data.Rules {
		if r.NodeID != nodeID || !r.Enabled {
			continue
		}
		if r.ExpireAt != nil && now.After(*r.ExpireAt) {
			continue
		}
		out = append(out, r)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ListenPort < out[j].ListenPort })
	return out
}

func (s *Store) SaveRule(r common.ForwardRule, actor common.User, ip string) (common.ForwardRule, error) {
	if err := validateRule(r); err != nil {
		return common.ForwardRule{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.data.Nodes[r.NodeID]; !ok {
		return common.ForwardRule{}, fmt.Errorf("%w: node does not exist", ErrBadRequest)
	}
	if r.UserID != "" {
		if _, ok := s.data.Users[r.UserID]; !ok {
			return common.ForwardRule{}, fmt.Errorf("%w: owner user does not exist", ErrBadRequest)
		}
	}
	now := time.Now()
	if r.ID == "" {
		r.ID = common.RandomID("rul")
		r.CreatedAt = now
		r.Enabled = true
		if r.UserID == "" {
			r.UserID = actor.ID
		}
		r.LastApplyState = "pending"
	} else if old, ok := s.data.Rules[r.ID]; ok {
		r.CreatedAt = old.CreatedAt
		if r.UserID == "" {
			r.UserID = old.UserID
		}
		r.LastApplyState = old.LastApplyState
		r.LastError = old.LastError
	}
	r.UpdatedAt = now
	s.data.RuleVersion++
	r.RuleVersion = s.data.RuleVersion
	s.data.Rules[r.ID] = r
	s.addEventLocked(actor.ID, "rule.save", "rule:"+r.ID, ip, "saved forwarding rule")
	return r, s.saveLocked()
}

func (s *Store) DeleteRule(id string, actor common.User, ip string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.data.Rules[id]; !ok {
		return ErrNotFound
	}
	s.deleteRuleLocked(id)
	s.data.RuleVersion++
	s.addEventLocked(actor.ID, "rule.delete", "rule:"+id, ip, "deleted forwarding rule")
	return s.saveLocked()
}

func (s *Store) deleteRuleLocked(id string) {
	delete(s.data.Rules, id)
	delete(s.data.RuleReports, id)
	for k, c := range s.data.Counters {
		if c.RuleID == id {
			delete(s.data.Counters, k)
		}
	}
	for k, samples := range s.data.CounterHistory {
		if strings.HasPrefix(k, id+"|") {
			delete(s.data.CounterHistory, k)
			continue
		}
		kept := samples[:0]
		for _, sample := range samples {
			if sample.RuleID != id {
				kept = append(kept, sample)
			}
		}
		s.data.CounterHistory[k] = kept
	}
	delete(s.data.TargetHistory, id)
}

func (s *Store) UpdateHeartbeat(req common.AgentHeartbeatRequest, remoteIP string) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	n, ok := s.data.Nodes[req.NodeID]
	if !ok {
		return 0, ErrNotFound
	}
	now := time.Now()
	n.Status = "online"
	n.Hostname = req.Hostname
	n.OS = req.OS
	n.Arch = req.Arch
	n.AgentVersion = req.AgentVersion
	n.PrivateIPs = req.PrivateIPs
	n.PublicIP = remoteIP
	n.LastMetrics = req.Metrics
	n.LastDiagnostics = req.Diagnostics
	n.LastRuleset = req.RulesetPreview
	n.LastError = req.LastError
	n.LastSeenAt = &now
	n.ForwardingMode = req.ForwardingMode
	n.FirewallMode = req.FirewallMode
	n.RuleVersion = req.RuleVersion
	n.UpdatedAt = now
	s.data.Nodes[n.ID] = n
	s.recordMetricHistoryLocked(req.NodeID, req.Metrics, now)
	for _, c := range req.Counters {
		c.UpdatedAt = now
		s.data.Counters[c.RuleID+"|"+c.Protocol] = c
		s.recordCounterHistoryLocked(c, now)
	}
	for _, report := range req.RuleReports {
		report.CheckedAt = now
		s.data.RuleReports[report.RuleID] = report
		s.recordTargetHistoryLocked(report, now)
		if rule, ok := s.data.Rules[report.RuleID]; ok {
			rule.LastApplyState = report.State
			if report.State == "error" {
				rule.LastError = report.Message
			} else {
				rule.LastError = ""
			}
			rule.UpdatedAt = now
			s.data.Rules[rule.ID] = rule
		}
	}
	return s.data.RuleVersion, s.saveLocked()
}

func (s *Store) recordMetricHistoryLocked(nodeID string, metrics common.NodeMetrics, at time.Time) {
	samples := append(s.data.MetricHistory[nodeID], NodeMetricSample{At: at, Metrics: metrics})
	if len(samples) > maxNodeMetricSamples {
		samples = samples[len(samples)-maxNodeMetricSamples:]
	}
	s.data.MetricHistory[nodeID] = samples
}

func (s *Store) recordCounterHistoryLocked(counter common.RuleCounter, at time.Time) {
	key := counter.RuleID + "|" + counter.Protocol
	samples := append(s.data.CounterHistory[key], RuleCounterSample{
		At:       at,
		RuleID:   counter.RuleID,
		Protocol: counter.Protocol,
		Packets:  counter.Packets,
		Bytes:    counter.Bytes,
	})
	if len(samples) > maxRuleCounterSamples {
		samples = samples[len(samples)-maxRuleCounterSamples:]
	}
	s.data.CounterHistory[key] = samples
}

func (s *Store) recordTargetHistoryLocked(report common.RuleApplyReport, at time.Time) {
	if report.RuleID == "" || report.TargetIP == "" {
		return
	}
	rule, ok := s.data.Rules[report.RuleID]
	if !ok {
		return
	}
	samples := s.data.TargetHistory[report.RuleID]
	next := TargetIPSample{
		ResolvedAt: at,
		RuleID:     report.RuleID,
		TargetHost: rule.TargetHost,
		TargetIP:   report.TargetIP,
	}
	if len(samples) > 0 {
		last := samples[len(samples)-1]
		if last.TargetHost == next.TargetHost && last.TargetIP == next.TargetIP {
			return
		}
	}
	samples = append(samples, next)
	if len(samples) > maxTargetIPSamples {
		samples = samples[len(samples)-maxTargetIPSamples:]
	}
	s.data.TargetHistory[report.RuleID] = samples
}

func (s *Store) historySnapshots() (map[string][]NodeMetricSample, map[string][]RuleCounterSample, map[string][]TargetIPSample) {
	s.mu.Lock()
	defer s.mu.Unlock()
	metrics := make(map[string][]NodeMetricSample, len(s.data.MetricHistory))
	for key, samples := range s.data.MetricHistory {
		metrics[key] = append([]NodeMetricSample(nil), samples...)
	}
	counters := make(map[string][]RuleCounterSample, len(s.data.CounterHistory))
	for key, samples := range s.data.CounterHistory {
		counters[key] = append([]RuleCounterSample(nil), samples...)
	}
	targets := make(map[string][]TargetIPSample, len(s.data.TargetHistory))
	for key, samples := range s.data.TargetHistory {
		targets[key] = append([]TargetIPSample(nil), samples...)
	}
	return metrics, counters, targets
}

func (s *Store) RuleVersion() int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.data.RuleVersion
}

func (s *Store) AcceptNonce(nodeID, nonce string, ts time.Time) bool {
	if nonce == "" || nodeID == "" {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	for k, seenAt := range s.data.SeenNonces {
		if now.Sub(seenAt) > 15*time.Minute {
			delete(s.data.SeenNonces, k)
		}
	}
	key := nodeID + "|" + nonce
	if _, exists := s.data.SeenNonces[key]; exists {
		return false
	}
	if now.Sub(ts) > 5*time.Minute || ts.Sub(now) > 5*time.Minute {
		return false
	}
	s.data.SeenNonces[key] = now
	_ = s.saveLocked()
	return true
}

func (s *Store) Dashboard() map[string]any {
	nodes := s.ListNodes()
	rules := s.ListRules()
	onlineNodes := 0
	enabledRules := 0
	report := s.Diagnostics()
	for _, n := range nodes {
		if n.Status == "online" {
			onlineNodes++
		}
	}
	for _, r := range rules {
		if r.Enabled {
			enabledRules++
		}
	}
	return map[string]any{
		"nodes":         len(nodes),
		"online_nodes":  onlineNodes,
		"rules":         len(rules),
		"enabled_rules": enabledRules,
		"rule_version":  s.RuleVersion(),
		"findings":      report.Findings,
	}
}

func (s *Store) Counters() []common.RuleCounter {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]common.RuleCounter, 0, len(s.data.Counters))
	for _, c := range s.data.Counters {
		out = append(out, c)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].RuleID == out[j].RuleID {
			return out[i].Protocol < out[j].Protocol
		}
		return out[i].RuleID < out[j].RuleID
	})
	return out
}

func (s *Store) RuleReports() []common.RuleApplyReport {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]common.RuleApplyReport, 0, len(s.data.RuleReports))
	for _, report := range s.data.RuleReports {
		out = append(out, report)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CheckedAt.After(out[j].CheckedAt) })
	return out
}

func (s *Store) Diagnostics() DiagnosisReport {
	nodes := s.ListNodes()
	rules := s.ListRules()
	counters := s.Counters()
	reports := s.RuleReports()
	metricHistory, counterHistory, targetHistory := s.historySnapshots()
	nodeByID := map[string]common.Node{}
	for _, n := range nodes {
		nodeByID[n.ID] = n
	}
	countersByRule := map[string][]common.RuleCounter{}
	for _, c := range counters {
		countersByRule[c.RuleID] = append(countersByRule[c.RuleID], c)
	}
	reportsByRule := map[string]common.RuleApplyReport{}
	for _, report := range reports {
		reportsByRule[report.RuleID] = report
	}
	report := DiagnosisReport{
		GeneratedAt: time.Now(),
		Findings:    []common.Finding{},
		Nodes:       []NodeDiagnosis{},
		Rules:       []RuleDiagnosis{},
	}
	for _, n := range nodes {
		findings := analyzeNode(n)
		trend := buildNodeTrend(metricHistory[n.ID], time.Now())
		findings = append(findings, analyzeNodeTrend(n, trend)...)
		health := nodeHealth(n, findings)
		report.Nodes = append(report.Nodes, NodeDiagnosis{
			NodeID:   n.ID,
			NodeName: n.Name,
			Status:   n.Status,
			Health:   health,
			Summary:  nodeSummary(n, health, findings),
			Metrics:  n.LastMetrics,
			Trend:    trend,
			Ruleset:  n.LastRuleset,
			Findings: findings,
		})
		report.Findings = append(report.Findings, findings...)
	}
	for _, r := range rules {
		n := nodeByID[r.NodeID]
		applyReport := reportsByRule[r.ID]
		rates := buildRuleCounterRates(r.ID, counterHistory, time.Now())
		dnsHistory := append([]TargetIPSample(nil), targetHistory[r.ID]...)
		findings := analyzeRule(r, n, countersByRule[r.ID], applyReport)
		findings = append(findings, analyzeRuleTrend(r, rates, dnsHistory)...)
		report.Rules = append(report.Rules, RuleDiagnosis{
			RuleID:        r.ID,
			RuleName:      r.Name,
			NodeID:        r.NodeID,
			NodeName:      n.Name,
			Protocol:      r.Protocol,
			Listen:        r.ListenPort,
			Target:        fmt.Sprintf("%s:%d", r.TargetHost, r.TargetPort),
			Enabled:       r.Enabled,
			ApplyState:    r.LastApplyState,
			ApplyMessage:  applyReport.Message,
			TargetIP:      applyReport.TargetIP,
			Counters:      countersByRule[r.ID],
			CounterRates:  rates,
			Probes:        applyReport.Probes,
			TargetHistory: dnsHistory,
			LikelyCause:   likelyRuleCause(r, n, applyReport, countersByRule[r.ID], rates, dnsHistory, findings),
			Findings:      findings,
		})
		report.Findings = append(report.Findings, findings...)
	}
	sort.Slice(report.Findings, func(i, j int) bool {
		return severityRank(report.Findings[i].Severity) > severityRank(report.Findings[j].Severity)
	})
	return report
}

func (s *Store) Events(limit int) []Event {
	s.mu.Lock()
	defer s.mu.Unlock()
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	start := len(s.data.Events) - limit
	if start < 0 {
		start = 0
	}
	out := append([]Event(nil), s.data.Events[start:]...)
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out
}

func (s *Store) addEventLocked(actorID, action, target, ip, detail string) {
	s.data.Events = append(s.data.Events, Event{
		ID:        common.RandomID("evt"),
		ActorID:   actorID,
		Action:    action,
		Target:    target,
		IP:        ip,
		Detail:    detail,
		CreatedAt: time.Now(),
	})
	if len(s.data.Events) > 2000 {
		s.data.Events = s.data.Events[len(s.data.Events)-2000:]
	}
}

func validateRule(r common.ForwardRule) error {
	if strings.TrimSpace(r.Name) == "" {
		return fmt.Errorf("%w: rule name is required", ErrBadRequest)
	}
	if r.Protocol != "tcp" && r.Protocol != "udp" && r.Protocol != "both" {
		return fmt.Errorf("%w: protocol must be tcp, udp, or both", ErrBadRequest)
	}
	if r.ListenPort < 1 || r.ListenPort > 65535 || r.TargetPort < 1 || r.TargetPort > 65535 {
		return fmt.Errorf("%w: port out of range", ErrBadRequest)
	}
	if strings.TrimSpace(r.TargetHost) == "" {
		return fmt.Errorf("%w: target host is required", ErrBadRequest)
	}
	for _, cidr := range r.SourceCIDRs {
		if strings.TrimSpace(cidr) == "" {
			continue
		}
		if _, _, err := net.ParseCIDR(cidr); err != nil {
			return fmt.Errorf("%w: invalid source cidr "+cidr, ErrBadRequest)
		}
	}
	return nil
}

func buildNodeTrend(samples []NodeMetricSample, now time.Time) NodeTrend {
	recent := recentMetricSamples(samples, now, trendWindow)
	if len(recent) < 2 && len(samples) >= 2 {
		recent = samples[len(samples)-2:]
	}
	if len(recent) < 2 {
		return NodeTrend{SampleCount: len(recent)}
	}
	first := recent[0]
	last := recent[len(recent)-1]
	seconds := last.At.Sub(first.At).Seconds()
	if seconds <= 0 {
		return NodeTrend{SampleCount: len(recent)}
	}
	conntrackDelta := int64(last.Metrics.ConntrackCount) - int64(first.Metrics.ConntrackCount)
	tcpOutDelta := counterDelta(first.Metrics.TCPOutSegments, last.Metrics.TCPOutSegments)
	tcpRetransDelta := counterDelta(first.Metrics.TCPRetransSegments, last.Metrics.TCPRetransSegments)
	trend := NodeTrend{
		SampleCount:        len(recent),
		WindowSeconds:      int64(seconds),
		ConntrackDelta:     conntrackDelta,
		ConntrackDirection: trendDirection(conntrackDelta),
		TCPRetransDelta:    tcpRetransDelta,
		TCPOutDelta:        tcpOutDelta,
		NetInBytesPerSec:   float64(counterDelta(first.Metrics.NetIn, last.Metrics.NetIn)) / seconds,
		NetOutBytesPerSec:  float64(counterDelta(first.Metrics.NetOut, last.Metrics.NetOut)) / seconds,
	}
	if tcpOutDelta > 0 {
		trend.TCPRetransRatio = float64(tcpRetransDelta) / float64(tcpOutDelta)
	}
	return trend
}

func buildRuleCounterRates(ruleID string, history map[string][]RuleCounterSample, now time.Time) []RuleCounterRate {
	out := []RuleCounterRate{}
	for _, proto := range []string{"tcp", "udp"} {
		key := ruleID + "|" + proto
		samples := recentCounterSamples(history[key], now, trendWindow)
		if len(samples) < 2 && len(history[key]) >= 2 {
			all := history[key]
			samples = all[len(all)-2:]
		}
		if len(samples) < 2 {
			continue
		}
		first := samples[0]
		last := samples[len(samples)-1]
		seconds := last.At.Sub(first.At).Seconds()
		if seconds <= 0 {
			continue
		}
		packetDelta := counterDelta(first.Packets, last.Packets)
		byteDelta := counterDelta(first.Bytes, last.Bytes)
		out = append(out, RuleCounterRate{
			Protocol:         proto,
			WindowSeconds:    int64(seconds),
			PacketsDelta:     packetDelta,
			BytesDelta:       byteDelta,
			PacketsPerSecond: float64(packetDelta) / seconds,
			BytesPerSecond:   float64(byteDelta) / seconds,
		})
	}
	return out
}

func analyzeNodeTrend(n common.Node, trend NodeTrend) []common.Finding {
	if trend.SampleCount < 2 {
		return nil
	}
	now := time.Now()
	out := []common.Finding{}
	if n.LastMetrics.ConntrackMax > 0 && trend.ConntrackDelta > 0 {
		deltaPct := float64(trend.ConntrackDelta) / float64(n.LastMetrics.ConntrackMax)
		if deltaPct > 0.10 {
			out = append(out, common.Finding{Severity: "warn", Code: "conntrack.rising", Title: "conntrack 增长较快", Detail: fmt.Sprintf("%s 最近 %d 秒 conntrack 增加 %d", n.Name, trend.WindowSeconds, trend.ConntrackDelta), CreatedAt: now})
		}
	}
	if trend.TCPOutDelta > 0 && trend.TCPRetransRatio > 0.05 {
		out = append(out, common.Finding{Severity: "warn", Code: "tcp.retrans_delta", Title: "近期 TCP 重传偏高", Detail: fmt.Sprintf("%s 最近 %d 秒 TCP 重传比例 %.2f%%", n.Name, trend.WindowSeconds, trend.TCPRetransRatio*100), CreatedAt: now})
	}
	return out
}

func analyzeRuleTrend(r common.ForwardRule, rates []RuleCounterRate, dnsHistory []TargetIPSample) []common.Finding {
	now := time.Now()
	out := []common.Finding{}
	for _, rate := range rates {
		if rate.WindowSeconds > 0 && rate.PacketsDelta > 0 && rate.BytesDelta == 0 {
			out = append(out, common.Finding{Severity: "warn", Code: "rule.counter_packets_no_bytes", Title: "规则计数异常", Detail: fmt.Sprintf("%s %s 最近有包计数但字节为 0", r.Name, rate.Protocol), CreatedAt: now})
		}
	}
	if len(dnsHistory) >= 2 {
		prev := dnsHistory[len(dnsHistory)-2]
		last := dnsHistory[len(dnsHistory)-1]
		if prev.TargetIP != last.TargetIP && time.Since(last.ResolvedAt) < 30*time.Minute {
			out = append(out, common.Finding{Severity: "info", Code: "target.ip_changed", Title: "目标解析地址发生变化", Detail: fmt.Sprintf("%s 从 %s 变为 %s", r.TargetHost, prev.TargetIP, last.TargetIP), CreatedAt: last.ResolvedAt})
		}
	}
	return out
}

func likelyRuleCause(r common.ForwardRule, n common.Node, report common.RuleApplyReport, counters []common.RuleCounter, rates []RuleCounterRate, dnsHistory []TargetIPSample, findings []common.Finding) string {
	if !r.Enabled {
		return "规则已停用，不会参与转发。"
	}
	if n.ID == "" {
		return "规则绑定的节点不存在，无法下发。"
	}
	if n.Status != "online" {
		return "节点离线或 Agent 心跳中断，先恢复节点连通性。"
	}
	if report.State == "error" {
		return "nftables 规则应用失败，优先查看 apply message 和 Agent 权限。"
	}
	for _, probe := range report.Probes {
		if probe.Protocol == "tcp" && !probe.OK {
			return "目标 TCP 服务不可达，优先检查目标服务、防火墙和目标地址解析。"
		}
	}
	if len(dnsHistory) >= 2 {
		prev := dnsHistory[len(dnsHistory)-2]
		last := dnsHistory[len(dnsHistory)-1]
		if prev.TargetIP != last.TargetIP && time.Since(last.ResolvedAt) < 30*time.Minute {
			return "目标域名近期解析到新 IP，若转发突然变慢，优先检查新目标 IP 的链路和服务状态。"
		}
	}
	if hasFindingCode(findings, "conntrack.full") || hasFindingCode(findings, "conntrack.high") || hasFindingCode(findings, "conntrack.rising") {
		return "节点 conntrack 压力较高，新连接建立可能变慢或失败。"
	}
	if n.LastMetrics.ConntrackMax > 0 && float64(n.LastMetrics.ConntrackCount)/float64(n.LastMetrics.ConntrackMax) >= 0.75 {
		return "节点 conntrack 使用率较高，新连接建立可能变慢或失败。"
	}
	if hasFindingCode(findings, "tcp.retrans") || hasFindingCode(findings, "tcp.retrans_delta") {
		return "近期 TCP 重传偏高，更像链路质量、目标端拥塞或跨网路由问题。"
	}
	if n.LastMetrics.TCPOutSegments > 0 && float64(n.LastMetrics.TCPRetransSegments)/float64(n.LastMetrics.TCPOutSegments) > 0.08 {
		return "节点累计 TCP 重传偏高，更像链路质量、目标端拥塞或跨网路由问题。"
	}
	totalPackets := uint64(0)
	for _, c := range counters {
		totalPackets += c.Packets
	}
	totalRate := 0.0
	for _, rate := range rates {
		totalRate += rate.PacketsPerSecond
	}
	if report.State == "applied" && totalPackets == 0 {
		return "规则已应用但没有命中流量，优先检查云安全组、公网端口、源 CIDR 和访问入口。"
	}
	if totalRate > 0 {
		return "规则近期有流量命中，当前未发现明确瓶颈；继续观察速率和节点趋势。"
	}
	return "暂无足够趋势样本，等待更多 Agent 心跳和 counter 数据。"
}

func analyzeNode(n common.Node) []common.Finding {
	now := time.Now()
	out := []common.Finding{}
	if n.Status != "online" {
		out = append(out, common.Finding{Severity: "critical", Code: "node.offline", Title: "节点离线", Detail: n.Name + " 未在 90 秒内上报心跳，规则不会继续更新", CreatedAt: now})
	}
	if n.LastError != "" {
		out = append(out, common.Finding{Severity: "critical", Code: "agent.error", Title: "Agent 上报错误", Detail: n.Name + "：" + n.LastError, CreatedAt: now})
	}
	out = append(out, n.LastDiagnostics...)
	if n.LastMetrics.ConntrackMax > 0 {
		pct := float64(n.LastMetrics.ConntrackCount) / float64(n.LastMetrics.ConntrackMax)
		if pct >= 0.9 {
			out = append(out, common.Finding{Severity: "critical", Code: "conntrack.full", Title: "conntrack 接近上限", Detail: fmt.Sprintf("%s conntrack 使用率 %.0f%%，新连接可能变慢或失败", n.Name, pct*100), CreatedAt: now})
		} else if pct >= 0.75 {
			out = append(out, common.Finding{Severity: "warn", Code: "conntrack.high", Title: "conntrack 使用率偏高", Detail: fmt.Sprintf("%s conntrack 使用率 %.0f%%", n.Name, pct*100), CreatedAt: now})
		}
	}
	if n.LastMetrics.MemoryTotal > 0 {
		pct := float64(n.LastMetrics.MemoryUsed) / float64(n.LastMetrics.MemoryTotal)
		if pct > 0.9 {
			out = append(out, common.Finding{Severity: "warn", Code: "memory.high", Title: "节点内存压力高", Detail: n.Name + " 内存使用率超过 90%", CreatedAt: now})
		}
	}
	if n.LastMetrics.TCPOutSegments > 0 {
		pct := float64(n.LastMetrics.TCPRetransSegments) / float64(n.LastMetrics.TCPOutSegments)
		if pct > 0.08 {
			out = append(out, common.Finding{Severity: "warn", Code: "tcp.retrans", Title: "TCP 重传偏高", Detail: n.Name + " TCP 重传比例偏高，可能存在链路或目标端问题", CreatedAt: now})
		}
	}
	return out
}

func analyzeRule(r common.ForwardRule, n common.Node, counters []common.RuleCounter, report common.RuleApplyReport) []common.Finding {
	now := time.Now()
	out := []common.Finding{}
	if !r.Enabled {
		return out
	}
	if n.ID == "" {
		out = append(out, common.Finding{Severity: "critical", Code: "rule.node_missing", Title: "规则节点不存在", Detail: r.Name + " 绑定的节点不存在", CreatedAt: now})
		return out
	}
	if n.Status != "online" {
		out = append(out, common.Finding{Severity: "critical", Code: "rule.node_offline", Title: "规则所在节点离线", Detail: r.Name + " 所在节点 " + n.Name + " 离线", CreatedAt: now})
	}
	switch report.State {
	case "":
		out = append(out, common.Finding{Severity: "info", Code: "rule.apply_pending", Title: "规则等待下发", Detail: r.Name + " 已保存，等待 Agent 拉取并应用", CreatedAt: now})
	case "pending":
		out = append(out, common.Finding{Severity: "info", Code: "rule.apply_pending", Title: "规则等待下发", Detail: r.Name + " 等待 Agent 应用", CreatedAt: now})
	case "dry_run":
		out = append(out, common.Finding{Severity: "info", Code: "rule.dry_run", Title: "规则处于 dry-run", Detail: r.Name + " 已生成 nftables ruleset，但 Agent 未实际应用", CreatedAt: report.CheckedAt})
	case "error":
		out = append(out, common.Finding{Severity: "critical", Code: "rule.apply_failed", Title: "规则应用失败", Detail: r.Name + "：" + report.Message, CreatedAt: report.CheckedAt})
	case "applied":
		if time.Since(report.CheckedAt) > 2*time.Minute {
			out = append(out, common.Finding{Severity: "warn", Code: "rule.apply_stale", Title: "规则应用状态过期", Detail: r.Name + " 超过 2 分钟没有新的应用状态回报", CreatedAt: now})
		}
	}
	for _, probe := range report.Probes {
		if probe.Protocol == "tcp" && !probe.OK {
			out = append(out, common.Finding{Severity: "warn", Code: "rule.target_tcp_failed", Title: "目标 TCP 检测失败", Detail: fmt.Sprintf("%s 目标 %s:%d 不可达：%s", r.Name, probe.TargetHost, probe.TargetPort, probe.Error), CreatedAt: probe.CheckedAt})
		}
		if probe.Protocol == "udp" && !probe.OK {
			out = append(out, common.Finding{Severity: "info", Code: "rule.target_udp_probe", Title: "UDP 探测未确认", Detail: fmt.Sprintf("%s UDP 目标 %s:%d 未确认：%s", r.Name, probe.TargetHost, probe.TargetPort, probe.Error), CreatedAt: probe.CheckedAt})
		}
	}
	if len(counters) == 0 {
		out = append(out, common.Finding{Severity: "info", Code: "rule.no_counter", Title: "规则暂无计数", Detail: r.Name + " 暂未收到 nftables counter，等待 Agent 下一次心跳", CreatedAt: now})
		return out
	}
	totalPackets := uint64(0)
	for _, c := range counters {
		totalPackets += c.Packets
		if time.Since(c.UpdatedAt) > 2*time.Minute {
			out = append(out, common.Finding{Severity: "warn", Code: "rule.counter_stale", Title: "规则计数过期", Detail: r.Name + " 的 " + c.Protocol + " counter 超过 2 分钟未更新", CreatedAt: now})
		}
	}
	if report.State == "applied" && totalPackets == 0 && !report.CheckedAt.IsZero() && time.Since(report.CheckedAt) > time.Minute {
		out = append(out, common.Finding{Severity: "info", Code: "rule.no_traffic", Title: "规则暂未命中", Detail: r.Name + " 已应用，但 counter 仍为 0，可能暂无流量或访问未命中该端口", CreatedAt: now})
	}
	return out
}

func nodeHealth(n common.Node, findings []common.Finding) int {
	score := 100
	if n.Status != "online" {
		score -= 60
	}
	for _, f := range findings {
		switch f.Severity {
		case "critical":
			score -= 25
		case "warn":
			score -= 12
		}
	}
	if score < 0 {
		return 0
	}
	return score
}

func nodeSummary(n common.Node, health int, findings []common.Finding) string {
	if n.Status != "online" {
		return "节点离线，规则状态无法确认"
	}
	if health >= 90 {
		return "节点健康，当前没有明显瓶颈"
	}
	for _, f := range findings {
		if f.Severity == "critical" || f.Severity == "warn" {
			return f.Title
		}
	}
	return "节点存在轻微风险，建议观察趋势"
}

func severityRank(severity string) int {
	switch severity {
	case "critical":
		return 3
	case "warn":
		return 2
	case "info":
		return 1
	default:
		return 0
	}
}

func recentMetricSamples(samples []NodeMetricSample, now time.Time, window time.Duration) []NodeMetricSample {
	if len(samples) == 0 {
		return nil
	}
	cutoff := now.Add(-window)
	start := 0
	for i, sample := range samples {
		if !sample.At.Before(cutoff) {
			start = i
			break
		}
		if i == len(samples)-1 {
			start = i
		}
	}
	return samples[start:]
}

func recentCounterSamples(samples []RuleCounterSample, now time.Time, window time.Duration) []RuleCounterSample {
	if len(samples) == 0 {
		return nil
	}
	cutoff := now.Add(-window)
	start := 0
	for i, sample := range samples {
		if !sample.At.Before(cutoff) {
			start = i
			break
		}
		if i == len(samples)-1 {
			start = i
		}
	}
	return samples[start:]
}

func counterDelta(first, last uint64) uint64 {
	if last >= first {
		return last - first
	}
	return last
}

func trendDirection(delta int64) string {
	switch {
	case delta > 0:
		return "rising"
	case delta < 0:
		return "falling"
	default:
		return "flat"
	}
}

func hasFindingCode(findings []common.Finding, code string) bool {
	for _, finding := range findings {
		if finding.Code == code {
			return true
		}
	}
	return false
}

func normalizeRole(role common.Role) (common.Role, error) {
	switch role {
	case "":
		return common.RoleUser, nil
	case common.RoleUser, common.RoleAdmin, common.RoleSuperAdmin:
		return role, nil
	default:
		return "", fmt.Errorf("%w: invalid role", ErrBadRequest)
	}
}

func (s *Store) superAdminCountLocked() int {
	count := 0
	for _, u := range s.data.Users {
		if u.Role == common.RoleSuperAdmin {
			count++
		}
	}
	return count
}

func (s *Store) enabledSuperAdminCountLocked() int {
	count := 0
	for _, u := range s.data.Users {
		if u.Role == common.RoleSuperAdmin && !u.Disabled {
			count++
		}
	}
	return count
}

func (s *Store) deleteSessionsForUserLocked(userID string) {
	for token, sess := range s.data.Sessions {
		if sess.UserID == userID {
			delete(s.data.Sessions, token)
		}
	}
}

func sanitizeUser(u common.User) common.User {
	u.PasswordHash = ""
	u.TOTPSecret = ""
	return u
}

func clientIPFromRemote(remoteAddr string) string {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err == nil {
		return host
	}
	return remoteAddr
}

func atoi64(s string) uint64 {
	v, _ := strconv.ParseUint(strings.TrimSpace(s), 10, 64)
	return v
}
