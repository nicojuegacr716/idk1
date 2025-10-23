import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import { ArrowLeft, Link as LinkIcon, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { fetchAnnouncementBySlug } from "@/lib/api-client";
import type { AnnouncementDetail as AnnouncementDetailType } from "@/lib/types";

const AnnouncementDetail = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();

  const query = useQuery<AnnouncementDetailType>({
    queryKey: ["announcement", "slug", slug],
    queryFn: () => fetchAnnouncementBySlug(slug!),
    enabled: Boolean(slug),
  });

  const attachments = useMemo(() => query.data?.attachments ?? [], [query.data?.attachments]);

  if (query.isLoading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        <p className="mt-2 text-sm text-muted-foreground">Đang tải thông báo…</p>
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Không tìm thấy thông báo</CardTitle>
          <CardDescription>Bài thông báo này hiện không khả dụng hoặc đã bị xoá.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="secondary" onClick={() => navigate("/announcements")}>
            Quay lại danh sách
          </Button>
        </CardContent>
      </Card>
    );
  }

  const announcement = query.data;

  return (
    <div className="max-w-4xl space-y-6">
      <Button variant="ghost" className="gap-2" onClick={() => navigate(-1)}>
        <ArrowLeft className="w-4 h-4" />
        Quay lại
      </Button>

      <Card className="glass-card overflow-hidden">
        {announcement.hero_image_url && (
          <div className="h-64 overflow-hidden bg-muted">
            <img src={announcement.hero_image_url} alt={announcement.title} className="h-full w-full object-cover" />
          </div>
        )}
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">Thông báo</Badge>
            {announcement.created_at && (
              <span className="text-xs text-muted-foreground">
                Đăng lúc {new Date(announcement.created_at).toLocaleString()}
              </span>
            )}
          </div>
          <CardTitle className="text-3xl">{announcement.title}</CardTitle>
          {announcement.excerpt && <CardDescription className="text-base">{announcement.excerpt}</CardDescription>}
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="prose dark:prose-invert max-w-none">
            <ReactMarkdown>{announcement.content}</ReactMarkdown>
          </div>

          {attachments.length > 0 && (
            <div>
              <Separator className="my-4" />
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Tệp đính kèm</h3>
              <ul className="mt-3 space-y-2 text-sm">
                {attachments.map((item, index) => (
                  <li key={index}>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 text-primary hover:underline"
                    >
                      <LinkIcon className="w-4 h-4" />
                      {item.label?.trim() || item.url}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AnnouncementDetail;
