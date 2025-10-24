import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, Code2 } from "lucide-react";

import { fetchPlatformVersion } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export function Footer() {
  const { data } = useQuery({
    queryKey: ["platform-version"],
    queryFn: fetchPlatformVersion,
    staleTime: 300_000,
  });

  const versionLabel = useMemo(() => {
    if (!data) {
      return "dev v0.0.0";
    }
    return `${data.channel} ${data.version}`;
  }, [data]);

  return (
    <footer
      className={cn(
        "sticky bottom-0 border-t glass-panel text-xs text-muted-foreground",
        "w-full px-4 sm:px-6 py-2 z-30 flex-shrink-0 backdrop-blur supports-[backdrop-filter]:bg-background/80",
      )}
    >
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Code2 className="h-3.5 w-3.5 text-primary" />
          <span>Phiên bản: {versionLabel}</span>
        </div>

        <div className="flex w-full items-center justify-end gap-1.5 text-muted-foreground sm:w-auto">
          <Activity className="h-3.5 w-3.5 text-primary" />
          <span>Bản quyền thuộc về LT4C - ZynHash Production © 2025</span>
        </div>
      </div>
    </footer>
  );
}
