import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { queryKeys, useUsers } from "../api/hooks";
import type { Role, User } from "../api/types";
import { useAuth } from "../app/AuthContext";
import { useToast } from "../app/ToastContext";
import { Badge, CodeBox, EmptyState, HelperCard, Spinner } from "../components/ui";
import { Modal } from "../components/Modal";
import { PageActions } from "../components/PageActions";
import { formatTime, } from "../lib/format";
import { roleText } from "../lib/labels";

interface UserMutationResult {
  item: User;
  temporary_password?: string;
}

interface RowDraft {
  role: Role;
  disabled: boolean;
}

const ALL_ROLES: Role[] = ["user", "admin", "super_admin"];

export function UsersPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const usersQuery = useUsers(true);

  const [formOpen, setFormOpen] = useState(false);
  const [result, setResult] = useState<{ title: string; detail: string } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});

  const refreshUsers = () => queryClient.invalidateQueries({ queryKey: queryKeys.users });

  const createMutation = useMutation({
    mutationFn: (payload: { username: string; password: string; role: string }) =>
      api<UserMutationResult>("/api/users", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: (data) => {
      refreshUsers();
      setFormOpen(false);
      setResult(
        data.temporary_password
          ? { title: "临时密码", detail: `${data.item.username}\n${data.temporary_password}` }
          : { title: "用户已创建", detail: data.item.username },
      );
      toast("用户已创建", "ok");
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, role, disabled }: { id: string; role: Role; disabled: boolean }) =>
      api(`/api/users/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ role, disabled }) }),
    onSuccess: () => {
      refreshUsers();
      setResult(null);
      toast("用户已更新", "ok");
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });

  const resetMutation = useMutation({
    mutationFn: (id: string) =>
      api<UserMutationResult>(`/api/users/${encodeURIComponent(id)}/reset-password`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: (data) => {
      refreshUsers();
      setResult({
        title: "新临时密码",
        detail: `${data.item.username}\n${data.temporary_password || "已设置为指定密码"}`,
      });
      toast("密码已重置", "ok");
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });

  if (usersQuery.isLoading) return <Spinner />;
  const users = usersQuery.data?.items || [];

  const draftOf = (u: User): RowDraft => drafts[u.id] ?? { role: u.role, disabled: !!u.disabled };
  const setDraft = (id: string, patch: Partial<RowDraft>) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { role: "user", disabled: false }), ...patch } }));

  const onCreate = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    createMutation.mutate({ username: fd.username, password: fd.password, role: fd.role });
  };

  const roleOptions = (u: User) =>
    ALL_ROLES.filter((role) => role !== "super_admin" || user?.role === "super_admin" || u.role === "super_admin");

  return (
    <>
      <PageActions>
        <button className="btn primary" type="button" onClick={() => setFormOpen(true)}>
          新增用户
        </button>
      </PageActions>

      <HelperCard
        title="用户权限怎么理解"
        detail="管理员可以管理节点接入和用户；普通用户只需要管理自己的转发规则。"
        steps={[
          { title: "先少给权限", detail: "不需要管理节点的人，建议使用普通用户。" },
          { title: "临时密码", detail: "新增或重置后请让用户尽快登录并修改密码。" },
          { title: "离职或不用", detail: "可以直接禁用账号，保留审计记录。" },
        ]}
      />

      {result && (
        <div className="panel pad user-result">
          <strong>{result.title}</strong>
          <CodeBox>{result.detail}</CodeBox>
        </div>
      )}

      {users.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>用户</th>
                <th>角色</th>
                <th>状态</th>
                <th>两步验证</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isSelf = u.id === user?.id;
                const draft = draftOf(u);
                return (
                  <tr key={u.id}>
                    <td>
                      <strong>{u.username}</strong>
                      <div className="mono">{u.id}</div>
                    </td>
                    <td>
                      <select
                        className="select compact"
                        value={draft.role}
                        disabled={isSelf}
                        onChange={(e) => setDraft(u.id, { role: e.target.value as Role })}
                      >
                        {roleOptions(u).map((role) => (
                          <option key={role} value={role}>
                            {roleText(role)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <label className="checkline">
                        <input
                          type="checkbox"
                          checked={draft.disabled}
                          disabled={isSelf}
                          onChange={(e) => setDraft(u.id, { disabled: e.target.checked })}
                        />{" "}
                        禁用
                      </label>
                    </td>
                    <td>
                      <Badge tone={u.totp_enabled ? "ok" : "warn"}>{u.totp_enabled ? "已开启" : "未开启"}</Badge>
                    </td>
                    <td>{formatTime(u.created_at)}</td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="btn"
                          type="button"
                          disabled={isSelf}
                          onClick={() => updateMutation.mutate({ id: u.id, role: draft.role, disabled: draft.disabled })}
                        >
                          保存
                        </button>
                        <button
                          className="btn danger"
                          type="button"
                          onClick={() => {
                            if (window.confirm("确认重置该用户密码？")) resetMutation.mutate(u.id);
                          }}
                        >
                          重置密码
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title="暂无用户" detail="当前还没有可管理的用户。" />
      )}

      {formOpen && (
        <Modal
          title="给其他人开面板账号"
          subtitle="如果留空初始密码，系统会自动生成一个临时密码。"
          width={560}
          onClose={() => setFormOpen(false)}
        >
          <form className="form-grid" onSubmit={onCreate}>
            <label className="field">
              用户名
              <input className="input" name="username" placeholder="例如 zhangsan" required autoFocus />
            </label>
            <label className="field">
              角色
              <select className="select" name="role" defaultValue="user">
                <option value="user">普通用户</option>
                <option value="admin">管理员</option>
                {user?.role === "super_admin" && <option value="super_admin">超级管理员</option>}
              </select>
            </label>
            <label className="field wide">
              初始密码
              <input
                className="input"
                name="password"
                type="password"
                autoComplete="new-password"
                placeholder="留空自动生成"
              />
            </label>
            <div className="wide toolbar">
              <button className="btn primary" type="submit" disabled={createMutation.isPending}>
                创建用户
              </button>
              <button className="btn" type="button" onClick={() => setFormOpen(false)}>
                取消
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
