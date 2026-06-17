import { Bar, Eyebrow } from "./ui";
import { fmtBytes } from "../lib/format";
import { protocolText } from "../lib/labels";
import type { TrafficSummary } from "../lib/traffic";

export function TrafficPanel({ traffic }: { traffic: TrafficSummary }) {
  const max = Math.max(1, ...traffic.topRules.map((item) => item.bytes));
  const tcpPct = traffic.bytes ? Math.round((traffic.byProtocol.tcp / traffic.bytes) * 100) : 0;
  const udpPct = traffic.bytes ? Math.round((traffic.byProtocol.udp / traffic.bytes) * 100) : 0;

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
