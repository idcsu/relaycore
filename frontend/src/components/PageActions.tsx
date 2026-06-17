import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function PageActions({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setHost(document.getElementById("page-actions"));
  }, []);

  if (!host) return null;
  return createPortal(children, host);
}
