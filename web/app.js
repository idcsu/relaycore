const state = {
  user: null,
  version: "",
  page: "dashboard",
  dashboard: {},
  nodes: [],
  rules: [],
  counters: [],
  reports: [],
  diagnostics: null,
  tokens: [],
  users: [],
  events: [],
  totpSetup: null,
  selectedRuleID: null,
  selectedNodeID: null,
  userResult: null
};

const pages = [
  ["dashboard", "仪表盘", "◇", "节点健康、规则状态和风险提示"],
  ["nodes", "节点", "N", "节点资源、转发模式和在线状态"],
  ["rules", "规则", "R", "端口、目标、协议和规则下发版本"],
  ["diagnostics", "诊断", "D", "定位节点、规则和转发路径的异常原因"],
  ["tokens", "接入", "T", "生成一次性 Agent Token"],
  ["users", "用户", "U", "账号、角色、禁用状态和规则归属"],
  ["security", "安全", "S", "两步验证和账号保护"],
  ["events", "审计", "E", "关键操作和系统事件"]
];

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(path, { credentials: "same-origin", ...options, headers });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data.error || `请求失败 ${res.status}`);
  return data;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}

function fmtBytes(v) {
  v = Number(v || 0);
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i ? 1 : 0)} ${units[i]}`;
}

function pct(part, total) {
  if (!total) return "0%";
  return `${Math.round(Number(part || 0) / Number(total) * 100)}%`;
}

function badge(text, tone = "info") {
  return `<span class="badge ${tone}">${esc(text)}</span>`;
}

function isAdminRole(role) {
  return role === "admin" || role === "super_admin";
}

function userName(id) {
  if (!id) return "-";
  const user = state.users.find(u => u.id === id);
  return user ? user.username : id;
}

function cssEscape(value) {
  if (window.CSS?.escape) return CSS.escape(value);
  return String(value).replace(/["\\]/g, "\\$&");
}

function toast(message, tone = "") {
  const el = document.createElement("div");
  el.className = `toast ${tone}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3600);
}

async function boot() {
  try {
    const me = await api("/api/me");
    state.user = me.user;
    state.version = me.version || "";
    await refreshAll();
    renderApp();
  } catch {
    renderLogin();
  }
}

function renderLogin() {
  document.getElementById("app").innerHTML = `
    <main class="login-shell">
      <section class="login-card">
        <div class="login-brand">
          <div>
            <div class="brand-mark">RC</div>
            <h1>RelayCore</h1>
            <p>内核级端口转发控制台</p>
          </div>
          <p>面向低配节点的转发管理、健康诊断和安全接入。</p>
        </div>
        <form class="login-form" id="loginForm">
          <div>
            <h2>登录</h2>
          </div>
          <label class="field">用户名
            <input class="input" name="username" autocomplete="username" required />
          </label>
          <label class="field">密码
            <input class="input" type="password" name="password" autocomplete="current-password" required />
          </label>
          <label class="field">两步验证码
            <input class="input" name="totp_code" inputmode="numeric" autocomplete="one-time-code" placeholder="未启用可留空" />
          </label>
          <button class="btn primary" type="submit">进入控制台</button>
        </form>
      </section>
    </main>
  `;
  document.getElementById("loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    const body = JSON.stringify(Object.fromEntries(new FormData(e.currentTarget)));
    try {
      const data = await api("/api/auth/login", { method: "POST", body });
      state.user = data.user;
      state.version = data.version || "";
      await refreshAll();
      renderApp();
    } catch (err) {
      toast(err.message, "danger");
    }
  });
}

async function refreshAll() {
  const [dashboard, nodes, rules] = await Promise.all([
    api("/api/dashboard"),
    api("/api/nodes"),
    api("/api/rules")
  ]);
  state.dashboard = dashboard;
  state.nodes = nodes.items || [];
  state.rules = rules.items || [];
  state.counters = rules.counters || [];
  state.reports = rules.reports || [];
  if (state.page === "diagnostics") {
    state.diagnostics = await api("/api/diagnostics");
  }
  if (state.page === "tokens") {
    state.tokens = (await api("/api/node-tokens")).items || [];
  }
  if (isAdminRole(state.user?.role) && (state.page === "users" || state.page === "rules")) {
    state.users = (await api("/api/users")).items || [];
  }
  if (state.page === "events") {
    state.events = (await api("/api/events")).items || [];
  }
}

function renderApp() {
  const navPages = visiblePages();
  const page = navPages.find(p => p[0] === state.page) || navPages[0];
  document.getElementById("app").innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="sidebar-title">
          <div class="brand-mark">RC</div>
          <div><strong>RelayCore</strong><span>v${esc(state.version)}</span></div>
        </div>
        <nav class="nav">
          ${navPages.map(p => `<button data-page="${p[0]}" class="${state.page === p[0] ? "active" : ""}"><span>${p[2]}</span>${p[1]}</button>`).join("")}
        </nav>
        <div class="sidebar-foot">
          <strong>${esc(state.user?.username)}</strong>
          <div>${esc(state.user?.role)}</div>
          <button class="btn ghost" id="logoutBtn">退出登录</button>
        </div>
      </aside>
      <main class="main">
        <header class="topbar">
          <div><h1>${page[1]}</h1><p>${page[3]}</p></div>
          <div class="toolbar">
            <button class="btn" id="refreshBtn">刷新</button>
            ${state.page === "rules" ? `<button class="btn primary" id="showRuleForm">新增规则</button>` : ""}
            ${state.page === "tokens" ? `<button class="btn primary" id="showTokenForm">生成 Token</button>` : ""}
            ${state.page === "users" ? `<button class="btn primary" id="showUserForm">新增用户</button>` : ""}
          </div>
        </header>
        <section class="content">${renderPage()}</section>
      </main>
    </div>
  `;
  document.querySelectorAll("[data-page]").forEach(btn => btn.addEventListener("click", async () => {
    state.page = btn.dataset.page;
    try {
      await refreshAll();
      renderApp();
    } catch (err) { toast(err.message, "danger"); }
  }));
  document.getElementById("refreshBtn").addEventListener("click", async () => {
    try { await refreshAll(); renderApp(); toast("已刷新"); } catch (err) { toast(err.message, "danger"); }
  });
  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    renderLogin();
  });
  bindPageEvents();
}

function renderPage() {
  if (state.page === "dashboard") return renderDashboard();
  if (state.page === "nodes") return renderNodes();
  if (state.page === "rules") return renderRules();
  if (state.page === "diagnostics") return renderDiagnostics();
  if (state.page === "tokens") return renderTokens();
  if (state.page === "users") return renderUsers();
  if (state.page === "security") return renderSecurity();
  if (state.page === "events") return renderEvents();
  return "";
}

function visiblePages() {
  return pages.filter(p => {
    if (p[0] === "users" || p[0] === "tokens" || p[0] === "events") {
      return isAdminRole(state.user?.role);
    }
    return true;
  });
}

function renderDashboard() {
  const d = state.dashboard || {};
  const findings = d.findings || [];
  return `
    <div class="grid cols-4">
      ${metric("节点在线", `${d.online_nodes || 0}/${d.nodes || 0}`, "90 秒内心跳视为在线")}
      ${metric("启用规则", `${d.enabled_rules || 0}/${d.rules || 0}`, `版本 ${d.rule_version || 0}`)}
      ${metric("风险提示", findings.length, "来自节点指标和诊断")}
      ${metric("转发模式", "nftables", "默认走 Linux 内核路径")}
    </div>
    <div class="section-head"><h2>诊断提示</h2></div>
    ${findings.length ? `<div class="finding-list">${findings.map(renderFinding).join("")}</div>` : `<div class="panel empty">暂无风险提示</div>`}
    <div class="section-head"><h2>节点概览</h2></div>
    ${nodeTable(state.nodes)}
  `;
}

function renderNodes() {
  return nodeTable(state.nodes);
}

function nodeTable(nodes) {
  if (!nodes.length) return `<div class="panel empty">暂无节点</div>`;
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>节点</th><th>状态</th><th>资源</th><th>conntrack</th><th>转发</th><th>公网 IP</th><th>操作</th></tr></thead>
        <tbody>${nodes.map(n => `
          <tr>
            <td><strong>${esc(n.name)}</strong><div class="mono">${esc(n.hostname || n.id)}</div></td>
            <td>${badge(n.status === "online" ? "online" : "offline", n.status === "online" ? "ok" : "danger")}</td>
            <td>负载 ${Number(n.last_metrics?.load1 || 0).toFixed(2)}<br>${fmtBytes(n.last_metrics?.memory_used)} / ${fmtBytes(n.last_metrics?.memory_total)}</td>
            <td>${esc(n.last_metrics?.conntrack_count || 0)} / ${esc(n.last_metrics?.conntrack_max || 0)}<br>${pct(n.last_metrics?.conntrack_count, n.last_metrics?.conntrack_max)}</td>
            <td>${badge(n.forwarding_mode || "nftables", "info")} ${firewallBadge(n.firewall_mode)} ${badge(`${n.last_metrics?.forwarding_rule_count || 0} 条`, "ok")}</td>
            <td class="mono">${esc(n.public_ip || "-")}</td>
            <td><button class="btn" data-open-node="${esc(n.id)}">详情</button></td>
          </tr>
        `).join("")}</tbody>
      </table>
    </div>
    ${renderNodeDrawer()}
  `;
}

function renderRules() {
  return `
    <div id="ruleFormHost" class="hidden">${ruleForm()}</div>
    ${state.rules.length ? `
      <div class="table-wrap">
        <table>
          <thead><tr><th>规则</th><th>协议</th><th>监听</th><th>目标</th><th>节点</th><th>归属</th><th>计数</th><th>应用</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>${state.rules.map(r => {
            const node = state.nodes.find(n => n.id === r.node_id);
            const total = counterTotal(r.id);
            const report = reportOf(r.id);
            return `<tr>
              <td><strong>${esc(r.name)}</strong><div>${esc(r.description || "")}</div></td>
              <td>${badge(r.protocol, "info")}</td>
              <td class="mono">:${esc(r.listen_port)}</td>
              <td class="mono">${esc(r.target_host)}:${esc(r.target_port)}</td>
              <td>${esc(node?.name || r.node_id)}</td>
              <td>${esc(userName(r.user_id))}</td>
              <td>${fmtBytes(total.bytes)}<br><span class="muted">${esc(total.packets)} packets</span></td>
              <td>${applyBadge(r.last_apply_state || report.state)}<br><span class="muted">${esc(r.last_error || report.message || "")}</span></td>
              <td>${badge(r.enabled ? "enabled" : "disabled", r.enabled ? "ok" : "warn")}</td>
              <td><div class="row-actions"><button class="btn" data-open-rule="${esc(r.id)}">详情</button><button class="btn danger" data-delete-rule="${esc(r.id)}">删除</button></div></td>
            </tr>`;
          }).join("")}</tbody>
        </table>
      </div>
    ` : `<div class="panel empty">暂无转发规则</div>`}
    ${renderRuleDrawer()}
  `;
}

function renderDiagnostics() {
  const d = state.diagnostics || { findings: [], nodes: [], rules: [] };
  return `
    <div class="grid cols-3">
      ${metric("全局风险", d.findings?.length || 0, "按严重程度排序")}
      ${metric("节点报告", d.nodes?.length || 0, "健康分和瓶颈归因")}
      ${metric("规则报告", d.rules?.length || 0, "counter 和规则风险")}
    </div>
    <div class="section-head"><h2>关键结论</h2></div>
    ${d.findings?.length ? `<div class="finding-list">${d.findings.map(renderFinding).join("")}</div>` : `<div class="panel empty">暂无诊断风险</div>`}
    <div class="section-head"><h2>节点健康</h2></div>
    ${d.nodes?.length ? `<div class="grid cols-3">${d.nodes.map(renderNodeDiagnosis).join("")}</div>` : `<div class="panel empty">暂无节点诊断</div>`}
    <div class="section-head"><h2>规则诊断</h2></div>
    ${d.rules?.length ? renderRuleDiagnosisTable(d.rules) : `<div class="panel empty">暂无规则诊断</div>`}
  `;
}

function renderNodeDiagnosis(n) {
  const tone = n.health >= 90 ? "ok" : n.health >= 65 ? "warn" : "danger";
  const trend = n.trend || {};
  return `
    <div class="panel pad diag-card">
      <div class="diag-head">
        <div><strong>${esc(n.node_name)}</strong><span>${esc(n.status)}</span></div>
        ${badge(n.health, tone)}
      </div>
      <div class="healthbar"><i style="width:${Math.max(0, Math.min(100, Number(n.health || 0)))}%"></i></div>
      <p>${esc(n.summary)}</p>
      <div class="diag-mini">
        <span>负载 ${Number(n.metrics?.load1 || 0).toFixed(2)}</span>
        <span>内存 ${pct(n.metrics?.memory_used, n.metrics?.memory_total)}</span>
        <span>CT ${pct(n.metrics?.conntrack_count, n.metrics?.conntrack_max)}</span>
        <span>CT Δ ${fmtSigned(trend.conntrack_delta)}</span>
        <span>TCP 重传 ${formatRatio(trend.tcp_retrans_ratio)}</span>
      </div>
      ${n.ruleset ? `<details class="ruleset-details"><summary>nftables ruleset</summary><pre class="codebox">${esc(n.ruleset)}</pre></details>` : ""}
    </div>
  `;
}

function renderRuleDiagnosisTable(rules) {
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>规则</th><th>节点</th><th>监听</th><th>目标</th><th>应用</th><th>counter</th><th>探测</th><th>可能原因</th></tr></thead>
        <tbody>${rules.map(r => {
          const total = (r.counters || []).reduce((acc, c) => ({ packets: acc.packets + Number(c.packets || 0), bytes: acc.bytes + Number(c.bytes || 0) }), { packets: 0, bytes: 0 });
          return `<tr>
            <td><strong>${esc(r.rule_name)}</strong><div>${badge(r.protocol, "info")} ${r.enabled ? badge("enabled", "ok") : badge("disabled", "warn")}</div></td>
            <td>${esc(r.node_name || r.node_id)}</td>
            <td class="mono">:${esc(r.listen)}</td>
            <td class="mono">${esc(r.target)}${r.target_ip ? `<br><span class="muted">${esc(r.target_ip)}</span>` : ""}</td>
            <td>${applyBadge(r.apply_state)}<br><span class="muted">${esc(r.apply_message || "")}</span></td>
            <td>${fmtBytes(total.bytes)}<br><span class="muted">${esc(total.packets)} packets</span><br>${renderCounterRates(r.counter_rates || [])}</td>
            <td>${renderProbes(r.probes || [])}</td>
            <td><span class="muted">${esc(r.likely_cause || "暂无结论")}</span></td>
          </tr>`;
        }).join("")}</tbody>
      </table>
    </div>
  `;
}

function renderRuleDrawer() {
  if (!state.selectedRuleID) return "";
  const rule = state.rules.find(r => r.id === state.selectedRuleID);
  if (!rule) return "";
  const node = state.nodes.find(n => n.id === rule.node_id) || {};
  const report = reportOf(rule.id);
  const diag = ruleDiagnosisOf(rule.id);
  const counters = state.counters.filter(c => c.rule_id === rule.id);
  const total = counterTotal(rule.id);
  const probes = diag?.probes?.length ? diag.probes : (report.probes || []);
  const findings = diag?.findings || [];
  const rates = diag?.counter_rates || [];
  const targetHistory = diag?.target_history || [];
  const ruleset = node.last_ruleset || (state.diagnostics?.nodes || []).find(n => n.node_id === rule.node_id)?.ruleset || "";
  const fragment = rulesetFragment(ruleset, rule, report);
  const recommendations = ruleRecommendations(rule, node, report, findings, total, probes);
  return `
    <div class="drawer-backdrop">
      <aside class="drawer" aria-label="规则详情">
        <header class="drawer-head">
          <div>
            <h2>${esc(rule.name)}</h2>
            <p class="mono">:${esc(rule.listen_port)} -> ${esc(rule.target_host)}:${esc(rule.target_port)}</p>
          </div>
          <button class="btn" data-close-rule>关闭</button>
        </header>
        <div class="drawer-body">
          <div class="detail-grid">
            <div><span>节点</span><strong>${esc(node.name || rule.node_id)}</strong></div>
            <div><span>协议</span><strong>${esc(rule.protocol)}</strong></div>
            <div><span>应用状态</span><strong>${applyBadge(rule.last_apply_state || report.state)}</strong></div>
            <div><span>防火墙</span><strong>${firewallBadge(node.firewall_mode)}</strong></div>
          </div>

          <section class="drawer-section">
            <h3>应用报告</h3>
            <div class="codebox">${esc(report.message || rule.last_error || "暂无 apply 报告")}
${report.target_ip ? `target_ip=${esc(report.target_ip)}` : ""}
${report.counters?.length ? `counters=${esc(report.counters.join(", "))}` : ""}</div>
          </section>

          <section class="drawer-section">
            <h3>Counter</h3>
            ${counters.length ? `<div class="mini-table">${counters.map(c => `<div><span>${esc(c.protocol)}</span><strong>${fmtBytes(c.bytes)}</strong><em>${esc(c.packets)} packets</em></div>`).join("")}</div>` : `<p class="muted">暂无 counter 数据</p>`}
            <p class="muted">合计 ${fmtBytes(total.bytes)} / ${esc(total.packets)} packets</p>
            ${rates.length ? `<div class="mini-table">${rates.map(rate => `<div><span>${esc(rate.protocol)} rate</span><strong>${formatBytesPerSecond(rate.bytes_per_second)}</strong><em>${formatPacketsPerSecond(rate.packets_per_second)} / ${esc(rate.window_seconds)}s / Δ ${fmtBytes(rate.bytes_delta)}</em></div>`).join("")}</div>` : `<p class="muted">暂无 counter rate，需要至少两次心跳样本</p>`}
          </section>

          <section class="drawer-section">
            <h3>目标探测</h3>
            ${probes.length ? `<div class="probe-list">${probes.map(p => `<div>${badge(`${p.protocol} ${p.ok ? "ok" : "fail"}`, p.ok ? "ok" : "warn")} <span class="mono">${esc(p.target_host)}:${esc(p.target_port)}</span><small>${esc(p.latency_ms || 0)} ms ${esc(p.error || "")}</small></div>`).join("")}</div>` : `<p class="muted">暂无探测数据</p>`}
          </section>

          <section class="drawer-section">
            <h3>解析历史</h3>
            ${targetHistory.length ? `<div class="probe-list">${targetHistory.slice(-6).reverse().map(item => `<div><span class="mono">${esc(item.target_host)}</span><strong>${esc(item.target_ip)}</strong><small>${esc(formatTime(item.resolved_at))}</small></div>`).join("")}</div>` : `<p class="muted">暂无 DNS/IP 变化记录</p>`}
          </section>

          <section class="drawer-section">
            <h3>可能原因</h3>
            <div class="finding info"><strong>${esc(diag?.likely_cause || "暂无结论")}</strong><p>基于 apply 状态、counter、探测、DNS 历史和节点趋势生成。</p></div>
          </section>

          <section class="drawer-section">
            <h3>建议动作</h3>
            <div class="finding-list">${recommendations.map(item => `<div class="finding ${esc(item.tone)}"><strong>${esc(item.title)}</strong><p>${esc(item.detail)}</p></div>`).join("")}</div>
          </section>

          <section class="drawer-section">
            <h3>Ruleset 片段</h3>
            ${fragment ? `<pre class="codebox">${esc(fragment)}</pre>` : `<p class="muted">暂无匹配片段</p>`}
          </section>
        </div>
      </aside>
    </div>
  `;
}

function renderNodeDrawer() {
  if (!state.selectedNodeID) return "";
  const node = state.nodes.find(n => n.id === state.selectedNodeID);
  if (!node) return "";
  const diag = nodeDiagnosisOf(node.id);
  const metrics = node.last_metrics || {};
  const trend = diag?.trend || {};
  const assigned = state.rules.filter(r => r.node_id === node.id);
  const ruleset = node.last_ruleset || diag?.ruleset || "";
  const findings = nodeFindings(node, diag, assigned);
  return `
    <div class="drawer-backdrop">
      <aside class="drawer" aria-label="节点详情">
        <header class="drawer-head">
          <div>
            <h2>${esc(node.name)}</h2>
            <p class="mono">${esc(node.hostname || node.id)} ${node.public_ip ? ` / ${esc(node.public_ip)}` : ""}</p>
          </div>
          <button class="btn" data-close-node>关闭</button>
        </header>
        <div class="drawer-body">
          <div class="detail-grid">
            <div><span>状态</span><strong>${badge(node.status === "online" ? "online" : "offline", node.status === "online" ? "ok" : "danger")}</strong></div>
            <div><span>健康</span><strong>${esc(diag?.health ?? "-")}</strong></div>
            <div><span>转发</span><strong>${badge(node.forwarding_mode || "nftables", "info")}</strong></div>
            <div><span>防火墙</span><strong>${firewallBadge(node.firewall_mode)}</strong></div>
          </div>

          <section class="drawer-section">
            <h3>资源</h3>
            <div class="metric-strip">
              <div><span>Load 1m</span><strong>${Number(metrics.load1 || 0).toFixed(2)}</strong></div>
              <div><span>内存</span><strong>${pct(metrics.memory_used, metrics.memory_total)}</strong><em>${fmtBytes(metrics.memory_used)} / ${fmtBytes(metrics.memory_total)}</em></div>
              <div><span>磁盘</span><strong>${pct(metrics.disk_used, metrics.disk_total)}</strong><em>${fmtBytes(metrics.disk_used)} / ${fmtBytes(metrics.disk_total)}</em></div>
              <div><span>运行</span><strong>${fmtDuration(metrics.uptime)}</strong></div>
            </div>
          </section>

          <section class="drawer-section">
            <h3>conntrack / TCP</h3>
            <div class="metric-strip">
              <div><span>conntrack</span><strong>${pct(metrics.conntrack_count, metrics.conntrack_max)}</strong><em>${esc(metrics.conntrack_count || 0)} / ${esc(metrics.conntrack_max || 0)} / Δ ${fmtSigned(trend.conntrack_delta)}</em></div>
              <div><span>TCP retrans</span><strong>${tcpRetransRatio(metrics)}</strong><em>近期 ${formatRatio(trend.tcp_retrans_ratio)} / Δ ${esc(trend.tcp_retrans_delta || 0)}</em></div>
              <div><span>入站</span><strong>${fmtBytes(metrics.net_in)}</strong><em>${formatBytesPerSecond(trend.net_in_bytes_per_sec)}</em></div>
              <div><span>出站</span><strong>${fmtBytes(metrics.net_out)}</strong><em>${formatBytesPerSecond(trend.net_out_bytes_per_sec)}</em></div>
            </div>
            <p class="muted">趋势窗口 ${esc(trend.window_seconds || 0)} 秒，样本 ${esc(trend.sample_count || 0)} 个。</p>
          </section>

          <section class="drawer-section">
            <h3>最近错误</h3>
            ${findings.length ? `<div class="finding-list">${findings.map(renderFinding).join("")}</div>` : `<p class="muted">暂无错误或风险提示</p>`}
          </section>

          <section class="drawer-section">
            <h3>关联规则</h3>
            ${assigned.length ? `<div class="mini-table rule-mini-table">${assigned.map(r => {
              const total = counterTotal(r.id);
              const report = reportOf(r.id);
              return `<div><span>${esc(r.protocol)} :${esc(r.listen_port)}</span><strong>${esc(r.name)}</strong><em>${esc(r.target_host)}:${esc(r.target_port)} / ${fmtBytes(total.bytes)} / ${esc(report.state || r.last_apply_state || "pending")}</em></div>`;
            }).join("")}</div>` : `<p class="muted">暂无关联规则</p>`}
          </section>

          <section class="drawer-section">
            <h3>私网地址</h3>
            ${node.private_ips?.length ? `<div class="chip-list">${node.private_ips.map(ip => `<span class="mono">${esc(ip)}</span>`).join("")}</div>` : `<p class="muted">暂无私网地址</p>`}
          </section>

          <section class="drawer-section">
            <h3>Ruleset 预览</h3>
            ${ruleset ? `<pre class="codebox">${esc(ruleset)}</pre>` : `<p class="muted">暂无 ruleset 预览</p>`}
          </section>
        </div>
      </aside>
    </div>
  `;
}

function ruleForm() {
  return `
    <form class="panel pad grid" id="ruleForm">
      <div class="form-grid">
        <label class="field">规则名称<input class="input" name="name" required /></label>
        <label class="field">节点<select class="select" name="node_id" required>
          <option value="">选择节点</option>
          ${state.nodes.map(n => `<option value="${esc(n.id)}">${esc(n.name)}</option>`).join("")}
        </select></label>
        ${isAdminRole(state.user?.role) ? `<label class="field">归属用户<select class="select" name="user_id">
          <option value="">当前用户</option>
          ${state.users.map(u => `<option value="${esc(u.id)}">${esc(u.username)} / ${esc(u.role)}</option>`).join("")}
        </select></label>` : ""}
        <label class="field">协议<select class="select" name="protocol"><option value="tcp">TCP</option><option value="udp">UDP</option><option value="both">TCP + UDP</option></select></label>
        <label class="field">监听端口<input class="input" name="listen_port" type="number" min="1" max="65535" required /></label>
        <label class="field">目标地址<input class="input" name="target_host" required /></label>
        <label class="field">目标端口<input class="input" name="target_port" type="number" min="1" max="65535" required /></label>
        <label class="field wide">源 CIDR 白名单<textarea class="textarea" name="source_cidrs" placeholder="一行一个，留空表示全部允许"></textarea></label>
        <label class="field wide">备注<textarea class="textarea" name="description"></textarea></label>
      </div>
      <div class="toolbar"><button class="btn primary" type="submit">保存规则</button><button class="btn" type="button" id="hideRuleForm">取消</button></div>
    </form>
  `;
}

function renderTokens() {
  return `
    <div id="tokenResult"></div>
    <div id="tokenFormHost" class="hidden">
      <form class="panel pad grid" id="tokenForm">
        <div class="form-grid">
          <label class="field">节点名称<input class="input" name="name" required /></label>
          <label class="field">有效小时<input class="input" name="hours" type="number" min="1" max="720" value="24" /></label>
        </div>
        <div class="toolbar"><button class="btn primary" type="submit">生成</button><button class="btn" type="button" id="hideTokenForm">取消</button></div>
      </form>
    </div>
    ${state.tokens.length ? `
      <div class="table-wrap">
        <table>
          <thead><tr><th>名称</th><th>使用</th><th>过期时间</th><th>节点</th></tr></thead>
          <tbody>${state.tokens.map(t => `<tr><td>${esc(t.name)}</td><td>${esc(t.used_count)} / ${esc(t.max_uses)}</td><td>${esc(t.expires_at)}</td><td class="mono">${esc(t.used_by_node || "-")}</td></tr>`).join("")}</tbody>
        </table>
      </div>
    ` : `<div class="panel empty">暂无接入 Token</div>`}
  `;
}

function renderUsers() {
  return `
    ${state.userResult ? `<div class="panel pad user-result"><strong>${esc(state.userResult.title)}</strong><div class="codebox">${esc(state.userResult.detail)}</div></div>` : ""}
    <div id="userFormHost" class="hidden">
      <form class="panel pad grid" id="userForm">
        <div class="form-grid">
          <label class="field">用户名<input class="input" name="username" required /></label>
          <label class="field">角色<select class="select" name="role">
            <option value="user">user</option>
            <option value="admin">admin</option>
            ${state.user?.role === "super_admin" ? `<option value="super_admin">super_admin</option>` : ""}
          </select></label>
          <label class="field wide">初始密码<input class="input" name="password" type="password" autocomplete="new-password" placeholder="留空自动生成" /></label>
        </div>
        <div class="toolbar"><button class="btn primary" type="submit">创建用户</button><button class="btn" type="button" id="hideUserForm">取消</button></div>
      </form>
    </div>
    ${state.users.length ? `
      <div class="table-wrap">
        <table>
          <thead><tr><th>用户</th><th>角色</th><th>状态</th><th>两步验证</th><th>创建时间</th><th>操作</th></tr></thead>
          <tbody>${state.users.map(u => `<tr>
            <td><strong>${esc(u.username)}</strong><div class="mono">${esc(u.id)}</div></td>
            <td><select class="select compact" data-user-role="${esc(u.id)}" ${u.id === state.user?.id ? "disabled" : ""}>
              ${["user", "admin", "super_admin"].filter(role => role !== "super_admin" || state.user?.role === "super_admin" || u.role === "super_admin").map(role => `<option value="${role}" ${u.role === role ? "selected" : ""}>${role}</option>`).join("")}
            </select></td>
            <td><label class="checkline"><input type="checkbox" data-user-disabled="${esc(u.id)}" ${u.disabled ? "checked" : ""} ${u.id === state.user?.id ? "disabled" : ""} /> 禁用</label></td>
            <td>${badge(u.totp_enabled ? "enabled" : "off", u.totp_enabled ? "ok" : "warn")}</td>
            <td>${esc(formatTime(u.created_at))}</td>
            <td><div class="row-actions"><button class="btn" data-save-user="${esc(u.id)}" ${u.id === state.user?.id ? "disabled" : ""}>保存</button><button class="btn danger" data-reset-user="${esc(u.id)}">重置密码</button></div></td>
          </tr>`).join("")}</tbody>
        </table>
      </div>
    ` : `<div class="panel empty">暂无用户</div>`}
  `;
}

function renderSecurity() {
  const enabled = !!state.user?.totp_enabled;
  return `
    <div class="grid cols-3">
      ${metric("两步验证", enabled ? "已启用" : "未启用", enabled ? "登录时需要动态验证码" : "建议启用以保护面板")}
      ${metric("会话 Cookie", "HttpOnly", "SameSite=Lax")}
      ${metric("Agent 通信", "HMAC", "timestamp + nonce 防重放")}
    </div>
    <div class="section-head"><h2>两步验证</h2></div>
    <div class="panel pad grid">
      ${enabled ? `
        <p class="muted">当前账号已启用两步验证。停用时需要输入登录密码和当前验证码。</p>
        <form id="totpDisableForm" class="form-grid">
          <label class="field">当前密码<input class="input" type="password" name="password" required /></label>
          <label class="field">验证码<input class="input" name="code" inputmode="numeric" required /></label>
          <div class="wide toolbar"><button class="btn danger" type="submit">停用两步验证</button></div>
        </form>
      ` : `
        <p class="muted">先输入当前密码生成密钥，用认证器 App 扫描 otpauth URI 或手动输入密钥，再填入 6 位验证码启用。</p>
        <form id="totpSetupForm" class="form-grid">
          <label class="field">当前密码<input class="input" type="password" name="password" required /></label>
          <div class="field"><span>&nbsp;</span><button class="btn primary" type="submit">生成密钥</button></div>
        </form>
        ${state.totpSetup ? `
          <div class="totp-setup">
            <div class="qr-card">${renderTOTPQR(state.totpSetup.uri)}</div>
            <div class="grid">
              <label class="field">密钥<input class="input mono" readonly value="${esc(state.totpSetup.secret)}" /></label>
              <div class="codebox">${esc(state.totpSetup.uri)}</div>
            </div>
            <form id="totpEnableForm" class="form-grid">
              <input type="hidden" name="secret" value="${esc(state.totpSetup.secret)}" />
              <label class="field">验证码<input class="input" name="code" inputmode="numeric" required /></label>
              <div class="field"><span>&nbsp;</span><button class="btn primary" type="submit">启用两步验证</button></div>
            </form>
          </div>
        ` : ""}
      `}
    </div>
  `;
}

function renderEvents() {
  if (!state.events.length) return `<div class="panel empty">暂无审计事件</div>`;
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>时间</th><th>动作</th><th>目标</th><th>来源</th><th>详情</th></tr></thead>
        <tbody>${state.events.map(e => `<tr><td>${esc(e.created_at)}</td><td>${esc(e.action)}</td><td>${esc(e.target)}</td><td>${esc(e.ip || "-")}</td><td>${esc(e.detail)}</td></tr>`).join("")}</tbody>
      </table>
    </div>
  `;
}

function metric(label, value, sub) {
  return `<div class="panel pad metric"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(sub)}</small></div>`;
}

function renderFinding(f) {
  return `<div class="finding ${esc(f.severity)}"><strong>${esc(f.title)}</strong><p>${esc(f.detail)}</p></div>`;
}

function applyBadge(state) {
  if (state === "applied") return badge("applied", "ok");
  if (state === "dry_run") return badge("dry-run", "info");
  if (state === "error") return badge("error", "danger");
  if (state === "skipped") return badge("skipped", "warn");
  return badge(state || "pending", "warn");
}

function firewallBadge(mode) {
  if (mode === "strict") return badge("strict", "warn");
  if (mode === "strict_pending") return badge("strict-pending", "warn");
  return badge(mode || "managed", "info");
}

function renderProbes(probes) {
  if (!probes.length) return `<span class="muted">-</span>`;
  return probes.map(p => `${badge(`${p.protocol} ${p.ok ? "ok" : "fail"}`, p.ok ? "ok" : "warn")}<br><span class="muted">${esc(p.latency_ms || 0)} ms</span>`).join("<br>");
}

function renderCounterRates(rates) {
  if (!rates.length) return `<span class="muted">rate 等待样本</span>`;
  return rates.map(rate => `<span class="muted">${esc(rate.protocol)} ${formatBytesPerSecond(rate.bytes_per_second)} / ${formatPacketsPerSecond(rate.packets_per_second)}</span>`).join("<br>");
}

function renderTOTPQR(uri) {
  try {
    if (typeof window !== "undefined" && window.RelayCoreQR) {
      return window.RelayCoreQR.renderSVG(uri, { scale: 5, border: 4 });
    }
  } catch {
    return `<div class="qr-fallback">二维码生成失败，请使用下方密钥手动录入。</div>`;
  }
  return `<div class="qr-fallback">二维码模块未加载，请使用下方密钥手动录入。</div>`;
}

function bindPageEvents() {
  const showRule = document.getElementById("showRuleForm");
  if (showRule) showRule.addEventListener("click", () => document.getElementById("ruleFormHost").classList.remove("hidden"));
  const hideRule = document.getElementById("hideRuleForm");
  if (hideRule) hideRule.addEventListener("click", () => document.getElementById("ruleFormHost").classList.add("hidden"));
  const ruleFormEl = document.getElementById("ruleForm");
  if (ruleFormEl) ruleFormEl.addEventListener("submit", submitRule);
  document.querySelectorAll("[data-open-node]").forEach(btn => btn.addEventListener("click", async () => {
    state.selectedNodeID = btn.dataset.openNode;
    try {
      state.diagnostics = await api("/api/diagnostics");
      renderApp();
    } catch (err) { toast(err.message, "danger"); }
  }));
  document.querySelectorAll("[data-close-node]").forEach(btn => btn.addEventListener("click", () => {
    state.selectedNodeID = null;
    renderApp();
  }));
  document.querySelectorAll("[data-open-rule]").forEach(btn => btn.addEventListener("click", async () => {
    state.selectedRuleID = btn.dataset.openRule;
    try {
      state.diagnostics = await api("/api/diagnostics");
      renderApp();
    } catch (err) { toast(err.message, "danger"); }
  }));
  document.querySelectorAll("[data-close-rule]").forEach(btn => btn.addEventListener("click", () => {
    state.selectedRuleID = null;
    renderApp();
  }));
  document.querySelectorAll("[data-delete-rule]").forEach(btn => btn.addEventListener("click", async () => {
    if (!confirm("确认删除该规则？")) return;
    try {
      await api(`/api/rules/${btn.dataset.deleteRule}`, { method: "DELETE" });
      await refreshAll();
      renderApp();
      toast("规则已删除");
    } catch (err) { toast(err.message, "danger"); }
  }));

  const showToken = document.getElementById("showTokenForm");
  if (showToken) showToken.addEventListener("click", () => document.getElementById("tokenFormHost").classList.remove("hidden"));
  const hideToken = document.getElementById("hideTokenForm");
  if (hideToken) hideToken.addEventListener("click", () => document.getElementById("tokenFormHost").classList.add("hidden"));
  const tokenFormEl = document.getElementById("tokenForm");
  if (tokenFormEl) tokenFormEl.addEventListener("submit", submitToken);
  const showUser = document.getElementById("showUserForm");
  if (showUser) showUser.addEventListener("click", () => document.getElementById("userFormHost").classList.remove("hidden"));
  const hideUser = document.getElementById("hideUserForm");
  if (hideUser) hideUser.addEventListener("click", () => document.getElementById("userFormHost").classList.add("hidden"));
  const userFormEl = document.getElementById("userForm");
  if (userFormEl) userFormEl.addEventListener("submit", submitUser);
  document.querySelectorAll("[data-save-user]").forEach(btn => btn.addEventListener("click", () => saveUser(btn.dataset.saveUser)));
  document.querySelectorAll("[data-reset-user]").forEach(btn => btn.addEventListener("click", () => resetUserPassword(btn.dataset.resetUser)));
  const totpSetup = document.getElementById("totpSetupForm");
  if (totpSetup) totpSetup.addEventListener("submit", submitTOTPSetup);
  const totpEnable = document.getElementById("totpEnableForm");
  if (totpEnable) totpEnable.addEventListener("submit", submitTOTPEnable);
  const totpDisable = document.getElementById("totpDisableForm");
  if (totpDisable) totpDisable.addEventListener("submit", submitTOTPDisable);
}

async function submitRule(e) {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.currentTarget));
  const body = {
    name: fd.name,
    node_id: fd.node_id,
    protocol: fd.protocol,
    listen_port: Number(fd.listen_port),
    target_host: fd.target_host,
    target_port: Number(fd.target_port),
    user_id: fd.user_id || "",
    source_cidrs: String(fd.source_cidrs || "").split(/\n|,/).map(s => s.trim()).filter(Boolean),
    description: fd.description || "",
    enabled: true
  };
  try {
    await api("/api/rules", { method: "POST", body: JSON.stringify(body) });
    await refreshAll();
    renderApp();
    toast("规则已保存");
  } catch (err) { toast(err.message, "danger"); }
}

async function submitToken(e) {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.currentTarget));
  try {
    const data = await api("/api/node-tokens", { method: "POST", body: JSON.stringify({ name: fd.name, hours: Number(fd.hours || 24) }) });
    await refreshAll();
    renderApp();
    document.getElementById("tokenResult").innerHTML = `<div class="panel pad"><strong>接入命令</strong><div class="codebox">${esc(data.install_command)}</div></div>`;
    toast("Token 已生成");
  } catch (err) { toast(err.message, "danger"); }
}

async function submitUser(e) {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.currentTarget));
  try {
    const data = await api("/api/users", { method: "POST", body: JSON.stringify({ username: fd.username, password: fd.password, role: fd.role }) });
    state.userResult = data.temporary_password ? { title: "临时密码", detail: `${data.item.username}\n${data.temporary_password}` } : { title: "用户已创建", detail: data.item.username };
    state.users = (await api("/api/users")).items || [];
    renderApp();
    toast("用户已创建");
  } catch (err) { toast(err.message, "danger"); }
}

async function saveUser(id) {
  const role = document.querySelector(`[data-user-role="${cssEscape(id)}"]`)?.value;
  const disabled = !!document.querySelector(`[data-user-disabled="${cssEscape(id)}"]`)?.checked;
  try {
    await api(`/api/users/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ role, disabled }) });
    state.users = (await api("/api/users")).items || [];
    state.userResult = null;
    renderApp();
    toast("用户已更新");
  } catch (err) { toast(err.message, "danger"); }
}

async function resetUserPassword(id) {
  if (!confirm("确认重置该用户密码？")) return;
  try {
    const data = await api(`/api/users/${encodeURIComponent(id)}/reset-password`, { method: "POST", body: JSON.stringify({}) });
    state.users = (await api("/api/users")).items || [];
    state.userResult = { title: "新临时密码", detail: `${data.item.username}\n${data.temporary_password || "已设置为指定密码"}` };
    renderApp();
    toast("密码已重置");
  } catch (err) { toast(err.message, "danger"); }
}

async function submitTOTPSetup(e) {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.currentTarget));
  try {
    state.totpSetup = await api("/api/account/totp/setup", { method: "POST", body: JSON.stringify({ password: fd.password }) });
    renderApp();
    toast("密钥已生成");
  } catch (err) { toast(err.message, "danger"); }
}

async function submitTOTPEnable(e) {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.currentTarget));
  try {
    const data = await api("/api/account/totp/enable", { method: "POST", body: JSON.stringify({ secret: fd.secret, code: fd.code }) });
    state.user = data.user;
    state.totpSetup = null;
    renderApp();
    toast("两步验证已启用");
  } catch (err) { toast(err.message, "danger"); }
}

async function submitTOTPDisable(e) {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.currentTarget));
  try {
    const data = await api("/api/account/totp/disable", { method: "POST", body: JSON.stringify({ password: fd.password, code: fd.code }) });
    state.user = data.user;
    renderApp();
    toast("两步验证已停用");
  } catch (err) { toast(err.message, "danger"); }
}

function counterTotal(ruleID) {
  return state.counters.filter(c => c.rule_id === ruleID).reduce((acc, c) => {
    acc.packets += Number(c.packets || 0);
    acc.bytes += Number(c.bytes || 0);
    return acc;
  }, { packets: 0, bytes: 0 });
}

function reportOf(ruleID) {
  return state.reports.find(r => r.rule_id === ruleID) || {};
}

function ruleDiagnosisOf(ruleID) {
  return (state.diagnostics?.rules || []).find(r => r.rule_id === ruleID) || null;
}

function nodeDiagnosisOf(nodeID) {
  return (state.diagnostics?.nodes || []).find(n => n.node_id === nodeID) || null;
}

function nodeFindings(node, diag, assigned) {
  const out = [...(diag?.findings || []), ...(node.last_diagnostics || [])];
  if (node.last_error) {
    out.unshift({
      severity: "critical",
      title: "Agent 错误",
      detail: node.last_error
    });
  }
  if (node.status && node.status !== "online") {
    out.unshift({
      severity: "critical",
      title: "节点离线",
      detail: "最近 90 秒内没有收到 Agent 心跳。"
    });
  }
  const pending = assigned.filter(r => (r.last_apply_state || "pending") === "pending").length;
  if (pending) {
    out.push({
      severity: "warn",
      title: "存在待应用规则",
      detail: `${pending} 条规则仍处于 pending 状态。`
    });
  }
  const seen = new Set();
  return out.filter(f => {
    const key = `${f.severity}|${f.title}|${f.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function fmtDuration(seconds) {
  seconds = Number(seconds || 0);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function tcpRetransRatio(metrics) {
  const out = Number(metrics?.tcp_out_segments || 0);
  const retrans = Number(metrics?.tcp_retrans_segments || 0);
  if (!out) return "0%";
  return `${Math.min(100, retrans / out * 100).toFixed(2)}%`;
}

function formatRatio(value) {
  value = Number(value || 0);
  return `${Math.min(100, value * 100).toFixed(2)}%`;
}

function formatBytesPerSecond(value) {
  value = Number(value || 0);
  return `${fmtBytes(value)}/s`;
}

function formatPacketsPerSecond(value) {
  value = Number(value || 0);
  return `${value.toFixed(value >= 10 ? 1 : 2)} pkt/s`;
}

function fmtSigned(value) {
  value = Number(value || 0);
  if (value > 0) return `+${value}`;
  return String(value);
}

function formatTime(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}

function rulesetFragment(ruleset, rule, report) {
  if (!ruleset) return "";
  const needles = [
    String(rule.listen_port || ""),
    report.target_ip || "",
    ...(report.counters || [])
  ].filter(Boolean);
  const lines = String(ruleset).split("\n");
  const matched = lines.filter(line => needles.some(needle => line.includes(needle)));
  return matched.slice(0, 60).join("\n");
}

function ruleRecommendations(rule, node, report, findings, total, probes) {
  const items = [];
  if (node.status && node.status !== "online") {
    items.push({ tone: "critical", title: "节点离线", detail: "先恢复 Agent 心跳，再判断转发规则是否异常。" });
  }
  if ((rule.last_apply_state || report.state) === "error") {
    items.push({ tone: "critical", title: "规则应用失败", detail: report.message || rule.last_error || "检查 nftables 语法、权限和目标地址解析。" });
  }
  if (node.firewall_mode === "strict_pending") {
    items.push({ tone: "warn", title: "严格防火墙等待确认", detail: "Agent 已进入回滚保护窗口，等待 Panel 心跳确认后会变为 strict。" });
  }
  const failedTCP = probes.find(p => p.protocol === "tcp" && !p.ok);
  if (failedTCP) {
    items.push({ tone: "warn", title: "目标 TCP 不可达", detail: `${failedTCP.target_host}:${failedTCP.target_port} 探测失败，优先检查目标服务、防火墙和路由。` });
  }
  if (Number(total.packets || 0) === 0 && rule.enabled && (rule.last_apply_state === "applied" || report.state === "applied")) {
    items.push({ tone: "warn", title: "暂无入口流量", detail: "规则已应用但 counter 仍为 0，优先检查云安全组、公网 IP、监听端口和上游访问路径。" });
  }
  for (const finding of findings || []) {
    items.push({ tone: finding.severity || "warn", title: finding.title, detail: finding.detail });
  }
  if (!items.length) {
    items.push({ tone: "info", title: "未发现明显异常", detail: "当前 apply、探测和 counter 没有暴露出高优先级风险。" });
  }
  return items;
}

boot();
