import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { queryKeys } from "../api/hooks";
import type { MeResponse, User } from "../api/types";

interface AuthState {
  user: User | null;
  version: string;
  loading: boolean;
  setSession: (me: MeResponse) => void;
  clearSession: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.me,
    queryFn: () => api<MeResponse>("/api/me"),
    retry: false,
    staleTime: 60_000,
  });

  const value = useMemo<AuthState>(
    () => ({
      user: data?.user ?? null,
      version: data?.version ?? "",
      loading: isLoading,
      setSession: (me: MeResponse) => {
        queryClient.setQueryData(queryKeys.me, me);
      },
      clearSession: () => {
        queryClient.setQueryData(queryKeys.me, null);
        queryClient.clear();
      },
    }),
    [data, isLoading, queryClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
