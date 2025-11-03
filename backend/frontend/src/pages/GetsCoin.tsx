import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Loader2, Link as LinkIcon, RefreshCw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { fetchWalletBalance, registerWorkerTokenForCoin, fetchAdsAvailableWorkers, ApiError } from "@/lib/api-client";
import type { WalletBalance } from "@/lib/types";
import { useAuth } from "@/context/AuthContext";
import { useTurnstile } from "@/hooks/useTurnstile";

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
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
  const {
    containerRef: captchaContainerRef,
    token: turnstileToken,
    error: captchaError,
    ready: captchaReady,
    reset: resetTurnstile,
    configured: captchaConfigured,
  } = useTurnstile("register_worker");

  const walletQuery = useQuery<WalletBalance>({
    queryKey: ["wallet-balance"],
    queryFn: fetchWalletBalance,
    staleTime: 10_000,
  });

  const registerMutation = useMutation({ mutationFn: registerWorkerTokenForCoin });

  const {
    data: availableWorkersResponse,
    isLoading: workersLoading,
    isFetching: workersFetching,
    refetch: refetchWorkers,
  } = useQuery({
    queryKey: ["ads-available-workers"],
    queryFn: fetchAdsAvailableWorkers,
    staleTime: 20_000,
    refetchInterval: 45_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const workers = useMemo(
    () => (Array.isArray(availableWorkersResponse?.workers) ? availableWorkersResponse?.workers ?? [] : []),
    [availableWorkersResponse?.workers],
  );

  useEffect(() => {
    if (!workers.length) {
      setSelectedWorkerId(null);
      return;
    }
    const alreadySelected = workers.some((worker) => worker.id === selectedWorkerId);
    if (!alreadySelected) {
      const firstAvailable = workers.find((worker) => worker.tokens_left > 0) ?? workers[0];
      setSelectedWorkerId(firstAvailable.id);
    }
  }, [workers, selectedWorkerId]);

  useEffect(() => {
    if (!workers.length) return;
    if (!workers.some((worker) => worker.tokens_left < 0)) return;
    const timer = window.setTimeout(() => {
      refetchWorkers();
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [workers, refetchWorkers]);

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
    resetTurnstile();
  }, [registerMutation, resetTurnstile]);

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
    if (workers.length > 0 && !selectedWorkerId) {
      setMessage("Vui lòng chọn worker để gửi token.");
      return;
    }
    if (captchaConfigured && !turnstileToken) {
      setMessage("Vui lòng hoàn thành Cloudflare Turnstile trước khi gửi.");
      return;
    }

    setPhase("pending");
    setMessage("Chúng tôi đang xác minh tài khoản, vui lòng đợi và kiểm tra email.");

    try {
      const response = await registerMutation.mutateAsync({
        email: trimmedEmail,
        password: trimmedPassword,
        confirm: true,
        turnstileToken,
        workerId: selectedWorkerId
      });
      resetTurnstile();

      if (response?.ok) {
        setPhase("done");
        setMessage("Hoàn tất! +20 xu đã được cộng vào ví của bạn.");
        refresh();
        await walletQuery.refetch();
      } else {
        setPhase("error");
        setMessage("Worker không phản hồi. Vui lòng thử lại sau.");
      }
    } catch (error: unknown) {
      setPhase("error");
      resetTurnstile();
      if (error instanceof ApiError) {
        const status = error.status;
        const detail = (error.data as { detail?: string } | undefined)?.detail;
        if (status === 401) {
          setMessage("Vui lòng đăng nhập lại để tiếp tục.");
          return;
        }
        if (status === 403 && detail === "turnstile_failed") {
          setMessage("Xác thực Cloudflare Turnstile thất bại. Vui lòng thử lại.");
          return;
        }
        if (status === 503 && detail === "turnstile_not_configured") {
          setMessage("Captcha chưa được cấu hình trên máy chủ. Vui lòng báo quản trị viên.");
          return;
        }
        if (status === 503 && detail === "turnstile_unreachable") {
          setMessage("Không thể kết nối dịch vụ xác thực captcha. Vui lòng thử lại.");
          return;
        }
        if (status === 400 && detail === "confirmation_required") {
          setMessage("Bạn cần xác nhận đây không phải tài khoản chính của mình.");
          return;
        }
        if (status === 400 && detail === "password_requirements") {
          setMessage("Mật khẩu phải có chữ hoa, chữ thường, số và ký tự đặc biệt.");
          return;
        }
        if (status === 409 && detail === "duplicate_mail") {
          setMessage("Email này đã được đăng ký trước đó.");
          return;
        }
        if (status === 503 && detail === "no_worker_available") {
          setMessage("Tạm thời hết worker khả dụng. Vui lòng thử lại sau.");
          return;
        }
        if (status === 400 && detail === "need_email_verify") {
          setMessage("Tài khoản NVIDIA yêu cầu xác minh email trước khi có thể sử dụng.");
          return;
        }
        if (status === 400 && detail === "domain_not_supported") {
          setMessage("Chỉ hỗ trợ email @gmail.com, @hotmail.com hoặc @outlook.com.");
          return;
        }
        if (status === 400 && detail === "dottrick_not_allowed") {
          setMessage("Email không được phép sử dụng dấu chấm hoặc dấu cộng cho domain này.");
          return;
        }
        if (status === 400 && detail === "invalid_email") {
          setMessage("Định dạng email không hợp lệ. Vui lòng kiểm tra lại.");
          return;
        }
        if (status === 400 && detail === "worker_auth_required") {
          setMessage("Worker từ chối đăng nhập. Vui lòng kiểm tra lại email/mật khẩu.");
          return;
        }
        if (status === 400 && detail === "invalid_worker_request") {
          setMessage("Worker không thể xử lý yêu cầu. Vui lòng kiểm tra thông tin và thử lại.");
          return;
        }
        if (status === 503 && detail === "worker_rate_limited") {
          setMessage("Worker đang bận xử lý quá nhiều yêu cầu. Vui lòng thử lại sau ít phút.");
          return;
        }
        if (status === 502 && (detail === "worker_error" || detail === "worker_rejected")) {
          setMessage("Worker gặp lỗi hoặc từ chối yêu cầu. Vui lòng thử lại.");
          return;
        }
        setMessage(error.message || "Không thể xử lý yêu cầu. Vui lòng thử lại.");
        return;
      }
      if (error instanceof Error) {
        setMessage(error.message);
        return;
      }
      setMessage("Không thể xử lý yêu cầu. Vui lòng thử lại.");
    }
  }, [email, password, confirmed, selectedWorkerId, workers, registerMutation, refresh, walletQuery, turnstileToken, resetTurnstile]);

  return (
    <div className="space-y-6 sm:space-y-8 overflow-x-hidden">
      <div className="mx-auto w-full max-w-screen-sm sm:max-w-3xl px-3 sm:px-4">
        <div className="flex flex-col gap-2 text-center">
          <h1 className="text-2xl sm:text-3xl font-bold">Gets Coin</h1>
          <p className="text-sm sm:text-base text-muted-foreground">
            Tạo một tài khoản NVIDIA phụ để nhận nhanh +20 xu vào ví LifeTech4Cloud.
          </p>
          {walletQuery.data && (
            <p className="text-xs sm:text-sm text-muted-foreground">
              Số dư hiện tại:{" "}
              <Badge variant="secondary" className="font-semibold text-primary">
                {walletQuery.data.balance} xu
              </Badge>
            </p>
          )}
        </div>

        <Card className="glass-card mt-4 sm:mt-6 w-full">
          <CardHeader className="pb-3 sm:pb-4">
            <CardTitle className="text-lg sm:text-xl">Hướng dẫn</CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              Làm theo các bước bên dưới rồi gửi thông tin tài khoản phụ bạn vừa tạo.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-5 sm:space-y-6">
            {phase === "idle" && (
              <>
                <ol className="list-decimal pl-5 sm:pl-6 space-y-2 sm:space-y-2.5 text-left text-sm">
                  <li className="leading-relaxed">
                    Bước 1: Nhấp vào{" "}
                    <Button
                      variant="link"
                      className="px-1 align-baseline"
                      onClick={handleCopyLink}
                    >
                      <LinkIcon className="mr-1 h-4 w-4" /> {REGISTRATION_LINK}
                    </Button>
                    {copied && (
                      <span className="ml-1.5 text-[11px] sm:text-xs text-emerald-500">Đã sao chép</span>
                    )}
                  </li>
                  <li className="leading-relaxed">
                    Bước 2: Tạo mới một tài khoản mà bạn không dùng cho mục đích khác (gmail/hotmail...), với username và mật khẩu phải gồm chữ hoa, chữ thường, số và ký tự đặc biệt.
                  </li>
                  <li className="leading-relaxed">
                    Bước 3: Điền thông tin tài khoản phụ vào form dưới đây và gửi cho hệ thống.
                  </li>
                </ol>

                <div className="grid gap-4 text-left sm:grid-cols-1">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium" htmlFor="gets-email">
                      Email đăng ký
                    </label>
                    <Input
                      id="gets-email"
                      inputMode="email"
                      className="text-base" /* tránh iOS auto-zoom */
                      placeholder="ví dụ: yourname@hotmail.com"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium" htmlFor="gets-pass">
                      Mật khẩu
                    </label>
                    <Input
                      id="gets-pass"
                      type="password"
                      className="text-base" /* tránh iOS auto-zoom */
                      placeholder="Nhập mật khẩu tài khoản phụ"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                  </div>
                  <div className="space-y-4">
                    {/* Worker selection */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium leading-none">
                        Chọn worker để gửi token:
                      </label>
                      {workers.length > 0 && (
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>{workers.length} worker khả dụng</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 gap-1 text-xs"
                            onClick={() => refetchWorkers()}
                            disabled={workersFetching}
                          >
                            {workersFetching ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3.5 w-3.5" />
                            )}
                            <span className="hidden sm:inline">Kiểm tra lại</span>
                            <span className="sm:hidden">Làm mới</span>
                          </Button>
                        </div>
                      )}
                      {workersLoading ? (
                        <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span>Đang tải danh sách worker...</span>
                        </div>
                      ) : workers.length > 0 ? (
                        <div className="space-y-1.5 max-h-[60svh] sm:max-h-40 overflow-y-auto rounded-md border border-border/40 p-1 lt4c-scrollbar">
                          {workers.map((worker) => (
                            <div
                              key={worker.id}
                              className={`flex items-center justify-between p-1.5 rounded-md border ${
                                selectedWorkerId === worker.id
                                  ? 'border-primary bg-primary/5'
                                  : 'border-border/40 hover:border-primary/40 hover:bg-primary/5'
                              } cursor-pointer transition-colors`}
                              onClick={() => setSelectedWorkerId(worker.id)}
                            >
                              <div className="flex items-center gap-2">
                                <div className={`w-2 h-2 rounded-full ${worker.tokens_left > 0 ? 'bg-green-500' : 'bg-red-500'}`}></div>
                                <span className="text-xs font-medium">{worker.name}</span>
                              </div>
                              <span className="text-xs flex items-center gap-1">
                                {worker.tokens_left > 0
                                  ? `${worker.tokens_left} token khả dụng`
                                  : worker.tokens_left === -1
                                    ? (
                                      <>
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                        Đang kiểm tra...
                                      </>
                                    )
                                    : "Hết token"}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2 text-sm text-muted-foreground">
                          <span>Không có worker nào khả dụng</span>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="w-fit gap-2"
                            onClick={() => refetchWorkers()}
                            disabled={workersFetching}
                          >
                            {workersFetching ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3.5 w-3.5" />
                            )}
                            Thử lại
                          </Button>
                        </div>
                      )}
                    </div>

                    {/* Confirmation checkbox */}
                    <label className="flex items-start gap-2 text-[13px] sm:text-sm text-muted-foreground">
                      <Checkbox checked={confirmed} onCheckedChange={(value) => setConfirmed(Boolean(value))} />
                      <span>Tôi xác nhận đây không phải tài khoản chính và đồng ý chia sẻ với hệ thống.</span>
                    </label>
                  </div>
                </div>

                <div className="space-y-2">
                  <div
                    ref={captchaContainerRef}
                    className="flex items-center justify-center min-h-[48px]"
                  />
                  {captchaError && (
                    <p className="text-xs text-destructive text-center">{captchaError}</p>
                  )}
                  {captchaConfigured && !captchaError && !captchaReady && (
                    <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Đang tải captcha...</span>
                    </p>
                  )}
                </div>

                {message && (
                  <div className="flex items-center gap-2 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4" />
                    <span className="min-w-0 break-words whitespace-normal">{message}</span>
                  </div>
                )}

                <Button
                  className="w-full h-11 text-base"
                  onClick={handleSubmit}
                  disabled={
                    phase === "pending" ||
                    (captchaConfigured ? !turnstileToken || Boolean(captchaError) : false)
                  }
                >
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
                <p className="px-2">
                  Nếu bạn nhận được email xác nhận từ NVIDIA, hãy hoàn tất bước xác nhận để hệ thống xử lý nhanh hơn.
                </p>
                <Button variant="secondary" onClick={resetForm} className="w-full sm:w-auto">
                  Nhập lại
                </Button>
              </div>
            )}

            {phase === "done" && (
              <div className="space-y-4 text-center">
                <CheckCircle2 className="h-9 w-9 sm:h-10 sm:w-10 text-emerald-500 mx-auto" />
                <p className="text-base font-semibold">Hoàn tất!</p>
                <p className="text-sm text-muted-foreground px-2">
                  Cảm ơn bạn đã hỗ trợ. Bạn có thể gửi thêm tài khoản khác nếu muốn.
                </p>
                <Button onClick={resetForm} className="w-full sm:w-auto">
                  Gửi thêm tài khoản khác
                </Button>
              </div>
            )}

            {phase === "error" && (
              <div className="space-y-4 text-center text-sm text-muted-foreground">
                <AlertCircle className="h-9 w-9 sm:h-10 sm:w-10 text-destructive mx-auto" />
                <p className="text-base font-semibold text-destructive">Gửi thất bại</p>
                <p className="px-2 break-words">{message}</p>
                <Button variant="secondary" onClick={resetForm} className="w-full sm:w-auto">
                  Thử lại
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default GetsCoin;
