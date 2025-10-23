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
  if (!value) return "không rõ";
  try {
    return `${formatDistanceToNow(new Date(value), { addSuffix: true })}`;
  } catch {
    return "không rõ";
  }
};

const sessionTitle = (session: VpsSession) => session.product?.name || "Phiên VPS";

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
      toast("Đã cập nhật cấu hình Kyaro.");
      queryClient.setQueryData(["admin-settings", "kyaro"], data);
      setPromptTouched(false);
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Cập nhật cấu hình Kyaro thất bại.";
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
      title: "VPS đang hoạt động",
      value: sessionsLoading ? "..." : String(activeSessions.length),
      description: `${readySessions.length} đã sẵn sàng / ${provisioningSessions.length} đang khởi tạo`,
      icon: Server,
      accent: "text-primary",
    },
    {
      title: "Số dư",
      value: formatCoins(profile?.coins ?? 0),
      description: "Trong ví tài khoản của bạn",
      icon: Zap,
      accent: "text-warning",
    },
    {
      title: "Hộp thư hỗ trợ",
      value: threadsLoading ? "..." : String(threads.length),
      description: "Lịch sử hỗ trợ từ AI và nhân viên",
      icon: MessageSquare,
      accent: "text-secondary",
    },
    ...(hasAdminAccess
      ? [
          {
            title: "Tình trạng hệ thống",
            value: healthStatus?.api_up ? "Hoạt động" : "Gián đoạn",
            description: healthStatus?.version ? `Phiên bản ${healthStatus.version}` : "Theo dõi thời gian thực",
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
          <h1 className="text-3xl font-bold mb-2">Chào mừng trở lại, {profile?.display_name || profile?.username || "bạn"}!</h1>
          <p className="text-muted-foreground">
            Bảng điều khiển hiển thị dữ liệu thời gian thực, gồm phiên VPS, hỗ trợ và trạng thái hệ thống.
          </p>
        </div>
        <div className="flex gap-2">
          <Button className="gap-2" onClick={() => navigate("/vps")}>
            Khởi chạy VPS
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
            <CardTitle>Hành động nhanh</CardTitle>
            <CardDescription>Đi nhanh đến các khu vực chính</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button className="w-full justify-start" variant="outline" size="lg" onClick={() => navigate("/vps")}>
              <Server className="w-5 h-5 mr-3" />
              Tạo phiên VPS mới
            </Button>
            <Button className="w-full justify-start" variant="outline" size="lg" onClick={() => navigate("/support")}>
              <MessageSquare className="w-5 h-5 mr-3" />
              Mở hộp thư hỗ trợ
            </Button>
            {hasAdminAccess && (
              <Button className="w-full justify-start" variant="outline" size="lg" onClick={() => navigate("/admin/analytics")}>
                <Activity className="w-5 h-5 mr-3" />
                Xem tình trạng hệ thống
              </Button>
            )}
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle>Tổng quan hỗ trợ</CardTitle>
            <CardDescription>Được phục vụ bởi trợ lý AI và nhân viên</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {threadsLoading && <p className="text-sm text-muted-foreground">Đang tải lịch sử hỗ trợ...</p>}
            {!threadsLoading && threads.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Chưa có cuộc trò chuyện hỗ trợ. Vào trang Hỗ trợ để bắt đầu.
              </p>
            )}
            {!threadsLoading &&
              threads.slice(0, 4).map((thread: SupportThread) => (
                <div key={thread.id} className="flex items-center justify-between rounded-lg border border-border/40 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium capitalize">Hỗ trợ bởi: {thread.source}</p>
                    <p className="text-xs text-muted-foreground">Cập nhật {timeAgo(thread.updated_at)}</p>
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
              Cấu hình Kyaro
            </CardTitle>
            <CardDescription>Tinh chỉnh cách trợ lý phản hồi trên toàn nền tảng.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={promptDraft}
              onChange={(event) => {
                setPromptDraft(event.target.value);
                setPromptTouched(true);
              }}
              className="h-48 glass-card"
              placeholder="Mô tả cách Kyaro nên trả lời quản trị viên và người dùng..."
              disabled={kyaroLoading || updatePromptMutation.isLoading}
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Phiên bản: {kyaroPrompt?.version ?? "--"}</span>
              <span>Cập nhật lúc: {kyaroPrompt?.updated_at ?? "--"}</span>
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
                Hoàn tác
              </Button>
              <Button
                onClick={() => updatePromptMutation.mutate(promptDraft.trim())}
                disabled={!promptChanged || !promptValid || updatePromptMutation.isLoading}
              >
                {updatePromptMutation.isLoading ? "Đang lưu..." : "Lưu cấu hình"}
              </Button>
            </div>
            {!promptValid && <p className="text-xs text-destructive">Nội dung không được để trống.</p>}
          </CardContent>
        </Card>
      )}

      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Hoạt động VPS gần đây</CardTitle>
          <CardDescription>
            Cập nhật theo thời gian thực từ hệ thống
          </CardDescription>
        </CardHeader>
        <CardContent>
          {recentActivity.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Chưa có phiên nào. Tạo một phiên trong trang VPS để xem quá trình khởi tạo trực tiếp.
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
                      <p className="text-xs text-muted-foreground">Mã phiên: {session.id}</p>
                    </div>
                    <span className="text-xs uppercase font-semibold text-muted-foreground">{session.status}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Cập nhật {timeAgo(session.updated_at)}</span>
                    {session.stream && (
                      <a className="text-primary hover:underline" href={session.stream} target="_blank" rel="noreferrer">
                        Xem luồng sự kiện →
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
