import type { ReactNode } from "react";
import type { Finding } from "../api/types";
import { severityText } from "../lib/labels";
import type { Tone } from "../lib/labels";

export function Badge({ children, tone = "info" }: { children: ReactNode; tone?: Tone }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Panel({
  children,
  pad = false,
  className = "",
}: {
  children: ReactNode;
  pad?: boolean;
  className?: string;
}) {
  return <div className={`panel ${pad ? "pad" : ""} ${className}`.trim()}>{children}</div>;
}

export function Metric({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="panel pad metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {sub != null && <small>{sub}</small>}
    </div>
  );
}

export function SectionHead({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div className="section-head">
      <h2>{title}</h2>
      {actions}
    </div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <span className="eyebrow">{children}</span>;
}

export function FieldHelp({ children }: { children: ReactNode }) {
  return <small className="field-help">{children}</small>;
}

export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: string }) {
  return (
    <div className="panel empty-state">
      <strong>{title}</strong>
      <p>{detail}</p>
      {action && <span>{action}</span>}
    </div>
  );
}

export interface HelperStep {
  title: string;
  detail: string;
}

export function HelperCard({ title, detail, steps = [] }: { title: string; detail: string; steps?: HelperStep[] }) {
  return (
    <div className="panel pad helper-card">
      <div>
        <Eyebrow>新手提示</Eyebrow>
        <h2>{title}</h2>
        <p>{detail}</p>
      </div>
      {steps.length > 0 && (
        <div className="helper-steps">
          {steps.map((step, idx) => (
            <div key={idx}>
              <span>{idx + 1}</span>
              <strong>{step.title}</strong>
              <p>{step.detail}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function FindingItem({ finding }: { finding: Finding }) {
  return (
    <div className={`finding ${finding.severity}`}>
      <span>{severityText(finding.severity)}</span>
      <strong>{finding.title}</strong>
      <p>{finding.detail}</p>
    </div>
  );
}

export function FindingList({ findings }: { findings: Finding[] }) {
  return (
    <div className="finding-list">
      {findings.map((f, idx) => (
        <FindingItem key={idx} finding={f} />
      ))}
    </div>
  );
}

export function Bar({ value, variant = "" }: { value: number; variant?: string }) {
  const width = Math.max(0, Math.min(100, value));
  return (
    <b className="bar-track">
      <i className={variant} style={{ width: `${width}%` }} />
    </b>
  );
}

export function CodeBox({ children }: { children: ReactNode }) {
  return <pre className="codebox">{children}</pre>;
}

export function Spinner({ label = "加载中…" }: { label?: string }) {
  return (
    <div className="loading-block">
      <span className="spinner" aria-hidden />
      <span>{label}</span>
    </div>
  );
}
