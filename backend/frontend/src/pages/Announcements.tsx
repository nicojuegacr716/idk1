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
          <h1 className="text-3xl font-bold mb-2">Announcements</h1>
          <p className="text-muted-foreground">
            Stay up to date with platform changes, scheduled maintenance, and release highlights.
          </p>
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading announcements...</p>}

      {!isLoading && announcements.length === 0 && (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle>No announcements yet</CardTitle>
            <CardDescription>New messages from the team will appear here.</CardDescription>
          </CardHeader>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {announcements.map((item) => (
          <Card key={item.id} className="glass-card flex flex-col overflow-hidden">
            {item.hero_image_url && (
              <div className="h-40 overflow-hidden bg-muted">
                <img src={item.hero_image_url} alt={item.title} className="h-full w-full object-cover" />
              </div>
            )}
            <CardHeader className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-lg">{item.title}</CardTitle>
                <Badge variant="outline">Update</Badge>
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
                <Button asChild variant="secondary">
                  <Link to={`/announcements/${item.slug}`}>Read full update</Link>
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

