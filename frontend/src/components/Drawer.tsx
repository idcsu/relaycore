import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function Drawer({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
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
    <div className="drawer-backdrop" onMouseDown={onClose}>
      <aside className="drawer" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <div>
            <h2>{title}</h2>
            {subtitle != null && <p className="mono">{subtitle}</p>}
          </div>
          <button className="btn" type="button" onClick={onClose}>
            关闭
          </button>
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}

export function DrawerSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="drawer-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}
