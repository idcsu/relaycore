import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { Layout } from "../components/Layout";
import { Spinner } from "../components/ui";
import { LoginPage } from "../pages/LoginPage";
import { DashboardPage } from "../pages/DashboardPage";
import { NodesPage } from "../pages/NodesPage";
import { RulesPage } from "../pages/RulesPage";
import { DiagnosticsPage } from "../pages/DiagnosticsPage";
import { TokensPage } from "../pages/TokensPage";
import { UsersPage } from "../pages/UsersPage";
import { SecurityPage } from "../pages/SecurityPage";
import { EventsPage } from "../pages/EventsPage";
import { isAdminRole } from "../lib/labels";

export function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="boot-screen">
        <Spinner label="正在加载控制台…" />
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  const admin = isAdminRole(user.role);

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="nodes" element={<NodesPage />} />
        <Route path="rules" element={<RulesPage />} />
        <Route path="diagnostics" element={<DiagnosticsPage />} />
        <Route path="security" element={<SecurityPage />} />
        {admin && <Route path="tokens" element={<TokensPage />} />}
        {admin && <Route path="users" element={<UsersPage />} />}
        {admin && <Route path="events" element={<EventsPage />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
