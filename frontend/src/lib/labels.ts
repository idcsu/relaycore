import type { ApplyState, Protocol, Role } from "../api/types";

export function isAdminRole(role?: string): boolean {
  return role === "admin" || role === "super_admin";
}

export function roleText(role?: Role | string): string {
  if (role === "super_admin") return "超级管理员";
  if (role === "admin") return "管理员";
  if (role === "user") return "普通用户";
  return role || "-";
}

export function protocolText(value?: Protocol | string): string {
  if (value === "tcp") return "TCP";
  if (value === "udp") return "UDP";
  if (value === "both") return "TCP + UDP";
  return value || "-";
}

export function severityText(severity?: string): string {
  if (severity === "critical") return "严重";
  if (severity === "warn") return "提醒";
  if (severity === "info") return "提示";
  return severity || "提示";
}

export function firewallText(mode?: string): string {
  if (mode === "strict") return "严格防火墙";
  if (mode === "strict_pending" || mode === "strict-pending") return "严格确认中";
  if (mode === "managed") return "托管防火墙";
  return mode || "托管防火墙";
}

export function applyStateText(state?: ApplyState): string {
  if (state === "applied") return "已应用";
  if (state === "dry_run") return "演练模式";
  if (state === "error") return "应用失败";
  if (state === "skipped") return "已跳过";
  if (state === "pending") return "等待下发";
  return state || "等待下发";
}

export type Tone = "info" | "ok" | "warn" | "danger" | "neutral";

export function applyStateTone(state?: ApplyState): Tone {
  if (state === "applied") return "ok";
  if (state === "dry_run") return "info";
  if (state === "error") return "danger";
  if (state === "skipped") return "warn";
  return "warn";
}

export function firewallTone(mode?: string): Tone {
  if (mode === "strict" || mode === "strict_pending" || mode === "strict-pending") return "warn";
  return "info";
}

const EVENT_ACTIONS: Record<string, string> = {
  "system.bootstrap": "初始化管理员",
  "auth.failed": "登录失败",
  "auth.login": "登录成功",
  "account.totp": "两步验证变更",
  "user.create": "创建用户",
  "user.update": "更新用户",
  "user.reset_password": "重置密码",
  "node_token.create": "生成节点接入 Token",
  "node.register": "节点注册",
  "node.update": "更新节点",
  "node.delete": "删除节点",
  "rule.save": "保存规则",
  "rule.delete": "删除规则",
};

export function eventActionText(action: string): string {
  return EVENT_ACTIONS[action] || action || "-";
}

export function eventCategory(action: string): string {
  const a = String(action);
  if (a.startsWith("auth.") || a.startsWith("account.")) return "认证";
  if (a.startsWith("user.")) return "用户";
  if (a.startsWith("node") || a.startsWith("node_token")) return "节点";
  if (a.startsWith("rule.")) return "规则";
  if (a.startsWith("system.")) return "系统";
  return "其他";
}

export function eventCategoryTone(category: string): Tone {
  if (category === "认证") return "info";
  if (category === "规则") return "warn";
  if (category === "节点") return "ok";
  return "neutral";
}

export function eventDetailText(detail?: string): string {
  const text = String(detail || "");
  if (!text) return "-";
  if (text === "created initial administrator") return "创建初始管理员";
  if (text === "session created") return "创建登录会话";
  if (text.startsWith("login failed at ")) return "登录失败：" + text.replace("login failed at ", "");
  if (text.startsWith("created user ")) return "创建用户：" + text.replace("created user ", "");
  if (text.startsWith("role=")) {
    return text.replace("role=", "角色=").replace(" disabled=", "，禁用=");
  }
  if (text === "password reset") return "密码已重置";
  if (text === "created node token") return "生成节点接入 Token";
  if (text === "agent registered") return "Agent 注册成功";
  if (text === "saved forwarding rule") return "保存转发规则";
  if (text === "deleted forwarding rule") return "删除转发规则";
  if (text.startsWith("updated node ")) return "更新节点：" + text.replace("updated node ", "");
  if (text.startsWith("deleted node and ")) {
    return text.replace("deleted node and ", "删除节点，并移除 ").replace(" rule(s)", " 条规则");
  }
  if (text.startsWith("totp enabled=")) return text.endsWith("true") ? "两步验证已启用" : "两步验证已停用";
  return text;
}
