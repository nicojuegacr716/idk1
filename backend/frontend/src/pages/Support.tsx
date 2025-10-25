import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  MessageSquare,
  Plus,
  Send,
  Bot,
  Link as LinkIcon,
  File as FileIcon,
  Search,
  X,
  ListFilter,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/context/AuthContext";
import {
  adminReplySupportThread,
  askSupportAssistant,
  createSupportThread,
  fetchAdminSupportThread,
  fetchAdminSupportThreads,
  fetchSupportThreads,
  postSupportThreadMessage,
} from "@/lib/api-client";
import type {
  SupportAttachment,
  SupportThread,
  SupportThreadSummary,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import remarkGfm from "remark-gfm";
import ReactMarkdown from "react-markdown";
import { ThreeDot } from "react-loading-indicators";

/* ======================
 *  Helpers & Constants
 * ====================== */

type AttachmentDraft = {
  label: string;
  url: string;
  kind: "link" | "image" | "file";
};
type TabKey = "reply" | "ai";
const imageExtensions = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"];

const defaultAttachment: AttachmentDraft = { label: "", url: "", kind: "link" };

const cleanAttachments = (drafts: AttachmentDraft[]): SupportAttachment[] =>
  drafts
    .map((d) => ({
      url: d.url.trim(),
      label: d.label.trim() || null,
      kind: d.kind,
    }))
    .filter((a) => a.url.length > 0);

const isImageLink = (a: SupportAttachment) =>
  a.kind === "image" ||
  imageExtensions.some((ext) => a.url.toLowerCase().endsWith(ext));

const timeAgo = (value: string | null | undefined) => {
  if (!value) return "Không rõ";
  try {
    const fmt = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
    const minutes = Math.round(
      (new Date(value).getTime() - Date.now()) / 60000,
    );
    if (Math.abs(minutes) < 60) return fmt.format(minutes, "minute");
    const hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) return fmt.format(hours, "hour");
    const days = Math.round(hours / 24);
    return fmt.format(days, "day");
  } catch {
    return value;
  }
};

const getTimeValue = (raw: string | null | undefined) =>
  raw ? new Date(raw).getTime() : 0;
const sortThreadsByRecency = (t: SupportThread[]) =>
  [...t].sort(
    (a, b) =>
      getTimeValue(b.updated_at ?? b.created_at) -
      getTimeValue(a.updated_at ?? a.created_at),
  );
const sortSummariesByRecency = (t: SupportThreadSummary[]) =>
  [...t].sort(
    (a, b) =>
      getTimeValue(b.last_message_at ?? b.updated_at) -
      getTimeValue(a.last_message_at ?? a.updated_at),
  );
const sortMessagesChronologically = (m: SupportThread["messages"]) =>
  [...m].sort(
    (a, b) => getTimeValue(a.created_at) - getTimeValue(b.created_at),
  );

const formatTicketId = (id: string) =>
  `#${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
const formatUserRef = (userId: string | null | undefined) =>
  userId ? userId.replace(/-/g, "").slice(0, 10).toUpperCase() : "Khách";

const ThreadBadge = ({ status }: { status: SupportThread["status"] }) => {
  const styles =
    status === "open"
      ? "bg-emerald-500/15 text-emerald-600"
      : status === "pending"
      ? "bg-amber-500/15 text-amber-600"
      : status === "resolved"
      ? "bg-blue-500/15 text-blue-600"
      : "bg-muted text-muted-foreground";
  const label =
    status === "open"
      ? "Mở"
      : status === "pending"
      ? "Đang chờ"
      : status === "resolved"
      ? "Đã xử lý"
      : "Đã đóng";
  return <Badge className={cn("px-2 py-0.5", styles)}>{label}</Badge>;
};

/* ======================
 *  UI Sub-components
 * ====================== */

const AttachmentEditor = ({
  value,
  onChange,
}: {
  value: AttachmentDraft[];
  onChange: (next: AttachmentDraft[]) => void;
}) => {
  const update = (i: number, patch: Partial<AttachmentDraft>) => {
    const next = [...value];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const remove = (i: number) => {
    const next = [...value];
    next.splice(i, 1);
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {value.map((a, i) => (
        <div
          key={i}
          className="grid gap-2 sm:grid-cols-[1fr,2fr,auto,auto] sm:items-center"
        >
          <Input
            placeholder="Nhập tên tệp đính kèm"
            value={a.label}
            onChange={(e) => update(i, { label: e.target.value })}
          />
          <Input
            placeholder="https://..."
            value={a.url}
            onChange={(e) => update(i, { url: e.target.value })}
          />
          <select
            value={a.kind}
            onChange={(e) =>
              update(i, { kind: e.target.value as AttachmentDraft["kind"] })
            }
            className="h-10 rounded-md border border-input bg-background px-3 text-sm shadow-sm"
          >
            <option value="link">Liên kết</option>
            <option value="image">Hình ảnh</option>
            <option value="file">Tệp</option>
          </select>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => remove(i)}
            className="sm:justify-self-end"
          >
            Xóa
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="gap-2"
        onClick={() => onChange([...value, { ...defaultAttachment }])}
      >
        <Plus className="w-4 h-4" />
        Thêm tệp đính kèm
      </Button>
    </div>
  );
};

const AttachmentPreview = ({
  attachment,
}: {
  attachment: SupportAttachment;
}) => {
  if (isImageLink(attachment)) {
    return (
      <div className="overflow-hidden rounded-lg border border-border/40 bg-muted/30">
        {/* eslint-disable-next-line jsx-a11y/alt-text, @next/next/no-img-element */}
        <img
          src={attachment.url}
          alt={attachment.label ?? attachment.url}
          className="max-h-48 w-full object-contain"
        />
        {attachment.label && (
          <p className="border-t border-border/40 px-3 py-2 text-xs text-muted-foreground">
            {attachment.label}
          </p>
        )}
      </div>
    );
  }
  const Icon = attachment.kind === "file" ? FileIcon : LinkIcon;
  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 rounded border border-border/40 bg-muted/40 px-3 py-2 text-sm text-primary hover:bg-muted"
    >
      <Icon className="w-4 h-4" />
      {attachment.label || attachment.url}
    </a>
  );
};

const MessageBubble = ({
  thread,
  message,
  viewer,
}: {
  thread: SupportThread;
  message: SupportThread["messages"][number];
  viewer: "admin" | "user";
}) => {
  const isUser = message.sender === "user";
  const isAdmin = message.sender === "admin";
  const isAi = message.sender === "ai";
  const viewerIsAdmin = viewer === "admin";

  const userLabel = viewerIsAdmin
    ? `Người dùng ${formatUserRef(thread.user_id ?? null)}`
    : "Bạn";
  const adminLabel = viewerIsAdmin
    ? message.role ?? "Nhân viên hỗ trợ"
    : "Đội hỗ trợ";
  const senderLabel = isAi ? "Trợ lý Kyaro" : isUser ? userLabel : adminLabel;

  const alignRight =
    isUser && !viewerIsAdmin ? true : viewerIsAdmin ? isUser : false;

  return (
    <div
      className={cn(
        "flex w-full gap-3",
        alignRight ? "justify-end" : "justify-start",
      )}
    >
      {!alignRight && (
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-muted text-foreground shadow-sm">
          {isAi ? (
            <Bot className="h-4 w-4" />
          ) : (
            <MessageSquare className="h-4 w-4" />
          )}
        </div>
      )}

      <div
        className={cn(
          "flex max-w-[85%] sm:max-w-[78%] flex-col",
          alignRight ? "items-end" : "items-start",
        )}
      >
        <div
          className={cn(
            "rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm",
            alignRight
              ? "bg-primary text-primary-foreground"
              : isAi
              ? "bg-secondary/30 text-foreground"
              : "bg-muted text-foreground",
          )}
        >
          <p
            className={cn(
              "mb-1 text-[0.65rem] font-semibold uppercase tracking-wide opacity-80",
              alignRight ? "text-right" : "text-left",
            )}
          >
            {senderLabel}
          </p>

          {message.content ? (
            isAi ? (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                className="prose prose-sm dark:prose-invert max-w-none break-words [&_pre]:overflow-x-auto"
              >
                {message.content}
              </ReactMarkdown>
            ) : (
              <p className="whitespace-pre-wrap break-words">
                {message.content}
              </p>
            )
          ) : (
            <p className="italic opacity-75">Chưa có nội dung.</p>
          )}
        </div>

        {message.attachments?.length ? (
          <div
            className={cn(
              "mt-2 flex w-full flex-col gap-2",
              alignRight ? "items-end" : "items-start",
            )}
          >
            {message.attachments.map((att, i) => (
              <AttachmentPreview key={i} attachment={att} />
            ))}
          </div>
        ) : null}

        <p className="mt-1 text-xs text-muted-foreground">
          {timeAgo(message.created_at)}
          {message.role && isAdmin ? ` • ${message.role}` : ""}
        </p>
      </div>

      {alignRight && (
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-muted text-foreground shadow-sm">
          <MessageSquare className="h-4 w-4" />
        </div>
      )}
    </div>
  );
};

/* ======================
 *        Page
 * ====================== */

const Support = () => {
  const { hasAdminAccess } = useAuth();
  const queryClient = useQueryClient();

  // UI state
  const [search, setSearch] = useState("");
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<
    SupportThread["status"] | "all"
  >("open");
  const [composerTab, setComposerTab] = useState<TabKey>("reply");
  const [showListMobile, setShowListMobile] = useState(false);

  // Compose state
  const [replyText, setReplyText] = useState("");
  const [replyAttachments, setReplyAttachments] = useState<AttachmentDraft[]>(
    [],
  );
  const [aiText, setAiText] = useState("");
  const [aiAttachments, setAiAttachments] = useState<AttachmentDraft[]>([]);
  const endRef = useRef<HTMLDivElement | null>(null);

  // Queries
  const userThreadsQueryKey: readonly [string, string] = [
    "support-threads",
    "user",
  ];
  const adminListQueryKey: readonly [string, string, string] = [
    "support-threads",
    "admin",
    statusFilter ?? "all",
  ];

  const userThreadsQuery = useQuery({
    queryKey: userThreadsQueryKey,
    queryFn: fetchSupportThreads,
    enabled: !hasAdminAccess,
    staleTime: 15_000,
  });

  const adminSummariesQuery = useQuery({
    queryKey: adminListQueryKey,
    queryFn: () =>
      fetchAdminSupportThreads(
        statusFilter === "all" ? undefined : statusFilter,
      ),
    enabled: hasAdminAccess,
    staleTime: 10_000,
  });

  const adminThreadDetailQuery = useQuery({
    queryKey: ["support-thread", "admin", selectedThreadId],
    queryFn: () => fetchAdminSupportThread(selectedThreadId!),
    enabled: hasAdminAccess && Boolean(selectedThreadId),
    staleTime: 5_000,
  });

  // Derived data
  const adminThreadSummaries = useMemo(
    () =>
      hasAdminAccess
        ? sortSummariesByRecency(adminSummariesQuery.data ?? [])
        : [],
    [hasAdminAccess, adminSummariesQuery.data],
  );

  const userThreads = userThreadsQuery.data ?? [];
  const sortedUserThreads = useMemo(
    () => sortThreadsByRecency(userThreads),
    [userThreads],
  );

  // Which list to show (left column)
  const ticketItems: Array<SupportThread | SupportThreadSummary> =
    useMemo(() => {
      const base = hasAdminAccess ? adminThreadSummaries : sortedUserThreads;
      if (!search.trim()) return base;
      const q = search.trim().toLowerCase();
      return base.filter((t: any) => {
        const id = (t.id ?? "").toString().toLowerCase();
        const source = (t.source ?? "").toString().toLowerCase();
        const name = (t.title ?? t.subject ?? "").toString().toLowerCase();
        return id.includes(q) || source.includes(q) || name.includes(q);
      });
    }, [hasAdminAccess, adminThreadSummaries, sortedUserThreads, search]);

  // Selected thread entity
  const selectedThread: SupportThread | undefined = useMemo(() => {
    if (!selectedThreadId) return undefined;
    if (hasAdminAccess) {
      return adminThreadDetailQuery.data &&
        adminThreadDetailQuery.data.id === selectedThreadId
        ? adminThreadDetailQuery.data
        : undefined;
    }
    return sortedUserThreads.find((t) => t.id === selectedThreadId);
  }, [
    selectedThreadId,
    hasAdminAccess,
    adminThreadDetailQuery.data,
    sortedUserThreads,
  ]);

  // Ensure selection
  useEffect(() => {
    if (hasAdminAccess) {
      const hasSel = selectedThreadId
        ? adminThreadSummaries.some((s) => s.id === selectedThreadId)
        : false;
      if (selectedThreadId && !hasSel) {
        setSelectedThreadId(adminThreadSummaries[0]?.id ?? null);
      } else if (!selectedThreadId && adminThreadSummaries.length > 0) {
        setSelectedThreadId(adminThreadSummaries[0].id);
      }
      return;
    }
    if (!selectedThreadId && sortedUserThreads.length > 0) {
      setSelectedThreadId(sortedUserThreads[0].id);
    }
  }, [
    hasAdminAccess,
    selectedThreadId,
    adminThreadSummaries,
    sortedUserThreads,
  ]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (selectedThread) {
      setTimeout(
        () => endRef.current?.scrollIntoView({ behavior: "smooth" }),
        0,
      );
    }
  }, [selectedThread?.id, selectedThread?.messages?.length]);

  /* Cache update helpers */
  const updateThreadInCache = (
    threadId: string,
    updater: (thread: SupportThread) => SupportThread,
  ) => {
    if (hasAdminAccess) {
      queryClient.setQueryData(
        ["support-thread", "admin", threadId],
        (prev: SupportThread | undefined) => {
          if (!prev) return prev;
          const next = updater(prev);
          return {
            ...next,
            messages: sortMessagesChronologically(next.messages ?? []),
          };
        },
      );
      queryClient.setQueryData(adminListQueryKey, (prev: any) => {
        if (!prev) return prev;
        const updated = prev.map((s: SupportThreadSummary) =>
          s.id === threadId
            ? { ...s, updated_at: new Date().toISOString() }
            : s,
        );
        return sortSummariesByRecency(updated);
      });
    } else {
      queryClient.setQueryData(
        userThreadsQueryKey,
        (prev: SupportThread[] | undefined) => {
          if (!prev) return prev;
          const updated = prev.map((t) => {
            if (t.id !== threadId) return t;
            const next = updater(t);
            return {
              ...next,
              messages: sortMessagesChronologically(next.messages ?? []),
            };
          });
          return sortThreadsByRecency(updated);
        },
      );
    }
  };

  /* SSE live updates */
  const sseRef = useRef<EventSource | null>(null);
  useEffect(() => {
    if (!selectedThreadId) return;
    const base = import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, "") ?? "";
    const path = hasAdminAccess
      ? `/api/v1/admin/support/threads/${selectedThreadId}/events`
      : `/support/threads/${selectedThreadId}/events`;
    const url = `${base}${path}`;
    const sse = new EventSource(url, { withCredentials: true });
    sseRef.current = sse;

    const onSnapshot = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as SupportThread;
        if (!data?.id) return;
        updateThreadInCache(data.id, () => data);
      } catch {}
    };
    const onCreated = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as any;
        const threadId = data.thread_id as string;
        if (!threadId || !data.id) return;
        updateThreadInCache(threadId, (thr) => {
          const exists = thr.messages.some((m) => m.id === data.id);
          const attachments = (data.attachments ?? []) as SupportAttachment[];
          const newMsg = {
            id: data.id,
            sender: data.sender,
            role: data.role ?? null,
            content: data.content ?? null,
            attachments,
            meta: data.meta ?? {},
            created_at: data.created_at ?? null,
          };
          const messages = exists
            ? thr.messages.map((m) => (m.id === data.id ? newMsg : m))
            : [...thr.messages, newMsg];
          return {
            ...thr,
            messages,
            updated_at: newMsg.created_at ?? thr.updated_at,
          };
        });
      } catch {}
    };
    const onStatus = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as {
          thread_id: string;
          status: SupportThread["status"];
          updated_at?: string;
        };
        if (!data.thread_id || !data.status) return;
        updateThreadInCache(data.thread_id, (t) => ({
          ...t,
          status: data.status,
          updated_at: data.updated_at ?? t.updated_at,
        }));
      } catch {}
    };

    sse.addEventListener("thread.snapshot", onSnapshot);
    sse.addEventListener("message.created", onCreated);
    sse.addEventListener("thread.status", onStatus);
    sse.onerror = () => console.warn("SSE bị gián đoạn, đang thử lại...");

    return () => {
      sse.removeEventListener("thread.snapshot", onSnapshot);
      sse.removeEventListener("message.created", onCreated);
      sse.removeEventListener("thread.status", onStatus);
      sse.close();
      sseRef.current = null;
    };
  }, [hasAdminAccess, selectedThreadId]);

  /* Mutations */
  const upsertUserThread = useCallback(
    (thread: SupportThread) => {
      queryClient.setQueryData(
        userThreadsQueryKey,
        (prev: SupportThread[] | undefined) => {
          const norm = {
            ...thread,
            messages: sortMessagesChronologically(thread.messages ?? []),
          };
          if (!prev) return [norm];
          const idx = prev.findIndex((t) => t.id === thread.id);
          const next =
            idx >= 0
              ? [...prev.slice(0, idx), norm, ...prev.slice(idx + 1)]
              : [...prev, norm];
          return sortThreadsByRecency(next);
        },
      );
    },
    [queryClient],
  );

  const askMutation = useMutation({
    mutationFn: ({
      message,
      threadId,
      newThread,
      attachments,
    }: {
      message: string;
      threadId?: string | null;
      newThread?: boolean;
      attachments: SupportAttachment[];
    }) =>
      askSupportAssistant(message, {
        threadId,
        newThread,
        attachments,
      }),
    onSuccess: (thread) => {
      if (!hasAdminAccess) upsertUserThread(thread);
      setSelectedThreadId(thread.id);
      setAiText("");
      setAiAttachments([]);
      setShowListMobile(false);
    },
    onError: (err: unknown) =>
      toast(err instanceof Error ? err.message : "Không gửi được tới trợ lý."),
  });

  const humanMutation = useMutation({
    mutationFn: ({
      threadId,
      message,
      attachments,
    }: {
      threadId: string | null;
      message: string;
      attachments: SupportAttachment[];
    }) =>
      threadId
        ? postSupportThreadMessage(threadId, message, attachments)
        : createSupportThread(message, attachments),
    onSuccess: (thread) => {
      if (!hasAdminAccess) upsertUserThread(thread);
      setSelectedThreadId(thread.id);
      setReplyText("");
      setReplyAttachments([]);
      setShowListMobile(false);
    },
    onError: (err: unknown) =>
      toast(err instanceof Error ? err.message : "Không gửi được tin nhắn."),
  });

  const adminReplyMutation = useMutation({
    mutationFn: ({
      id,
      message,
      status,
      attachments,
    }: {
      id: string;
      message: string;
      status: SupportThread["status"] | null;
      attachments: SupportAttachment[];
    }) => adminReplySupportThread(id, message, status, attachments),
    onError: (err: unknown) =>
      toast(err instanceof Error ? err.message : "Phản hồi thất bại."),
  });

  /* Handlers */
  const sendReply = async () => {
    const trimmed = replyText.trim();
    if (!trimmed) return toast("Nội dung không được để trống.");
    if (hasAdminAccess) {
      if (!selectedThreadId) return;
      await adminReplyMutation.mutateAsync({
        id: selectedThreadId,
        message: trimmed,
        status: selectedThread?.status ?? "open",
        attachments: cleanAttachments(replyAttachments),
      });
    } else {
      await humanMutation.mutateAsync({
        threadId: selectedThread?.source === "human" ? selectedThread.id : null,
        message: trimmed,
        attachments: cleanAttachments(replyAttachments),
      });
    }
  };

  const askKyaro = async () => {
    const trimmed = aiText.trim();
    if (!trimmed) return toast("Nội dung không được để trống.");
    await askMutation.mutateAsync({
      message: trimmed,
      threadId: selectedThread?.source === "ai" ? selectedThread.id : undefined,
      newThread: selectedThread?.source !== "ai",
      attachments: cleanAttachments(aiAttachments),
    });
  };

  const viewer: "admin" | "user" = hasAdminAccess ? "admin" : "user";
  const orderedMessages = useMemo(
    () =>
      selectedThread
        ? sortMessagesChronologically(selectedThread.messages ?? [])
        : [],
    [selectedThread],
  );

  /* ==============
   *    Render
   * ============== */
  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Mobile top bar */}
      <div className="flex items-center justify-between sm:hidden">
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => setShowListMobile(true)}
        >
          <ListFilter className="h-4 w-4" />
          Danh sách ticket
        </Button>
        {selectedThread && <ThreadBadge status={selectedThread.status} />}
      </div>

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-[360px,1fr]">
        {/* LEFT: Ticket list (desktop) */}
        <Card className="glass-card hidden lg:block">
          <CardHeader className="space-y-3">
            <CardTitle>Danh sách ticket</CardTitle>
            <CardDescription>
              Chọn ticket để đọc & trả lời. Tìm kiếm theo mã, nguồn hoặc tiêu
              đề.
            </CardDescription>
            <div className="flex items-center gap-2">
              <div className="relative w-full">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Tìm ticket..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              {hasAdminAccess && (
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm shadow-sm"
                >
                  <option value="all">Tất cả</option>
                  <option value="open">Mở</option>
                  <option value="pending">Đang chờ</option>
                  <option value="resolved">Đã xử lý</option>
                  <option value="closed">Đã đóng</option>
                </select>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[70dvh] rounded-b-md border-t border-border/20 lt4c-scrollbar">
              <div className="space-y-2 p-2 pr-4">
                {(!hasAdminAccess
                  ? userThreadsQuery.isLoading
                  : adminSummariesQuery.isLoading) && (
                  <p className="px-2 py-2 text-sm text-muted-foreground">
                    Đang tải danh sách...
                  </p>
                )}
                {ticketItems.length === 0 && (
                  <p className="px-2 py-2 text-sm text-muted-foreground">
                    Không có ticket phù hợp.
                  </p>
                )}
                {ticketItems.map((t: any) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedThreadId(t.id)}
                    className={cn(
                      "w-full rounded-lg border border-transparent px-3 py-2 text-left transition hover:border-border/60",
                      t.id === selectedThreadId
                        ? "border-primary bg-primary/5"
                        : "bg-card",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {t.source === "ai"
                            ? "Trợ lý AI"
                            : `Ticket ${formatTicketId(t.id)}`}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {hasAdminAccess
                            ? `Người dùng ${formatUserRef(t.user_id)}`
                            : t.source === "ai"
                            ? "AI"
                            : "Hỗ trợ"}{" "}
                          •{" "}
                          {timeAgo(
                            t.last_message_at ?? t.updated_at ?? t.created_at,
                          )}
                        </p>
                      </div>
                      <ThreadBadge status={t.status} />
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* RIGHT: Chat panel */}
        <div className="space-y-4 sm:space-y-6">
          <Card className="glass-card">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between gap-3">
                <span className="truncate">
                  {selectedThread
                    ? selectedThread.source === "ai"
                      ? "Trợ lý Kyaro"
                      : `Ticket ${formatTicketId(selectedThread.id)}`
                    : "Chưa chọn ticket"}
                </span>
                <span className="hidden sm:inline-flex">
                  {selectedThread && (
                    <ThreadBadge status={selectedThread.status} />
                  )}
                </span>
              </CardTitle>
              <CardDescription className="truncate">
                {selectedThread
                  ? selectedThread.source === "ai"
                    ? "Hỏi đáp nhanh với trợ lý."
                    : "Trao đổi với đội hỗ trợ."
                  : "Hãy chọn một ticket ở khung bên trái để bắt đầu."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[55dvh] sm:h-[60dvh] rounded-md border border-border/20 lt4c-scrollbar">
                <div className="space-y-5 p-3 sm:p-4 pr-5">
                  {!selectedThread && (
                    <p className="text-sm text-muted-foreground">
                      Chưa có cuộc trò chuyện nào được chọn.
                    </p>
                  )}
                  {selectedThread &&
                    orderedMessages.map((m) => (
                      <MessageBubble
                        key={m.id}
                        thread={selectedThread}
                        message={m}
                        viewer={viewer}
                      />
                    ))}
                  <div ref={endRef} />
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Composer */}
          <Card className="glass-card">
            <CardHeader className="pb-2">
              <CardTitle>Soạn tin nhắn</CardTitle>
              <CardDescription className="truncate">
                {hasAdminAccess
                  ? "Chọn tab phù hợp: trả lời khách hoặc hỏi Trợ lý Kyaro (nội bộ)."
                  : "Gửi tin nhắn, đính kèm ảnh/liên kết. Tin nhắn sẽ tới đúng kênh bạn đã chọn."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {hasAdminAccess ? (
                <Tabs
                  value={composerTab}
                  onValueChange={(v) => setComposerTab(v as TabKey)}
                  className="w-full"
                >
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="reply">Trả lời khách</TabsTrigger>
                    <TabsTrigger value="ai">Hỏi Trợ lý AI</TabsTrigger>
                  </TabsList>

                  <TabsContent value="reply" className="space-y-4">
                    <Textarea
                      placeholder="Nhập phản hồi cho người dùng..."
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      className="min-h-[100px] sm:min-h-[120px]"
                      disabled={!selectedThread}
                    />
                    <AttachmentEditor
                      value={replyAttachments}
                      onChange={setReplyAttachments}
                    />
                    <div className="flex justify-end">
                      <Button
                        onClick={sendReply}
                        disabled={
                          !selectedThread || adminReplyMutation.isLoading
                        }
                        className="gap-2"
                      >
                        {adminReplyMutation.isLoading ? (
                          <ThreeDot
                            variant="bounce"
                            color="#ffac00"
                            size="large"
                            text="Đang tải nội dung từ server"
                            textColor=""
                          />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                        Gửi phản hồi
                      </Button>
                    </div>
                  </TabsContent>

                  <TabsContent value="ai" className="space-y-4">
                    <Textarea
                      placeholder="Đặt câu hỏi cho Trợ lý Kyaro (riêng tư)..."
                      value={aiText}
                      onChange={(e) => setAiText(e.target.value)}
                      className="min-h-[100px] sm:min-h-[120px]"
                    />
                    <AttachmentEditor
                      value={aiAttachments}
                      onChange={setAiAttachments}
                    />
                    <div className="flex justify-end">
                      <Button
                        onClick={askKyaro}
                        disabled={askMutation.isLoading}
                        className="gap-2"
                      >
                        {askMutation.isLoading ? (
                          <ThreeDot
                            variant="bounce"
                            color="#ffac00"
                            size="large"
                            text="Đang tải nội dung từ server"
                            textColor=""
                          />
                        ) : (
                          <Bot className="h-4 w-4" />
                        )}
                        Hỏi Kyaro
                      </Button>
                    </div>
                  </TabsContent>
                </Tabs>
              ) : (
                <>
                  {selectedThread?.source === "ai" ? (
                    <>
                      <Textarea
                        placeholder="Hỏi trợ lý..."
                        value={aiText}
                        onChange={(e) => setAiText(e.target.value)}
                        className="min-h-[100px] sm:min-h-[120px]"
                      />
                      <AttachmentEditor
                        value={aiAttachments}
                        onChange={setAiAttachments}
                      />
                      <div className="flex justify-end">
                        <Button
                          onClick={askKyaro}
                          disabled={askMutation.isLoading}
                          className="gap-2"
                        >
                          {askMutation.isLoading ? (
                            <ThreeDot
                              variant="bounce"
                              color="#ffac00"
                              size="large"
                              text="Đang tải nội dung từ server"
                              textColor=""
                            />
                          ) : (
                            <Bot className="h-4 w-4" />
                          )}
                          Gửi
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <Textarea
                        placeholder="Nhập tin nhắn..."
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        className="min-h-[100px] sm:min-h-[120px]"
                      />
                      <AttachmentEditor
                        value={replyAttachments}
                        onChange={setReplyAttachments}
                      />
                      <div className="flex justify-end">
                        <Button
                          onClick={sendReply}
                          disabled={humanMutation.isLoading}
                          className="gap-2"
                        >
                          {humanMutation.isLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Send className="h-4 w-4" />
                          )}
                          Gửi
                        </Button>
                      </div>
                    </>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Mobile slide-over list */}
      {showListMobile && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowListMobile(false)}
          />
          <div className="absolute inset-y-0 left-0 w-[88%] max-w-[380px] bg-background shadow-2xl border-r border-border lt4c-scrollbar flex flex-col">
            <div className="flex items-center gap-2 p-3 border-b border-border/50">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowListMobile(false)}
              >
                <X className="h-5 w-5" />
              </Button>
              <p className="font-semibold">Danh sách ticket</p>
            </div>

            <div className="p-3 flex items-center gap-2">
              <div className="relative w-full">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Tìm ticket..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              {hasAdminAccess && (
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                  className="h-10 rounded-md border border-input bg-background px-2 text-xs shadow-sm"
                >
                  <option value="all">Tất cả</option>
                  <option value="open">Mở</option>
                  <option value="pending">Đang chờ</option>
                  <option value="resolved">Đã xử lý</option>
                  <option value="closed">Đã đóng</option>
                </select>
              )}
            </div>

            <ScrollArea className="flex-1 lt4c-scrollbar">
              <div className="space-y-2 p-2 pr-4">
                {(!hasAdminAccess
                  ? userThreadsQuery.isLoading
                  : adminSummariesQuery.isLoading) && (
                  <p className="px-2 py-2 text-sm text-muted-foreground">
                    Đang tải danh sách...
                  </p>
                )}
                {ticketItems.length === 0 && (
                  <p className="px-2 py-2 text-sm text-muted-foreground">
                    Không có ticket phù hợp.
                  </p>
                )}
                {ticketItems.map((t: any) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setSelectedThreadId(t.id);
                      setShowListMobile(false);
                    }}
                    className={cn(
                      "w-full rounded-lg border border-transparent px-3 py-2 text-left transition hover:border-border/60",
                      t.id === selectedThreadId
                        ? "border-primary bg-primary/5"
                        : "bg-card",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {t.source === "ai"
                            ? "Trợ lý AI"
                            : `Ticket ${formatTicketId(t.id)}`}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {hasAdminAccess
                            ? `Người dùng ${formatUserRef(t.user_id)}`
                            : t.source === "ai"
                            ? "AI"
                            : "Hỗ trợ"}{" "}
                          •{" "}
                          {timeAgo(
                            t.last_message_at ?? t.updated_at ?? t.created_at,
                          )}
                        </p>
                      </div>
                      <ThreadBadge status={t.status} />
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>
        </div>
      )}
    </div>
  );
};

export default Support;
