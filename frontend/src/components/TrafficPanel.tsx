import { Bar, Eyebrow } from "./ui";
import { fmtBytes } from "../lib/format";
import { protocolText } from "../lib/labels";
import type { TrafficSummary } from "../lib/traffic";

function shortTime(value?: string): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function TrafficPanel({ traffic }: { traffic: TrafficSummary }) {
  const max = Math.max(1, ...traffic.topRules.map((item) => item.bytes));
  const nodeMax = Math.max(1, ...traffic.byNode.map((item) => item.bytes));
  const tcpPct = traffic.bytes ? Math.round((traffic.byProtocol.tcp / traffic.bytes) * 100) : 0;
  const udpPct = traffic.bytes ? Math.round((traffic.byProtocol.udp / traffic.bytes) * 100) : 0;
  const activeNodes = traffic.byNode.filter((item) => item.bytes > 0).length;
  const topNode = traffic.topNode?.bytes ? traffic.topNode : null;
  const trend = traffic.series || [];
  const trendMax = Math.max(1, ...trend.map((item) => Number(item.bytes || 0)));
  const trendBytes = trend.reduce((sum, item) => sum + Number(item.bytes || 0), 0);
  const trendPoints = trend.map((item, idx) => {
    const x = trend.length <= 1 ? 0 : (idx / (trend.length - 1)) * 100;
    const y = 46 - (Number(item.bytes || 0) / trendMax) * 40;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const trendArea = trendPoints.length ? `0,50 ${trendPoints.join(" ")} 100,50` : "";
  const sourceText =
    traffic.source === "cumulative"
      ? "Panel 按每次心跳的 counter 增量累计；nftables counter 重置后也会继续累加。"
      : "当前只使用最新 counter 值，等待面板升级后会切换为增量累计。";

  return (
    <div className="traffic-panel panel pad">
      <div className="traffic-head">
        <div>
          <Eyebrow>流量统计</Eyebrow>
          <h2>中转流量分析</h2>
          <p>{sourceText}</p>
        </div>
        <div className="traffic-total">
          <strong>{fmtBytes(traffic.bytes)}</strong>
          <span>累计 {traffic.packets} 次连接/包</span>
        </div>
      </div>
      <div className="traffic-insights">
        <div>
          <span>累计中转流量</span>
          <strong>{fmtBytes(traffic.bytes)}</strong>
          <em>按规则增量累计</em>
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
      <div className="traffic-chart">
        <div className="traffic-chart-head">
          <div>
            <strong>最近 1 小时新增流量</strong>
            <span>每 5 分钟聚合一次，适合观察是否突然上涨。</span>
          </div>
          <b>{fmtBytes(trendBytes)}</b>
        </div>
        {trendPoints.length ? (
          <>
            <svg viewBox="0 0 100 54" preserveAspectRatio="none" aria-hidden>
              <polygon points={trendArea} />
              <polyline points={trendPoints.join(" ")} />
            </svg>
            <div className="traffic-chart-axis">
              <span>{shortTime(trend[0]?.at)}</span>
              <span>{shortTime(trend[trend.length - 1]?.at)}</span>
            </div>
          </>
        ) : (
          <div className="empty-inline">暂无足够历史样本。等待几次 Agent 心跳后会出现趋势曲线。</div>
        )}
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
                <strong>{item.rule?.name || item.name || item.rule_id}</strong>
                <span>
                  {item.rule
                    ? `${protocolText(item.rule.protocol)} :${item.rule.listen_port}`
                    : item.listenPort
                      ? `${protocolText(item.protocol)} :${item.listenPort}`
                      : item.rule_id}
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
