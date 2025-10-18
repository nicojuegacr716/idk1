import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Server, Zap, Shield, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/context/AuthContext";
import { fetchVpsProducts } from "@/lib/api-client";
import type { VpsProduct } from "@/lib/types";

const marketingFeatures = [
  {
    icon: Server,
    title: "Tạo VPS trong vài giây",
    description: "Khởi tạo phiên Windows hoặc Linux thật, sẵn sàng dùng ngay.",
  },
  {
    icon: Zap,
    title: "Tự động hóa mọi thao tác",
    description: "Hệ thống tự cấp phát và kích hoạt máy, bạn chỉ việc bấm chọn.",
  },
  {
    icon: Shield,
    title: "Bảo mật tin cậy",
    description: "Quy trình đăng nhập và khởi chạy được bảo vệ nhiều lớp.",
  },
];

const formatCoins = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 0 });

const getProductTagline = (product: VpsProduct): string => {
  if (product.description) {
    return product.description;
  }
  return "Tài nguyên VPS được quản lý bởi LT4C.";
};

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");

const buildDiscordLoginUrl = (): string => {
  if (!API_BASE_URL) {
    return "/auth/discord/login";
  }
  return `${API_BASE_URL}/auth/discord/login`;
};

export default function Landing() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();

  const { data: products = [], isLoading: loadingProducts } = useQuery({
    queryKey: ["vps-products"],
    queryFn: fetchVpsProducts,
    staleTime: 60_000,
  });

  const [primaryProduct] = products;
  const additionalProducts = useMemo(() => (primaryProduct ? products.slice(1) : products), [primaryProduct, products]);

  const goToDashboard = () => navigate("/dashboard");

  const handlePrimaryAction = () => {
    if (isAuthenticated) {
      goToDashboard();
    } else {
      window.location.href = buildDiscordLoginUrl();
    }
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 glass-panel border-b">
        <div className="container mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
              <Server className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold gradient-text">LifeTech4Code</span>
          </div>
          <nav className="hidden md:flex items-center gap-6">
            <a href="#features" className="text-sm hover:text-primary transition-colors">
              Tính năng
            </a>
            <a href="#pricing" className="text-sm hover:text-primary transition-colors">
              Bảng giá
            </a>
            <a href="#about" className="text-sm hover:text-primary transition-colors">
              Giới thiệu
            </a>
          </nav>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={handlePrimaryAction}>
              {isAuthenticated ? "Bảng điều khiển" : "Đăng nhập"}
            </Button>
            <Button size="sm" className="gap-2" onClick={handlePrimaryAction}>
              {isAuthenticated ? "Mở Console" : "Bắt đầu"}
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <section className="container mx-auto px-6 py-24 text-center">
        <div className="max-w-4xl mx-auto space-y-8 animate-fade-in">
          <h1 className="text-5xl md:text-7xl font-bold leading-tight">
            Cloud VPS
            <span className="gradient-text"> cực đơn giản</span>
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Khởi tạo VPS Windows thực, theo dõi tiến trình khởi chạy ngay trên bảng điều khiển. Trải nghiệm mượt, thao tác nhanh.
          </p>
          <div className="flex gap-4 justify-center">
            <Button size="lg" className="gap-2" onClick={handlePrimaryAction}>
              {isAuthenticated ? "Vào bảng điều khiển" : "Đăng nhập bằng Discord"}
              <ArrowRight className="w-5 h-5" />
            </Button>
            <Button size="lg" variant="outline" onClick={() => window.scrollTo({ top: window.innerHeight, behavior: "smooth" })}>
              Xem tính năng
            </Button>
          </div>
          <div className="flex items-center justify-center gap-8 text-sm text-muted-foreground pt-8">
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4 text-success" />
              <span>Đăng nhập Discord an toàn</span>
            </div>
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4 text-success" />
              <span>Hạ tầng ổn định, tốc độ cao</span>
            </div>
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4 text-success" />
              <span>Theo dõi trạng thái thời gian thực</span>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="container mx-auto px-6 py-24">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold mb-4">Vì sao chọn LT4C</h2>
          <p className="text-muted-foreground text-lg">
            Tất cả tính năng trên giao diện đều hoạt động thật, không phải demo.
          </p>
        </div>
        <div className="grid md:grid-cols-3 gap-8">
          {marketingFeatures.map((feature) => (
            <Card key={feature.title} className="glass-card hover-lift">
              <CardHeader>
                <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-primary to-secondary flex items-center justify-center mb-4">
                  <feature.icon className="w-6 h-6 text-white" />
                </div>
                <CardTitle>{feature.title}</CardTitle>
                <CardDescription>{feature.description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      <section id="pricing" className="container mx-auto px-6 py-24">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold mb-4">Danh mục gói VPS</h2>
          <p className="text-muted-foreground text-lg">
            Danh sách gói được cập nhật theo thời gian thực.
          </p>
        </div>
        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {loadingProducts && (
            <Card className="glass-card md:col-span-3">
              <CardHeader>
                <CardTitle>Đang tải gói VPS...</CardTitle>
                <CardDescription>Đang lấy dữ liệu mới nhất.</CardDescription>
              </CardHeader>
            </Card>
          )}

          {!loadingProducts && products.length === 0 && (
            <Card className="glass-card md:col-span-3">
              <CardHeader>
                <CardTitle>Chưa có gói khả dụng</CardTitle>
                <CardDescription>
                  Vui lòng quay lại sau hoặc liên hệ hỗ trợ để biết thêm thông tin.
                </CardDescription>
              </CardHeader>
            </Card>
          )}

          {!loadingProducts && primaryProduct && (
            <PricingCard product={primaryProduct} highlight onAction={handlePrimaryAction} />
          )}

          {additionalProducts.map((product) => (
            <PricingCard key={product.id} product={product} onAction={handlePrimaryAction} />
          ))}
        </div>
      </section>

      <section id="about" className="container mx-auto px-6 py-24">
        <div className="max-w-4xl mx-auto text-center space-y-6">
          <h2 className="text-3xl font-bold">Thiết kế để vận hành thực tế</h2>
          <p className="text-muted-foreground text-lg">
            Giao diện hiện đại kết nối trực tiếp với hệ thống LT4C. Phiên làm việc, hỗ trợ, vai trò quản trị
            đều được lưu trữ an toàn và quản lý tập trung.
          </p>
        </div>
      </section>

      <footer className="border-t border-border/50 mt-24">
        <div className="container mx-auto px-6 py-12">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
                <Server className="w-5 h-5 text-white" />
              </div>
              <span className="font-bold gradient-text">LifeTech4Code</span>
            </div>
            <p className="text-sm text-muted-foreground">(c) {new Date().getFullYear()} LifeTech4Code. Mọi quyền được bảo lưu.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

const PricingCard = ({
  product,
  highlight = false,
  onAction,
}: {
  product: VpsProduct;
  highlight?: boolean;
  onAction: () => void;
}) => (
  <Card
    className={`glass-card hover-lift ${highlight ? "ring-2 ring-primary scale-105 md:col-span-2 lg:col-span-1" : ""}`}
  >
    {highlight && (
      <div className="absolute -top-4 left-1/2 -translate-x-1/2">
        <span className="bg-gradient-to-r from-primary to-secondary text-white px-4 py-1 rounded-full text-sm font-medium">
          Nổi bật
        </span>
      </div>
    )}
    <CardHeader>
      <CardTitle className="text-2xl capitalize">{product.name}</CardTitle>
      <div className="mt-4">
        <span className="text-4xl font-bold text-warning">{formatCoins(product.price_coins)}</span>
        <span className="text-muted-foreground ml-2">coin</span>
      </div>
      <CardDescription>{getProductTagline(product)}</CardDescription>
    </CardHeader>
    <CardContent>
      <Button className="w-full" variant={highlight ? "default" : "outline"} onClick={onAction}>
        {highlight ? "Khởi chạy trong bảng điều khiển" : "Đăng nhập để khởi chạy"}
      </Button>
    </CardContent>
  </Card>
);
