import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchAdminSelf,
  fetchProfile,
  logout as apiLogout,
  clearAdminCsrfCache,
  subscribeAdminForbidden,
  resetAdminForbiddenState,
} from "@/lib/api-client";
import type { AdminUser, UserProfile } from "@/lib/types";

type AuthContextValue = {
  profile: UserProfile | null;
  adminUser: AdminUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  hasAdminAccess: boolean;
  error: unknown;
  refresh: () => void;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const queryClient = useQueryClient();
  const [adminRevoked, setAdminRevoked] = useState(false);
  const isClient = typeof window !== "undefined";

  const profileQuery = useQuery({
    queryKey: ["profile"],
    queryFn: fetchProfile,
    retry: false,
    staleTime: 30_000,
    enabled: isClient,
  });

  const profile = profileQuery.data ?? null;
  const adminQueryKey = useMemo(() => ["admin-user"] as const, []);
  const hasAdminRole = Boolean(profile?.is_admin);

  const adminQuery = useQuery({
    queryKey: adminQueryKey,
    queryFn: fetchAdminSelf,
    retry: false,
    enabled: isClient && hasAdminRole,
    staleTime: 30_000,
  });

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["profile"] });
    if (hasAdminRole) {
      queryClient.invalidateQueries({ queryKey: adminQueryKey });
    }
  }, [adminQueryKey, hasAdminRole, queryClient]);

  const logout = useCallback(async () => {
    await apiLogout();
    clearAdminCsrfCache();
    resetAdminForbiddenState();
    setAdminRevoked(false);
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => {
    const unsubscribe = subscribeAdminForbidden(() => {
      setAdminRevoked(true);
      clearAdminCsrfCache();
      queryClient.cancelQueries({
        predicate: (query) => {
          const root = Array.isArray(query.queryKey) ? query.queryKey[0] : undefined;
          return typeof root === "string" && root.startsWith("admin-");
        },
      });
      queryClient.removeQueries({
        predicate: (query) => {
          const root = Array.isArray(query.queryKey) ? query.queryKey[0] : undefined;
          return typeof root === "string" && root.startsWith("admin-");
        },
        type: "inactive",
      });
      queryClient.setQueryData(adminQueryKey, null);
    });
    return unsubscribe;
  }, [adminQueryKey, queryClient]);

  useEffect(() => {
    if (hasAdminRole && adminQuery.data) {
      setAdminRevoked(false);
      resetAdminForbiddenState();
    }
  }, [adminQuery.data, hasAdminRole]);

  useEffect(() => {
    if (!hasAdminRole) {
      setAdminRevoked(false);
      resetAdminForbiddenState();
      queryClient.setQueryData(adminQueryKey, null);
    }
  }, [adminQueryKey, hasAdminRole, queryClient]);

  const value = useMemo<AuthContextValue>(() => {
    const adminLoading = hasAdminRole ? adminQuery.isLoading : false;
    const isLoading = !isClient || profileQuery.isLoading || adminLoading;
    const error = profileQuery.error ?? (hasAdminRole ? adminQuery.error : null) ?? null;
    const adminUser = hasAdminRole ? adminQuery.data ?? null : null;
    return {
      profile,
      adminUser,
      isLoading,
      error,
      isAuthenticated: Boolean(profile),
      hasAdminAccess: hasAdminRole && !adminRevoked,
      refresh,
      logout,
    };
  }, [
    adminQuery.data,
    adminQuery.error,
    adminQuery.isLoading,
    adminRevoked,
    logout,
    isClient,
    hasAdminRole,
    profile,
    profileQuery.error,
    profileQuery.isLoading,
    refresh,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
};
