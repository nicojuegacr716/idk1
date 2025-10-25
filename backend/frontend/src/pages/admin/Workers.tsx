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
  KeyRound,
  RotateCcw,
  Trash2,
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
  deleteWorker,
  disableWorker,
  fetchWorkerDetail,
  fetchWorkers,
  ApiError,
  requestWorkerToken,
  restartWorker,
  registerWorker,
  updateWorker,
} from "@/lib/api-client";
import type { WorkerDetail, WorkerHealthStatus, WorkerInfo } from "@/lib/types";
import { Slab } from "react-loading-indicators";

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

const sanitizeUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
};

export default function Workers() {
  const queryClient = useQueryClient();
  const [registerOpen, setRegisterOpen] = useState(false);
  const [registerForm, setRegisterForm] = useState<WorkerFormState>(DEFAULT_FORM);
  const [editWorker, setEditWorker] = useState<WorkerInfo | null>(null);
  const [editForm, setEditForm] = useState<WorkerFormState>(DEFAULT_FORM);
  const [detailWorkerId, setDetailWorkerId] = useState<string | null>(null);
  const [healthStatus, setHealthStatus] = useState<WorkerHealthStatus | null>(null);
  const [tokenWorker, setTokenWorker] = useState<WorkerInfo | null>(null);
  const [tokenForm, setTokenForm] = useState({ email: "", password: "" });
  const [restartTarget, setRestartTarget] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

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
      toast("Đã đăng ký worker.");
      setRegisterOpen(false);
      setRegisterForm(DEFAULT_FORM);
      queryClient.invalidateQueries({ queryKey: ["admin-workers"] });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Đăng ký worker thất bại.";
      toast(message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: { name?: string | null; base_url?: string | null; max_sessions?: number | null; status?: "active" | "disabled" | null } }) =>
      updateWorker(id, payload),
    onSuccess: (_, variables) => {
      toast("Đã cập nhật worker.");
      if (variables.payload.status === "active") {
        toast("Đã bật worker.", { description: "Trạng thái chuyển sang active." });
      }
      setEditWorker(null);
      queryClient.invalidateQueries({ queryKey: ["admin-workers"] });
      if (detailWorkerId) {
        queryClient.invalidateQueries({ queryKey: ["admin-worker", detailWorkerId] });
      }
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Cập nhật worker thất bại.";
      toast(message);
    },
  });

  const disableMutation = useMutation({
    mutationFn: disableWorker,
    onSuccess: () => {
      toast("Đã tắt (disable) worker.");
      queryClient.invalidateQueries({ queryKey: ["admin-workers"] });
      if (detailWorkerId) {
        queryClient.invalidateQueries({ queryKey: ["admin-worker", detailWorkerId] });
      }
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Tắt worker thất bại.";
      toast(message);
    },
  });

  const restartMutation = useMutation({
    mutationFn: restartWorker,
    onMutate: (id: string) => {
      setRestartTarget(id);
    },
    onSuccess: (data) => {
      const terminated = data.terminated_sessions;
      const description =
        terminated > 0
          ? `Đã hủy ${terminated} phiên đang chạy.`
          : "Không có phiên nào cần hủy.";
      toast("Đã khởi động lại worker.", { description });
      queryClient.invalidateQueries({ queryKey: ["admin-workers"] });
      if (detailWorkerId) {
        queryClient.invalidateQueries({ queryKey: ["admin-worker", detailWorkerId] });
      }
    },
    onError: (error: unknown) => {
      const message =
        error instanceof ApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Khởi động lại worker thất bại.";
      toast(message);
    },
    onSettled: () => {
      setRestartTarget(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteWorker,
    onMutate: (id: string) => {
      setDeleteTarget(id);
    },
    onSuccess: (_, workerId) => {
      toast("Đã xóa worker.");
      queryClient.invalidateQueries({ queryKey: ["admin-workers"] });
      queryClient.removeQueries({ queryKey: ["admin-worker", workerId] });
      if (detailWorkerId === workerId) {
        setDetailWorkerId(null);
      }
      if (editWorker?.id === workerId) {
        setEditWorker(null);
      }
      if (tokenWorker?.id === workerId) {
        setTokenWorker(null);
        setTokenForm({ email: "", password: "" });
      }
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Xóa worker thất bại.";
      toast(message);
    },
    onSettled: () => {
      setDeleteTarget(null);
    },
  });

  const healthMutation = useMutation({
    mutationFn: checkWorkerHealth,
    onSuccess: (data) => {
      setHealthStatus(data);
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Kiểm tra sức khỏe worker thất bại.";
      toast(message);
    },
  });

  const tokenMutation = useMutation({
    mutationFn: ({ workerId, email, password }: { workerId: string; email: string; password: string }) =>
      requestWorkerToken(workerId, { email, password }),
    onSuccess: () => {
      toast("Worker đang lấy session token mới.");
      setTokenWorker(null);
      setTokenForm({ email: "", password: "" });
    },
    onError: (error: unknown) => {
      const message =
        error instanceof ApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Yêu cầu token cho worker thất bại.";
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
      toast("Cần nhập Base URL của worker.");
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

  const handleRestart = (worker: WorkerInfo) => {
    if (worker.active_sessions === 0 || window.confirm("Bạn có chắc muốn hủy toàn bộ phiên đang chạy của worker này?")) {
      restartMutation.mutate(worker.id);
    }
  };

  const handleDelete = (worker: WorkerInfo) => {
    if (worker.active_sessions > 0) {
      toast("Không thể xóa khi worker còn phiên đang chạy. Vui lòng khởi động lại trước.");
      return;
    }
    if (window.confirm("Xóa worker này? Hành động không thể hoàn tác.")) {
      deleteMutation.mutate(worker.id);
    }
  };

  const handleTokenSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!tokenWorker) return;
    const email = tokenForm.email.trim();
    if (!email || !tokenForm.password) {
      toast("Cần nhập email và mật khẩu.");
      return;
    }
    tokenMutation.mutate({ workerId: tokenWorker.id, email, password: tokenForm.password });
  };

  const handleCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast("Đã sao chép vào clipboard.");
    } catch {
      toast("Sao chép thất bại.");
    }
  };

  const detail = detailQuery.data;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold mb-2">Quản lý Worker</h1>
          <p className="text-muted-foreground">
            Worker cung cấp các endpoint mô tả trong <code className="font-mono text-xs">Workers_Docs.md</code>. Mọi lời gọi
            được điều phối ở phía server để bảo vệ thông tin đăng nhập.
          </p>
        </div>
        <Button className="gap-2" onClick={() => setRegisterOpen(true)}>
          <Plus className="w-4 h-4" />
          Đăng ký Worker
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-5">
        {[
          { label: "Tổng số Worker", value: summary.total.toString(), icon: Server },
          { label: "Worker đang hoạt động", value: summary.active.toString(), icon: Activity },
          { label: "Phiên đang chạy", value: summary.activeSessions.toString(), icon: Users },
          { label: "Tổng sức chứa", value: summary.capacity.toString(), icon: Gauge },
          { label: "Slot còn trống", value: summary.available.toString(), icon: Zap },
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
              <CardTitle><Slab color="#d18d00" size="large" text="Đang tải nội dung từ server" textColor="" /></CardTitle>
            </CardHeader>
          </Card>
        )}
        {!isLoading && workers.length === 0 && (
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Chưa có worker nào</CardTitle>
              <CardDescription>Hãy đăng ký endpoint worker trước khi cấp phát phiên VPS.</CardDescription>
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
                      <CardTitle className="text-lg">{worker.name || "Worker chưa đặt tên"}</CardTitle>
                      <CardDescription className="text-xs">{worker.base_url}</CardDescription>
                    </div>
                    <Badge className={statusBadge(worker.status)}>{worker.status.toUpperCase()}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                    <Metric label="Phiên đang chạy" value={worker.active_sessions.toString()} />
                    <Metric label="Giới hạn phiên" value={worker.max_sessions.toString()} />
                    <Metric label="Tạo lúc" value={formatDateTime(worker.created_at)} />
                    <Metric label="Cập nhật" value={formatDateTime(worker.updated_at)} />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-2"
                      onClick={() => setDetailWorkerId(worker.id)}
                    >
                      <Eye className="w-4 h-4" />
                      Xem chi tiết
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-2"
                      onClick={() => {
                        setTokenWorker(worker);
                        setTokenForm({ email: "", password: "" });
                      }}
                      disabled={tokenMutation.isLoading && tokenWorker?.id === worker.id}
                    >
                      {tokenMutation.isLoading && tokenWorker?.id === worker.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <KeyRound className="w-4 h-4" />
                      )}
                      Yêu cầu token
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-2"
                      onClick={() => setEditWorker(worker)}
                    >
                      <Pencil className="w-4 h-4" />
                      Chỉnh sửa
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-2"
                      onClick={() => handleToggleStatus(worker)}
                      disabled={
                        disableMutation.isLoading ||
                        updateMutation.isLoading ||
                        restartMutation.isLoading ||
                        deleteMutation.isLoading
                      }
                    >
                      {worker.status === "active" ? (
                        <>
                          <Power className="w-4 h-4" />
                          Tắt (Disable)
                        </>
                      ) : (
                        <>
                          <Plug className="w-4 h-4" />
                          Bật (Enable)
                        </>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-2"
                      onClick={() => handleRestart(worker)}
                      disabled={restartMutation.isLoading || deleteMutation.isLoading}
                    >
                      {restartMutation.isLoading && restartTarget === worker.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <RotateCcw className="w-4 h-4" />
                      )}
                      Khởi động lại
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="gap-2"
                      onClick={() => handleDelete(worker)}
                      disabled={
                        worker.active_sessions > 0 ||
                        deleteMutation.isLoading ||
                        restartMutation.isLoading
                      }
                    >
                      {deleteMutation.isLoading && deleteTarget === worker.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                      Xóa
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
      </div>

      <Dialog
        open={Boolean(tokenWorker)}
        onOpenChange={(open) => {
          if (!open) {
            setTokenWorker(null);
            setTokenForm({ email: "", password: "" });
          }
        }}
      >
        <DialogContent className="glass-card max-w-md">
          <DialogHeader>
            <DialogTitle>Yêu cầu session token cho worker</DialogTitle>
            <DialogDescription>
              Cung cấp thông tin NVIDIA Learn để worker làm mới <code>sessionid</code>.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleTokenSubmit} className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="token-email">Email</Label>
              <Input
                id="token-email"
                type="email"
                autoComplete="username"
                value={tokenForm.email}
                onChange={(event) => setTokenForm((prev) => ({ ...prev, email: event.target.value }))}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="token-password">Mật khẩu</Label>
              <Input
                id="token-password"
                type="password"
                autoComplete="current-password"
                value={tokenForm.password}
                onChange={(event) => setTokenForm((prev) => ({ ...prev, password: event.target.value }))}
                required
              />
            </div>
            <DialogFooter className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setTokenWorker(null)}>
                Hủy
              </Button>
              <Button type="submit" className="gap-2" disabled={tokenMutation.isLoading}>
                {tokenMutation.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Gửi yêu cầu"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={registerOpen} onOpenChange={setRegisterOpen}>
        <DialogContent className="glass-card max-w-lg">
          <DialogHeader>
            <DialogTitle>Đăng ký Worker</DialogTitle>
            <DialogDescription>
              Nhập tên, Base URL và (tùy chọn) sức chứa cho endpoint worker mới.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleRegisterSubmit} className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="register-name">Tên</Label>
              <Input
                id="register-name"
                value={registerForm.name}
                onChange={(event) => setRegisterForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="Nhãn hiển thị (tùy chọn)"
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
              <Label htmlFor="register-max">Giới hạn phiên</Label>
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
                Hủy
              </Button>
              <Button type="submit" disabled={registerMutation.isLoading}>
                {registerMutation.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Đăng ký"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editWorker)} onOpenChange={(open) => !open && setEditWorker(null)}>
        <DialogContent className="glass-card max-w-lg">
          <DialogHeader>
            <DialogTitle>Chỉnh sửa Worker</DialogTitle>
            <DialogDescription>Cập nhật metadata hoặc điều chỉnh sức chứa.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditSubmit} className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-name">Tên</Label>
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
              <Label htmlFor="edit-max">Giới hạn phiên</Label>
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
                Hủy
              </Button>
              <Button type="submit" disabled={updateMutation.isLoading}>
                {updateMutation.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Lưu thay đổi"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(detailWorkerId)} onOpenChange={(open) => !open && setDetailWorkerId(null)}>
        <DialogContent className="glass-card max-w-3xl">
          <DialogHeader>
            <DialogTitle>Endpoint của Worker</DialogTitle>
            <DialogDescription>
              Xem các route đang hoạt động do worker cung cấp. Giá trị dựa theo <code>Workers_Docs.md</code>.
            </DialogDescription>
          </DialogHeader>
          {detailQuery.isLoading && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Đang tải worker...
            </div>
          )}
          {!detailQuery.isLoading && detail && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold">{detail.name || "Worker chưa đặt tên"}</h3>
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
                  <h4 className="text-sm font-semibold">Sức khỏe</h4>
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
                    Kiểm tra
                  </Button>
                </div>
                {healthStatus && (
                  <div className="rounded-lg border border-border/40 bg-muted/30 p-3 space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Trạng thái: <span className="font-medium text-foreground">{healthStatus.ok ? "OK" : "Không sẵn sàng"}</span>
                    </p>
                    {typeof healthStatus.latency_ms === "number" && (
                      <p className="text-xs text-muted-foreground">
                        Độ trễ: <span className="font-medium text-foreground">{healthStatus.latency_ms.toFixed(2)} ms</span>
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
