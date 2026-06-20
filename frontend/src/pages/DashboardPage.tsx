import { useDashboard, useNodes, useRules } from "../api/hooks";
import { useAuth } from "../app/AuthContext";
import { EmptyState, FindingList, HelperCard, Metric, SectionHead, Spinner } from "../components/ui";
import { NodeManager } from "../components/NodeManager";
import { TrafficPanel } from "../components/TrafficPanel";
import { isAdminRole } from "../lib/labels";
import { trafficSummary } from "../lib/traffic";

export function DashboardPage() {
  const { user } = useAuth();
  const dashboard = useDashboard();
  const nodes = useNodes();
  const rules = useRules();

  if (dashboard.isLoading || nodes.isLoading || rules.isLoading) {
    return <Spinner />;
  }

  const d = dashboard.data || {};
  const findings = d.findings || [];
  const nodeList = nodes.data?.items || [];
  const ruleList = rules.data?.items || [];
  const counters = rules.data?.counters || [];
  const reports = rules.data?.reports || [];
  const traffic = trafficSummary(counters, ruleList, nodeList);

  return (
    <>
      <HelperCard
        title="第一次使用按这个顺序来"
        detail="先接入节点，再新增转发规则，最后用诊断中心确认访问路径是否正常。"
        steps={[
          { title: "接入节点", detail: "到“节点接入”生成命令，在转发服务器上执行一次即可。" },
          { title: "新增规则", detail: "填写节点公网监听端口，以及要转到的目标地址和端口。" },
          { title: "看诊断", detail: "如果不通或变慢，先看计数器、目标探测和节点资源。" },
        ]}
      />

      <div className="grid cols-4">
        <Metric label="节点在线" value={`${d.online_nodes || 0}/${d.nodes || 0}`} sub="90 秒内心跳视为在线" />
        <Metric label="启用规则" value={`${d.enabled_rules || 0}/${d.rules || 0}`} sub={`版本 ${d.rule_version || 0}`} />
        <Metric label="风险提示" value={findings.length} sub="来自节点指标和诊断" />
        <Metric label="转发模式" value="nftables" sub="默认走 Linux 内核路径" />
      </div>

      <TrafficPanel traffic={traffic} />

      <SectionHead title="诊断提示" />
      {findings.length ? (
        <FindingList findings={findings} />
      ) : (
        <EmptyState
          title="暂无风险提示"
          detail="当前没有发现明显异常。等节点和规则跑一段时间后，这里会显示更完整的判断。"
        />
      )}

      <SectionHead title="节点概览" />
      <NodeManager
        nodes={nodeList}
        rules={ruleList}
        counters={counters}
        reports={reports}
        isAdmin={isAdminRole(user?.role)}
      />
    </>
  );
}
