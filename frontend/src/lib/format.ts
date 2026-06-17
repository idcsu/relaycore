export function fmtBytes(value: number | undefined | null): string {
  let v = Number(value || 0);
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i ? 1 : 0)} ${units[i]}`;
}

export function pct(part: number | undefined | null, total: number | undefined | null): string {
  if (!total) return "0%";
  return `${Math.round((Number(part || 0) / Number(total)) * 100)}%`;
}

export function pctValue(part: number | undefined | null, total: number | undefined | null): number {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((Number(part || 0) / Number(total)) * 100)));
}

export function fmtDuration(seconds: number | undefined | null): string {
  const s = Number(seconds || 0);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (days) return `${days} 天 ${hours} 小时`;
  if (hours) return `${hours} 小时 ${minutes} 分钟`;
  return `${minutes} 分钟`;
}

export function fmtSigned(value: number | undefined | null): string {
  const v = Number(value || 0);
  return v > 0 ? `+${v}` : String(v);
}

export function formatRatio(value: number | undefined | null): string {
  const v = Number(value || 0);
  return `${Math.min(100, v * 100).toFixed(2)}%`;
}

export function formatBytesPerSecond(value: number | undefined | null): string {
  return `${fmtBytes(Number(value || 0))}/s`;
}

export function formatPacketsPerSecond(value: number | undefined | null): string {
  const v = Number(value || 0);
  return `${v.toFixed(v >= 10 ? 1 : 2)} 包/秒`;
}

export function formatTime(value: string | number | undefined | null): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}

export function tcpRetransRatio(metrics?: { tcp_out_segments?: number; tcp_retrans_segments?: number }): string {
  const out = Number(metrics?.tcp_out_segments || 0);
  const retrans = Number(metrics?.tcp_retrans_segments || 0);
  if (!out) return "0%";
  return `${Math.min(100, (retrans / out) * 100).toFixed(2)}%`;
}
