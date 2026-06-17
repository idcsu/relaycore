import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { queryKeys, useDiagnostics, useNodes, useRules, useUsers } from "../api/hooks";
import type { Rule } from "../api/types";
import { useAuth } from "../app/AuthContext";
import { useToast } from "../app/ToastContext";
import { EmptyState, HelperCard, Spinner } from "../components/ui";
import { PageActions } from "../components/PageActions";
import { RuleCard } from "../components/RuleCard";
import { RuleForm, type RulePayload } from "../components/RuleForm";
import { RuleDrawer } from "../components/RuleDrawer";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { isAdminRole } from "../lib/labels";

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
        <div className="rule-list">
          {rules.map((rule) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              node={nodes.find((n) => n.id === rule.node_id)}
              counters={counters}
              report={reports.find((r) => r.rule_id === rule.id)}
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
