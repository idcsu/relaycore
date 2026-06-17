import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../api/client";
import type { TOTPSetup, User } from "../api/types";
import { useAuth } from "../app/AuthContext";
import { useToast } from "../app/ToastContext";
import { CodeBox, FieldHelp, HelperCard, Metric, SectionHead } from "../components/ui";
import { QRCodeView } from "../components/QRCode";

export function SecurityPage() {
  const { user, version, setSession } = useAuth();
  const { toast } = useToast();
  const [setup, setSetup] = useState<TOTPSetup | null>(null);
  const enabled = !!user?.totp_enabled;

  const applyUser = (u: User) => setSession({ user: u, version });

  const setupMutation = useMutation({
    mutationFn: (password: string) =>
      api<TOTPSetup>("/api/account/totp/setup", { method: "POST", body: JSON.stringify({ password }) }),
    onSuccess: (data) => {
      setSetup(data);
      toast("密钥已生成", "ok");
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });

  const enableMutation = useMutation({
    mutationFn: (payload: { secret: string; code: string }) =>
      api<{ user: User }>("/api/account/totp/enable", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: (data) => {
      applyUser(data.user);
      setSetup(null);
      toast("两步验证已启用", "ok");
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });

  const disableMutation = useMutation({
    mutationFn: (payload: { password: string; code: string }) =>
      api<{ user: User }>("/api/account/totp/disable", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: (data) => {
      applyUser(data.user);
      toast("两步验证已停用", "ok");
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });

  const onSetup = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setupMutation.mutate(fd.password);
  };
  const onEnable = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    enableMutation.mutate({ secret: fd.secret, code: fd.code });
  };
  const onDisable = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    disableMutation.mutate({ password: fd.password, code: fd.code });
  };

  return (
    <>
      <HelperCard
        title="建议开启两步验证"
        detail="两步验证需要手机认证器 App 的 6 位动态验证码，即使密码泄露也能多一道保护。"
        steps={[
          { title: "生成密钥", detail: "输入当前密码后，面板会显示二维码和手动密钥。" },
          { title: "扫码保存", detail: "用认证器 App 扫码，确认能看到 6 位验证码。" },
          { title: "启用验证", detail: "输入当前验证码启用，以后登录需要密码加验证码。" },
        ]}
      />

      <div className="grid cols-3">
        <Metric
          label="两步验证"
          value={enabled ? "已启用" : "未启用"}
          sub={enabled ? "登录时需要动态验证码" : "建议启用以保护面板"}
        />
        <Metric label="会话 Cookie" value="HttpOnly" sub="SameSite=Lax" />
        <Metric label="Agent 通信" value="HMAC" sub="timestamp + nonce 防重放" />
      </div>

      <SectionHead title="两步验证" />
      <div className="panel pad grid">
        {enabled ? (
          <>
            <p className="muted">当前账号已启用两步验证。停用时需要输入登录密码和认证器里的当前 6 位验证码。</p>
            <form className="form-grid" onSubmit={onDisable}>
              <label className="field">
                当前密码
                <input className="input" type="password" name="password" required />
              </label>
              <label className="field">
                6 位验证码
                <input className="input" name="code" inputMode="numeric" placeholder="例如 123456" required />
              </label>
              <div className="wide toolbar">
                <button className="btn danger" type="submit" disabled={disableMutation.isPending}>
                  停用两步验证
                </button>
              </div>
            </form>
          </>
        ) : (
          <>
            <p className="muted">
              先输入当前密码生成密钥，用认证器 App 扫描二维码或手动输入密钥，再填入 6 位验证码启用。
            </p>
            <form className="form-grid" onSubmit={onSetup}>
              <label className="field">
                当前密码
                <input className="input" type="password" name="password" required />
              </label>
              <div className="field align-end">
                <button className="btn primary" type="submit" disabled={setupMutation.isPending}>
                  生成密钥
                </button>
              </div>
            </form>
            {setup && (
              <div className="totp-setup">
                <div className="qr-card">
                  <QRCodeView value={setup.uri} />
                </div>
                <div className="grid">
                  <label className="field">
                    手动密钥
                    <input className="input mono" readOnly value={setup.secret} />
                    <FieldHelp>扫码失败时，把这串密钥手动输入到认证器 App。</FieldHelp>
                  </label>
                  <CodeBox>{setup.uri}</CodeBox>
                  <form className="form-grid" onSubmit={onEnable}>
                    <input type="hidden" name="secret" value={setup.secret} />
                    <label className="field">
                      6 位验证码
                      <input className="input" name="code" inputMode="numeric" placeholder="认证器 App 里的数字" required />
                    </label>
                    <div className="field align-end">
                      <button className="btn primary" type="submit" disabled={enableMutation.isPending}>
                        启用两步验证
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
