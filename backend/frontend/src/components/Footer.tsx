import { Activity, Code2 } from "lucide-react";

export function Footer() {
  const version = "v1.2.4";

  return (
    <footer className="fixed bottom-0 left-0 w-full border-t glass-panel text-xs text-muted-foreground z-50">
      <div className="flex items-center justify-between px-6 py-2">
        <div className="flex items-center gap-1.5">
          <Code2 className="w-3.5 h-3.5 text-primary" />
          <span>Phiên bản: {version}</span>
        </div>

        <div className="flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5 text-primary" />
          <span>© 2025 LT4C - ZynHash Production</span>
        </div>
      </div>
    </footer>
  );
}
