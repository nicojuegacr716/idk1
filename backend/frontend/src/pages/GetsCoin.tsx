import { useState, useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertCircle, Loader2, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { registerWorkerTokenForCoin, fetchWalletBalance } from "@/lib/api-client";
import type { WalletBalance } from "@/lib/types";

type RegStatus = "idle" | "pending" | "done" | "error";

const REG_LINK = "https://learn.nvidia.com/join?auth=login&redirectPath=/my-learning";

const GetsCoin = () => {
  const { refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<RegStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const walletQuery = useQuery<WalletBalance>({
    queryKey: ["wallet-balance"],
    queryFn: fetchWalletBalance,
    staleTime: 10_000,
  });

  const registerMutation = useMutation({ mutationFn: registerWorkerTokenForCoin });

  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(REG_LINK);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      console.error("copy link error", error);
    }
  }, []);

  const resetForm = () => {
    setStatus("idle");
    setMessage(null);
    setEmail("");
    setPassword("");
    setConfirm(false);
    registerMutation.reset();
  };

  const handleSubmit = async () => {
    const trimmedEmail = email.trim();
    const trimmedPassword = password.trim();

    if (!trimmedEmail || !trimmedPassword) {
      setMessage("Vui lòng nhập đầy đủ email và mật khẩu.");
      return;
    }
    if (!confirm) {
      setMessage("Vui lòng xác nhận đây không phải tài khoản chính của bạn.");
      return;
    }

    setStatus("pending");
    setMessage(
      "Chúng tôi đang xác thực tài khoản của bạn, vui lòng đợi...\nHãy kiểm tra hộp thư để xác nhận nếu có email từ NVIDIA.",
    );

    try {
      const response = await registerMutation.mutateAsync({
        email: trimmedEmail,
        password: trimmedPassword,
        confirm: true,
      });

      if (response?.ok) {
        setStatus("done");
        setMessage("Hoàn tất! Cảm ơn bạn, +15 xu đã được cộng vào ví của bạn.");
        refresh();
        await walletQuery.refetch();
      } else {
        setStatus("error");
        setMessage("Worker không phản hồi thành công. Vui lòng thử lại sau.");
      }
    } catch (error: unknown) {
      setStatus("error");
      if (error instanceof Error) {
        setMessage(error.message);
      } else if (typeof error === "object" && error !== null && "data" in error) {
        const detail = (error as { data?: { detail?: string } }).data?.detail;
        if (detail === "duplicate_mail") {
          setMessage("Email này đã được đăng ký trước đó.");
        } else if (detail === "no_worker_available" || detail === "no_tokens_available") {
          setMessage("Hiện chưa có worker khả dụng. Vui lòng thử lại sau.");
        } else {
          setMessage(detail ?? "Không thể xử lý yêu cầu. Vui lòng thử lại.");
        }
      } else {
        setMessage("Không thể xử lý yêu cầu. Vui lòng thử lại.");
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 text-center">
        <h1 className="text-3xl font-bold">Gets Coin</h1>
        <p className="text-muted-foreground">
          Tạo một tài khoản NVIDIA phụ để nhận nhanh +15 xu vào ví LifeTech4Cloud.
        </p>
        {walletQuery.data && (
          <p className="text-sm text-muted-foreground">
            Số dư hiện tại: <span className="font-semibold text-primary">{walletQuery.data.balance} xu</span>
          </p>
        )}
      </div>

      <Card className="glass-card max-w-3xl w-full mx-auto">
        <CardHeader className="pb-4">
          <CardTitle className="text-xl">Các bước thực hiện</CardTitle>
          <CardDescription>
            Làm theo hướng dẫn dưới đây và gửi thông tin tài khoản phụ mà bạn vừa tạo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {status === "idle" && (
            <>
              <ol className="list-decimal pl-6 space-y-2 text-sm md:text-base text-left">
                <li>
                  Bước 1: Truy cập đường dẫn
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="ml-2 underline text-primary"
                  >
                    learn.nvidia.com/join?auth=login&redirectPath=/my-learning
                  </button>
                  {copied && <span className="ml-2 text-xs text-emerald-500">Đã sao chép</span>}
                </li>
                <li>
                  Bước 2: Tạo một tài khoản mới (gmail/hotmail hoặc email phụ không dùng cho tài khoản chính).
                </li>
                <li>
                  Bước 3: Điền thông tin tài khoản mới vào form bên dưới và gửi cho chúng tôi.
                </li>
              </ol>

              <div className="grid gap-4 text-left">
                <div className="space-y-1">
                  <label className="text-sm font-medium" htmlFor="reg-email">
                    Email đăng ký
                  </label>
                  <Input
                    id="reg-email"
                    placeholder="ví dụ: yourname+coin@gmail.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium" htmlFor="reg-pass">
                    Mật khẩu
                  </label>
                  <Input
                    id="reg-pass"
                    type="password"
                    placeholder="Nhập mật khẩu tài khoản phụ"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </div>
                <label className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Checkbox checked={confirm} onCheckedChange={(checked) => setConfirm(Boolean(checked))} />
                  Tôi xác nhận đây không phải tài khoản chính của tôi và chấp nhận chia sẻ với hệ thống.
                </label>
              </div>

              {message && (
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  <span>{message}</span>
                </div>
              )}

              <Button
                onClick={handleSubmit}
                disabled={registerMutation.isLoading}
                className="w-full h-11 text-base"
              >
                {registerMutation.isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Đang gửi thông tin…
                  </>
                ) : (
                  "Gửi thông tin"
                )}
              </Button>
            </>
          )}

          {status === "pending" && (
            <div className="space-y-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-2 text-primary">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Chúng tôi đang xác thực tài khoản. Vui lòng đợi...</span>
              </div>
              <p>
                Nếu bạn nhận được email xác nhận từ NVIDIA, hãy hoàn tất bước xác nhận để việc kiểm tra diễn ra nhanh hơn.
              </p>
              <Button variant="secondary" onClick={resetForm}>
                Hủy và nhập lại
              </Button>
            </div>
          )}

          {status === "done" && (
            <div className="space-y-4 text-center">
              <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto" />
              <p className="text-base font-semibold">Hoàn tất!</p>
              <p className="text-sm text-muted-foreground">
                Cảm ơn bạn đã hỗ trợ. Hệ thống đã cộng xu vào ví của bạn sau khi xác thực.
              </p>
              <Button onClick={resetForm}>Gửi thêm tài khoản khác</Button>
            </div>
          )}

          {status === "error" && (
            <div className="space-y-4 text-center">
              <AlertCircle className="h-10 w-10 text-destructive mx-auto" />
              <p className="text-base font-semibold text-destructive">Gửi thất bại</p>
              <p className="text-sm text-muted-foreground">{message}</p>
              <div className="flex justify-center gap-2">
                <Button variant="secondary" onClick={resetForm}>
                  Nhập lại
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default GetsCoin;
