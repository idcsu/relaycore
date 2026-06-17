import { useState, type FormEvent } from "react";
import { api } from "../api/client";
import type { MeResponse } from "../api/types";
import { useAuth } from "../app/AuthContext";
import { useToast } from "../app/ToastContext";

export function LoginPage() {
  const { setSession } = useAuth();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const body = JSON.stringify(Object.fromEntries(new FormData(form)));
    setSubmitting(true);
    try {
      const data = await api<MeResponse>("/api/auth/login", { method: "POST", body });
      setSession(data);
    } catch (err) {
      toast((err as Error).message, "danger");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="login-brand">
          <div>
            <div className="brand-mark">RC</div>
            <h1>RelayCore</h1>
          </div>
          <div className="login-points">
            <span>适合 1 核 1G 节点</span>
            <span>规则走 Linux 内核转发</span>
            <span>内置诊断和安全接入</span>
          </div>
        </div>
        <form className="login-form" onSubmit={onSubmit}>
          <div>
            <h2>登录面板</h2>
            <p>如果刚部署完成，请使用安装脚本输出的管理员账号和密码。</p>
          </div>
          <label className="field">
            用户名
            <input className="input" name="username" autoComplete="username" placeholder="例如 admin" required />
          </label>
          <label className="field">
            密码
            <input
              className="input"
              type="password"
              name="password"
              autoComplete="current-password"
              placeholder="输入面板密码"
              required
            />
          </label>
          <label className="field">
            两步验证码
            <input
              className="input"
              name="totp_code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="没有开启就留空"
            />
          </label>
          <button className="btn primary" type="submit" disabled={submitting}>
            {submitting ? "登录中…" : "进入控制台"}
          </button>
        </form>
      </section>
    </main>
  );
}
