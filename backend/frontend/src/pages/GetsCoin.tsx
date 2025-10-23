import { useCallback, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Loader2, Link as LinkIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { fetchWalletBalance, registerWorkerTokenForCoin } from "@/lib/api-client";
import type { WalletBalance } from "@/lib/types";
import { useAuth } from "@/context/AuthContext";

type RegisterPhase = "idle" | "pending" | "done" | "error";

const REGISTRATION_LINK = "https://learn.nvidia.com/join?auth=login&redirectPath=/my-learning";

const GetsCoin = () => {
  const { refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [phase, setPhase] = useState<RegisterPhase>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const walletQuery = useQuery<WalletBalance>({
    queryKey: ["wallet-balance"],
    queryFn: fetchWalletBalance,
    staleTime: 10_000,
  });

  const registerMutation = useMutation({ mutationFn: registerWorkerTokenForCoin });

  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(REGISTRATION_LINK);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      console.error("copy-link", error);
    }
  }, []);

  const resetForm = useCallback(() => {
    setPhase("idle");
    setMessage(null);
    setEmail("");
    setPassword("");
    setConfirmed(false);
    registerMutation.reset();
  }, [registerMutation]);

  const handleSubmit = useCallback(async () => {
    const trimmedEmail = email.trim();
    const trimmedPassword = password.trim();

    if (!trimmedEmail || !trimmedPassword) {
      setMessage("Vui lòng nhập đầy đủ email và mật khẩu.");
      return;
    }
    if (!confirmed) {
      setMessage("Bạn cần xác nhận đây không phải tài khoản chính của mình.");
      return;
    }

    setPhase("pending");
    setMessage("Chúng tôi đang xác minh tài khoản, vui lòng đợi và kiểm tra email." );

    try {
      const response = await registerMutation.mutateAsync({
        email: trimmedEmail,
        password: trimmedPassword,
        confirm: true,
      });

      if (response?.ok) {
        setPhase("done");
        setMessage("Hoàn tất! +15 xu đã được cộng vào ví của bạn.");
        refresh();
        await walletQuery.refetch();
      } else {
        setPhase("error");
        setMessage("Worker không phản hồi. Vui lòng thử lại sau.");
      }
    } catch (error: unknown) {
      setPhase("error");
      if (error instanceof Error) {
        setMessage(error.message);
        return;
      }
      if (typeof error === "object" && error !== null && "data" in error) {
        const detail = (error as { data?: { detail?: string } }).data?.detail;
        if (detail === "duplicate_mail") {
          setMessage("Email này đã được đăng ký trước đó.");
        } else if (detail === "no_worker_available" || detail === "no_tokens_available") {
          setMessage("Tạm thời hết worker khả dụng. Vui lòng thử lại sau.");
        } else if (detail) {
          setMessage(detail);
        } else {
          setMessage("Không thể xử lý yêu cầu. Vui lòng thử lại.");
        }
      } else {
        setMessage("Không thể xử lý yêu cầu. Vui lòng thử lại.");
      }
    }
  }, [email, password, confirmed, registerMutation, refresh, walletQuery]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 text-center">
        <h1 className="text-3xl font-bold">Gets Coin</h1>
        <p className="text-muted-foreground">
          Tạo một tài khoản NVIDIA phụ để nhận nhanh +15 xu vào ví LifeTech4Cloud.
        </p>
        {walletQuery.data && (
          <p className="text-sm text-muted-foreground">
            Số dư hiện tại: {" "}
            <Badge variant="secondary" className="font-semibold text-primary">
              {walletQuery.data.balance} xu
            </Badge>
          </p>
        )}
      </div>

      <Card className="glass-card max-w-3xl w-full mx-auto">
        <CardHeader className="pb-4">
          <CardTitle className="text-xl">Hướng dẫn</CardTitle>
          <CardDescription>
            Làm theo các bước bên dưới rồi gửi thông tin tài khoản phụ bạn vừa tạo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {phase === "idle" && (
            <>
              <ol className="list-decimal pl-6 space-y-2 text-left text-sm md:text-base">
                <li>
                  Bước 1: Nhấp vào
                  <Button variant="link" className="px-1" onClick={handleCopyLink}>
                    <LinkIcon className="mr-1 h-4 w-4" /> {REGISTRATION_LINK}
                  </Button>
                  {copied && (
                    <span className="ml-2 text-xs text-emerald-500">Đã sao chép</span>
                  )}
                </li>
                <li>
                  Bước 2: Tạo mới một tài khoản mà bạn không dùng cho mục đích khác (gmail/hotmail...).
                </li>
                <li>
                  Bước 3: Điền thông tin tài khoản phụ vào form dưới đây và gửi cho hệ thống.
                </li>
              </ol>

              <div className="grid gap-4 text-left">
                <div className="space-y-1">
                  <label className="text-sm font-medium" htmlFor="gets-email">
                    Email đăng ký
                  </label>
                  <Input
                    id="gets-email"
                    placeholder="ví dụ: yourname+coin@gmail.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium" htmlFor="gets-pass">
                    Mật khẩu
                  </label>
                  <Input
                    id="gets-pass"
                    type="password"
                    placeholder="Nhập mật khẩu tài khoản phụ"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </div>
                <label className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Checkbox checked={confirmed} onCheckedChange={(value) => setConfirmed(Boolean(value))} />
                  Tôi xác nhận đây không phải tài khoản chính và đồng ý chia sẻ với hệ thống.
                </label>
              </div>

              {message && (
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  <span>{message}</span>
                </div>
              )}

              <Button className="w-full h-11 text-base" onClick={handleSubmit}>
                Gửi thông tin
              </Button>
            </>
          )}

          {phase === "pending" && (
            <div className="space-y-4 text-center text-sm text-muted-foreground">
              <div className="flex items-center justify-center gap-2 text-primary">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Đang xác thực tài khoản...</span>
              </div>
              <p>
                Nếu bạn nhận được email xác nhận từ NVIDIA, hãy hoàn tất bước xác nhận để hệ thống xử lý nhanh hơn.
              </p>
              <Button variant="secondary" onClick={resetForm}>
                Nhập lại
              </Button>
            </div>
          )}

          {phase === "done" && (
            <div className="space-y-4 text-center">
              <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto" />
              <p className="text-base font-semibold">Hoàn tất!</p>
              <p className="text-sm text-muted-foreground">
                Cảm ơn bạn đã hỗ trợ. Bạn có thể gửi thêm tài khoản khác nếu muốn.
              </p>
              <Button onClick={resetForm}>Gửi thêm tài khoản khác</Button>
            </div>
          )}

          {phase === "error" && (
            <div className="space-y-4 text-center text-sm text-muted-foreground">
              <AlertCircle className="h-10 w-10 text-destructive mx-auto" />
              <p className="text-base font-semibold text-destructive">Gửi thất bại</p>
              <p>{message}</p>
              <Button variant="secondary" onClick={resetForm}>
                Thử lại
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default GetsCoin;
