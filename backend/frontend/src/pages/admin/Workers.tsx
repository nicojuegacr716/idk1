import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Copy,
  Eye,
  Gauge,
  Loader2,
  Pencil,
  Plug,
  Power,
  RefreshCw,
  Server,
  Users,
  Zap,
  Plus,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/components/ui/sonner";
import {
  checkWorkerHealth,
  disableWorker,
  fetchWorkerDetail,
  fetchWorkers,
  registerWorker,
  updateWorker,
} from "@/lib/api-client";
import type { WorkerDetail, WorkerHealthStatus, WorkerInfo } from "@/lib/types";

const statusBadge = (status: string) => {
  switch (status) {
    case "active":
      return "bg-success text-success-foreground";
    case "disabled":
      return "bg-muted text-muted-foreground";
    default:
      return "bg-muted text-muted-foreground";
  }
};

const formatDateTime = (iso: string | null | undefined) => {
  if (!iso) return "--";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  return date.toLocaleString();
};

type WorkerFormState = {
  name: string;
  base_url: string;
  max_sessions: number;
};

const DEFAULT_FORM: WorkerFormState = {
  name: "",
  base_url: "",
  max_sessions: 3,
};

const sanitizeUrl = (value: string) => value.trim();

export default function Workers() {
  const queryClient = useQueryClient();
  const [registerOpen, setRegisterOpen] = useState(false);
  const [registerForm, setRegisterForm] = useState<WorkerFormState>(DEFAULT_FORM);
  const [editWorker, setEditWorker] = useState<WorkerInfo | null>(null);
  const [editForm, setEditForm] = useState<WorkerFormState>(DEFAULT_FORM);
  const [detailWorkerId, setDetailWorkerId] = useState<string | null>(null);
  const [healthStatus, setHealthStatus] = useState<WorkerHealthStatus | null>(null);

  const { data: workers = [], isLoading } = useQuery<WorkerInfo[]>({
    queryKey: ["admin-workers"],
    queryFn: fetchWorkers,
    staleTime: 10_000,
  });

  const detailQuery = useQuery<WorkerDetail>({
    queryKey: ["admin-worker", detailWorkerId],
    queryFn: () => fetchWorkerDetail(detailWorkerId!),
    enabled: Boolean(detailWorkerId),
  });

  useEffect(() => {
    if (editWorker) {
      setEditForm({
        name: editWorker.name ?? "",
        base_url: editWorker.base_url,
        max_sessions: editWorker.max_sessions,
      });
    } else {
      setEditForm(DEFAULT_FORM);
    }
  }, [editWorker]);

  useEffect(() => {
    setHealthStatus(null);
  }, [detailWorkerId]);

  const registerMutation = useMutation({
    mutationFn: registerWorker,
    onSuccess: () => {
      toast("Worker registered.");
      setRegisterOpen(false);
      setRegisterForm(DEFAULT_FORM);
      queryClient.invalidateQueries({ queryKey: ["admin-workers"] });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Failed to register worker.";
      toast(message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: { name?: string | null; base_url?: string | null; max_sessions?: number | null; status?: "active" | "disabled" | null } }) =>
      updateWorker(id, payload),
    onSuccess: (_, variables) => {
      toast("Worker updated.");
      if (variables.payload.status === "active") {
        toast("Worker enabled.", { description: "Status set to active." });
      }
      setEditWorker(null);
      queryClient.invalidateQueries({ queryKey: ["admin-workers"] });
      if (detailWorkerId) {
        queryClient.invalidateQueries({ queryKey: ["admin-worker", detailWorkerId] });
      }
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Failed to update worker.";
      toast(message);
    },
  });

  const disableMutation = useMutation({
    mutationFn: disableWorker,
    onSuccess: () => {
      toast("Worker disabled.");
      queryClient.invalidateQueries({ queryKey: ["admin-workers"] });
      if (detailWorkerId) {
        queryClient.invalidateQueries({ queryKey: ["admin-worker", detailWorkerId] });
      }
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Failed to disable worker.";
      toast(message);
    },
  });

  const healthMutation = useMutation({
    mutationFn: checkWorkerHealth,
    onSuccess: (data) => {
      setHealthStatus(data);
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Worker health check failed.";
      toast(message);
    },
  });

  const summary = useMemo(() => {
    const total = workers.length;
    const active = workers.filter((worker) => worker.status === "active").length;
    const activeSessions = workers.reduce((sum, worker) => sum + worker.active_sessions, 0);
    const capacity = workers.reduce((sum, worker) => sum + worker.max_sessions, 0);
    const available = Math.max(capacity - activeSessions, 0);
    return { total, active, activeSessions, capacity, available };
  }, [workers]);

  const handleRegisterSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const payload = {
      name: registerForm.name.trim() || null,
      base_url: sanitizeUrl(registerForm.base_url),
      max_sessions: registerForm.max_sessions,
    };
    if (!payload.base_url) {
      toast("Worker base URL is required.");
      return;
    }
    registerMutation.mutate(payload);
  };

  const handleEditSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editWorker) return;
    const payload = {
      name: editForm.name.trim() || null,
      base_url: sanitizeUrl(editForm.base_url) || null,
      max_sessions: editForm.max_sessions,
    };
    updateMutation.mutate({ id: editWorker.id, payload });
  };

  const handleToggleStatus = (worker: WorkerInfo) => {
    if (worker.status === "active") {
      disableMutation.mutate(worker.id);
    } else {
      updateMutation.mutate({ id: worker.id, payload: { status: "active" } });
    }
  };

  const handleCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast("Copied to clipboard");
    } catch {
      toast("Failed to copy.");
    }
  };

  const detail = detailQuery.data;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold mb-2">Worker Management</h1>
          <p className="text-muted-foreground">
            Workers expose the endpoints described in <code className="font-mono text-xs">Workers_Docs.md</code>. All calls are
            orchestrated server-side to protect credentials.
          </p>
        </div>
        <Button className="gap-2" onClick={() => setRegisterOpen(true)}>
          <Plus className="w-4 h-4" />
          Register Worker
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-5">
        {[
          { label: "Total Workers", value: summary.total.toString(), icon: Server },
          { label: "Active Workers", value: summary.active.toString(), icon: Activity },
          { label: "Active Sessions", value: summary.activeSessions.toString(), icon: Users },
          { label: "Total Capacity", value: summary.capacity.toString(), icon: Gauge },
          { label: "Available Slots", value: summary.available.toString(), icon: Zap },
        ].map((stat) => (
          <Card key={stat.label} className="glass-card">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.label}</CardTitle>
              <stat.icon className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6">
        {isLoading && (
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Loading workers...</CardTitle>
            </CardHeader>
          </Card>
        )}
        {!isLoading && workers.length === 0 && (
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>No workers registered</CardTitle>
              <CardDescription>Register worker endpoints before provisioning VPS sessions.</CardDescription>
            </CardHeader>
          </Card>
        )}
        {!isLoading &&
          workers.map((worker) => {
            const isDisabled = worker.status === "disabled";
            return (
              <Card key={worker.id} className="glass-card">
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <CardTitle className="text-lg">{worker.name || "Unnamed worker"}</CardTitle>
                      <CardDescription className="text-xs">{worker.base_url}</CardDescription>
                    </div>
                    <Badge className={statusBadge(worker.status)}>{worker.status.toUpperCase()}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                    <Metric label="Active Sessions" value={worker.active_sessions.toString()} />
                    <Metric label="Max Sessions" value={worker.max_sessions.toString()} />
                    <Metric label="Created" value={formatDateTime(worker.created_at)} />
                    <Metric label="Updated" value={formatDateTime(worker.updated_at)} />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-2"
                      onClick={() => setDetailWorkerId(worker.id)}
                    >
                      <Eye className="w-4 h-4" />
                      View details
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-2"
                      onClick={() => setEditWorker(worker)}
                    >
                      <Pencil className="w-4 h-4" />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-2"
                      onClick={() => handleToggleStatus(worker)}
                      disabled={disableMutation.isLoading || updateMutation.isLoading}
                    >
                      {worker.status === "active" ? (
                        <>
                          <Power className="w-4 h-4" />
                          Disable
                        </>
                      ) : (
                        <>
                          <Plug className="w-4 h-4" />
                          Enable
                        </>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
      </div>

      <Dialog open={registerOpen} onOpenChange={setRegisterOpen}>
        <DialogContent className="glass-card max-w-lg">
          <DialogHeader>
            <DialogTitle>Register Worker</DialogTitle>
            <DialogDescription>
              Provide a friendly name, base URL, and optional capacity for the new worker endpoint.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleRegisterSubmit} className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="register-name">Name</Label>
              <Input
                id="register-name"
                value={registerForm.name}
                onChange={(event) => setRegisterForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="Optional label"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="register-base-url">Base URL</Label>
              <Input
                id="register-base-url"
                value={registerForm.base_url}
                onChange={(event) => setRegisterForm((prev) => ({ ...prev, base_url: event.target.value }))}
                placeholder="http://worker-host:4000"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="register-max">Max sessions</Label>
              <Input
                id="register-max"
                type="number"
                min={1}
                value={registerForm.max_sessions}
                onChange={(event) =>
                  setRegisterForm((prev) => ({
                    ...prev,
                    max_sessions: Math.max(1, Number(event.target.value) || 1),
                  }))
                }
              />
            </div>
            <DialogFooter className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setRegisterOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={registerMutation.isLoading}>
                {registerMutation.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Register"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editWorker)} onOpenChange={(open) => !open && setEditWorker(null)}>
        <DialogContent className="glass-card max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Worker</DialogTitle>
            <DialogDescription>Update the worker metadata or adjust capacity.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditSubmit} className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                value={editForm.name}
                onChange={(event) => setEditForm((prev) => ({ ...prev, name: event.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-base-url">Base URL</Label>
              <Input
                id="edit-base-url"
                value={editForm.base_url}
                onChange={(event) => setEditForm((prev) => ({ ...prev, base_url: event.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-max">Max sessions</Label>
              <Input
                id="edit-max"
                type="number"
                min={1}
                value={editForm.max_sessions}
                onChange={(event) =>
                  setEditForm((prev) => ({
                    ...prev,
                    max_sessions: Math.max(1, Number(event.target.value) || 1),
                  }))
                }
              />
            </div>
            <DialogFooter className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setEditWorker(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={updateMutation.isLoading}>
                {updateMutation.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(detailWorkerId)} onOpenChange={(open) => !open && setDetailWorkerId(null)}>
        <DialogContent className="glass-card max-w-3xl">
          <DialogHeader>
            <DialogTitle>Worker Endpoints</DialogTitle>
            <DialogDescription>
              Inspect the live routes exposed by this worker. Values are derived from <code>Workers_Docs.md</code>.
            </DialogDescription>
          </DialogHeader>
          {detailQuery.isLoading && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Loading worker...
            </div>
          )}
          {!detailQuery.isLoading && detail && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold">{detail.name || "Unnamed worker"}</h3>
                <p className="text-sm text-muted-foreground break-all">{detail.base_url}</p>
              </div>
              <div className="grid gap-3">
                {Object.entries(detail.endpoints).map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between gap-2 rounded border border-border/40 px-3 py-2">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">{key.replace("_", " ")}</p>
                      <p className="text-sm font-mono break-all">{value}</p>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => handleCopy(value)}>
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <Separator />
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold">Health</h4>
                  <Button
                    size="sm"
                    className="gap-2"
                    onClick={() => {
                      if (!detailWorkerId) return;
                      setHealthStatus(null);
                      healthMutation.mutate(detailWorkerId);
                    }}
                    disabled={healthMutation.isLoading}
                  >
                    {healthMutation.isLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <RefreshCw className="w-4 h-4" />
                    )}
                    Check health
                  </Button>
                </div>
                {healthStatus && (
                  <div className="rounded-lg border border-border/40 bg-muted/30 p-3 space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Status: <span className="font-medium text-foreground">{healthStatus.ok ? "OK" : "Unavailable"}</span>
                    </p>
                    {typeof healthStatus.latency_ms === "number" && (
                      <p className="text-xs text-muted-foreground">
                        Latency: <span className="font-medium text-foreground">{healthStatus.latency_ms.toFixed(2)} ms</span>
                      </p>
                    )}
                    {healthStatus.payload && (
                      <pre className="text-xs bg-background/60 rounded p-2 border border-border/30 overflow-auto max-h-48">
                        {JSON.stringify(healthStatus.payload, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

const Metric = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-lg border border-border/40 p-4">
    <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
    <p className="mt-1 text-sm font-semibold break-all">{value}</p>
  </div>
);

