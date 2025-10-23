import { useCallback } from "react";
import {
  LayoutDashboard,
  Server,
  Users,
  Shield,
  Megaphone,
  MessageSquare,
  TrendingUp,
  Settings,
  LogOut,
  Zap,
  Package,
  Gift,
  Coins,
} from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/context/AuthContext";

const menuItems = [
  { title: 'Dashboard', url: '/dashboard', icon: LayoutDashboard },
  { title: 'VPS', url: '/vps', icon: Server },
  { title: 'Earn Coins', url: '/earn', icon: Gift },
  { title: 'Gets Coin', url: '/gets-coin', icon: Coins },
  { title: 'Support', url: '/support', icon: MessageSquare },
];

const adminItems = [
  { title: 'Announcements', url: '/admin/announcements', icon: Megaphone },
  { title: 'Users', url: '/admin/users', icon: Users },
  { title: 'Roles & Permissions', url: '/admin/roles', icon: Shield },
  { title: 'VPS Products', url: '/admin/vps-products', icon: Package },
  { title: 'Workers', url: '/admin/workers', icon: Zap },
  { title: 'Analytics', url: '/admin/analytics', icon: TrendingUp },
  { title: 'Settings', url: '/admin/settings', icon: Settings },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const { hasAdminAccess, logout } = useAuth();
  const collapsed = state === "collapsed";
  const navigate = useNavigate();

  const handleLogout = useCallback(async () => {
    await logout();
    navigate("/");
  }, [logout, navigate]);

  return (
    <Sidebar collapsible="icon" className="glass-panel border-r">
      <SidebarContent>
        <div className="px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
              <Server className="w-5 h-5 text-white" />
            </div>
            {!collapsed && (
              <div>
                <h2 className="text-sm font-bold gradient-text">LifeTech4Cloud</h2>
                <p className="text-xs text-muted-foreground">Cửa hàng Cloud Gaming</p>
              </div>
            )}
          </div>
        </div>

        <SidebarGroup>
          <SidebarGroupLabel>Menu chính</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      className={({ isActive }) =>
                        isActive
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "hover:bg-sidebar-accent/50"
                      }
                    >
                      <item.icon className="w-4 h-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {hasAdminAccess && (
          <SidebarGroup>
            <SidebarGroupLabel>Khu vực quản trị</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to={item.url}
                        className={({ isActive }) =>
                          isActive
                            ? "bg-sidebar-accent text-sidebar-accent-foreground"
                            : "hover:bg-sidebar-accent/50"
                        }
                      >
                        <item.icon className="w-4 h-4" />
                        {!collapsed && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        <div className="mt-auto p-4">
          <SidebarMenuButton
            className="w-full hover:bg-destructive/20 hover:text-destructive"
            onClick={handleLogout}
          >
            <LogOut className="w-4 h-4" />
            {!collapsed && <span>Đăng xuất</span>}
          </SidebarMenuButton>
        </div>
      </SidebarContent>
    </Sidebar>
  );
}
