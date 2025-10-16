import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Server, Plus, Trash2, ExternalLink, ListChecks, Loader2, FileText } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  fetchVpsProducts,
  fetchVpsSessions,
  createVpsSession,
  deleteVpsSession,
  fetchVpsSessionLog,
  ApiError,
} from "@/lib/api-client";
import type { VpsProduct, VpsSession } from "@/lib/types";
import { toast } from "@/components/ui/sonner";

const idempotencyKey = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
};

const statusVariant = (status: string) => {
  switch (status) {
    case "ready":
      return { variant: "default" as const, className: "bg-success text-success-foreground" };
    case "failed":
      return { variant: "destructive" as const, className: "" };
    case "provisioning":
      return { variant: "outline" as const, className: "border-warning text-warning" };
    default:
      return { variant: "secondary" as const, className: "" };
  }
};

const checklistProgress = (session: VpsSession) => {
  const total = session.checklist.length || 1;
  const done = session.checklist.filter((item) => item.done).length;
  return Math.round((done / total) * 100);
};

const humanizeChecklistLabel = (label: string | null) => {
  if (!label) return "Checklist item";
  return label.charAt(0).toUpperCase() + label.slice(1);
};

export default function VPS() {
  const [selectedProduct, setSelectedProduct] = useState<VpsProduct | null>(null);
  const [logDialogOpen, setLogDialogOpen] = useState(false);
  const [logContent, setLogContent] = useState("");
  const [logSession, setLogSession] = useState<VpsSession | null>(null);
  const [logError, setLogError] = useState<string | null>(null);

  const {
    data: products = [],
    isLoading: productsLoading,
  } = useQuery({
    queryKey: ["vps-products"],
    queryFn: fetchVpsProducts,
    staleTime: 60_000,
  });

  const {
    data: sessions = [],
    isLoading: sessionsLoading,
    refetch: refetchSessions,
  } = useQuery({
    queryKey: ["vps-sessions"],
    queryFn: fetchVpsSessions,
    staleTime: 10_000,
  });

  const createSession = useMutation({
    mutationFn: (productId: string) => createVpsSession(productId, idempotencyKey()),
    onSuccess: () => {
      refetchSessions();
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError && error.status === 400) {
        const detail = (error.data as { detail?: string })?.detail ?? "Insufficient balance.";
        toast(detail);
        return;
      }
      const message = error instanceof Error ? error.message : "Failed to create session.";
      toast(message);
    },
  });

  const removeSession = useMutation({
    mutationFn: deleteVpsSession,
    onSuccess: () => {
      refetchSessions();
    },
  });

  const logViewer = useMutation({
    mutationFn: fetchVpsSessionLog,
    onSuccess: (body: string) => {
      setLogContent(body);
      setLogError(null);
    },
    onError: (error: unknown) => {
      const message = error instanceof ApiError ? error.message : "Failed to load VPS logs.";
      setLogError(message);
    },
  });

  const handleViewLogs = (session: VpsSession) => {
    setLogSession(session);
    setLogContent("");
    setLogError(null);
    setLogDialogOpen(true);
    logViewer.mutate(session.id);
  };

  const handleCloseLogDialog = (open: boolean) => {
    setLogDialogOpen(open);
    if (!open) {
      setLogSession(null);
      setLogContent("");
      setLogError(null);
      logViewer.reset();
    }
  };

  const activeSessions = useMemo(() => sessions.filter((session) => !["deleted"].includes(session.status)), [sessions]);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold mb-2">VPS Management</h1>
          <p className="text-muted-foreground">
            Each action below calls real endpoints under <code className="font-mono text-xs">/vps</code>.
          </p>
        </div>
        <div className="flex gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="w-4 h-4" />
                Create VPS
              </Button>
            </DialogTrigger>
            <DialogContent className="glass-panel max-w-4xl">
              <DialogHeader>
                <DialogTitle>Select a VPS product</DialogTitle>
                <DialogDescription>Products are loaded from the backend. Choose one to launch.</DialogDescription>
              </DialogHeader>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                {productsLoading && <p className="text-sm text-muted-foreground px-4">Loading products...</p>}
                {!productsLoading && products.length === 0 && (
                  <p className="text-sm text-muted-foreground px-4">
                    No products available. Use the admin console to create entries in <code className="font-mono text-xs">/api/v1/admin/vps-products</code>.
                  </p>
                )}
                {products.map((product) => (
                  <Card
                    key={product.id}
                    className={`glass-card cursor-pointer transition-all ${
                      selectedProduct?.id === product.id ? "ring-2 ring-primary" : ""
                    }`}
                    onClick={() => setSelectedProduct(product)}
                  >
                    <CardHeader>
                      <CardTitle className="text-lg">{product.name}</CardTitle>
                      <CardDescription className="text-xs">{product.description || "Managed VPS capacity"}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-warning">
                        {product.price_coins.toLocaleString()} <span className="text-sm text-muted-foreground">coins</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <Button variant="outline" onClick={() => setSelectedProduct(null)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => selectedProduct && createSession.mutate(selectedProduct.id)}
                  disabled={!selectedProduct || createSession.isPending}
                >
                  {createSession.isPending ? "Launching..." : "Launch VPS"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xl font-semibold">Your Sessions</h2>
          <p className="text-sm text-muted-foreground">
            Streaming URLs, checklist progress, and RDP credentials arrive from workers.
          </p>
        </div>

        {sessionsLoading && <p className="text-sm text-muted-foreground">Loading sessions from /vps/sessions...</p>}

        {!sessionsLoading && activeSessions.length === 0 && (
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>No sessions yet</CardTitle>
              <CardDescription>Create a session to see worker callbacks populate this list.</CardDescription>
            </CardHeader>
          </Card>
        )}

        {!sessionsLoading &&
          activeSessions.map((session) => {
            const progress = checklistProgress(session);
            const status = statusVariant(session.status);
            return (
              <Card key={session.id} className="glass-card hover-lift">
                <CardContent className="space-y-4 p-6">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
                        <Server className="w-6 h-6 text-white" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-lg">
                          {session.product?.name || "VPS Session"}
                        </h3>
                        <p className="text-xs text-muted-foreground">Session ID: {session.id}</p>
                      </div>
                    </div>
                    <Badge variant={status.variant} className={status.className}>
                      {session.status.toUpperCase()}
                    </Badge>
                  </div>

                  <div>
                    <Progress value={progress} className="h-2 mb-3" />
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <ListChecks className="w-4 h-4" />
                      <span>
                        {progress}% complete / last updated {session.updated_at ? new Date(session.updated_at).toLocaleString() : "unknown"}
                      </span>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <Checklist session={session} />
                    <ConnectionDetails session={session} />
                  </div>

                  <div className="flex flex-wrap gap-2 justify-end">
                    {session.stream && (
                      <Button variant="outline" size="sm" asChild>
                        <a href={session.stream} target="_blank" rel="noreferrer">
                          <ExternalLink className="w-4 h-4 mr-2" />
                          Stream Events
                        </a>
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      disabled={!session.has_log || (logViewer.isPending && logSession?.id === session.id)}
                      onClick={() => handleViewLogs(session)}
                    >
                      {logViewer.isPending && logSession?.id === session.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <FileText className="w-4 h-4" />
                      )}
                      View Logs
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="gap-2"
                      onClick={() => removeSession.mutate(session.id)}
                      disabled={removeSession.isPending && removeSession.variables === session.id}
                    >
                      <Trash2 className="w-4 h-4" />
                      {removeSession.isPending && removeSession.variables === session.id ? "Deleting..." : "Delete"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
      </div>

      <Dialog open={logDialogOpen} onOpenChange={handleCloseLogDialog}>
        <DialogContent className="max-w-3xl glass-card">
          <DialogHeader>
            <DialogTitle>Worker Log</DialogTitle>
            <DialogDescription>
              {logSession ? `Session ${logSession.id}` : "Detailed provisioning output from the worker service."}
            </DialogDescription>
          </DialogHeader>
          {logViewer.isPending && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Fetching logs from the backend...
            </div>
          )}
          {!logViewer.isPending && logError && (
            <p className="text-sm text-destructive">{logError}</p>
          )}
          {!logViewer.isPending && !logError && (
            <ScrollArea className="max-h-[420px] rounded-md border border-border/40 bg-muted/30">
              <pre className="p-4 text-xs font-mono whitespace-pre-wrap">{logContent || "No log output yet."}</pre>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

const Checklist = ({ session }: { session: VpsSession }) => (
  <div className="rounded-lg border border-border/40 p-4 space-y-2">
    <p className="text-sm font-semibold flex items-center gap-2">
      <ListChecks className="w-4 h-4" />
      Provisioning Checklist
    </p>
    {session.checklist.length === 0 && <p className="text-xs text-muted-foreground">No checklist items reported yet.</p>}
    {session.checklist.map((item) => (
      <div key={item.key ?? Math.random()} className="flex items-center justify-between text-xs">
        <span className={item.done ? "text-foreground" : "text-muted-foreground"}>
          {humanizeChecklistLabel(item.label)}
        </span>
        <span className={`font-medium ${item.done ? "text-success" : "text-muted-foreground"}`}>
          {item.done ? "Done" : "Pending"}
        </span>
      </div>
    ))}
  </div>
);

const ConnectionDetails = ({ session }: { session: VpsSession }) => (
  <div className="rounded-lg border border-border/40 p-4 space-y-2">
    <p className="text-sm font-semibold">Connection Details</p>
    {session.status !== "ready" && (
      <p className="text-xs text-muted-foreground">
        RDP credentials appear when the worker reports a ready status via <code className="font-mono text-[10px]">/workers/callback/result</code>.
      </p>
    )}
    {session.status === "ready" && session.rdp && (
      <div className="text-xs space-y-1">
        <div>Host: <span className="font-mono">{session.rdp.host}</span></div>
        <div>Port: <span className="font-mono">{session.rdp.port}</span></div>
        <div>User: <span className="font-mono">{session.rdp.user}</span></div>
        <div>Password: <span className="font-mono">{session.rdp.password}</span></div>
      </div>
    )}
  </div>
);
