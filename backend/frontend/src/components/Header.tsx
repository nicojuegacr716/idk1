import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell, Coins, User, LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useAuth } from "@/context/AuthContext";
import { fetchAnnouncements } from "@/lib/api-client";
import type { AnnouncementSummary } from "@/lib/types";

const initials = (value: string) =>
  value
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "U";

export function Header() {
  const { profile, logout, hasAdminAccess } = useAuth();
  const navigate = useNavigate();

  const handleLogout = useCallback(async () => {
    await logout();
    navigate("/");
  }, [logout, navigate]);

  const { data: announcements = [] } = useQuery<AnnouncementSummary[]>({
    queryKey: ["announcements"],
    queryFn: fetchAnnouncements,
    staleTime: 60_000,
  });
  const displayName = profile?.display_name || profile?.username || "User";
  const email = profile?.email ?? "No email connected";
  const coins = profile?.coins ?? 0;

  return (
    <header className="sticky top-0 z-50 w-full glass-panel border-b">
      <div className="flex h-16 items-center gap-4 px-6">
        <SidebarTrigger />
        <div className="flex-1" />
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg glass-card">
            <Coins className="w-4 h-4 text-warning" />
            <span className="text-sm font-semibold">{coins}</span>
            <span className="text-xs text-muted-foreground">coins</span>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
                <Bell className="w-5 h-5" />
                {announcements.length > 0 && (<span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary"></span>)}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 glass-panel space-y-2">
              <DropdownMenuLabel className="text-xs uppercase tracking-wide text-muted-foreground">Announcements</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {announcements.length === 0 && (<p className="px-2 pb-2 text-xs text-muted-foreground">No announcements at the moment.</p>)}
              {announcements.map((item) => (
                <DropdownMenuItem
                  key={item.id}
                  className="flex flex-col items-start gap-1 whitespace-normal py-2"
                  onSelect={() => navigate(`/announcements/${item.slug}`)}
                >
                  <span className="text-sm font-semibold">{item.title}</span>
                  {item.excerpt && <span className="text-xs text-muted-foreground line-clamp-2">{item.excerpt}</span>}
                  {item.created_at && (
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(item.created_at).toLocaleString()}
                    </span>
                  )}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate("/announcements")}>View all announcements</DropdownMenuItem>
              {hasAdminAccess && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate("/admin/announcements")}>
                    Manage announcements
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="relative h-10 w-10 rounded-full">
                <Avatar>
                  {profile?.avatar_url ? (
                    <AvatarImage src={profile.avatar_url} alt={displayName} />
                  ) : (
                    <AvatarFallback>{initials(displayName)}</AvatarFallback>
                  )}
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 glass-panel">
              <DropdownMenuLabel>
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium">{displayName}</p>
                  <p className="text-xs text-muted-foreground break-all">{email}</p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate("/support")}>Support</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive" onClick={handleLogout}>
                <LogOut className="mr-2 h-4 w-4" />
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
