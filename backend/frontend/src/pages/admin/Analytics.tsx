import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, Database, Globe, Server, Users, Zap } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  fetchAdminUsers,
  fetchHealthConfig,
  fetchStatusDb,
  fetchStatusDeps,
  fetchStatusHealth,
  fetchVpsSessions,
  fetchWorkers,
} from "@/lib/api-client";
import type { AdminUsersResponse, HealthConfig, StatusDb, StatusDeps, StatusHealth } from "@/lib/types";

const formatNumber = (value: number | null | undefined, digits = 1) => {
  if (value === null || value === undefined) return "--";
  return Number(value).toFixed(digits);
};

const formatMs = (value: number | null | undefined) => {
  if (value === null || value === undefined) return "--";
  return `${value.toFixed(1)} ms`;
};

export default function Analytics() {
  const { data: health } = useQuery<StatusHealth>({
    queryKey: ["admin-health"],
    queryFn: fetchStatusHealth,
    staleTime: 60_000,
  });

  const { data: deps } = useQuery<StatusDeps>({
    queryKey: ["admin-deps"],
    queryFn: fetchStatusDeps,
    staleTime: 60_000,
  });

  const { data: dbStatus } = useQuery<StatusDb>({
    queryKey: ["admin-db-status"],
    queryFn: fetchStatusDb,
    staleTime: 60_000,
  });

  const { data: users } = useQuery<AdminUsersResponse>({
    queryKey: ["admin-users", "analytics"],
    queryFn: () => fetchAdminUsers({ page_size: 1, page: 1 }),
    staleTime: 60_000,
  });

  const { data: workers = [] } = useQuery({
    queryKey: ["admin-workers", "analytics"],
    queryFn: fetchWorkers,
    staleTime: 10_000,
  });

  const { data: sessions = [] } = useQuery({
    queryKey: ["vps-sessions", "analytics"],
    queryFn: fetchVpsSessions,
    staleTime: 10_000,
  });

  const { data: healthConfig } = useQuery<HealthConfig>({
    queryKey: ["health-config"],
    queryFn: fetchHealthConfig,
    staleTime: 60_000,
  });

  const currentOrigin = typeof window !== "undefined" ? window.location.origin : "";

  const summaries = useMemo(() => {
    const activeSessions = sessions.filter((session) => session.status !== "deleted").length;
    const readySessions = sessions.filter((session) => session.status === "ready").length;
    const busyWorkers = workers.filter((worker) => worker.status === "busy").length;
    const idleWorkers = workers.filter((worker) => worker.status === "idle").length;
    return { activeSessions, readySessions, busyWorkers, idleWorkers };
  }, [sessions, workers]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold mb-2">Operational Analytics</h1>
        <p className="text-muted-foreground">
          Real metrics fetched from LT4C&apos;s admin status endpoints.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: "API Status",
            value: health?.api_up ? "Online" : "Offline",
            description: health?.version ? `Version ${health.version}` : "Status via /status/health",
            icon: Activity,
          },
          {
            label: "Users in DB",
            value: users?.total?.toLocaleString() ?? "--",
            description: "Count from /admin/users",
            icon: Users,
          },
          {
            label: "Active Sessions",
            value: summaries.activeSessions.toString(),
            description: `${summaries.readySessions} ready`,
            icon: Server,
          },
          {
            label: "Workers",
            value: workers.length.toString(),
            description: `${summaries.busyWorkers} busy / ${summaries.idleWorkers} idle`,
            icon: Zap,
          },
          {
            label: "CORS Origins",
            value: healthConfig?.allowed_origins?.length
              ? healthConfig.allowed_origins.length.toString()
              : "--",
            description: healthConfig?.allowed_origins?.[0]
              ? `First origin: ${healthConfig.allowed_origins[0]}`
              : "From /health/config",
            icon: Globe,
          },
        ].map((stat) => (
          <Card key={stat.label} className="glass-card">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.label}</CardTitle>
              <stat.icon className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground mt-1">{stat.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="glass-card">
          <CardHeader>
            <CardTitle>Dependency Health</CardTitle>
            <CardDescription>Data from <code className="font-mono text-xs">/api/v1/admin/status/deps</code></CardDescription>
          </CardHeader>
          <CardContent>
            <div className="w-full overflow-x-auto rounded-lg border border-border/40">
              <Table>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium">Postgres Ping</TableCell>
                    <TableCell>{formatMs(deps?.db_ping_ms)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Redis Ping</TableCell>
                    <TableCell>{formatMs(deps?.redis_ping_ms)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Disk Free</TableCell>
                    <TableCell>{deps?.disk_free_mb ? `${deps.disk_free_mb.toFixed(0)} MB` : "--"}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">CPU Usage</TableCell>
                    <TableCell>{formatNumber(deps?.cpu_percent)}%</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Memory Usage</TableCell>
                    <TableCell>{formatNumber(deps?.memory_percent)}%</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle>Database Diagnostics</CardTitle>
            <CardDescription>Information from <code className="font-mono text-xs">/api/v1/admin/status/db</code></CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="w-full overflow-x-auto rounded-lg border border-border/40">
              <Table>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium">Version</TableCell>
                    <TableCell>{dbStatus?.version ?? "unknown"}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Active Connections</TableCell>
                    <TableCell>{dbStatus?.active_connections ?? "--"}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Last Migration</TableCell>
                    <TableCell>{dbStatus?.last_migration ?? "--"}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            <div>
              <h3 className="text-sm font-semibold mb-2">Slow Queries</h3>
              {dbStatus?.slow_queries?.length ? (
                <div className="space-y-2">
                  {dbStatus.slow_queries.map((entry) => (
                    <div key={entry.query} className="rounded-lg border border-border/40 p-3">
                      <code className="block text-xs break-all">{entry.query}</code>
                      <p className="text-xs text-muted-foreground mt-1">{entry.duration_ms.toFixed(2)} ms</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No slow queries reported.</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle>CORS Configuration</CardTitle>
          <CardDescription>
            Runtime data directly from <code className="font-mono text-xs">/health/config</code>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold mb-2">Allowed Origins</h3>
            {healthConfig?.allowed_origins?.length ? (
              <ul className="space-y-2">
                {healthConfig.allowed_origins.map((origin) => (
                  <li
                    key={origin}
                    className="flex items-center justify-between rounded-lg border border-border/40 px-3 py-2 text-sm"
                  >
                    <code className="break-all">{origin}</code>
                    {currentOrigin && origin === currentOrigin && (
                      <span className="ml-3 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600">
                        current
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No origins reported by the API.</p>
            )}
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border/40 px-3 py-2 text-sm">
            <span className="font-medium">Credentials</span>
            <span>{healthConfig?.allow_credentials ? "Enabled" : "Disabled"}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
