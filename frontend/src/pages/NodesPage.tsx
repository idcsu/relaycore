import { useNodes, useRules } from "../api/hooks";
import { useAuth } from "../app/AuthContext";
import { HelperCard, Spinner } from "../components/ui";
import { NodeManager } from "../components/NodeManager";
import { isAdminRole } from "../lib/labels";

export function NodesPage() {
  const { user } = useAuth();
  const nodes = useNodes();
  const rules = useRules();

  if (nodes.isLoading || rules.isLoading) {
    return <Spinner />;
  }

  return (
    <>
      <HelperCard
        title="严格防火墙在哪里设置"
        detail="当前严格防火墙由节点服务器上的 Agent 启动参数控制，不是在面板里直接切换。"
        steps={[
          { title: "启用位置", detail: "在节点的 agent.env 或启动命令里设置 RELAYCORE_FIREWALL_MODE=strict。" },
          { title: "安全机制", detail: "严格模式有回滚保护，面板确认不到节点时 Agent 会回滚防火墙。" },
          { title: "救援命令", detail: "如果误配置，可在节点执行 relaycore-agent rescue 清理 RelayCore 规则。" },
        ]}
      />
      <NodeManager
        nodes={nodes.data?.items || []}
        rules={rules.data?.items || []}
        counters={rules.data?.counters || []}
        reports={rules.data?.reports || []}
        isAdmin={isAdminRole(user?.role)}
      />
    </>
  );
}
