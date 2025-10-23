import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fetchAnnouncements } from "@/lib/api-client";
import type { AnnouncementSummary } from "@/lib/types";

const Announcements = () => {
  const { data: announcements = [], isLoading } = useQuery<AnnouncementSummary[]>({
    queryKey: ["announcements", "list"],
    queryFn: fetchAnnouncements,
    staleTime: 60_000,
  });

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Thông báo</h1>
          <p className="text-muted-foreground">
            Nơi tổng hợp thay đổi nền tảng, lịch bảo trì và điểm nhấn phiên bản.
          </p>
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Đang tải thông báo…</p>}

      {!isLoading && announcements.length === 0 && (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle>Chưa có thông báo</CardTitle>
            <CardDescription>Các cập nhật mới từ đội ngũ sẽ xuất hiện tại đây.</CardDescription>
          </CardHeader>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {announcements.map((item) => (
          <Card key={item.id} className="glass-card flex flex-col overflow-hidden">
            {item.hero_image_url && (
              <div className="h-40 overflow-hidden bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.hero_image_url}
                  alt={item.title}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </div>
            )}
            <CardHeader className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-lg line-clamp-2">{item.title}</CardTitle>
                <Badge variant="outline">Cập nhật</Badge>
              </div>
              {item.created_at && (
                <p className="text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString()}</p>
              )}
            </CardHeader>
            <CardContent className="flex flex-1 flex-col space-y-4">
              {item.excerpt && (
                <div className="prose prose-sm dark:prose-invert line-clamp-4">
                  <ReactMarkdown>{item.excerpt}</ReactMarkdown>
                </div>
              )}
              <div className="mt-auto">
                <Button asChild variant="secondary" aria-label={`Xem chi tiết: ${item.title}`}>
                  <Link to={`/announcements/${item.slug}`}>Xem chi tiết</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default Announcements;
