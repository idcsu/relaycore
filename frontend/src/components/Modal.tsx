import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  width = 640,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.classList.add("no-scroll");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("no-scroll");
    };
  }, [onClose]);

  return createPortal(
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" style={{ maxWidth: width }} onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle != null && <p>{subtitle}</p>}
          </div>
          <button className="btn" type="button" onClick={onClose}>
            关闭
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
