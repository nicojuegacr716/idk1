import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Save, Trash2, Loader2, Eye } from "lucide-react";
import ReactMarkdown from "react-markdown";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  createAnnouncement,
  deleteAnnouncement,
  fetchAdminAnnouncement,
  fetchAdminAnnouncements,
  updateAnnouncement,
} from "@/lib/api-client";
import type { AnnouncementAttachment, AnnouncementDetail, AnnouncementSummary } from "@/lib/types";
import { toast } from "@/components/ui/sonner";

type Draft = {
  id?: string;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  hero_image_url: string;
  attachments: AnnouncementAttachment[];
};

const emptyDraft: Draft = {
  title: "",
  slug: "",
  excerpt: "",
  content: "",
  hero_image_url: "",
  attachments: [],
};

const ensureUrl = (value: string) => value.trim() || "";

const AnnouncementsAdmin = () => {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [previewMode, setPreviewMode] = useState(false);

  const summariesQuery = useQuery<AnnouncementSummary[]>({
    queryKey: ["admin-announcements"],
    queryFn: fetchAdminAnnouncements,
    staleTime: 60_000,
  });

  const detailQuery = useQuery<AnnouncementDetail>({
    queryKey: ["admin-announcement", selectedId],
    queryFn: () => fetchAdminAnnouncement(selectedId!),
    enabled: Boolean(selectedId),
  });

  useEffect(() => {
    if (detailQuery.data) {
      const detail = detailQuery.data;
      setDraft({
        id: detail.id,
        title: detail.title,
        slug: detail.slug,
        excerpt: detail.excerpt ?? "",
        content: detail.content,
        hero_image_url: detail.hero_image_url ?? "",
        attachments: detail.attachments ?? [],
      });
    } else if (!selectedId) {
      setDraft(emptyDraft);
    }
  }, [detailQuery.data, selectedId]);

  const createMutation = useMutation({
    mutationFn: createAnnouncement,
    onSuccess: (data) => {
      toast("Announcement published.");
      queryClient.invalidateQueries({ queryKey: ["admin-announcements"] });
      queryClient.invalidateQueries({ queryKey: ["announcements"] });
      setSelectedId(data.id);
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Failed to publish announcement.";
      toast(message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<Draft> }) =>
      updateAnnouncement(id, {
        title: payload.title,
        slug: payload.slug,
        excerpt: payload.excerpt,
        content: payload.content,
        hero_image_url: payload.hero_image_url,
        attachments: payload.attachments,
      }),
    onSuccess: () => {
      toast("Announcement updated.");
      queryClient.invalidateQueries({ queryKey: ["admin-announcements"] });
      if (selectedId) {
        queryClient.invalidateQueries({ queryKey: ["admin-announcement", selectedId] });
      }
      queryClient.invalidateQueries({ queryKey: ["announcements"] });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Failed to update announcement.";
      toast(message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAnnouncement,
    onSuccess: () => {
      toast("Announcement deleted.");
      queryClient.invalidateQueries({ queryKey: ["admin-announcements"] });
      queryClient.invalidateQueries({ queryKey: ["announcements"] });
      setSelectedId(null);
      setDraft(emptyDraft);
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Failed to delete announcement.";
      toast(message);
    },
  });

  const handleSave = () => {
    if (!draft.title.trim() || !draft.content.trim()) {
      toast("Title and content are required.");
      return;
    }

    const payload = {
      title: draft.title.trim(),
      slug: draft.slug.trim() || undefined,
      excerpt: draft.excerpt.trim() || undefined,
      content: draft.content,
      hero_image_url: ensureUrl(draft.hero_image_url) || undefined,
      attachments: draft.attachments
        .filter((item) => ensureUrl(item.url))
        .map((item) => ({ label: item.label?.trim() || null, url: ensureUrl(item.url) })),
    };

    if (draft.id) {
      updateMutation.mutate({ id: draft.id, payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const setAttachment = (index: number, value: AnnouncementAttachment) => {
    setDraft((prev) => {
      const next = [...prev.attachments];
      next[index] = value;
      return { ...prev, attachments: next };
    });
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[320px,1fr]">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Announcements</h1>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => {
              setSelectedId(null);
              setDraft(emptyDraft);
              setPreviewMode(false);
            }}
          >
            <Plus className="w-4 h-4" />
            New
          </Button>
        </div>

        <Card className="glass-card max-h-[70vh] overflow-auto">
          <CardContent className="p-0">
            {summariesQuery.isLoading && <p className="p-4 text-sm text-muted-foreground">Loading announcements...</p>}
            {!summariesQuery.isLoading && (summariesQuery.data ?? []).length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">No announcements created yet.</p>
            )}
            <ul className="divide-y divide-border/40">
              {(summariesQuery.data ?? []).map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(item.id);
                      setPreviewMode(false);
                    }}
                    className={`w-full px-4 py-3 text-left transition ${
                      selectedId === item.id ? "bg-primary/10" : "hover:bg-muted/60"
                    }`}
                  >
                    <p className="font-semibold text-sm">{item.title}</p>
                    {item.created_at && (
                      <p className="text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString()}</p>
                    )}
                    {item.hero_image_url && <Badge className="mt-2" variant="secondary">Hero</Badge>}
                  </button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <Card className="glass-card">
          <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>{draft.id ? "Edit announcement" : "Compose announcement"}</CardTitle>
              <CardDescription>
                Supports Markdown for rich formatting. Slug is optional; one will be generated if left blank.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              {draft.id && (
                <Button
                  variant="destructive"
                  size="icon"
                  onClick={() => deleteMutation.mutate(draft.id!)}
                  disabled={deleteMutation.isLoading}
                >
                  {deleteMutation.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </Button>
              )}
              <Button variant={previewMode ? "secondary" : "outline"} onClick={() => setPreviewMode((prev) => !prev)}>
                <Eye className="w-4 h-4 mr-2" />
                {previewMode ? "Hide preview" : "Preview"}
              </Button>
              <Button onClick={handleSave} disabled={createMutation.isLoading || updateMutation.isLoading}>
                {(createMutation.isLoading || updateMutation.isLoading) ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4 mr-2" />
                )}
                Save
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={draft.title}
                onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
                placeholder="Announcement headline"
              />
            </div>

            <div className="grid gap-2 md:grid-cols-2 md:gap-4">
              <div className="grid gap-2">
                <Label htmlFor="slug">Slug</Label>
                <Input
                  id="slug"
                  value={draft.slug}
                  onChange={(event) => setDraft((prev) => ({ ...prev, slug: event.target.value }))}
                  placeholder="optional-custom-slug"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="hero">Hero image URL</Label>
                <Input
                  id="hero"
                  value={draft.hero_image_url}
                  onChange={(event) => setDraft((prev) => ({ ...prev, hero_image_url: event.target.value }))}
                  placeholder="https://cdn.example.com/banner.png"
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="excerpt">Excerpt</Label>
              <Textarea
                id="excerpt"
                value={draft.excerpt}
                onChange={(event) => setDraft((prev) => ({ ...prev, excerpt: event.target.value }))}
                placeholder="Short summary displayed in previews."
                className="min-h-[80px]"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="content">Content (Markdown supported)</Label>
              <Textarea
                id="content"
                value={draft.content}
                onChange={(event) => setDraft((prev) => ({ ...prev, content: event.target.value }))}
                placeholder="Write the full announcement..."
                className="min-h-[260px] font-mono text-sm"
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Attachments</Label>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() =>
                    setDraft((prev) => ({
                      ...prev,
                      attachments: [...prev.attachments, { label: "", url: "" }],
                    }))
                  }
                >
                  <Plus className="w-4 h-4" />
                  Add attachment
                </Button>
              </div>
              <div className="space-y-3">
                {draft.attachments.map((item, index) => (
                  <div key={index} className="grid gap-2 md:grid-cols-[1fr,2fr,auto] md:items-center md:gap-3">
                    <Input
                      value={item.label ?? ""}
                      onChange={(event) => setAttachment(index, { ...item, label: event.target.value })}
                      placeholder="Label (optional)"
                    />
                    <Input
                      value={item.url}
                      onChange={(event) => setAttachment(index, { ...item, url: event.target.value })}
                      placeholder="https://..."
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setDraft((prev) => {
                          const next = [...prev.attachments];
                          next.splice(index, 1);
                          return { ...prev, attachments: next };
                        })
                      }
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
                {draft.attachments.length === 0 && (
                  <p className="text-xs text-muted-foreground">No attachments added.</p>
                )}
              </div>
            </div>

            {previewMode && (
              <>
                <Separator />
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Live Preview</h3>
                  {draft.hero_image_url && (
                    <div className="overflow-hidden rounded-lg border border-border/40">
                      <img src={draft.hero_image_url} alt={draft.title} className="w-full object-cover" />
                    </div>
                  )}
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown>{draft.content || "_Nothing to preview yet._"}</ReactMarkdown>
                  </div>
                  {draft.attachments.length > 0 && (
                    <div>
                      <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Attachments</h4>
                      <ul className="list-disc pl-5 space-y-1 text-sm">
                        {draft.attachments
                          .filter((item) => ensureUrl(item.url))
                          .map((item, index) => (
                            <li key={index}>
                              <a
                                href={ensureUrl(item.url)}
                                target="_blank"
                                rel="noreferrer"
                                className="text-primary hover:underline"
                              >
                                {item.label?.trim() || ensureUrl(item.url)}
                              </a>
                            </li>
                          ))}
                      </ul>
                    </div>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AnnouncementsAdmin;

