import { type FormEvent } from "react";
import type { Node, Rule, User } from "../api/types";
import { Modal } from "./Modal";
import { FieldHelp } from "./ui";
import { roleText } from "../lib/labels";

export interface RulePayload {
  id: string;
  name: string;
  node_id: string;
  protocol: string;
  listen_port: number;
  target_host: string;
  target_port: number;
  user_id: string;
  source_cidrs: string[];
  description: string;
  enabled: boolean;
}

export function RuleForm({
  rule,
  nodes,
  users,
  isAdmin,
  submitting,
  onSubmit,
  onClose,
}: {
  rule: Rule | null;
  nodes: Node[];
  users: User[];
  isAdmin: boolean;
  submitting: boolean;
  onSubmit: (payload: RulePayload) => void;
  onClose: () => void;
}) {
  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    onSubmit({
      id: fd.id || "",
      name: fd.name,
      node_id: fd.node_id,
      protocol: fd.protocol,
      listen_port: Number(fd.listen_port),
      target_host: fd.target_host,
      target_port: Number(fd.target_port),
      user_id: fd.user_id || "",
      source_cidrs: String(fd.source_cidrs || "")
        .split(/\n|,/)
        .map((s) => s.trim())
        .filter(Boolean),
      description: fd.description || "",
      enabled: fd.enabled !== "false",
    });
  };

  const title = rule ? "编辑转发规则" : "把一个公网端口转到目标服务";
  const intro = rule
    ? "修改后会触发规则版本更新，Agent 下一次心跳会重新应用。"
    : "建议先用 TCP 创建一条最简单的规则测试。确认可用后，再加 UDP 或来源白名单。";

  return (
    <Modal title={title} subtitle={intro} width={720} onClose={onClose}>
      <form className="form-grid" onSubmit={handleSubmit}>
        <input type="hidden" name="id" value={rule?.id || ""} />
        <label className="field">
          规则名称
          <input className="input" name="name" placeholder="例如：我的网站 8443" defaultValue={rule?.name || ""} required />
          <FieldHelp>只用于面板里识别，建议写清楚用途。</FieldHelp>
        </label>
        <label className="field">
          节点
          <select className="select" name="node_id" defaultValue={rule?.node_id || ""} required>
            <option value="">选择节点</option>
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
          <FieldHelp>这台节点会开放公网监听端口。</FieldHelp>
        </label>
        {isAdmin && (
          <label className="field">
            归属用户
            <select className="select" name="user_id" defaultValue={rule?.user_id || ""}>
              <option value="">当前用户</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.username} / {roleText(u.role)}
                </option>
              ))}
            </select>
            <FieldHelp>普通用户只能看到归属于自己的规则。</FieldHelp>
          </label>
        )}
        <label className="field">
          协议
          <select className="select" name="protocol" defaultValue={rule?.protocol || "tcp"}>
            <option value="tcp">TCP</option>
            <option value="udp">UDP</option>
            <option value="both">TCP + UDP</option>
          </select>
          <FieldHelp>网站、SSH、面板通常选 TCP；游戏或语音服务可能需要 UDP。</FieldHelp>
        </label>
        <label className="field">
          监听端口
          <input
            className="input"
            name="listen_port"
            type="number"
            min={1}
            max={65535}
            placeholder="例如 8443"
            defaultValue={rule?.listen_port || ""}
            required
          />
          <FieldHelp>用户访问节点公网 IP 时使用的端口。</FieldHelp>
        </label>
        <label className="field">
          目标地址
          <input
            className="input"
            name="target_host"
            placeholder="例如 10.0.0.5 或 example.com"
            defaultValue={rule?.target_host || ""}
            required
          />
          <FieldHelp>节点最终要转发到的服务器地址。</FieldHelp>
        </label>
        <label className="field">
          目标端口
          <input
            className="input"
            name="target_port"
            type="number"
            min={1}
            max={65535}
            placeholder="例如 443"
            defaultValue={rule?.target_port || ""}
            required
          />
          <FieldHelp>目标服务实际监听的端口。</FieldHelp>
        </label>
        <label className="field">
          状态
          <select className="select" name="enabled" defaultValue={rule?.enabled === false ? "false" : "true"}>
            <option value="true">启用</option>
            <option value="false">停用</option>
          </select>
          <FieldHelp>停用后规则不会下发到 Agent。</FieldHelp>
        </label>
        <label className="field wide">
          来源白名单
          <textarea
            className="textarea"
            name="source_cidrs"
            placeholder="一行一个，例如 1.2.3.4/32；留空表示允许所有来源"
            defaultValue={(rule?.source_cidrs || []).join("\n")}
          />
          <FieldHelp>不确定就先留空。需要限制访问来源时再填写 CIDR。</FieldHelp>
        </label>
        <label className="field wide">
          备注
          <textarea
            className="textarea"
            name="description"
            placeholder="可选：写一下这个转发给谁用、转到哪里"
            defaultValue={rule?.description || ""}
          />
        </label>
        <div className="wide toolbar">
          <button className="btn primary" type="submit" disabled={submitting}>
            {rule ? "保存修改" : "保存规则"}
          </button>
          <button className="btn" type="button" onClick={onClose}>
            取消
          </button>
        </div>
      </form>
    </Modal>
  );
}
