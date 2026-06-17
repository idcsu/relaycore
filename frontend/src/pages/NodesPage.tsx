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
        detail="在节点列表点“设置”，选择严格防火墙即可。Agent 会自动应用，并带有回滚保护。"
        steps={[
          { title: "先确认 SSH", detail: "保存前确认 SSH 保留端口包含你当前登录服务器用的端口。" },
          { title: "一键切换", detail: "保存后等待 Agent 下一次心跳，节点会进入严格确认中。" },
          { title: "自动回滚", detail: "如果面板确认不到节点，Agent 会按设置秒数自动回滚防火墙。" },
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
