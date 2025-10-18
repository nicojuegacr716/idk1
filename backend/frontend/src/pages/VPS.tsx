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
  if (!label) return "Mục kiểm tra";
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
        const detail = (error.data as { detail?: string })?.detail ?? "Số dư không đủ.";
        toast(detail);
        return;
      }
      const message = error instanceof Error ? error.message : "Tạo phiên thất bại.";
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
      const message = error instanceof ApiError ? error.message : "Không tải được nhật ký VPS.";
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
          <h1 className="text-3xl font-bold mb-2">Quản lý VPS</h1>
          <p className="text-muted-foreground">
            Tạo và theo dõi phiên VPS theo thời gian thực ngay tại đây.
          </p>
        </div>
        <div className="flex gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="w-4 h-4" />
                Tạo VPS
              </Button>
            </DialogTrigger>
            <DialogContent className="glass-panel max-w-4xl">
              <DialogHeader>
                <DialogTitle>Chọn gói VPS</DialogTitle>
                <DialogDescription>Danh sách gói được cập nhật từ hệ thống. Chọn gói để khởi chạy.</DialogDescription>
              </DialogHeader>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                {productsLoading && <p className="text-sm text-muted-foreground px-4">Đang tải gói...</p>}
                {!productsLoading && products.length === 0 && (
                  <p className="text-sm text-muted-foreground px-4">
                    Hiện chưa có gói khả dụng. Vui lòng quay lại sau.
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
                      <CardDescription className="text-xs">{product.description || "Tài nguyên VPS quản lý"}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-warning">
                        {product.price_coins.toLocaleString()} <span className="text-sm text-muted-foreground">coin</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <Button variant="outline" onClick={() => setSelectedProduct(null)}>
                  Hủy
                </Button>
                <Button
                  onClick={() => selectedProduct && createSession.mutate(selectedProduct.id)}
                  disabled={!selectedProduct || createSession.isPending}
                >
                  {createSession.isPending ? "Đang khởi chạy..." : "Khởi chạy VPS"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xl font-semibold">Phiên của bạn</h2>
          <p className="text-sm text-muted-foreground">
            Xem tiến độ, trạng thái và thông tin kết nối khi sẵn sàng.
          </p>
        </div>

        {sessionsLoading && <p className="text-sm text-muted-foreground">Đang tải danh sách phiên...</p>}

        {!sessionsLoading && activeSessions.length === 0 && (
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Chưa có phiên nào</CardTitle>
              <CardDescription>Tạo một phiên mới để bắt đầu sử dụng VPS.</CardDescription>
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
                          {session.product?.name || "Phiên VPS"}
                        </h3>
                        <p className="text-xs text-muted-foreground">Mã phiên: {session.id}</p>
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
                        Hoàn thành {progress}% • Cập nhật lần cuối{" "}
                        {session.updated_at ? new Date(session.updated_at).toLocaleString() : "không rõ"}
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
                          Xem dòng sự kiện
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
                      Xem nhật ký
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="gap-2"
                      onClick={() => removeSession.mutate(session.id)}
                      disabled={removeSession.isPending && removeSession.variables === session.id}
                    >
                      <Trash2 className="w-4 h-4" />
                      {removeSession.isPending && removeSession.variables === session.id ? "Đang xóa..." : "Xóa"}
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
            <DialogTitle>Nhật ký cài đặt</DialogTitle>
            <DialogDescription>
              {logSession ? `Phiên ${logSession.id}` : "Chi tiết quá trình khởi tạo từ dịch vụ hệ thống."}
            </DialogDescription>
          </DialogHeader>
          {logViewer.isPending && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Đang tải nhật ký...
            </div>
          )}
          {!logViewer.isPending && logError && (
            <p className="text-sm text-destructive">{logError}</p>
          )}
          {!logViewer.isPending && !logError && (
            <ScrollArea className="max-h-[420px] rounded-md border border-border/40 bg-muted/30">
              <pre className="p-4 text-xs font-mono whitespace-pre-wrap">{logContent || "Chưa có nội dung nhật ký."}</pre>
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
      Danh sách kiểm tra
    </p>
    {session.checklist.length === 0 && <p className="text-xs text-muted-foreground">Chưa có mục kiểm tra.</p>}
    {session.checklist.map((item) => (
      <div key={item.key ?? Math.random()} className="flex items-center justify-between text-xs">
        <span className={item.done ? "text-foreground" : "text-muted-foreground"}>
          {humanizeChecklistLabel(item.label)}
        </span>
        <span className={`font-medium ${item.done ? "text-success" : "text-muted-foreground"}`}>
          {item.done ? "Hoàn tất" : "Đang xử lý"}
        </span>
      </div>
    ))}
  </div>
);

const ConnectionDetails = ({ session }: { session: VpsSession }) => (
  <div className="rounded-lg border border-border/40 p-4 space-y-2">
    <p className="text-sm font-semibold">Thông tin kết nối</p>
    {session.status !== "ready" && (
      <p className="text-xs text-muted-foreground">
        Thông tin đăng nhập RDP sẽ xuất hiện khi phiên sẵn sàng.
      </p>
    )}
    {session.status === "ready" && session.rdp && (
      <div className="text-xs space-y-1">
        <div>Máy chủ: <span className="font-mono">{session.rdp.host}</span></div>
        <div>Cổng: <span className="font-mono">{session.rdp.port}</span></div>
        <div>Tài khoản: <span className="font-mono">{session.rdp.user}</span></div>
        <div>Mật khẩu: <span className="font-mono">{session.rdp.password}</span></div>
      </div>
    )}
  </div>
);
