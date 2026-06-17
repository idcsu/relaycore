import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { queryKeys, useDiagnostics } from "../api/hooks";
import type { Counter, Node, Rule, RuleReport } from "../api/types";
import { useToast } from "../app/ToastContext";
import { NodeTable } from "./NodeTable";
import { NodeDrawer } from "./NodeDrawer";
import { Modal } from "./Modal";

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
  const [renameId, setRenameId] = useState<string | null>(null);

  const diagnosticsQuery = useDiagnostics(selectedId != null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.nodes });
    queryClient.invalidateQueries({ queryKey: queryKeys.rules });
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
  };

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api(`/api/nodes/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ name }) }),
    onSuccess: () => {
      invalidate();
      setRenameId(null);
      toast("节点已更新", "ok");
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/api/nodes/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      toast("节点已删除", "ok");
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });

  const relatedRuleCount = (id: string) => rules.filter((r) => r.node_id === id).length;

  const onDelete = (id: string) => {
    const node = nodes.find((n) => n.id === id);
    if (!node) return;
    const related = relatedRuleCount(id);
    const ok = window.confirm(
      `确认删除节点“${node.name}”？${related ? `该节点下 ${related} 条规则也会被删除。` : ""}`,
    );
    if (!ok) return;
    deleteMutation.mutate(id);
  };

  const selectedNode = nodes.find((n) => n.id === selectedId) || null;
  const renameNode = nodes.find((n) => n.id === renameId) || null;
  const diagnosis = selectedNode
    ? (diagnosticsQuery.data?.nodes || []).find((n) => n.node_id === selectedNode.id) || null
    : null;

  const onRenameSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!renameNode) return;
    const name = String(new FormData(e.currentTarget).get("name") || "").trim();
    if (!name) return;
    renameMutation.mutate({ id: renameNode.id, name });
  };

  return (
    <>
      <NodeTable
        nodes={nodes}
        isAdmin={isAdmin}
        onOpen={setSelectedId}
        onEdit={setRenameId}
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

      {renameNode && (
        <Modal title="重命名节点" subtitle="只修改面板显示名称，不影响节点上的 Agent。" width={460} onClose={() => setRenameId(null)}>
          <form className="form-grid" onSubmit={onRenameSubmit}>
            <label className="field wide">
              节点名称
              <input className="input" name="name" defaultValue={renameNode.name} required autoFocus />
            </label>
            <div className="wide toolbar">
              <button className="btn primary" type="submit" disabled={renameMutation.isPending}>
                保存
              </button>
              <button className="btn" type="button" onClick={() => setRenameId(null)}>
                取消
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
