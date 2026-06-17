import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { queryKeys, useDiagnostics } from "../api/hooks";
import type { Counter, Node, Rule, RuleReport } from "../api/types";
import { useToast } from "../app/ToastContext";
import { NodeTable } from "./NodeTable";
import { NodeDrawer } from "./NodeDrawer";
import { Modal } from "./Modal";
import { ConfirmDialog } from "./ConfirmDialog";
import { FieldHelp } from "./ui";

export function NodeManager({
  nodes,
  rules,
  counters,
  reports,
  isAdmin,
}: {
  nodes: Node[];
  rules: Rule[];
  counters: Counter[];
  reports: RuleReport[];
  isAdmin: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const diagnosticsQuery = useDiagnostics(selectedId != null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.nodes });
    queryClient.invalidateQueries({ queryKey: queryKeys.rules });
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
    queryClient.invalidateQueries({ queryKey: queryKeys.diagnostics });
  };

  const settingsMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      api(`/api/nodes/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(payload) }),
    onSuccess: () => {
      invalidate();
      setSettingsId(null);
      toast("节点已更新", "ok");
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/api/nodes/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: (_data, id) => {
      queryClient.setQueryData(queryKeys.nodes, (old: { items?: Node[] } | undefined) =>
        old ? { ...old, items: (old.items || []).filter((n) => n.id !== id) } : old,
      );
      setSelectedId((current) => (current === id ? null : current));
      setSettingsId((current) => (current === id ? null : current));
      setDeleteId(null);
      invalidate();
      toast("节点已删除", "ok");
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });

  const relatedRuleCount = (id: string) => rules.filter((r) => r.node_id === id).length;

  const onDelete = (id: string) => {
    setDeleteId(id);
  };

  const selectedNode = nodes.find((n) => n.id === selectedId) || null;
  const settingsNode = nodes.find((n) => n.id === settingsId) || null;
  const deleteNode = nodes.find((n) => n.id === deleteId) || null;
  const diagnosis = selectedNode
    ? (diagnosticsQuery.data?.nodes || []).find((n) => n.node_id === selectedNode.id) || null
    : null;

  const onSettingsSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!settingsNode) return;
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") || "").trim();
    if (!name) return;
    const ports = String(fd.get("firewall_ssh_ports") || "")
      .split(/,|\n/)
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 65535);
    settingsMutation.mutate({
      id: settingsNode.id,
      payload: {
        name,
        desired_firewall_mode: fd.get("desired_firewall_mode") || "managed",
        firewall_ssh_ports: ports.length ? ports : [22],
        firewall_rollback_seconds: Number(fd.get("firewall_rollback_seconds") || 60),
      },
    });
  };

  return (
    <>
      <NodeTable
        nodes={nodes}
        isAdmin={isAdmin}
        onOpen={setSelectedId}
        onEdit={setSettingsId}
        onDelete={onDelete}
        relatedRuleCount={relatedRuleCount}
      />

      {selectedNode && (
        <NodeDrawer
          node={selectedNode}
          diagnosis={diagnosis}
          rules={rules}
          counters={counters}
          reports={reports}
          onClose={() => setSelectedId(null)}
        />
      )}

      {settingsNode && (
        <Modal title="节点设置" subtitle="这里可以修改显示名称，也可以让面板下发严格防火墙策略。" width={620} onClose={() => setSettingsId(null)}>
          <form className="form-grid" onSubmit={onSettingsSubmit}>
            <label className="field wide">
              节点名称
              <input className="input" name="name" defaultValue={settingsNode.name} required autoFocus />
              <FieldHelp>只影响面板里的显示名称，不会改服务器 hostname。</FieldHelp>
            </label>
            <label className="field">
              防火墙托管模式
              <select className="select" name="desired_firewall_mode" defaultValue={settingsNode.desired_firewall_mode || "managed"}>
                <option value="managed">托管防火墙</option>
                <option value="strict">严格防火墙：自动 60 秒回滚</option>
              </select>
              <FieldHelp>严格模式只保留 SSH 和当前转发端口，其余入站会被拒绝。</FieldHelp>
            </label>
            <label className="field">
              SSH 保留端口
              <input
                className="input"
                name="firewall_ssh_ports"
                defaultValue={(settingsNode.firewall_ssh_ports?.length ? settingsNode.firewall_ssh_ports : [22]).join(",")}
                placeholder="例如 22 或 22,2222"
              />
              <FieldHelp>必须包含你当前连接服务器使用的 SSH 端口。</FieldHelp>
            </label>
            <label className="field">
              回滚秒数
              <input
                className="input"
                type="number"
                min={15}
                max={600}
                name="firewall_rollback_seconds"
                defaultValue={settingsNode.firewall_rollback_seconds || 60}
              />
              <FieldHelp>Agent 应用严格模式后，如果面板确认不到心跳，会自动回滚。</FieldHelp>
            </label>
            <div className="notice-panel wide">
              <strong>严格模式会先进入确认窗口</strong>
              <p>
                保存后，Agent 下一次心跳会应用严格防火墙。如果规则导致节点无法再联系面板，Agent 会按这里设置的时间自动回滚。
              </p>
            </div>
            <div className="wide toolbar">
              <button className="btn primary" type="submit" disabled={settingsMutation.isPending}>
                保存
              </button>
              <button className="btn" type="button" onClick={() => setSettingsId(null)}>
                取消
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deleteNode && (
        <ConfirmDialog
          title="删除节点"
          detail={`确认删除“${deleteNode.name}”？${relatedRuleCount(deleteNode.id) ? `该节点下 ${relatedRuleCount(deleteNode.id)} 条规则也会一起删除。` : ""} 如果节点服务器上的 Agent 还在运行，它会继续尝试用旧密钥上报，请在服务器上停用或重新接入。`}
          confirmText="删除节点"
          danger
          loading={deleteMutation.isPending}
          onConfirm={() => deleteMutation.mutate(deleteNode.id)}
          onClose={() => setDeleteId(null)}
        />
      )}
    </>
  );
}
