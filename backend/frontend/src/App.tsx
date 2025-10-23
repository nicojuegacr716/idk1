import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Header } from "@/components/Header";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import Landing from "@/pages/Landing";
import Dashboard from "@/pages/Dashboard";
import Profile from "@/pages/Profile";
import VPS from "@/pages/VPS";
import Earn from "@/pages/Earn";
import GetsCoin from "@/pages/GetsCoin";
import Announcements from "@/pages/Announcements";
import AnnouncementDetail from "@/pages/AnnouncementDetail";
import Support from "@/pages/Support";
import Users from "@/pages/admin/Users";
import Roles from "@/pages/admin/Roles";
import Workers from "@/pages/admin/Workers";
import VpsProductsAdmin from "@/pages/admin/VpsProducts";
import AdminAnnouncements from "@/pages/admin/Announcements";
import Analytics from "@/pages/admin/Analytics";
import Settings from "@/pages/admin/Settings";
import NotFound from "@/pages/NotFound";
import { ThreeDot } from "react-loading-indicators";
import { Footer } from "@/components/Footer";

const queryClient = new QueryClient();

const DashboardLayout = ({ children }: { children: React.ReactNode }) => (
  <SidebarProvider>
    <div className="min-h-screen flex w-full">
      <AppSidebar />
      <div className="flex-1 flex flex-col">
        <Header />
        <main className="flex-1 p-6 overflow-auto">{children}</main>
        <Footer />
      </div>
    </div>
  </SidebarProvider>
);

const LoadingScreen = () => (
  <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
    <ThreeDot variant="bounce" color="#ffac00" size="large" text="Đang tải nội dung từ server" textColor="" />
  </div>
);

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) {
    return <LoadingScreen />;
  }
  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }
  return <DashboardLayout>{children}</DashboardLayout>;
};

const AdminRoute = ({ children }: { children: React.ReactNode }) => {
  const { isLoading, isAuthenticated, hasAdminAccess } = useAuth();
  if (isLoading) {
    return <LoadingScreen />;
  }
  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }
  if (!hasAdminAccess) {
    return <Navigate to="/dashboard" replace />;
  }
  return <DashboardLayout>{children}</DashboardLayout>;
};

const AppRoutes = () => (
  <Routes>
    <Route path="/" element={<Landing />} />
    <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
    <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
    <Route path="/vps" element={<ProtectedRoute><VPS /></ProtectedRoute>} />
    <Route path="/earn" element={<ProtectedRoute><Earn /></ProtectedRoute>} />
    <Route path="/gets-coin" element={<ProtectedRoute><GetsCoin /></ProtectedRoute>} />
    <Route path="/announcements" element={<ProtectedRoute><Announcements /></ProtectedRoute>} />
    <Route path="/announcements/:slug" element={<ProtectedRoute><AnnouncementDetail /></ProtectedRoute>} />
    <Route path="/support" element={<ProtectedRoute><Support /></ProtectedRoute>} />
    <Route path="/admin/users" element={<AdminRoute><Users /></AdminRoute>} />
    <Route path="/admin/roles" element={<AdminRoute><Roles /></AdminRoute>} />
    <Route path="/admin/vps-products" element={<AdminRoute><VpsProductsAdmin /></AdminRoute>} />
    <Route path="/admin/workers" element={<AdminRoute><Workers /></AdminRoute>} />
    <Route path="/admin/announcements" element={<AdminRoute><AdminAnnouncements /></AdminRoute>} />
    <Route path="/admin/analytics" element={<AdminRoute><Analytics /></AdminRoute>} />
    <Route path="/admin/settings" element={<AdminRoute><Settings /></AdminRoute>} />
    <Route path="*" element={<NotFound />} />
  </Routes>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
