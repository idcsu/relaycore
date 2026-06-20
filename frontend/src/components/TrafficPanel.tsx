import { Bar, Eyebrow } from "./ui";
import { fmtBytes } from "../lib/format";
import { protocolText } from "../lib/labels";
import type { TrafficSummary } from "../lib/traffic";

export function TrafficPanel({ traffic }: { traffic: TrafficSummary }) {
  const max = Math.max(1, ...traffic.topRules.map((item) => item.bytes));
  const nodeMax = Math.max(1, ...traffic.byNode.map((item) => item.bytes));
  const tcpPct = traffic.bytes ? Math.round((traffic.byProtocol.tcp / traffic.bytes) * 100) : 0;
  const udpPct = traffic.bytes ? Math.round((traffic.byProtocol.udp / traffic.bytes) * 100) : 0;
  const activeNodes = traffic.byNode.filter((item) => item.bytes > 0).length;
  const topNode = traffic.topNode?.bytes ? traffic.topNode : null;

  return (
    <div className="traffic-panel panel pad">
      <div className="traffic-head">
        <div>
          <Eyebrow>流量统计</Eyebrow>
          <h2>中转累计流量</h2>
          <p>基于 Agent 上报的 nftables counter 统计，适合判断哪些规则正在吃流量。</p>
        </div>
        <div className="traffic-total">
          <strong>{fmtBytes(traffic.bytes)}</strong>
          <span>{traffic.packets} 次连接/包</span>
        </div>
      </div>
      <div className="traffic-insights">
        <div>
          <span>总使用流量</span>
          <strong>{fmtBytes(traffic.bytes)}</strong>
          <em>全部规则 counter 累计</em>
        </div>
        <div>
          <span>有流量节点</span>
          <strong>
            {activeNodes}/{traffic.byNode.length}
          </strong>
          <em>全部已接入节点</em>
        </div>
        <div>
          <span>最高流量节点</span>
          <strong>{topNode?.node?.name || topNode?.node_id || "-"}</strong>
          <em>{topNode ? fmtBytes(topNode.bytes) : "暂无流量"}</em>
        </div>
      </div>
      <div className="traffic-split">
        <div>
          <span>TCP {tcpPct}%</span>
          <Bar value={tcpPct} />
        </div>
        <div>
          <span>UDP {udpPct}%</span>
          <Bar value={udpPct} variant="udp" />
        </div>
      </div>
      <div className="traffic-section-title">
        <strong>节点流量占比</strong>
        <span>用于判断哪台中转节点承担了更多流量。</span>
      </div>
      <div className="traffic-node-list">
        {traffic.byNode.length ? (
          traffic.byNode.slice(0, 6).map((item, idx) => (
            <div className="traffic-node-row" key={item.node_id}>
              <div>
                <strong>{item.node?.name || item.node_id}</strong>
                <span>
                  {item.enabledRuleCount}/{item.ruleCount} 条启用规则
                </span>
              </div>
              <Bar value={Math.max(item.bytes ? 4 : 0, Math.round((item.bytes / nodeMax) * 100))} variant={`bar-${idx % 5}`} />
              <b className="traffic-value">{fmtBytes(item.bytes)}</b>
            </div>
          ))
        ) : (
          <div className="empty-inline">暂无节点规则数据。先接入节点并创建规则后，这里会显示节点流量占比。</div>
        )}
      </div>
      <div className="traffic-section-title">
        <strong>规则流量排行</strong>
        <span>用于快速找出最常被访问的转发规则。</span>
      </div>
      <div className="traffic-bars">
        {traffic.topRules.length ? (
          traffic.topRules.map((item, idx) => (
            <div className="traffic-row" key={item.rule_id}>
              <div>
                <strong>{item.rule?.name || item.rule_id}</strong>
                <span>
                  {item.rule ? `${protocolText(item.rule.protocol)} :${item.rule.listen_port}` : item.rule_id}
                </span>
              </div>
              <Bar value={Math.max(4, Math.round((item.bytes / max) * 100))} variant={`bar-${idx % 5}`} />
              <b className="traffic-value">{fmtBytes(item.bytes)}</b>
            </div>
          ))
        ) : (
          <div className="empty-inline">暂无 counter 数据。创建规则并产生访问后，这里会显示流量排行。</div>
        )}
      </div>
    </div>
  );
}
