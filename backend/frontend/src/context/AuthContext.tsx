import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchAdminUser,
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

const useAdminQueryKey = (profile: UserProfile | null) => ["admin-user", profile?.id] as const;

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
  const adminQueryKey = useMemo(() => useAdminQueryKey(profile), [profile?.id]);

  const adminQuery = useQuery({
    queryKey: adminQueryKey,
    queryFn: () => fetchAdminUser(profile!.id),
    retry: false,
    enabled: isClient && !!profile,
    staleTime: 30_000,
  });

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["profile"] });
    if (profile) {
      queryClient.invalidateQueries({ queryKey: useAdminQueryKey(profile) });
    }
  }, [profile, queryClient]);

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
    if (adminQuery.data) {
      setAdminRevoked(false);
      resetAdminForbiddenState();
    }
  }, [adminQuery.data]);

  const value = useMemo<AuthContextValue>(() => {
    const isLoading = !isClient || profileQuery.isLoading || adminQuery.isLoading;
    const error = profileQuery.error ?? adminQuery.error ?? null;
    const adminUser = adminQuery.data ?? null;
    return {
      profile,
      adminUser,
      isLoading,
      error,
      isAuthenticated: Boolean(profile),
      hasAdminAccess: Boolean(adminUser) && !adminRevoked,
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
