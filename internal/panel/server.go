package panel

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"relaycore/internal/common"
)

const sessionCookie = "relaycore_session"

type Server struct {
	store        *Store
	addr         string
	webDir       string
	stopCh       chan struct{}
	limiter      *loginLimiter
	pendingTOTPs sync.Map
}

type loginLimiter struct {
	mu       sync.Mutex
	attempts map[string]loginAttempt
}

type loginAttempt struct {
	Count       int
	LockedUntil time.Time
}

type pendingTOTP struct {
	Secret    string
	ExpiresAt time.Time
}

type authHandler func(http.ResponseWriter, *http.Request, common.User)

func NewServer(store *Store, addr, webDir string) *Server {
	return &Server{
		store:   store,
		addr:    addr,
		webDir:  webDir,
		stopCh:  make(chan struct{}),
		limiter: &loginLimiter{attempts: map[string]loginAttempt{}},
	}
}

func (s *Server) Stop() {
	select {
	case <-s.stopCh:
	default:
		close(s.stopCh)
	}
}

func (s *Server) ListenAndServe() error {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, map[string]any{"ok": true, "version": common.Version})
	})
	mux.HandleFunc("/api/auth/login", s.handleLogin)
	mux.HandleFunc("/api/auth/logout", s.requireAuth(s.handleLogout))
	mux.HandleFunc("/api/me", s.requireAuth(s.handleMe))
	mux.HandleFunc("/api/account/totp/setup", s.requireAuth(s.handleTOTPSetup))
	mux.HandleFunc("/api/account/totp/enable", s.requireAuth(s.handleTOTPEnable))
	mux.HandleFunc("/api/account/totp/disable", s.requireAuth(s.handleTOTPDisable))
	mux.HandleFunc("/api/dashboard", s.requireAuth(s.handleDashboard))
	mux.HandleFunc("/api/diagnostics", s.requireAuth(s.handleDiagnostics))
	mux.HandleFunc("/api/nodes", s.requireAuth(s.handleNodes))
	mux.HandleFunc("/api/node-tokens", s.requireAuth(s.handleNodeTokens))
	mux.HandleFunc("/api/rules", s.requireAuth(s.handleRules))
	mux.HandleFunc("/api/rules/", s.requireAuth(s.handleRuleByID))
	mux.HandleFunc("/api/users", s.requireAuth(s.handleUsers))
	mux.HandleFunc("/api/users/", s.requireAuth(s.handleUserByID))
	mux.HandleFunc("/api/events", s.requireAuth(s.handleEvents))
	mux.HandleFunc("/api/agent/register", s.handleAgentRegister)
	mux.HandleFunc("/api/agent/heartbeat", s.handleAgentHeartbeat)
	mux.Handle("/", s.webHandler())

	handler := s.requestLog(securityHeaders(mux))
	srv := &http.Server{
		Addr:         s.addr,
		Handler:      handler,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
	}
	go func() {
		<-s.stopCh
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(ctx)
	}()
	log.Printf("%s panel listening on %s", common.ProjectName, s.addr)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
		TOTPCode string `json:"totp_code"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	ip := realIP(r)
	if until, ok := s.limiter.allowed(ip, req.Username); !ok {
		writeError(w, http.StatusTooManyRequests, "login locked until "+until.Format(time.RFC3339))
		return
	}
	u, ok, reason := s.store.Login(req.Username, req.Password, req.TOTPCode)
	if !ok {
		s.limiter.fail(ip, req.Username)
		if reason == "" {
			reason = "用户名或密码错误"
		}
		writeError(w, http.StatusUnauthorized, reason)
		return
	}
	sess, err := s.store.CreateSession(u, ip, r.UserAgent())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "创建会话失败")
		return
	}
	s.limiter.success(ip, req.Username)
	secure := r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    sess.Token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   secure,
		Expires:  sess.ExpiresAt,
	})
	writeJSON(w, map[string]any{"user": u, "version": common.Version})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request, _ common.User) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if c, err := r.Cookie(sessionCookie); err == nil {
		_ = s.store.DeleteSession(c.Value)
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", Expires: time.Unix(0, 0), HttpOnly: true, SameSite: http.SameSiteLaxMode})
	writeJSON(w, map[string]any{"ok": true})
}

func (s *Server) handleMe(w http.ResponseWriter, _ *http.Request, u common.User) {
	writeJSON(w, map[string]any{"user": u, "version": common.Version})
}

func (s *Server) handleTOTPSetup(w http.ResponseWriter, r *http.Request, u common.User) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req struct {
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if !s.store.VerifyUserPassword(u.ID, req.Password) {
		writeError(w, http.StatusForbidden, "密码错误")
		return
	}
	secret, err := common.GenerateTOTPSecret()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "生成两步验证密钥失败")
		return
	}
	s.pendingTOTPs.Store(u.ID, pendingTOTP{Secret: secret, ExpiresAt: time.Now().Add(10 * time.Minute)})
	writeJSON(w, map[string]any{"secret": secret, "uri": common.TOTPURI(common.ProjectName, u.Username, secret)})
}

func (s *Server) handleTOTPEnable(w http.ResponseWriter, r *http.Request, u common.User) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req struct {
		Secret string `json:"secret"`
		Code   string `json:"code"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	pendingRaw, ok := s.pendingTOTPs.Load(u.ID)
	if !ok {
		writeError(w, http.StatusBadRequest, "请先生成两步验证密钥")
		return
	}
	pending := pendingRaw.(pendingTOTP)
	if time.Now().After(pending.ExpiresAt) || pending.Secret != req.Secret {
		s.pendingTOTPs.Delete(u.ID)
		writeError(w, http.StatusBadRequest, "两步验证密钥已过期，请重新生成")
		return
	}
	if _, ok := common.VerifyTOTP(req.Secret, req.Code, time.Now()); !ok {
		writeError(w, http.StatusBadRequest, "验证码错误")
		return
	}
	updated, err := s.store.SetUserTOTP(u.ID, req.Secret, true)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	s.pendingTOTPs.Delete(u.ID)
	writeJSON(w, map[string]any{"user": updated})
}

func (s *Server) handleTOTPDisable(w http.ResponseWriter, r *http.Request, u common.User) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req struct {
		Password string `json:"password"`
		Code     string `json:"code"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if !s.store.VerifyUserPassword(u.ID, req.Password) {
		writeError(w, http.StatusForbidden, "密码错误")
		return
	}
	full, ok := s.store.GetUserInternal(u.ID)
	if !ok {
		writeError(w, http.StatusNotFound, "用户不存在")
		return
	}
	if full.TOTPEnabled {
		if _, ok := common.VerifyTOTP(full.TOTPSecret, req.Code, time.Now()); !ok {
			writeError(w, http.StatusBadRequest, "验证码错误")
			return
		}
	}
	updated, err := s.store.SetUserTOTP(u.ID, "", false)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, map[string]any{"user": updated})
}

func (s *Server) handleDashboard(w http.ResponseWriter, _ *http.Request, _ common.User) {
	writeJSON(w, s.store.Dashboard())
}

func (s *Server) handleDiagnostics(w http.ResponseWriter, r *http.Request, _ common.User) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	writeJSON(w, s.store.Diagnostics())
}

func (s *Server) handleNodes(w http.ResponseWriter, r *http.Request, _ common.User) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	writeJSON(w, map[string]any{"items": s.store.ListNodes()})
}

func (s *Server) handleNodeTokens(w http.ResponseWriter, r *http.Request, u common.User) {
	if !isAdmin(u) {
		writeError(w, http.StatusForbidden, "permission denied")
		return
	}
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, map[string]any{"items": s.store.ListNodeTokens()})
	case http.MethodPost:
		var req struct {
			Name  string `json:"name"`
			Hours int    `json:"hours"`
		}
		if !decodeJSON(w, r, &req) {
			return
		}
		tok, err := s.store.CreateNodeToken(req.Name, req.Hours)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "创建节点 Token 失败")
			return
		}
		base := requestBaseURL(r)
		install := fmt.Sprintf("relaycore-agent -panel %s -token %s", base, tok.PlainToken)
		writeJSON(w, map[string]any{"item": tok, "install_command": install})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleRules(w http.ResponseWriter, r *http.Request, u common.User) {
	switch r.Method {
	case http.MethodGet:
		rules := s.store.ListRules()
		if !isAdmin(u) {
			rules = rulesOwnedBy(rules, u.ID)
		}
		ids := ruleIDSet(rules)
		writeJSON(w, map[string]any{"items": rules, "counters": countersForRules(s.store.Counters(), ids), "reports": reportsForRules(s.store.RuleReports(), ids), "rule_version": s.store.RuleVersion()})
	case http.MethodPost:
		if !isAdmin(u) {
			writeError(w, http.StatusForbidden, "permission denied")
			return
		}
		var rule common.ForwardRule
		if !decodeJSON(w, r, &rule) {
			return
		}
		saved, err := s.store.SaveRule(rule, u, realIP(r))
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, map[string]any{"item": saved})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleRuleByID(w http.ResponseWriter, r *http.Request, u common.User) {
	if !isAdmin(u) {
		writeError(w, http.StatusForbidden, "permission denied")
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/api/rules/")
	if id == "" {
		writeError(w, http.StatusNotFound, "rule not found")
		return
	}
	switch r.Method {
	case http.MethodPut:
		var rule common.ForwardRule
		if !decodeJSON(w, r, &rule) {
			return
		}
		rule.ID = id
		saved, err := s.store.SaveRule(rule, u, realIP(r))
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, map[string]any{"item": saved})
	case http.MethodDelete:
		if err := s.store.DeleteRule(id, u, realIP(r)); err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, map[string]any{"ok": true})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleUsers(w http.ResponseWriter, r *http.Request, u common.User) {
	if !isAdmin(u) {
		writeError(w, http.StatusForbidden, "permission denied")
		return
	}
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, map[string]any{"items": s.store.ListUsers()})
	case http.MethodPost:
		var req struct {
			Username string      `json:"username"`
			Password string      `json:"password"`
			Role     common.Role `json:"role"`
		}
		if !decodeJSON(w, r, &req) {
			return
		}
		created, generatedPassword, err := s.store.CreateUser(req.Username, req.Password, req.Role, u, realIP(r))
		if err != nil {
			writeStoreError(w, err)
			return
		}
		resp := map[string]any{"item": created}
		if generatedPassword != "" {
			resp["temporary_password"] = generatedPassword
		}
		writeJSON(w, resp)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleUserByID(w http.ResponseWriter, r *http.Request, u common.User) {
	if !isAdmin(u) {
		writeError(w, http.StatusForbidden, "permission denied")
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/users/")
	if path == "" {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}
	if strings.HasSuffix(path, "/reset-password") {
		id := strings.TrimSuffix(path, "/reset-password")
		if id == "" || r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		var req struct {
			Password string `json:"password"`
		}
		if !decodeJSON(w, r, &req) {
			return
		}
		updated, generatedPassword, err := s.store.ResetUserPassword(id, req.Password, u, realIP(r))
		if err != nil {
			writeStoreError(w, err)
			return
		}
		resp := map[string]any{"item": updated}
		if generatedPassword != "" {
			resp["temporary_password"] = generatedPassword
		}
		writeJSON(w, resp)
		return
	}
	if r.Method != http.MethodPut {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req struct {
		Role     common.Role `json:"role"`
		Disabled bool        `json:"disabled"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	updated, err := s.store.UpdateUser(path, req.Role, req.Disabled, u, realIP(r))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, map[string]any{"item": updated})
}

func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request, u common.User) {
	if !isAdmin(u) {
		writeError(w, http.StatusForbidden, "permission denied")
		return
	}
	writeJSON(w, map[string]any{"items": s.store.Events(100)})
}

func (s *Server) handleAgentRegister(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req common.AgentRegisterRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	resp, err := s.store.RegisterNode(req, realIP(r))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, resp)
}

func (s *Server) handleAgentHeartbeat(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 2<<20))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	nodeID := r.Header.Get("X-Node-ID")
	tsRaw := r.Header.Get("X-Timestamp")
	nonce := r.Header.Get("X-Nonce")
	sig := r.Header.Get("X-Signature")
	secret, ok := s.store.NodeSecret(nodeID)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unknown node")
		return
	}
	tsUnix, err := strconv.ParseInt(tsRaw, 10, 64)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid timestamp")
		return
	}
	ts := time.Unix(tsUnix, 0)
	if !common.VerifyHMACSHA256Hex(secret, common.SignedBody(tsRaw, nonce, body), sig) {
		writeError(w, http.StatusUnauthorized, "invalid signature")
		return
	}
	if !s.store.AcceptNonce(nodeID, nonce, ts) {
		writeError(w, http.StatusUnauthorized, "replayed or expired request")
		return
	}
	var req common.AgentHeartbeatRequest
	if err := json.Unmarshal(body, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.NodeID != nodeID {
		writeError(w, http.StatusUnauthorized, "node id mismatch")
		return
	}
	version, err := s.store.UpdateHeartbeat(req, realIP(r))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	resp := common.AgentHeartbeatResponse{ServerTime: time.Now(), RuleVersion: version}
	if req.RuleVersion != version {
		resp.Rules = s.store.RulesForNode(nodeID)
		resp.Message = "rules updated"
	}
	writeJSON(w, resp)
}

func (s *Server) requireAuth(next authHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(sessionCookie)
		if err != nil || c.Value == "" {
			writeError(w, http.StatusUnauthorized, "登录已失效")
			return
		}
		u, ok := s.store.UserBySession(c.Value)
		if !ok {
			writeError(w, http.StatusUnauthorized, "登录已失效")
			return
		}
		next(w, r, u)
	}
}

func (s *Server) webHandler() http.Handler {
	dir := s.webDir
	if dir == "" {
		dir = "web"
	}
	fs := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := filepath.Join(dir, filepath.Clean(r.URL.Path))
		if st, err := os.Stat(path); err == nil && !st.IsDir() {
			fs.ServeHTTP(w, r)
			return
		}
		http.ServeFile(w, r, filepath.Join(dir, "index.html"))
	})
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isStateChangingMethod(r.Method) && !originAllowed(r) {
			writeError(w, http.StatusForbidden, "来源校验失败")
			return
		}
		w.Header().Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		next.ServeHTTP(w, r)
	})
}

func (s *Server) requestLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		if !strings.HasPrefix(r.URL.Path, "/assets/") {
			log.Printf("%s %s %s %s", realIP(r), r.Method, r.URL.Path, time.Since(start).Round(time.Millisecond))
		}
	})
}

func (l *loginLimiter) allowed(ip, username string) (time.Time, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	a := l.attempts[ip+"|"+strings.ToLower(username)]
	if !a.LockedUntil.IsZero() && time.Now().Before(a.LockedUntil) {
		return a.LockedUntil, false
	}
	return time.Time{}, true
}

func (l *loginLimiter) fail(ip, username string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	key := ip + "|" + strings.ToLower(username)
	a := l.attempts[key]
	a.Count++
	if a.Count >= 4 {
		delay := time.Duration(1<<(min(a.Count-4, 5))) * 30 * time.Second
		a.LockedUntil = time.Now().Add(delay)
	}
	l.attempts[key] = a
}

func (l *loginLimiter) success(ip, username string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.attempts, ip+"|"+strings.ToLower(username))
}

func decodeJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	defer r.Body.Close()
	if err := json.NewDecoder(io.LimitReader(r.Body, 2<<20)).Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(common.APIError{Error: msg})
}

func writeStoreError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrUnauthorized):
		writeError(w, http.StatusUnauthorized, "unauthorized")
	case errors.Is(err, ErrNotFound):
		writeError(w, http.StatusNotFound, "not found")
	case errors.Is(err, ErrBadRequest):
		writeError(w, http.StatusBadRequest, err.Error())
	default:
		writeError(w, http.StatusInternalServerError, err.Error())
	}
}

func isAdmin(u common.User) bool {
	return u.Role == common.RoleAdmin || u.Role == common.RoleSuperAdmin
}

func isSuperAdmin(u common.User) bool {
	return u.Role == common.RoleSuperAdmin
}

func rulesOwnedBy(rules []common.ForwardRule, userID string) []common.ForwardRule {
	out := make([]common.ForwardRule, 0, len(rules))
	for _, rule := range rules {
		if rule.UserID == userID {
			out = append(out, rule)
		}
	}
	return out
}

func ruleIDSet(rules []common.ForwardRule) map[string]struct{} {
	out := make(map[string]struct{}, len(rules))
	for _, rule := range rules {
		out[rule.ID] = struct{}{}
	}
	return out
}

func countersForRules(counters []common.RuleCounter, ids map[string]struct{}) []common.RuleCounter {
	if ids == nil {
		return counters
	}
	out := make([]common.RuleCounter, 0, len(counters))
	for _, counter := range counters {
		if _, ok := ids[counter.RuleID]; ok {
			out = append(out, counter)
		}
	}
	return out
}

func reportsForRules(reports []common.RuleApplyReport, ids map[string]struct{}) []common.RuleApplyReport {
	if ids == nil {
		return reports
	}
	out := make([]common.RuleApplyReport, 0, len(reports))
	for _, report := range reports {
		if _, ok := ids[report.RuleID]; ok {
			out = append(out, report)
		}
	}
	return out
}

func realIP(r *http.Request) string {
	if v := strings.TrimSpace(r.Header.Get("X-Real-IP")); v != "" {
		return v
	}
	if v := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); v != "" {
		return strings.TrimSpace(strings.Split(v, ",")[0])
	}
	return clientIPFromRemote(r.RemoteAddr)
}

func requestBaseURL(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}

func isStateChangingMethod(method string) bool {
	return method == http.MethodPost || method == http.MethodPut || method == http.MethodPatch || method == http.MethodDelete
}

func originAllowed(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	return origin == requestBaseURL(r)
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
