import { useQuery } from "@tanstack/react-query";
import { api } from "./client";
import type {
  AuditEvent,
  DashboardResponse,
  DiagnosticsResponse,
  ListResponse,
  Node,
  NodeToken,
  RulesResponse,
  User,
} from "./types";

export const queryKeys = {
  me: ["me"] as const,
  dashboard: ["dashboard"] as const,
  nodes: ["nodes"] as const,
  rules: ["rules"] as const,
  diagnostics: ["diagnostics"] as const,
  tokens: ["node-tokens"] as const,
  users: ["users"] as const,
  events: ["events"] as const,
};

export function useDashboard() {
  return useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: () => api<DashboardResponse>("/api/dashboard"),
  });
}

export function useNodes() {
  return useQuery({
    queryKey: queryKeys.nodes,
    queryFn: () => api<ListResponse<Node>>("/api/nodes"),
  });
}

export function useRules() {
  return useQuery({
    queryKey: queryKeys.rules,
    queryFn: () => api<RulesResponse>("/api/rules"),
  });
}

export function useDiagnostics(enabled = true) {
  return useQuery({
    queryKey: queryKeys.diagnostics,
    queryFn: () => api<DiagnosticsResponse>("/api/diagnostics"),
    enabled,
  });
}

export function useTokens(enabled = true) {
  return useQuery({
    queryKey: queryKeys.tokens,
    queryFn: () => api<ListResponse<NodeToken>>("/api/node-tokens"),
    enabled,
  });
}

export function useUsers(enabled = true) {
  return useQuery({
    queryKey: queryKeys.users,
    queryFn: () => api<ListResponse<User>>("/api/users"),
    enabled,
  });
}

export function useEvents(enabled = true) {
  return useQuery({
    queryKey: queryKeys.events,
    queryFn: () => api<ListResponse<AuditEvent>>("/api/events"),
    enabled,
  });
}
