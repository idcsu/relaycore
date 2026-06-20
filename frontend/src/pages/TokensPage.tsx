import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { queryKeys, useTokens } from "../api/hooks";
import type { NodeToken } from "../api/types";
import { useToast } from "../app/ToastContext";
import { Badge, CodeBox, EmptyState, FieldHelp, HelperCard, Spinner } from "../components/ui";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Modal } from "../components/Modal";
import { PageActions } from "../components/PageActions";
import { formatTime } from "../lib/format";

interface TokenResult {
  install_command: string;
}

export function TokensPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const tokensQuery = useTokens(true);
  const [formOpen, setFormOpen] = useState(false);
  const [command, setCommand] = useState<string | null>(null);
  const [deleteTokenId, setDeleteTokenId] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (payload: { name: string; hours: number }) =>
      api<TokenResult>("/api/node-tokens", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tokens });
      setCommand(data.install_command);
      setFormOpen(false);
      toast("Token 已生成", "ok");
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/api/node-tokens/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: (_data, id) => {
      queryClient.setQueryData(queryKeys.tokens, (old: { items?: NodeToken[] } | undefined) =>
        old ? { ...old, items: (old.items || []).filter((t) => t.id !== id) } : old,
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.tokens });
      setDeleteTokenId(null);
      toast("接入记录已删除", "ok");
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    createMutation.mutate({ name: fd.name, hours: Number(fd.hours || 24) });
  };

  if (tokensQuery.isLoading) return <Spinner />;
  const tokens = tokensQuery.data?.items || [];
  const deleteToken = tokens.find((t) => t.id === deleteTokenId) || null;

  return (
    <>
      <PageActions>
        <button className="btn primary" type="button" onClick={() => setFormOpen(true)}>
          生成接入命令
        </button>
      </PageActions>

      <HelperCard
        title="接入新节点的步骤"
        detail="Token 是一次性接入凭证。生成后复制命令到新 VPS 执行，Agent 会自动注册到面板。"
        steps={[
          { title: "生成命令", detail: "填写节点名称和有效时间，点击生成接入命令。" },
          { title: "复制执行", detail: "在节点服务器上用 root 执行命令，等待 Agent 安装并启动。" },
          { title: "回到节点页", detail: "看到节点在线后，就可以新增转发规则。" },
        ]}
      />

      {command && (
        <div className="panel pad command-result">
          <strong>接入命令</strong>
          <p className="muted">在新节点服务器上用 root 执行下面这条命令。命令只显示这一次。</p>
          <CodeBox>{command}</CodeBox>
        </div>
      )}

      {tokens.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>名称</th>
                <th>使用</th>
                <th>过期时间</th>
                <th>节点</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => {
                const bound = Boolean(t.used_by_node);
                return (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    <td>
                      {t.used_count} / {t.max_uses}
                    </td>
                    <td>{formatTime(t.expires_at)}</td>
                    <td className="mono">{t.used_by_node || "-"}</td>
                    <td>{bound ? <Badge tone="ok">已绑定节点</Badge> : <Badge tone="warn">未绑定</Badge>}</td>
                    <td>
                      <div className="row-actions">
                        <button className="btn danger" type="button" disabled={bound} onClick={() => setDeleteTokenId(t.id)}>
                          删除记录
                        </button>
                      </div>
                      {bound && <div className="muted">已成功接入的记录保留作为审计。</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          title="暂无接入 Token"
          detail="点击右上角“生成接入命令”，把第一台节点接入进来。"
          action="Token 只用于接入，节点上线后可以不用管它。"
        />
      )}

      {formOpen && (
        <Modal
          title="给一台新 VPS 安装 Agent"
          subtitle="接入命令只在生成后显示一次，请在有效期内使用。"
          width={520}
          onClose={() => setFormOpen(false)}
        >
          <form className="form-grid" onSubmit={onSubmit}>
            <label className="field">
              节点名称
              <input className="input" name="name" placeholder="例如：香港-1" required autoFocus />
              <FieldHelp>建议写地区或用途，后面选规则时更好认。</FieldHelp>
            </label>
            <label className="field">
              有效小时
              <input className="input" name="hours" type="number" min={1} max={720} defaultValue={24} />
              <FieldHelp>过期后命令不能再用，可以重新生成。</FieldHelp>
            </label>
            <div className="wide toolbar">
              <button className="btn primary" type="submit" disabled={createMutation.isPending}>
                生成接入命令
              </button>
              <button className="btn" type="button" onClick={() => setFormOpen(false)}>
                取消
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deleteToken && (
        <ConfirmDialog
          title="删除接入记录"
          detail={`确认删除“${deleteToken.name}”？这只会删除未绑定节点的接入记录，不会影响已经在线的节点。`}
          confirmText="删除记录"
          danger
          loading={deleteMutation.isPending}
          onConfirm={() => deleteMutation.mutate(deleteToken.id)}
          onClose={() => setDeleteTokenId(null)}
        />
      )}
    </>
  );
}
