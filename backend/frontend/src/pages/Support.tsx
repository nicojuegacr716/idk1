import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MessageSquare, Plus, Send, Bot, Link as LinkIcon, File as FileIcon } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/context/AuthContext";
import { toast } from "@/components/ui/sonner";
import {
  adminReplySupportThread,
  askSupportAssistant,
  createSupportThread,
  fetchAdminSupportThread,
  fetchAdminSupportThreads,
  fetchSupportThreads,
  postSupportThreadMessage,
} from "@/lib/api-client";
import type { SupportAttachment, SupportThread, SupportThreadSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import remarkGfm from "remark-gfm";
import ReactMarkdown from "react-markdown";

type AttachmentDraft = {
  label: string;
  url: string;
  kind: "link" | "image" | "file";
};

type TabKey = "ai" | "human";

const imageExtensions = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"];

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");

const resolveApiUrl = (path: string) => {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  if (!API_BASE) {
    return path;
  }
  return `${API_BASE}${path}`;
};

const defaultAttachment: AttachmentDraft = { label: "", url: "", kind: "link" };

const cleanAttachments = (drafts: AttachmentDraft[]): SupportAttachment[] =>
  drafts
    .map((draft) => ({
      url: draft.url.trim(),
      label: draft.label.trim() || null,
      kind: draft.kind,
    }))
    .filter((item) => item.url.length > 0);

const isImageLink = (attachment: SupportAttachment) => {
  if (attachment.kind === "image") return true;
  const url = attachment.url.toLowerCase();
  return imageExtensions.some((ext) => url.endsWith(ext));
};

const timeAgo = (value: string | null | undefined) => {
  if (!value) return "Unknown";
  try {
    const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
    const minutes = Math.round((new Date(value).getTime() - Date.now()) / 60000);
    if (Math.abs(minutes) < 60) {
      return formatter.format(minutes, "minute");
    }
    const hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) {
      return formatter.format(hours, "hour");
    }
    const days = Math.round(hours / 24);
    return formatter.format(days, "day");
  } catch {
    return value;
  }
};

const getTimeValue = (raw: string | null | undefined) => (raw ? new Date(raw).getTime() : 0);

const sortThreadsByRecency = (threads: SupportThread[]): SupportThread[] =>
  [...threads].sort((a, b) => getTimeValue(b.updated_at ?? b.created_at) - getTimeValue(a.updated_at ?? a.created_at));

const sortSummariesByRecency = (threads: SupportThreadSummary[]): SupportThreadSummary[] =>
  [...threads].sort((a, b) => getTimeValue(b.last_message_at ?? b.updated_at) - getTimeValue(a.last_message_at ?? a.updated_at));

const sortMessagesChronologically = (messages: SupportThread["messages"]): SupportThread["messages"] =>
  [...messages].sort((a, b) => getTimeValue(a.created_at) - getTimeValue(b.created_at));

const formatTicketId = (id: string) => `#${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;

const formatUserRef = (userId: string | null | undefined) =>
  userId ? userId.replace(/-/g, "").slice(0, 10).toUpperCase() : "Guest";

const ThreadBadge = ({ status }: { status: SupportThread["status"] }) => {
  const variant =
    status === "open"
      ? "bg-green-500/20 text-green-600"
      : status === "pending"
      ? "bg-amber-500/20 text-amber-600"
      : status === "resolved"
      ? "bg-blue-500/20 text-blue-600"
      : "bg-muted text-muted-foreground";
  return <Badge className={cn("px-2 py-0.5 uppercase", variant)}>{status}</Badge>;
};

const AttachmentEditor = ({
  value,
  onChange,
}: {
  value: AttachmentDraft[];
  onChange: (next: AttachmentDraft[]) => void;
}) => {
  const updateAttachment = (index: number, update: Partial<AttachmentDraft>) => {
    const next = [...value];
    next[index] = { ...next[index], ...update };
    onChange(next);
  };

  const removeAttachment = (index: number) => {
    const next = [...value];
    next.splice(index, 1);
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {value.map((attachment, index) => (
        <div key={index} className="grid gap-2 md:grid-cols-[1fr,2fr,auto,auto] md:items-center">
          <Input
            placeholder="Label"
            value={attachment.label}
            onChange={(event) => updateAttachment(index, { label: event.target.value })}
          />
          <Input
            placeholder="https://..."
            value={attachment.url}
            onChange={(event) => updateAttachment(index, { url: event.target.value })}
          />
          <select
            value={attachment.kind}
            onChange={(event) => updateAttachment(index, { kind: event.target.value as AttachmentDraft["kind"] })}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="link">Link</option>
            <option value="image">Image</option>
            <option value="file">File</option>
          </select>
          <Button variant="ghost" size="sm" onClick={() => removeAttachment(index)}>
            Remove
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" className="gap-2" onClick={() => onChange([...value, { ...defaultAttachment }])}>
        <Plus className="w-4 h-4" />
        Attachment
      </Button>
    </div>
  );
};

const AttachmentPreview = ({ attachment }: { attachment: SupportAttachment }) => {
  if (isImageLink(attachment)) {
    return (
      <div className="overflow-hidden rounded-lg border border-border/40 bg-muted/30">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={attachment.url} alt={attachment.label ?? attachment.url} className="max-h-48 w-full object-contain" />
        {attachment.label && <p className="border-t border-border/40 px-3 py-2 text-xs text-muted-foreground">{attachment.label}</p>}
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
  const userLabel = viewerIsAdmin ? `User ${formatUserRef(thread.user_id ?? null)}` : "You";
  const adminLabel = viewerIsAdmin ? message.role ?? "Support Agent" : "Support Team";
  const senderLabel = isAi ? "Kyaro Assistant" : isUser ? userLabel : adminLabel;
  const absoluteTime = message.created_at ? new Date(message.created_at).toLocaleString() : null;

  return (
    <div className={cn("flex w-full gap-3", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-muted text-foreground shadow-sm">
          {isAi ? <Bot className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
        </div>
      )}
      <div className={cn("flex max-w-[75%] flex-col gap-2", isUser ? "items-end" : "items-start")}>
        <p
          className={cn(
            "text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground",
            isUser ? "text-right" : "text-left",
          )}
        >
          {senderLabel}
        </p>
        <div
          className={cn(
            "w-full rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm",
            isUser
              ? "bg-primary text-primary-foreground"
              : isAi
                ? "bg-secondary/30 text-foreground"
                : "bg-muted text-foreground",
          )}
        >
          {message.content ? (
            isAi ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]} className="prose prose-sm dark:prose-invert max-w-none break-words">
                {message.content}
              </ReactMarkdown>
            ) : (
              <p className="whitespace-pre-wrap break-words">{message.content}</p>
            )
          ) : (
            <p className="italic text-muted-foreground">No content provided.</p>
          )}
        </div>
        {message.attachments && message.attachments.length > 0 && (
          <div className="flex flex-col gap-2">
            {message.attachments.map((attachment, index) => (
              <AttachmentPreview key={index} attachment={attachment} />
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {timeAgo(message.created_at)}
          {absoluteTime ? ` • ${absoluteTime}` : ""}
          {isAdmin && message.role ? ` • ${message.role}` : null}
        </p>
      </div>
      {isUser && (
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-muted text-foreground shadow-sm">
          <MessageSquare className="h-4 w-4" />
        </div>
      )}
    </div>
  );
};

const Support = () => {
  const queryClient = useQueryClient();
  const { hasAdminAccess } = useAuth();
  const [activeTab, setActiveTab] = useState<TabKey>("human");
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [isCreatingAi, setIsCreatingAi] = useState(false);
  const [isCreatingHuman, setIsCreatingHuman] = useState(false);
  const [statusFilter, setStatusFilter] = useState<SupportThread["status"] | "all">("open");
  const [aiMessage, setAiMessage] = useState("");
  const [humanMessage, setHumanMessage] = useState("");
  const [adminReply, setAdminReply] = useState("");
  const [adminStatus, setAdminStatus] = useState<SupportThread["status"]>("open");
  const [aiAttachments, setAiAttachments] = useState<AttachmentDraft[]>([]);
  const [humanAttachments, setHumanAttachments] = useState<AttachmentDraft[]>([]);
  const [adminAttachments, setAdminAttachments] = useState<AttachmentDraft[]>([]);
  const endOfMessages = useRef<HTMLDivElement | null>(null);

  const userThreadsQueryKey: readonly [string, string] = ["support-threads", "user"];
  const adminListQueryKey: readonly [string, string, string] = ["support-threads", "admin", statusFilter ?? "all"];

  const userThreadsQuery = useQuery({
    queryKey: userThreadsQueryKey,
    queryFn: () => fetchSupportThreads(),
    enabled: !hasAdminAccess,
    staleTime: 15_000,
  });

  const adminSummariesQuery = useQuery({
    queryKey: adminListQueryKey,
    queryFn: async () => {
      const summaries = await fetchAdminSupportThreads(statusFilter === "all" ? undefined : statusFilter);
      return summaries;
    },
    enabled: hasAdminAccess,
    staleTime: 10_000,
  });

  const adminThreadDetailQuery = useQuery({
    queryKey: ["support-thread", "admin", selectedThreadId],
    queryFn: () => fetchAdminSupportThread(selectedThreadId!),
    enabled: hasAdminAccess && Boolean(selectedThreadId),
    staleTime: 5_000,
  });

  const adminThreadSummaries = useMemo(
    () => (hasAdminAccess ? sortSummariesByRecency(adminSummariesQuery.data ?? []) : []),
    [hasAdminAccess, adminSummariesQuery.data],
  );

  const userThreads = userThreadsQuery.data ?? [];

  const sortedUserThreads = useMemo(() => sortThreadsByRecency(userThreads), [userThreads]);

  const aiThreads = useMemo(
    () => (hasAdminAccess ? [] : sortedUserThreads.filter((thread) => thread.source === "ai")),
    [hasAdminAccess, sortedUserThreads],
  );

  const humanThreads = useMemo(
    () => (hasAdminAccess ? [] : sortedUserThreads.filter((thread) => thread.source === "human")),
    [hasAdminAccess, sortedUserThreads],
  );

  const visibleThreads = useMemo(() => {
    if (hasAdminAccess) {
      return adminThreadSummaries;
    }
    return activeTab === "ai" ? aiThreads : humanThreads;
  }, [hasAdminAccess, adminThreadSummaries, activeTab, aiThreads, humanThreads]);

  const selectedThread: SupportThread | undefined = useMemo(() => {
    if (!selectedThreadId) return undefined;
    if (hasAdminAccess) {
      return adminThreadDetailQuery.data && adminThreadDetailQuery.data.id === selectedThreadId
        ? adminThreadDetailQuery.data
        : undefined;
    }
    return sortedUserThreads.find((thread) => thread.id === selectedThreadId);
  }, [selectedThreadId, hasAdminAccess, adminThreadDetailQuery.data, sortedUserThreads]);

  useEffect(() => {
    if (hasAdminAccess) {
      const hasSelection = selectedThreadId
        ? adminThreadSummaries.some((summary) => summary.id === selectedThreadId)
        : false;
      if (selectedThreadId && !hasSelection) {
        setSelectedThreadId(adminThreadSummaries[0]?.id ?? null);
        return;
      }
      if (!selectedThreadId && adminThreadSummaries.length > 0) {
        setSelectedThreadId(adminThreadSummaries[0].id);
      }
      return;
    }
    const threadsForTab = activeTab === "ai" ? aiThreads : humanThreads;
    const isCreating = activeTab === "ai" ? isCreatingAi : isCreatingHuman;
    const hasSelection = selectedThreadId
      ? threadsForTab.some((thread) => thread.id === selectedThreadId)
      : false;
    if (selectedThreadId && !hasSelection) {
      setSelectedThreadId(threadsForTab[0]?.id ?? null);
      return;
    }
    if (!selectedThreadId && !isCreating && threadsForTab.length > 0) {
      setSelectedThreadId(threadsForTab[0].id);
    }
  }, [
    hasAdminAccess,
    adminThreadSummaries,
    selectedThreadId,
    activeTab,
    aiThreads,
    humanThreads,
    isCreatingAi,
    isCreatingHuman,
  ]);

  useEffect(() => {
    if (selectedThread) {
      setAdminStatus(selectedThread.status);
      setTimeout(() => endOfMessages.current?.scrollIntoView({ behavior: "smooth" }), 0);
    }
  }, [selectedThread]);

  const viewerContext: "admin" | "user" = hasAdminAccess ? "admin" : "user";

  const orderedMessages = useMemo(
    () => (selectedThread ? sortMessagesChronologically(selectedThread.messages ?? []) : []),
    [selectedThread],
  );

  const conversationTitle = useMemo(() => {
    if (selectedThread) {
      if (selectedThread.source === "ai") {
        return "Kyaro Assistant";
      }
      return hasAdminAccess ? "Support Ticket" : "Support Team";
    }
    if (hasAdminAccess) {
      return "Conversation";
    }
    return activeTab === "ai" ? "Kyaro Assistant" : "Support Team";
  }, [selectedThread, hasAdminAccess, activeTab]);

  const conversationSubtitle = useMemo(() => {
    if (selectedThread) {
      if (selectedThread.source === "ai") {
        return "Ask questions and get instant answers from Kyaro.";
      }
      return hasAdminAccess
        ? "Reply to the customer and keep the ticket status up to date."
        : "Chat with the LT4C support crew about your issue.";
    }
    if (hasAdminAccess) {
      return "Select a thread from the list to view messages.";
    }
    return activeTab === "ai"
      ? "Start a new assistant chat or pick a previous conversation."
      : "Create a new ticket or continue an existing one.";
  }, [selectedThread, hasAdminAccess, activeTab]);

  const conversationMeta = useMemo(() => {
    if (!selectedThread) return null;
    const parts: string[] = [formatTicketId(selectedThread.id), `Status ${selectedThread.status.toUpperCase()}`];
    if (hasAdminAccess) {
      parts.push(`User ${formatUserRef(selectedThread.user_id ?? null)}`);
    }
    if (selectedThread.updated_at) {
      parts.push(`Updated ${timeAgo(selectedThread.updated_at)}`);
    }
    return parts.join(" • ");
  }, [selectedThread, hasAdminAccess]);

  const queryKeyForThreads = hasAdminAccess ? adminListQueryKey : userThreadsQueryKey;

  const updateThreadInCache = (threadId: string, updater: (thread: SupportThread) => SupportThread) => {
    if (hasAdminAccess) {
      queryClient.setQueryData(["support-thread", "admin", threadId], (prev: SupportThread | undefined) => {
        if (!prev) return prev;
        const nextThread = updater(prev);
        return {
          ...nextThread,
          messages: sortMessagesChronologically(nextThread.messages ?? []),
        };
      });
      queryClient.setQueryData(adminListQueryKey, (prev: any) => {
        if (!prev) return prev;
        const updated = prev.map((summary: SupportThreadSummary) =>
          summary.id === threadId
            ? {
                ...summary,
                status: updater({
                  ...summary,
                  messages: [],
                } as unknown as SupportThread).status,
                updated_at: new Date().toISOString(),
                last_message_at: new Date().toISOString(),
              }
            : summary,
        );
        return sortSummariesByRecency(updated);
      });
    } else {
      queryClient.setQueryData(userThreadsQueryKey, (prev: SupportThread[] | undefined) => {
        if (!prev) return prev;
        const updated = prev.map((thread) => {
          if (thread.id !== threadId) {
            return thread;
          }
          const nextThread = updater(thread);
          return {
            ...nextThread,
            messages: sortMessagesChronologically(nextThread.messages ?? []),
          };
        });
        return sortThreadsByRecency(updated);
      });
    }
  };

  const sseSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!selectedThreadId) return;
    const path = hasAdminAccess
      ? `/api/v1/admin/support/threads/${selectedThreadId}/events`
      : `/support/threads/${selectedThreadId}/events`;
    const url = resolveApiUrl(path);
    const source = new EventSource(url, { withCredentials: true });
    sseSourceRef.current = source;

    const handleSnapshot = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as SupportThread;
        if (!data || !data.id) return;
        updateThreadInCache(data.id, () => data);
      } catch {
        // ignore
      }
    };

    const handleMessageCreated = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as any;
        const threadId = data.thread_id as string;
        if (!threadId || !data.id) return;
        updateThreadInCache(threadId, (thread) => {
          const exists = thread.messages.some((msg) => msg.id === data.id);
          const attachments = (data.attachments ?? []) as SupportAttachment[];
          const newMessage = {
            id: data.id,
            sender: data.sender,
            role: data.role ?? null,
            content: data.content ?? null,
            attachments,
            meta: data.meta ?? {},
            created_at: data.created_at ?? null,
          };
          const messages = exists
            ? thread.messages.map((msg) => (msg.id === data.id ? newMessage : msg))
            : [...thread.messages, newMessage];
          return {
            ...thread,
            messages,
            updated_at: newMessage.created_at ?? thread.updated_at,
          };
        });
      } catch {
        // ignore
      }
    };

    const handleStatus = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as { thread_id: string; status: SupportThread["status"]; updated_at?: string };
        if (!data.thread_id || !data.status) return;
        updateThreadInCache(data.thread_id, (thread) => ({
          ...thread,
          status: data.status,
          updated_at: data.updated_at ?? thread.updated_at,
        }));
      } catch {
        // ignore
      }
    };

    source.addEventListener("thread.snapshot", handleSnapshot);
    source.addEventListener("message.created", handleMessageCreated);
    source.addEventListener("thread.status", handleStatus);

    source.onerror = () => {
      // eslint-disable-next-line no-console
      console.warn("Support SSE connection lost, retrying...");
    };

    return () => {
      source.removeEventListener("thread.snapshot", handleSnapshot);
      source.removeEventListener("message.created", handleMessageCreated);
      source.removeEventListener("thread.status", handleStatus);
      source.close();
      sseSourceRef.current = null;
    };
  }, [hasAdminAccess, selectedThreadId]);

  const upsertUserThread = useCallback(
    (thread: SupportThread) => {
      queryClient.setQueryData(userThreadsQueryKey, (prev: SupportThread[] | undefined) => {
        const normalized = {
          ...thread,
          messages: sortMessagesChronologically(thread.messages ?? []),
        };
        if (!prev) {
          return [normalized];
        }
        const index = prev.findIndex((item) => item.id === thread.id);
        if (index >= 0) {
          const next = [...prev];
          next[index] = normalized;
          return sortThreadsByRecency(next);
        }
        return sortThreadsByRecency([...prev, normalized]);
      });
    },
    [queryClient, userThreadsQueryKey],
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
      upsertUserThread(thread);
      setActiveTab("ai");
      setIsCreatingAi(false);
      setSelectedThreadId(thread.id);
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Failed to contact assistant.";
      toast(message);
    },
  });

  const humanMessageMutation = useMutation({
    mutationFn: ({
      threadId,
      message,
      attachments,
    }: {
      threadId: string | null;
      message: string;
      attachments: SupportAttachment[];
    }) => {
      if (threadId) {
        return postSupportThreadMessage(threadId, message, attachments);
      }
      return createSupportThread(message, attachments);
    },
    onSuccess: (thread) => {
      upsertUserThread(thread);
      setActiveTab("human");
      setIsCreatingHuman(false);
      setSelectedThreadId(thread.id);
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Failed to send message.";
      toast(message);
    },
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
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Failed to reply to thread.";
      toast(message);
    },
  });

  const handleSelectThread = (threadId: string, source: "ai" | "human") => {
    setSelectedThreadId(threadId);
    if (hasAdminAccess) {
      return;
    }
    if (source === "ai") {
      setIsCreatingAi(false);
    } else {
      setIsCreatingHuman(false);
    }
  };

  const startNewConversation = (source: "ai" | "human") => {
    if (source === "ai") {
      setActiveTab("ai");
      setIsCreatingAi(true);
      setAiMessage("");
      setAiAttachments([]);
    } else {
      setActiveTab("human");
      setIsCreatingHuman(true);
      setHumanMessage("");
      setHumanAttachments([]);
    }
    setSelectedThreadId(null);
  };

  const handleSendAi = async () => {
    const trimmed = aiMessage.trim();
    if (!trimmed) {
      toast("Message cannot be empty.");
      return;
    }
    const attachments = cleanAttachments(aiAttachments);
    await askMutation.mutateAsync({
      message: trimmed,
      threadId: selectedThread?.source === "ai" ? selectedThread.id : undefined,
      newThread: selectedThread?.source !== "ai",
      attachments,
    });
    setAiMessage("");
    setAiAttachments([]);
  };

  const handleSendHuman = async () => {
    const trimmed = humanMessage.trim();
    if (!trimmed) {
      toast("Message cannot be empty.");
      return;
    }
    const attachments = cleanAttachments(humanAttachments);
    await humanMessageMutation.mutateAsync({
      threadId: selectedThread?.source === "human" ? selectedThread.id : null,
      message: trimmed,
      attachments,
    });
    setHumanMessage("");
    setHumanAttachments([]);
  };

  const handleAdminReply = async () => {
    if (!selectedThread || !hasAdminAccess) return;
    const trimmed = adminReply.trim();
    if (!trimmed) {
      toast("Message cannot be empty.");
      return;
    }
    const attachments = cleanAttachments(adminAttachments);
    await adminReplyMutation.mutateAsync({
      id: selectedThread.id,
      message: trimmed,
      status: adminStatus,
      attachments,
    });
    setAdminReply("");
    setAdminAttachments([]);
  };

  const isLoadingThreads = hasAdminAccess ? adminSummariesQuery.isLoading : userThreadsQuery.isLoading;

  const renderThreadList = () => {
    if (hasAdminAccess) {
      const summaries = adminSummariesQuery.data ?? [];
      return (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Threads</h3>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as SupportThread["status"] | "all")}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs shadow-sm"
            >
              <option value="all">All statuses</option>
              <option value="open">Open</option>
              <option value="pending">Pending</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </select>
          </div>
          <ScrollArea className="h-[70vh] rounded-md border border-border/30">
            <div className="space-y-2 p-2">
              {summaries.length === 0 && <p className="text-xs text-muted-foreground px-2">No threads found.</p>}
              {summaries.map((summary) => (
              <button
                key={summary.id}
                type="button"
                onClick={() => handleSelectThread(summary.id, summary.source)}
                className={cn(
                  "w-full rounded-lg border border-transparent px-3 py-2 text-left transition hover:border-border/60",
                  summary.id === selectedThreadId ? "border-primary bg-primary/5" : "bg-card",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">
                      {summary.source === "ai" ? "AI Assistant" : `Ticket ${formatTicketId(summary.id)}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      User {formatUserRef(summary.user_id)} • {timeAgo(summary.last_message_at ?? summary.updated_at)}
                    </p>
                  </div>
                  <ThreadBadge status={summary.status} />
                </div>
              </button>
            ))}
            </div>
          </ScrollArea>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            const next = value as TabKey;
            setActiveTab(next);
            if (next === "ai") {
              setIsCreatingHuman(false);
            } else {
              setIsCreatingAi(false);
            }
          }}
          className="w-full"
        >
          <TabsList className="grid grid-cols-2">
            <TabsTrigger value="ai">AI Assistant</TabsTrigger>
            <TabsTrigger value="human">Support Team</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center justify-between px-1">
          <p className="text-xs text-muted-foreground">
            {activeTab === "ai"
              ? "Chat with Kyaro for quick, automated answers."
              : "Talk directly with the human support team."}
          </p>
          <Button variant="outline" size="sm" onClick={() => startNewConversation(activeTab)}>
            {activeTab === "ai" ? "New AI chat" : "New ticket"}
          </Button>
        </div>
        <ScrollArea className="h-[70vh] rounded-md border border-border/30">
          <div className="space-y-2 p-2">
            {visibleThreads.length === 0 && <p className="text-xs text-muted-foreground px-2">No threads yet.</p>}
            {visibleThreads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                onClick={() => handleSelectThread(thread.id, thread.source)}
                className={cn(
                  "w-full rounded-lg border border-transparent px-3 py-2 text-left transition hover:border-border/60",
                  thread.id === selectedThreadId ? "border-primary bg-primary/5" : "bg-card",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">
                      {thread.source === "ai" ? "Kyaro Assistant" : `Ticket ${formatTicketId(thread.id)}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {thread.source === "ai" ? "AI conversation" : "Support team"} • {timeAgo(thread.updated_at ?? thread.created_at)}
                    </p>
                  </div>
                  <ThreadBadge status={thread.status} />
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>
    );
  };

  const renderComposer = () => {
    if (!selectedThread && !hasAdminAccess && activeTab === "ai") {
      return (
        <div className="space-y-4">
          <Textarea
            placeholder="Ask the assistant..."
            value={aiMessage}
            onChange={(event) => setAiMessage(event.target.value)}
            className="min-h-[120px]"
          />
          <AttachmentEditor value={aiAttachments} onChange={setAiAttachments} />
          <div className="flex justify-end">
            <Button onClick={handleSendAi} disabled={askMutation.isLoading}>
              {askMutation.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send"}
            </Button>
          </div>
        </div>
      );
    }

    if (!selectedThread && !hasAdminAccess && activeTab === "human") {
      return (
        <div className="space-y-4">
          <Textarea
            placeholder="Describe your issue..."
            value={humanMessage}
            onChange={(event) => setHumanMessage(event.target.value)}
            className="min-h-[120px]"
          />
          <AttachmentEditor value={humanAttachments} onChange={setHumanAttachments} />
          <div className="flex justify-end">
            <Button onClick={handleSendHuman} disabled={humanMessageMutation.isLoading}>
              {humanMessageMutation.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create ticket"}
            </Button>
          </div>
        </div>
      );
    }

    if (hasAdminAccess) {
      const composerDisabled = !selectedThread;
      return (
        <div className="space-y-4">
          <Textarea
            placeholder="Write a reply..."
            value={adminReply}
            onChange={(event) => setAdminReply(event.target.value)}
            className="min-h-[140px]"
            disabled={composerDisabled}
          />
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2">
              <label htmlFor="admin-status" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Status
              </label>
              <select
                id="admin-status"
                value={adminStatus}
                onChange={(event) => setAdminStatus(event.target.value as SupportThread["status"])}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm shadow-sm"
                disabled={composerDisabled}
              >
                <option value="open">Open</option>
                <option value="pending">Pending</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
              </select>
            </div>
            <AttachmentEditor value={adminAttachments} onChange={setAdminAttachments} />
          </div>
          <div className="flex justify-end">
            <Button onClick={handleAdminReply} disabled={composerDisabled || adminReplyMutation.isLoading}>
              {adminReplyMutation.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send reply"}
            </Button>
          </div>
        </div>
      );
    }

    if (selectedThread?.source === "ai") {
      return (
        <div className="space-y-4">
          <Textarea
            placeholder="Ask the assistant..."
            value={aiMessage}
            onChange={(event) => setAiMessage(event.target.value)}
            className="min-h-[120px]"
          />
          <AttachmentEditor value={aiAttachments} onChange={setAiAttachments} />
          <div className="flex justify-end">
            <Button onClick={handleSendAi} disabled={askMutation.isLoading}>
              {askMutation.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send"}
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <Textarea
          placeholder="Type your message..."
          value={humanMessage}
          onChange={(event) => setHumanMessage(event.target.value)}
          className="min-h-[120px]"
        />
        <AttachmentEditor value={humanAttachments} onChange={setHumanAttachments} />
        <div className="flex justify-end">
          <Button onClick={handleSendHuman} disabled={humanMessageMutation.isLoading}>
            {humanMessageMutation.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send"}
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[320px,1fr]">
      <div>{renderThreadList()}</div>
      <div className="space-y-6">
        <Card className="glass-card min-h-[60vh]">
          <CardHeader>
            <CardTitle>{conversationTitle}</CardTitle>
            <CardDescription>{conversationSubtitle}</CardDescription>
            {conversationMeta && <p className="text-xs text-muted-foreground">{conversationMeta}</p>}
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-[55vh] rounded-md border border-border/20">
              <div className="space-y-6 p-4">
                {isLoadingThreads && <p className="text-sm text-muted-foreground">Loading conversations...</p>}
                {!selectedThread && !isLoadingThreads && (
                  <div className="rounded-lg border border-dashed border-border/40 p-6 text-center text-muted-foreground">
                    <MessageSquare className="mx-auto mb-3 h-6 w-6 opacity-70" />
                    <p className="text-sm">
                      {hasAdminAccess
                        ? "Select a thread from the list to view messages."
                        : activeTab === "ai"
                          ? "Ask Kyaro anything below or open an existing assistant chat."
                          : "Describe your issue below to open a new ticket or revisit a previous one."}
                    </p>
                  </div>
                )}
                {selectedThread &&
                  orderedMessages.map((message) => (
                    <MessageBubble key={message.id} thread={selectedThread} message={message} viewer={viewerContext} />
                  ))}
                <div ref={endOfMessages} />
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle>{hasAdminAccess ? "Reply" : "Compose message"}</CardTitle>
            <CardDescription>
              {hasAdminAccess
                ? "Reply to the selected conversation and optionally adjust its status."
                : "Send a message, attach images or links, and receive real-time responses."}
            </CardDescription>
          </CardHeader>
          <CardContent>{renderComposer()}</CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Support;

