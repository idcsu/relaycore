import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { queryKeys, useDiagnostics, useNodes, useRules, useUsers } from "../api/hooks";
import type { Rule, RuleReport } from "../api/types";
import { useAuth } from "../app/AuthContext";
import { useToast } from "../app/ToastContext";
import { EmptyState, HelperCard, Spinner } from "../components/ui";
import { PageActions } from "../components/PageActions";
import { RuleCard } from "../components/RuleCard";
import { RuleForm, type RulePayload } from "../components/RuleForm";
import { RuleDrawer } from "../components/RuleDrawer";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { applyStateText, isAdminRole, protocolText } from "../lib/labels";

type RuleGroupMode = "node" | "status" | "protocol" | "none";
type RuleStatusFilter = "all" | "enabled" | "disabled" | "error";

interface RuleGroup {
  key: string;
  title: string;
  detail: string;
  rules: Rule[];
}

function ruleApplyState(rule: Rule, report?: RuleReport): string {
  return rule.last_apply_state || report?.state || "pending";
}

function ruleGroupTitle(rule: Rule, mode: RuleGroupMode, nodeName: string, report?: RuleReport): { key: string; title: string; detail: string } {
  if (mode === "status") {
    if (!rule.enabled) return { key: "disabled", title: "已停用", detail: "这些规则不会下发到节点" };
    const state = ruleApplyState(rule, report);
    return { key: state, title: applyStateText(state), detail: "按 Agent 最近一次应用结果分组" };
  }
  if (mode === "protocol") {
    return { key: rule.protocol, title: protocolText(rule.protocol), detail: "按 TCP、UDP 或双协议分组" };
  }
  if (mode === "none") {
    return { key: "all", title: "全部规则", detail: "按创建时间展示" };
  }
  return { key: rule.node_id || "unknown", title: nodeName, detail: "同一节点上的规则放在一起" };
}

export function RulesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const admin = isAdminRole(user?.role);

  const rulesQuery = useRules();
  const nodesQuery = useNodes();
  const usersQuery = useUsers(admin);

  const [formOpen, setFormOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleteRuleId, setDeleteRuleId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<RuleStatusFilter>("all");
  const [groupMode, setGroupMode] = useState<RuleGroupMode>("node");
  const diagnosticsQuery = useDiagnostics(selectedId != null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.rules });
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
  };

  const saveMutation = useMutation({
    mutationFn: (payload: RulePayload) => {
      const path = payload.id ? `/api/rules/${encodeURIComponent(payload.id)}` : "/api/rules";
      const method = payload.id ? "PUT" : "POST";
      return api(path, { method, body: JSON.stringify(payload) });
    },
    onSuccess: () => {
      invalidate();
      setFormOpen(false);
      setEditingRule(null);
      toast("规则已保存", "ok");
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });

  const toggleMutation = useMutation({
    mutationFn: (rule: Rule) =>
      api(`/api/rules/${encodeURIComponent(rule.id)}`, {
        method: "PUT",
        body: JSON.stringify({ ...rule, enabled: !rule.enabled }),
      }),
    onSuccess: (_data, rule) => {
      invalidate();
      toast(rule.enabled ? "规则已停用" : "规则已启用", "ok");
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/api/rules/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      setDeleteRuleId(null);
      toast("规则已删除", "ok");
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });

  if (rulesQuery.isLoading || nodesQuery.isLoading) {
    return <Spinner />;
  }

  const rules = rulesQuery.data?.items || [];
  const counters = rulesQuery.data?.counters || [];
  const reports = rulesQuery.data?.reports || [];
  const nodes = nodesQuery.data?.items || [];
  const users = usersQuery.data?.items || [];

  const ownerName = (id?: string) => {
    if (!id) return "-";
    return users.find((u) => u.id === id)?.username || id;
  };

  const reportByRule = new Map(reports.map((r) => [r.rule_id, r]));
  const nodeName = (id?: string) => nodes.find((n) => n.id === id)?.name || id || "未知节点";
  const keyword = search.trim().toLowerCase();
  const filteredRules = rules.filter((rule) => {
    const report = reportByRule.get(rule.id);
    const state = ruleApplyState(rule, report);
    if (statusFilter === "enabled" && !rule.enabled) return false;
    if (statusFilter === "disabled" && rule.enabled) return false;
    if (statusFilter === "error" && state !== "error" && !rule.last_error) return false;
    if (!keyword) return true;
    const haystack = [
      rule.name,
      rule.description,
      protocolText(rule.protocol),
      String(rule.listen_port),
      rule.target_host,
      String(rule.target_port),
      nodeName(rule.node_id),
      ownerName(rule.user_id),
      applyStateText(state),
      report?.message,
      rule.last_error,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(keyword);
  });
  const groupedRules = (() => {
    const groups = new Map<string, RuleGroup>();
    for (const rule of filteredRules) {
      const report = reportByRule.get(rule.id);
      const meta = ruleGroupTitle(rule, groupMode, nodeName(rule.node_id), report);
      const group = groups.get(meta.key) || { ...meta, rules: [] };
      group.rules.push(rule);
      groups.set(meta.key, group);
    }
    return [...groups.values()];
  })();

  const selectedRule = rules.find((r) => r.id === selectedId) || null;
  const deleteRule = rules.find((r) => r.id === deleteRuleId) || null;
  const selectedNode = selectedRule ? nodes.find((n) => n.id === selectedRule.node_id) : undefined;
  const ruleDiagnosis = selectedRule
    ? (diagnosticsQuery.data?.rules || []).find((r) => r.rule_id === selectedRule.id) || null
    : null;
  const nodeDiagnosis = selectedRule
    ? (diagnosticsQuery.data?.nodes || []).find((n) => n.node_id === selectedRule.node_id) || null
    : null;

  const openCreate = () => {
    setEditingRule(null);
    setFormOpen(true);
  };

  return (
    <>
      <PageActions>
        <button className="btn primary" type="button" onClick={openCreate}>
          新增规则
        </button>
      </PageActions>

      <HelperCard
        title="新增转发规则怎么填"
        detail="监听端口是别人访问节点时用的公网端口；目标地址和目标端口是最终要访问的服务。"
        steps={[
          { title: "选节点", detail: "选择哪台 VPS 来负责这个公网入口。" },
          { title: "填目标", detail: "目标可以是内网 IP、后端公网 IP 或域名，确保节点能访问到它。" },
          { title: "保存后测试", detail: "保存后进入详情看 counter 是否增加，目标探测是否正常。" },
        ]}
      />

      {rules.length ? (
        <>
          <div className="rules-filter panel pad">
            <label className="field rules-search">
              搜索规则
              <input
                className="input"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="输入名称、端口、目标地址、节点名或归属用户"
              />
            </label>
            <label className="field">
              分组方式
              <select className="select" value={groupMode} onChange={(e) => setGroupMode(e.target.value as RuleGroupMode)}>
                <option value="node">按节点分组</option>
                <option value="status">按状态分组</option>
                <option value="protocol">按协议分组</option>
                <option value="none">不分组</option>
              </select>
            </label>
            <div className="field">
              状态筛选
              <div className="segment">
                {[
                  ["all", "全部"],
                  ["enabled", "启用"],
                  ["disabled", "停用"],
                  ["error", "异常"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    className={statusFilter === value ? "active" : ""}
                    type="button"
                    onClick={() => setStatusFilter(value as RuleStatusFilter)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="rules-filter-count">
              <strong>
                {filteredRules.length}/{rules.length}
              </strong>
              <span>条规则</span>
            </div>
          </div>

          {filteredRules.length ? (
            <div className="grouped-rule-list">
              {groupedRules.map((group) => (
                <section className="rule-group" key={group.key}>
                  <div className="rule-group-head">
                    <div>
                      <strong>{group.title}</strong>
                      <span>{group.detail}</span>
                    </div>
                    <b>{group.rules.length} 条</b>
                  </div>
                  <div className="rule-list">
                    {group.rules.map((rule) => (
                      <RuleCard
                        key={rule.id}
                        rule={rule}
                        node={nodes.find((n) => n.id === rule.node_id)}
                        counters={counters}
                        report={reportByRule.get(rule.id)}
                        ownerName={ownerName(rule.user_id)}
                        isAdmin={admin}
                        onOpen={() => setSelectedId(rule.id)}
                        onEdit={() => {
                          setEditingRule(rule);
                          setFormOpen(true);
                        }}
                        onToggle={() => toggleMutation.mutate(rule)}
                        onDelete={() => setDeleteRuleId(rule.id)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <EmptyState
              title="没有匹配的规则"
              detail="换一个关键词，或者把状态筛选切回“全部”。"
              action="可以搜索规则名称、监听端口、目标地址、节点名和归属用户。"
            />
          )}
        </>
      ) : (
        <EmptyState
          title="还没有转发规则"
          detail="点击右上角“新增规则”，先创建一条简单的 TCP 规则测试。"
          action="确认能访问后，再按需加 UDP 或来源白名单。"
        />
      )}

      {formOpen && (
        <RuleForm
          rule={editingRule}
          nodes={nodes}
          users={users}
          isAdmin={admin}
          submitting={saveMutation.isPending}
          onSubmit={(payload) => saveMutation.mutate(payload)}
          onClose={() => {
            setFormOpen(false);
            setEditingRule(null);
          }}
        />
      )}

      {selectedRule && (
        <RuleDrawer
          rule={selectedRule}
          node={selectedNode}
          report={reports.find((r) => r.rule_id === selectedRule.id)}
          diagnosis={ruleDiagnosis}
          nodeDiagnosis={nodeDiagnosis}
          counters={counters}
          onClose={() => setSelectedId(null)}
        />
      )}

      {deleteRule && (
        <ConfirmDialog
          title="删除转发规则"
          detail={`确认删除“${deleteRule.name}”？删除后 Agent 下一次心跳会移除对应 nftables 规则。`}
          confirmText="删除规则"
          danger
          loading={deleteMutation.isPending}
          onConfirm={() => deleteMutation.mutate(deleteRule.id)}
          onClose={() => setDeleteRuleId(null)}
        />
      )}
    </>
  );
}
