import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Loader2, Play, ShieldAlert, MoreHorizontal, Minimize2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/context/AuthContext";
import {
  ApiError,
  fetchRewardPolicy,
  fetchRewardMetrics,
  fetchWalletBalance,
  prepareRewardedAd,
} from "@/lib/api-client";
import type { PrepareAdResponse, RewardMetricsSummary, RewardPolicy, WalletBalance } from "@/lib/types";

declare global {
  interface Window {
    grecaptcha?: {
      enterprise?: {
        execute: (siteKey: string, options: { action: string }) => Promise<string>;
      };
    };
    google?: any;
  }
}

const PLACEMENT = "earn";
const RECAPTCHA_SITE_KEY = import.meta.env.VITE_RECAPTCHA_SITE_KEY ?? "";
const CLIENT_SIGNING_KEY = import.meta.env.VITE_ADS_CLIENT_SIGNING_KEY ?? "";

let recaptchaLoader: Promise<void> | null = null;
let imaLoader: Promise<void> | null = null;

const ensureRecaptcha = async (): Promise<void> => {
  if (!RECAPTCHA_SITE_KEY || typeof window === "undefined") {
    return;
  }
  if (window.grecaptcha?.enterprise) {
    return;
  }
  if (!recaptchaLoader) {
    recaptchaLoader = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `https://www.google.com/recaptcha/enterprise.js?render=${RECAPTCHA_SITE_KEY}`;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load reCAPTCHA Enterprise script"));
      document.head.appendChild(script);
    });
  }
  await recaptchaLoader;
};

const ensureImaSdk = async (): Promise<void> => {
  if (typeof window === "undefined") {
    throw new Error("IMA SDK requires browser environment");
  }
  if (window.google?.ima) {
    return;
  }
  if (!imaLoader) {
    imaLoader = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://imasdk.googleapis.com/js/sdkloader/ima3.js";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load Google IMA SDK"));
      document.head.appendChild(script);
    });
  }
  await imaLoader;
};

const executeRecaptcha = async (): Promise<string | null> => {
  if (!RECAPTCHA_SITE_KEY) {
    return null;
  }
  await ensureRecaptcha();
  const executor = window.grecaptcha?.enterprise;
  if (!executor) {
    throw new Error("reCAPTCHA Enterprise is not available");
  }
  return executor.execute(RECAPTCHA_SITE_KEY, { action: "ads_prepare" });
};

const signPrepareRequest = async (
  userId: string,
  clientNonce: string,
  timestamp: string,
  placement: string,
): Promise<string | null> => {
  if (!CLIENT_SIGNING_KEY || typeof window === "undefined" || !window.crypto?.subtle) {
    return null;
  }
  const encoder = new TextEncoder();
  const keyMaterial = encoder.encode(CLIENT_SIGNING_KEY);
  const cryptoKey = await window.crypto.subtle.importKey(
    "raw",
    keyMaterial,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const payload = encoder.encode(`${userId}|${clientNonce}|${timestamp}|${placement}`);
  const buffer = await window.crypto.subtle.sign("HMAC", cryptoKey, payload);
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const collectClientHints = (): Record<string, string> => {
  if (typeof navigator === "undefined") {
    return {};
  }
  const hints: Record<string, string> = {
    ua: navigator.userAgent,
  };
  const uaData = (navigator as unknown as { userAgentData?: any }).userAgentData;
  if (uaData) {
    hints.platform = uaData.platform ?? "";
    hints.mobile = String(uaData.mobile ?? false);
    const brands = uaData.brands ?? uaData.getHighEntropyValues?.(["model", "platformVersion"]);
    if (Array.isArray(brands)) {
      hints.brands = brands.map((item: { brand?: string; version?: string }) => `${item.brand ?? ""}:${item.version ?? ""}`).join("|");
    }
  }
  try {
    hints.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    /* ignore */
  }
  return hints;
};

const formatSeconds = (seconds: number): string => {
  if (!Number.isFinite(seconds)) {
    return "--";
  }
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
};

type EarnStatus = "idle" | "preparing" | "loading" | "playing" | "verifying" | "success" | "error";

const initialMetrics: RewardMetricsSummary = {
  prepareOk: 0,
  prepareRejected: 0,
  ssvSuccess: 0,
  ssvInvalid: 0,
  ssvDuplicate: 0,
  ssvError: 0,
  rewardCoins: 0,
  failureRatio: 0,
  effectiveDailyCap: 0,
};

const Earn = () => {
  const { profile, refresh } = useAuth();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const adContainerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<EarnStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [metricsSnapshot, setMetricsSnapshot] = useState<RewardMetricsSummary>(initialMetrics);

  const { data: policy, isLoading: isLoadingPolicy, refetch: refetchPolicy } = useQuery<RewardPolicy>({
    queryKey: ["ads-policy"],
    queryFn: fetchRewardPolicy,
    staleTime: 60_000,
  });

  const walletQuery = useQuery<WalletBalance>({
    queryKey: ["wallet-balance"],
    queryFn: fetchWalletBalance,
    staleTime: 5_000,
    refetchOnWindowFocus: true,
    enabled: Boolean(profile),
  });

  const walletBalance = walletQuery.data?.balance ?? profile?.coins ?? 0;
  const refetchWallet = walletQuery.refetch;

  const metricsQuery = useQuery<RewardMetricsSummary>({
    queryKey: ["reward-metrics"],
    queryFn: fetchRewardMetrics,
    staleTime: 60_000,
    onSuccess: (data) => setMetricsSnapshot(data),
  });

  const refetchMetrics = metricsQuery.refetch;

  const prepareMutation = useMutation(prepareRewardedAd);

  const cooldownRemaining = useMemo(() => {
    if (!cooldownUntil) {
      return 0;
    }
    return Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
  }, [cooldownUntil]);

  useEffect(() => {
    if (!cooldownUntil) {
      return;
    }
    const timer = setInterval(() => {
      if (Date.now() >= cooldownUntil) {
        setCooldownUntil(null);
        setStatus("idle");
        clearInterval(timer);
      }
    }, 1_000);
    return () => clearInterval(timer);
  }, [cooldownUntil]);

  const runImaAd = useCallback(
    async (adTagUrl: string) => {
      await ensureImaSdk();
      const google = window.google;
      const videoElement = videoRef.current;
      const containerElement = adContainerRef.current;
      if (!google?.ima || !videoElement || !containerElement) {
        throw new Error("IMA SDK is not ready");
      }

      return new Promise<void>((resolve, reject) => {
        const adDisplayContainer = new google.ima.AdDisplayContainer(containerElement, videoElement);
        try {
          adDisplayContainer.initialize();
        } catch {
          /* ignore init errors */
        }

        const adsLoader = new google.ima.AdsLoader(adDisplayContainer);
        adsLoader.addEventListener(
          google.ima.AdErrorEvent.Type.AD_ERROR,
          (event: any) => {
            adsLoader.destroy();
            reject(new Error(event.getError()?.toString() ?? "IMA playback error"));
          },
          false,
        );

        adsLoader.addEventListener(
          google.ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED,
          (event: any) => {
            try {
              const adsManager = event.getAdsManager(videoElement);
              adsManager.addEventListener(google.ima.AdEvent.Type.CONTENT_RESUME_REQUESTED, () => {
                videoElement.pause();
              });
              adsManager.addEventListener(google.ima.AdEvent.Type.STARTED, () => setStatus("playing"));
              adsManager.addEventListener(google.ima.AdEvent.Type.COMPLETE, () => resolve());
              adsManager.addEventListener(google.ima.AdEvent.Type.ALL_ADS_COMPLETED, () => resolve());
              adsManager.addEventListener(
                google.ima.AdErrorEvent.Type.AD_ERROR,
                (errEvent: any) => {
                  reject(new Error(errEvent.getError()?.toString() ?? "Ad playback error"));
                },
              );
              adsManager.init(
                containerElement.clientWidth || 640,
                containerElement.clientHeight || 360,
                google.ima.ViewMode.NORMAL,
              );
              adsManager.start();
            } catch (error) {
              reject(error instanceof Error ? error : new Error(String(error)));
            }
          },
          false,
        );

        const request = new google.ima.AdsRequest();
        request.adTagUrl = adTagUrl;
        request.linearAdSlotWidth = containerElement.clientWidth || 640;
        request.linearAdSlotHeight = containerElement.clientHeight || 360;
        request.nonLinearAdSlotWidth = containerElement.clientWidth || 640;
        request.nonLinearAdSlotHeight = (containerElement.clientHeight || 360) / 3;
        request.setAdWillAutoPlay(true);
        request.setAdWillPlayMuted(false);

        try {
          adsLoader.requestAds(request);
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
    [],
  );

  const waitForWalletUpdate = useCallback(
    async (previousBalance: number): Promise<number> => {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1_200));
        const result = await refetchWallet();
        const currentBalance = result.data?.balance ?? previousBalance;
        if (currentBalance > previousBalance) {
          return currentBalance;
        }
      }
      return previousBalance;
    },
    [refetchWallet],
  );

  const handleWatchAd = useCallback(async () => {
    if (!profile) {
      setMessage("Bạn cần đăng nhập để nhận thưởng.");
      return;
    }
    if (!policy) {
      setMessage("Đang tải cấu hình thưởng, vui lòng thử lại sau.");
      return;
    }
    if (cooldownUntil && cooldownUntil > Date.now()) {
      setStatus("error");
      setMessage(`Bạn đang trong thời gian chờ ${formatSeconds(cooldownRemaining)}`);
      return;
    }

    setStatus("preparing");
    setMessage(null);

    const recaptchaToken = await executeRecaptcha().catch((error) => {
      console.warn("reCAPTCHA verification failed", error);
      return null;
    });

    const clientNonce = crypto.randomUUID();
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = await signPrepareRequest(profile.id, clientNonce, timestamp, PLACEMENT);
    const hints = collectClientHints();
    const startingBalance = walletBalance;

    let prepareResponse: PrepareAdResponse;
    try {
      prepareResponse = await prepareMutation.mutateAsync({
        placement: PLACEMENT,
        recaptchaToken,
        clientNonce,
        timestamp,
        signature,
        hints,
      });
    } catch (error) {
      setStatus("error");
      if (error instanceof ApiError) {
        const detail = (error.data as { detail?: string })?.detail ?? error.message;
        setMessage(detail);
        if (detail?.toLowerCase().includes("cooldown")) {
          setCooldownUntil(Date.now() + policy.minInterval * 1000);
        }
      } else if (error instanceof Error) {
        setMessage(error.message);
      } else {
        setMessage("Không thể chuẩn bị quảng cáo. Vui lòng thử lại.");
      }
      return;
    }

    try {
      setStatus("loading");
      await runImaAd(prepareResponse.adTagUrl);
      setStatus("verifying");
      const newBalance = await waitForWalletUpdate(startingBalance);
      if (newBalance > startingBalance) {
        const gained = newBalance - startingBalance;
        setStatus("success");
        setMessage(`+${gained} xu đã được cộng vào ví của bạn.`);
        setCooldownUntil(Date.now() + policy.minInterval * 1000);
        refresh();
        refetchWallet();
        refetchMetrics();
      } else {
        setStatus("success");
        setMessage("Bạn đã hoàn thành quảng cáo. Phần thưởng sẽ được cập nhật sau vài giây.");
        setCooldownUntil(Date.now() + policy.minInterval * 1000);
      }
    } catch (error) {
      setStatus("error");
      if (error instanceof Error) {
        setMessage(error.message);
      } else {
        setMessage("Không thể phát quảng cáo. Vui lòng thử lại.");
      }
    }
  }, [
    policy,
    profile,
    cooldownUntil,
    cooldownRemaining,
    prepareMutation,
    runImaAd,
    waitForWalletUpdate,
    refresh,
    walletBalance,
    refetchWallet,
    refetchMetrics,
  ]);

  // Reg Account For Coin state
  type RegState = { open: boolean; minimized: boolean; status: "idle" | "pending" | "done" | "error"; msg?: string | null };
  const REG_KEY = "lt4c_reg_account";
  const [regOpen, setRegOpen] = useState<boolean>(false);
  const [regMinimized, setRegMinimized] = useState<boolean>(false);
  const [regStatus, setRegStatus] = useState<RegState["status"]>("idle");
  const [regMsg, setRegMsg] = useState<string | null>(null);
  const [regEmail, setRegEmail] = useState<string>("");
  const [regPass, setRegPass] = useState<string>("");
  const [regConfirm, setRegConfirm] = useState<boolean>(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(REG_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        setRegOpen(Boolean(parsed.open));
        setRegMinimized(Boolean(parsed.minimized));
        setRegStatus((parsed.status as RegState["status"]) ?? "idle");
        setRegMsg(parsed.msg ?? null);
      }
    } catch {}
  }, []);

  const persistReg = (next?: Partial<RegState>) => {
    try {
      const current: RegState = { open: regOpen, minimized: regMinimized, status: regStatus, msg: regMsg };
      const merged = { ...current, ...(next ?? {}) };
      localStorage.setItem(REG_KEY, JSON.stringify(merged));
    } catch {}
  };

  useEffect(() => {
    persistReg();
  }, [regOpen, regMinimized, regStatus, regMsg]);

  const onRegStart = useCallback(async () => {
    setRegStatus("pending");
    setRegMsg("we are confirming\nplease wait ...\nand check your mailbox to confirm if there is a confirmation email");
    persistReg({ open: true, minimized: false, status: "pending", msg: "..." });
    try {
      const { registerWorkerTokenForCoin } = await import("@/lib/api-client");
      const resp = await registerWorkerTokenForCoin({ email: regEmail, password: regPass, confirm: regConfirm });
      if (resp?.ok) {
        setRegStatus("done");
        setRegMsg("Done\nthank you so much\nadded 15 coin");
        refresh();
        refetchWallet();
      } else {
        setRegStatus("error");
        setRegMsg("Request failed");
      }
    } catch (e: any) {
      setRegStatus("error");
      if (e?.status === 409) {
        setRegMsg("This email already exists (duplicate)");
      } else if (e?.data?.detail) {
        setRegMsg(String(e.data.detail));
      } else {
        setRegMsg(e?.message ?? "Request failed");
      }
    }
  }, [regEmail, regPass, regConfirm, refresh, refetchWallet]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold">Xem quảng cáo nhận thưởng</h1>
        <p className="text-muted-foreground">
          Xem quảng cáo 30 giây để nhận 5 xu. Phần thưởng chỉ được cộng khi xác minh thành công từ máy chủ.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        {/* Reg Account For Coin card */}
        <Card className="glass-card">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Reg Account For Coin</CardTitle>
              <CardDescription>Tạo tài khoản mới để nhận +15 xu</CardDescription>
            </div>
            <Button variant="secondary" onClick={() => { setRegOpen(true); setRegMinimized(false); persistReg({ open: true, minimized: false }); }}>
              <MoreHorizontal className="mr-2 h-4 w-4" /> More
            </Button>
          </CardHeader>
        </Card>

        {/* Floating minimized indicator */}
        {regMinimized && regStatus === "pending" && (
          <div className="fixed bottom-4 right-4 z-50">
            <Button onClick={() => { setRegMinimized(false); setRegOpen(true); }} variant="secondary">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Confirming...
            </Button>
          </div>
        )}

        {/* Dialog */}
        <Dialog open={regOpen} onOpenChange={(o) => { setRegOpen(o); if (!o && regStatus !== "pending") { setRegMinimized(false); persistReg({ open: o, minimized: false }); } }}>
          <DialogContent className="sm:max-w-[540px]">
            <DialogHeader>
              <DialogTitle>How ?</DialogTitle>
            </DialogHeader>
            {regStatus === "idle" && (
              <div className="space-y-3 text-sm">
                <ol className="list-decimal pl-5 space-y-2">
                  <li>
                    Step 1: Go to website
                    <button className="ml-1 underline" onClick={async () => { await navigator.clipboard.writeText("https://learn.nvidia.com/join?auth=login&redirectPath=/my-learning"); }}>
                      learn.nvidia.com/join?auth=login&redirectPath=/my-learning
                    </button>
                  </li>
                  <li>Step 2: create a new account with an email you don't use (like hotmail,gmail,etc)</li>
                  <li>Step 3: Go back and input your account here:</li>
                </ol>
                <div className="space-y-2">
                  <Input placeholder="Mail" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} />
                  <Input placeholder="Pass" type="password" value={regPass} onChange={(e) => setRegPass(e.target.value)} />
                  <div className="flex items-center space-x-2">
                    <Checkbox id="confirm" checked={regConfirm} onCheckedChange={(v) => setRegConfirm(Boolean(v))} />
                    <label htmlFor="confirm" className="text-sm">confirm that this account is not your official account for security reasons</label>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button disabled={!regEmail || !regPass || !regConfirm} onClick={onRegStart}>Done</Button>
                </div>
              </div>
            )}
            {regStatus === "pending" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="whitespace-pre-line text-sm">we are confirming{"\n"}please wait ...{"\n"}and check your mailbox to confirm if there is a confirmation email</p>
                  <Button variant="ghost" size="icon" onClick={() => { setRegMinimized(true); setRegOpen(false); persistReg({ open: false, minimized: true }); }}><Minimize2 className="h-4 w-4" /></Button>
                </div>
                <div className="flex items-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing...</div>
              </div>
            )}
            {regStatus === "done" && (
              <div className="space-y-2">
                <p className="whitespace-pre-line text-sm">Done{"\n"}thank you so much{"\n"}added 15 coin</p>
                <div className="flex gap-2"><Button onClick={() => { setRegOpen(false); setRegMinimized(false); setRegStatus("idle"); setRegMsg(null); persistReg({ open: false, minimized: false, status: "idle", msg: null }); }}>Close</Button></div>
              </div>
            )}
            {regStatus === "error" && (
              <div className="space-y-2">
                <p className="text-sm text-destructive">{regMsg ?? "Failed"}</p>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => { setRegStatus("idle"); setRegMsg(null); }}>Back</Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
        <Card className="glass-card">
          <CardHeader>
            <CardTitle>Nhận +5 xu</CardTitle>
            <CardDescription>
              Mỗi lượt xem hợp lệ sẽ được cộng xu sau khi xác minh.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 rounded-lg border border-border/40 px-3 py-2">
                <span className="text-sm text-muted-foreground">Số dư hiện tại</span>
                <Badge variant="secondary" className="text-base font-semibold">
                  {walletBalance} xu
                </Badge>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-border/40 px-3 py-2">
                <span className="text-sm text-muted-foreground">Thưởng mỗi lượt</span>
                <Badge variant="outline">{policy?.rewardPerView ?? 5} xu</Badge>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <Button
                onClick={handleWatchAd}
                disabled={
                  prepareMutation.isLoading ||
                  status === "loading" ||
                  status === "playing" ||
                  status === "verifying" ||
                  (cooldownUntil !== null && cooldownUntil > Date.now())
                }
                className="w-fit"
              >
                {prepareMutation.isLoading || status === "loading" ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Đang chuẩn bị quảng cáo
                  </>
                ) : status === "playing" ? (
                  <>
                    <Play className="mr-2 h-4 w-4" />
                    Quảng cáo đang chạy
                  </>
                ) : (
                  <>
                    <Play className="mr-2 h-4 w-4" />
                    Xem quảng cáo (+{policy?.rewardPerView ?? 5} xu)
                  </>
                )}
              </Button>
              {cooldownUntil && cooldownUntil > Date.now() && (
                <div className="text-sm text-muted-foreground">
                  Vui lòng đợi {formatSeconds(cooldownRemaining)} trước khi xem quảng cáo tiếp theo.
                </div>
              )}
            </div>

            <div className="rounded-lg border border-border/40 bg-muted/30 p-4">
              <div className="flex items-start gap-3">
                {status === "success" ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                ) : status === "error" ? (
                  <ShieldAlert className="h-5 w-5 text-destructive" />
                ) : (
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                )}
                <div>
                  <p className="text-sm font-semibold">
                    {status === "idle" && "Sẵn sàng nhận thưởng"}
                    {status === "preparing" && "Đang chuẩn bị quảng cáo..."}
                    {status === "loading" && "Đang tải quảng cáo..."}
                    {status === "playing" && "Quảng cáo đang phát, vui lòng xem đến hết để nhận thưởng."}
                    {status === "verifying" && "Đang chờ xác minh phần thưởng..."}
                    {status === "success" && "Hoàn tất"}
                    {status === "error" && "Không thể hoàn thành lượt xem"}
                  </p>
                  {message && <p className="text-sm text-muted-foreground mt-1">{message}</p>}
                </div>
              </div>
            </div>

            <div
              ref={adContainerRef}
              className="relative w-full overflow-hidden rounded-lg border border-border/40 bg-black aspect-video"
            >
              <video
                ref={videoRef}
                className="h-full w-full object-contain"
                playsInline
                muted
                controls={false}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card h-fit">
          <CardHeader>
            <CardTitle>Quota & Chính sách</CardTitle>
            <CardDescription>Cài đặt phần thưởng hiện tại</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {isLoadingPolicy && <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Đang tải chính sách...</p>}
            {policy && (
              <ul className="space-y-2">
                <li>
                  <span className="font-medium">Thưởng mỗi lượt:</span>{" "}
                  {policy.rewardPerView} xu (xem tối thiểu {policy.requiredDuration}s)
                </li>
                <li>
                  <span className="font-medium">Thời gian chờ:</span>{" "}
                  {formatSeconds(policy.minInterval)} giữa các lượt trên cùng thiết bị.
                </li>
                <li>
                  <span className="font-medium">Giới hạn theo người dùng:</span>{" "}
                  {policy.effectivePerDay}/{policy.perDay} lượt mỗi ngày.
                </li>
                <li>
                  <span className="font-medium">Giới hạn theo thiết bị:</span>{" "}
                  {policy.perDevice} lượt mỗi ngày.
                </li>
                {policy.priceFloor !== null && (
                  <li>
                    <span className="font-medium">Giá sàn hiện tại:</span> CPM ≥ {policy.priceFloor}
                  </li>
                )}
              </ul>
            )}
            {!isLoadingPolicy && !policy && (
              <div className="flex items-center gap-2 text-destructive">
                <AlertCircle className="h-4 w-4" />
                Không thể tải cấu hình thưởng.{" "}
                <button type="button" onClick={() => refetchPolicy()} className="underline">
                  Thử lại
                </button>
              </div>
            )}
            <div className="pt-4 border-t border-border/40 space-y-1">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Thống kê hệ thống</p>
              <p className="text-sm">
                Tỷ lệ lấp đầy:{" "}
                {metricsSnapshot.prepareOk
                  ? `${Math.round((metricsSnapshot.ssvSuccess / metricsSnapshot.prepareOk) * 100)}%`
                  : "--"}
              </p>
              <p className="text-sm">
                Xác minh SSV thành công: {metricsSnapshot.ssvSuccess} /{" "}
                {metricsSnapshot.ssvSuccess +
                  metricsSnapshot.ssvInvalid +
                  metricsSnapshot.ssvError +
                  metricsSnapshot.ssvDuplicate}
              </p>
              <p className="text-sm">
                Tổng xu đã thưởng: {metricsSnapshot.rewardCoins}
              </p>
              <p className="text-sm">
                Tỷ lệ lỗi: {(metricsSnapshot.failureRatio * 100).toFixed(1)}%
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Earn;
