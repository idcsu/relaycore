import { useState } from "react";
import { useEvents, useNodes, useRules, useUsers } from "../api/hooks";
import type { AuditEvent } from "../api/types";
import { Badge, EmptyState, Eyebrow, Spinner } from "../components/ui";
import { formatTime } from "../lib/format";
import { eventActionText, eventCategory, eventCategoryTone, eventDetailText } from "../lib/labels";

const CATEGORIES = ["all", "认证", "用户", "节点", "规则", "系统", "其他"];

export function EventsPage() {
  const eventsQuery = useEvents(true);
  const usersQuery = useUsers(true);
  const nodesQuery = useNodes();
  const rulesQuery = useRules();
  const [category, setCategory] = useState("all");

  if (eventsQuery.isLoading) return <Spinner />;

  const events = eventsQuery.data?.items || [];
  const users = usersQuery.data?.items || [];
  const nodes = nodesQuery.data?.items || [];
  const rules = rulesQuery.data?.items || [];

  const userName = (id?: string) => (id ? users.find((u) => u.id === id)?.username || id : "-");
  const eventTargetText = (target?: string) => {
    if (!target) return "-";
    const [kind, id] = String(target).split(":");
    if (kind === "user") return `用户：${userName(id)}`;
    if (kind === "node") return `节点：${nodes.find((n) => n.id === id)?.name || id}`;
    if (kind === "rule") return `规则：${rules.find((r) => r.id === id)?.name || id}`;
    if (kind === "node-token") return "节点接入 Token";
    if (target === "session") return "登录会话";
    return target;
  };

  if (!events.length) {
    return <EmptyState title="暂无审计日志" detail="登录、创建规则、重置密码等关键操作会记录在这里。" />;
  }

  const filtered: AuditEvent[] =
    category === "all" ? events : events.filter((e) => eventCategory(e.action) === category);

  return (
    <>
      <div className="panel pad event-filter">
        <div>
          <Eyebrow>日志分类</Eyebrow>
          <h2>审计日志</h2>
          <p>这里记录登录、用户、节点、规则等关键操作。可以按分类查看。</p>
        </div>
        <div className="segment">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              className={category === cat ? "active" : ""}
              onClick={() => setCategory(cat)}
            >
              {cat === "all" ? "全部" : cat}
            </button>
          ))}
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>分类</th>
              <th>操作人</th>
              <th>动作</th>
              <th>目标</th>
              <th>来源</th>
              <th>详情</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length ? (
              filtered.map((e, idx) => {
                const cat = eventCategory(e.action);
                return (
                  <tr key={idx}>
                    <td>{formatTime(e.created_at)}</td>
                    <td>
                      <Badge tone={eventCategoryTone(cat)}>{cat}</Badge>
                    </td>
                    <td>{e.actor_id ? userName(e.actor_id) : "系统"}</td>
                    <td>{eventActionText(e.action)}</td>
                    <td>{eventTargetText(e.target)}</td>
                    <td className="mono">{e.ip || "-"}</td>
                    <td>{eventDetailText(e.detail)}</td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={7}>
                  <EmptyState title="暂无匹配日志" detail="换一个分类或刷新后再看。" />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
