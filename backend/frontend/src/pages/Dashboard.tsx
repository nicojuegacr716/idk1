import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { Server, Zap, MessageSquare, Activity, ArrowRight, PenLine } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/context/AuthContext";
import {
  fetchSupportThreads,
  fetchVpsSessions,
  fetchStatusHealth,
  fetchKyaroPrompt,
  updateKyaroPrompt,
} from "@/lib/api-client";
import type { SupportThread, VpsSession, KyaroPrompt } from "@/lib/types";
import { toast } from "@/components/ui/sonner";

const formatCoins = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 0 });

const isActiveSession = (session: VpsSession) => !["deleted", "expired"].includes(session.status);

const timeAgo = (value: string | null) => {
  if (!value) return "unknown";
  try {
    return `${formatDistanceToNow(new Date(value), { addSuffix: true })}`;
  } catch {
    return "unknown";
  }
};

const sessionTitle = (session: VpsSession) => session.product?.name || "VPS Session";

export default function Dashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { profile, hasAdminAccess } = useAuth();

  const {
    data: sessions = [],
    isLoading: sessionsLoading,
  } = useQuery({
    queryKey: ["vps-sessions"],
    queryFn: fetchVpsSessions,
    staleTime: 10_000,
  });

  const {
    data: threads = [],
    isLoading: threadsLoading,
  } = useQuery({
    queryKey: ["support-threads"],
    queryFn: fetchSupportThreads,
    staleTime: 15_000,
  });

  const { data: healthStatus } = useQuery({
    queryKey: ["admin-health"],
    queryFn: fetchStatusHealth,
    enabled: hasAdminAccess,
    staleTime: 60_000,
  });

  const {
    data: kyaroPrompt,
    isLoading: kyaroLoading,
  } = useQuery<KyaroPrompt>({
    queryKey: ["admin-settings", "kyaro"],
    queryFn: fetchKyaroPrompt,
    enabled: hasAdminAccess,
    staleTime: 60_000,
  });

  const [promptDraft, setPromptDraft] = useState("");
  const [promptTouched, setPromptTouched] = useState(false);

  useEffect(() => {
    if (kyaroPrompt?.prompt !== undefined && !promptTouched) {
      setPromptDraft(kyaroPrompt.prompt);
    }
  }, [kyaroPrompt?.prompt, promptTouched]);

  const updatePromptMutation = useMutation({
    mutationFn: updateKyaroPrompt,
    onSuccess: (data) => {
      toast("Kyaro prompt updated.");
      queryClient.setQueryData(["admin-settings", "kyaro"], data);
      setPromptTouched(false);
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Failed to update Kyaro prompt.";
      toast(message);
    },
  });

  const activeSessions = useMemo(() => sessions.filter(isActiveSession), [sessions]);
  const readySessions = useMemo(() => sessions.filter((s) => s.status === "ready"), [sessions]);
  const provisioningSessions = useMemo(() => sessions.filter((s) => s.status === "provisioning"), [sessions]);

  const recentActivity = useMemo(() => {
    const sorted = [...sessions].sort((a, b) => {
      const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0;
      const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0;
      return bTime - aTime;
    });
    return sorted.slice(0, 5);
  }, [sessions]);

  const stats = [
    {
      title: "Active VPS",
      value: sessionsLoading ? "..." : String(activeSessions.length),
      description: `${readySessions.length} ready / ${provisioningSessions.length} provisioning`,
      icon: Server,
      accent: "text-primary",
    },
    {
      title: "Coin Balance",
      value: formatCoins(profile?.coins ?? 0),
      description: "Fetched from /me",
      icon: Zap,
      accent: "text-warning",
    },
    {
      title: "Support Threads",
      value: threadsLoading ? "..." : String(threads.length),
      description: "AI + human support history",
      icon: MessageSquare,
      accent: "text-secondary",
    },
    ...(hasAdminAccess
      ? [
          {
            title: "API Health",
            value: healthStatus?.api_up ? "Online" : "Offline",
            description: healthStatus?.version ? `Version ${healthStatus.version}` : "via /api/v1/admin/status/health",
            icon: Activity,
            accent: healthStatus?.api_up ? "text-success" : "text-destructive",
          },
        ]
      : []),
  ];

  const promptChanged = useMemo(() => promptDraft !== (kyaroPrompt?.prompt ?? ""), [promptDraft, kyaroPrompt?.prompt]);
  const promptValid = promptDraft.trim().length > 0;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-3xl font-bold mb-2">Welcome back, {profile?.display_name || profile?.username || "operator"}!</h1>
          <p className="text-muted-foreground">
            This dashboard reflects live data from the LT4C FastAPI backend. Sessions, support threads, and status checks are real.
          </p>
        </div>
        <div className="flex gap-2">
          <Button className="gap-2" onClick={() => navigate("/vps")}>
            Launch VPS
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.title} className="glass-card hover-lift">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
              <stat.icon className={`w-5 h-5 ${stat.accent}`} />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground mt-1">{stat.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="glass-card">
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Jump into the areas powered by live endpoints</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button className="w-full justify-start" variant="outline" size="lg" onClick={() => navigate("/vps")}>
              <Server className="w-5 h-5 mr-3" />
              Create New VPS Session
            </Button>
            <Button className="w-full justify-start" variant="outline" size="lg" onClick={() => navigate("/support")}>
              <MessageSquare className="w-5 h-5 mr-3" />
              Open Support Inbox
            </Button>
            {hasAdminAccess && (
              <Button className="w-full justify-start" variant="outline" size="lg" onClick={() => navigate("/admin/analytics")}>
                <Activity className="w-5 h-5 mr-3" />
                Inspect System Health
              </Button>
            )}
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle>Support Summary</CardTitle>
            <CardDescription>Threads served by AI assistant and human agents</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {threadsLoading && <p className="text-sm text-muted-foreground">Loading support history...</p>}
            {!threadsLoading && threads.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No support conversations yet. Start one from the Support page.
              </p>
            )}
            {!threadsLoading &&
              threads.slice(0, 4).map((thread: SupportThread) => (
                <div key={thread.id} className="flex items-center justify-between rounded-lg border border-border/40 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium capitalize">{thread.source} assistant</p>
                    <p className="text-xs text-muted-foreground">Updated {timeAgo(thread.updated_at)}</p>
                  </div>
                  <span className="text-xs font-semibold uppercase text-muted-foreground">{thread.status}</span>
                </div>
              ))}
          </CardContent>
        </Card>
      </div>

      {hasAdminAccess && (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PenLine className="w-4 h-4" />
              Kyaro Prompt
            </CardTitle>
            <CardDescription>Adjust how the assistant responds across the platform.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={promptDraft}
              onChange={(event) => {
                setPromptDraft(event.target.value);
                setPromptTouched(true);
              }}
              className="h-48 glass-card"
              placeholder="Describe how Kyaro should respond to admins and users..."
              disabled={kyaroLoading || updatePromptMutation.isLoading}
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Version: {kyaroPrompt?.version ?? "--"}</span>
              <span>Updated at: {kyaroPrompt?.updated_at ?? "--"}</span>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setPromptDraft(kyaroPrompt?.prompt ?? "");
                  setPromptTouched(false);
                }}
                disabled={!promptChanged || updatePromptMutation.isLoading}
              >
                Reset
              </Button>
              <Button
                onClick={() => updatePromptMutation.mutate(promptDraft.trim())}
                disabled={!promptChanged || !promptValid || updatePromptMutation.isLoading}
              >
                {updatePromptMutation.isLoading ? "Saving..." : "Save Prompt"}
              </Button>
            </div>
            {!promptValid && <p className="text-xs text-destructive">Prompt cannot be empty.</p>}
          </CardContent>
        </Card>
      )}

      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Recent VPS Activity</CardTitle>
          <CardDescription>
            Based on <code className="font-mono text-xs">/vps/sessions</code> and worker callbacks
          </CardDescription>
        </CardHeader>
        <CardContent>
          {recentActivity.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No sessions yet. Create one from the VPS page to see live provisioning data.
            </p>
          ) : (
            <div className="space-y-4">
              {recentActivity.map((session) => (
                <div
                  key={session.id}
                  className="flex flex-col gap-2 rounded-lg border border-border/50 p-4 transition-colors hover:bg-muted/40"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold">{sessionTitle(session)}</p>
                      <p className="text-xs text-muted-foreground">Session ID: {session.id}</p>
                    </div>
                    <span className="text-xs uppercase font-semibold text-muted-foreground">{session.status}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Updated {timeAgo(session.updated_at)}</span>
                    {session.stream && (
                      <a className="text-primary hover:underline" href={session.stream} target="_blank" rel="noreferrer">
                        Stream events -&gt;
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
