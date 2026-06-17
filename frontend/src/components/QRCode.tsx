import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function QRCodeView({ value }: { value: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    QRCode.toString(value, { type: "svg", margin: 2, width: 200 })
      .then((markup) => {
        if (active) setSvg(markup);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [value]);

  if (failed) {
    return <div className="qr-fallback">二维码生成失败，请使用下方密钥手动录入。</div>;
  }
  if (!svg) {
    return <div className="qr-fallback">二维码生成中…</div>;
  }
  return <div className="qr-svg" dangerouslySetInnerHTML={{ __html: svg }} />;
}
