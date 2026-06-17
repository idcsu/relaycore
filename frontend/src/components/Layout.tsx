import { useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useAuth } from "../app/AuthContext";
import { useToast } from "../app/ToastContext";
import { NAV_ITEMS } from "../app/navConfig";
import { isAdminRole, roleText } from "../lib/labels";

export interface PageActionsContext {
  setActions: (actions: ReactNode) => void;
}

export function Layout() {
  const { user, version, clearSession } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const items = NAV_ITEMS.filter((item) => !item.adminOnly || isAdminRole(user?.role));
  const current = items.find((item) => item.path === location.pathname) ?? items[0];

  const onLogout = async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    clearSession();
  };

  const onRefresh = async () => {
    await queryClient.invalidateQueries();
    toast("已刷新", "ok");
  };

  return (
    <div className={`app-shell ${mobileOpen ? "nav-open" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-title">
          <div className="brand-mark">RC</div>
          <div>
            <strong>RelayCore</strong>
            <span>v{version}</span>
          </div>
        </div>
        <nav className="nav">
          {items.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === "/"}
              className={({ isActive }) => (isActive ? "active" : "")}
              onClick={() => setMobileOpen(false)}
            >
              <span>{item.short}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <strong>{user?.username}</strong>
          <div>{roleText(user?.role)}</div>
          <button className="btn ghost" type="button" onClick={onLogout}>
            退出登录
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="topbar-title">
            <button
              className="btn nav-toggle"
              type="button"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="切换导航"
            >
              菜单
            </button>
            <div>
              <h1>{current.label}</h1>
              <p>{current.subtitle}</p>
            </div>
          </div>
          <div className="toolbar">
            <button className="btn" type="button" onClick={onRefresh}>
              刷新数据
            </button>
            <div id="page-actions" className="toolbar" />
          </div>
        </header>
        <section className="content">
          <Outlet />
        </section>
      </main>
    </div>
  );
}
