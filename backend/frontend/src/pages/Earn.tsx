import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Loader2, Play, ShieldAlert } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useAuth } from "@/context/AuthContext";
import {
  ApiError,
  fetchRewardPolicy,
  fetchRewardMetrics,
  fetchWalletBalance,
  prepareRewardedAd,
  completeMonetagAd,
} from "@/lib/api-client";
import type {
  PrepareAdResponse,
  RewardMetricsSummary,
  RewardPolicy,
  RewardProviderConfig,
  WalletBalance,
} from "@/lib/types";

declare global {
  interface Window {
    turnstile?: {
      render?: (
        container: HTMLElement | string,
        options: Record<string, unknown>,
      ) => unknown;
      execute: (
        siteKey: string,
        options?: { action?: string; cData?: string },
      ) => Promise<string>;
    };
    google?: any;
    monetag?: {
      display?: (zoneId: string, options?: Record<string, unknown>) => void;
      run?: (zoneId: string) => void;
    };
  }
}

const PLACEMENT = "earn";
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? "";
const CLIENT_SIGNING_KEY = import.meta.env.VITE_ADS_CLIENT_SIGNING_KEY ?? "";

let turnstileLoader: Promise<void> | null = null;
let imaLoader: Promise<void> | null = null;
const monetagLoaders = new Map<string, Promise<void>>();

const ensureTurnstile = async (): Promise<void> => {
  if (!TURNSTILE_SITE_KEY || typeof window === "undefined") {
    return;
  }
  if (window.turnstile) {
    return;
  }
  if (!turnstileLoader) {
    turnstileLoader = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `https://challenges.cloudflare.com/turnstile/v0/api.js?render=${TURNSTILE_SITE_KEY}`;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () =>
        reject(new Error("Failed to load Cloudflare Turnstile script"));
      document.head.appendChild(script);
    });
  }
  await turnstileLoader;
};

const ensureImaSdk = async (): Promise<void> => {
  if (typeof window === "undefined")
    throw new Error("IMA SDK requires browser environment");
  if (window.google?.ima) return;
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

const ensureMonetagScript = async (scriptUrl: string): Promise<void> => {
  if (!scriptUrl) {
    throw new Error("Monetag script URL missing");
  }
  if (typeof window === "undefined") {
    return;
  }
  if (document.querySelector(`script[data-monetag-src="${scriptUrl}"]`)) {
    return;
  }
  let loader = monetagLoaders.get(scriptUrl);
  if (!loader) {
    loader = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = scriptUrl;
      script.async = true;
      (script as HTMLScriptElement).dataset.monetagSrc = scriptUrl;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load Monetag script"));
      document.head.appendChild(script);
    });
    monetagLoaders.set(scriptUrl, loader);
  }
  await loader;
};

const showMonetagAd = (zoneId: string, container: HTMLElement | null) => {
  if (!container) {
    return;
  }
  container.innerHTML = "";
  try {
    if (window.monetag?.display) {
      window.monetag.display(zoneId, { container });
      return;
    }
  } catch (error) {
    console.warn("Monetag display() failed", error);
  }
  if (window.monetag?.run) {
    try {
      window.monetag.run(zoneId);
      return;
    } catch (error) {
      console.warn("Monetag run() failed", error);
    }
  }
  const fallback = document.createElement("div");
  fallback.className = "monetag-zone";
  fallback.setAttribute("data-zone", zoneId);
  container.appendChild(fallback);
};

const executeTurnstile = async (): Promise<string | null> => {
  if (!TURNSTILE_SITE_KEY) {
    return null;
  }
  await ensureTurnstile();
  const turnstile = window.turnstile;
  if (!turnstile?.execute) {
    throw new Error("Cloudflare Turnstile is not available");
  }
  return turnstile.execute(TURNSTILE_SITE_KEY, { action: "ads_prepare" });
};

const signPrepareRequest = async (
  userId: string,
  clientNonce: string,
  timestamp: string,
  placement: string,
): Promise<string | null> => {
  if (
    !CLIENT_SIGNING_KEY ||
    typeof window === "undefined" ||
    !window.crypto?.subtle
  )
    return null;
  const encoder = new TextEncoder();
  const keyMaterial = encoder.encode(CLIENT_SIGNING_KEY);
  const cryptoKey = await window.crypto.subtle.importKey(
    "raw",
    keyMaterial,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const payload = encoder.encode(
    `${userId}|${clientNonce}|${timestamp}|${placement}`,
  );
  const buffer = await window.crypto.subtle.sign("HMAC", cryptoKey, payload);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

const collectClientHints = (): Record<string, string> => {
  if (typeof navigator === "undefined") return {};
  const hints: Record<string, string> = { ua: navigator.userAgent };
  const uaData = (navigator as unknown as { userAgentData?: any })
    .userAgentData;
  if (uaData) {
    hints.platform = uaData.platform ?? "";
    hints.mobile = String(uaData.mobile ?? false);
    const brands =
      uaData.brands ??
      uaData.getHighEntropyValues?.(["model", "platformVersion"]);
    if (Array.isArray(brands)) {
      hints.brands = brands
        .map(
          (it: { brand?: string; version?: string }) =>
            `${it.brand ?? ""}:${it.version ?? ""}`,
        )
        .join("|");
    }
  }
  try {
    hints.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {}
  return hints;
};

const formatSeconds = (seconds: number): string => {
  if (!Number.isFinite(seconds)) return "--";
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
};

const providerDisplayName = (provider: string): string => {
  switch (provider) {
    case "monetag":
      return "Monetag";
    case "gma":
      return "Google Ads";
    default:
      return provider.toUpperCase();
  }
};

type EarnStatus =
  | "idle"
  | "preparing"
  | "loading"
  | "playing"
  | "verifying"
  | "success"
  | "error";

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
  const monetagContainerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<EarnStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [metricsSnapshot, setMetricsSnapshot] =
    useState<RewardMetricsSummary>(initialMetrics);
  const [selectedProvider, setSelectedProvider] = useState<string>("monetag");
    const [monetagElapsed, setMonetagElapsed] = useState<number>(0);
  const [monetagPaused, setMonetagPaused] = useState<boolean>(false);
  const monetagTimerRef = useRef<number | null>(null);
  const monetagElapsedRef = useRef<number>(0);
  const monetagActiveRef = useRef<boolean>(false);
  const monetagCancelRef = useRef<((reason: Error) => void) | null>(null);

  const policyQuery = useQuery<RewardPolicy>({
    queryKey: ["ads-policy"],
    queryFn: fetchRewardPolicy,
    staleTime: 60_000,
  });
  const policy = policyQuery.data;
  const isLoadingPolicy = policyQuery.isLoading;
  const refetchPolicy = policyQuery.refetch;

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
  });
  const refetchMetrics = metricsQuery.refetch;

  const cooldownRemaining = useMemo(() => {
    if (!cooldownUntil) return 0;
    return Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
  }, [cooldownUntil]);

  useEffect(() => {
    if (!cooldownUntil) return;
    const timer = setInterval(() => {
      if (Date.now() >= cooldownUntil) {
        setCooldownUntil(null);
        setStatus("idle");
        clearInterval(timer);
      }
    }, 1_000);
    return () => clearInterval(timer);
  }, [cooldownUntil]);

  useEffect(() => {
    if (metricsQuery.data) {
      setMetricsSnapshot(metricsQuery.data);
    }
  }, [metricsQuery.data]);
  const providerOptions = useMemo(() => {
    const rawEntries = Object.entries(policy?.providers ?? {}).filter(
      ([, cfg]) => cfg?.enabled,
    ) as Array<[string, RewardProviderConfig | undefined]>;
    if (rawEntries.length > 0) {
      return rawEntries;
    }
    return [
      [
        "monetag",
        (policy?.providers?.monetag as RewardProviderConfig | undefined) ??
          undefined,
      ],
    ];
  }, [policy]);
  const requiredDuration = policy?.requiredDuration ?? 30;
  const minIntervalSeconds = policy?.minInterval ?? 30;
  const monetagProgress =
    requiredDuration > 0
      ? Math.min(100, (monetagElapsed / requiredDuration) * 100)
      : 0;

  useEffect(() => {
    if (!policy) {
      return;
    }
    const enabledKeys = providerOptions.map(([key]) => key);
    if (enabledKeys.length === 0) {
      setSelectedProvider("monetag");
      setActiveProvider("monetag");
      return;
    }
    const preferred = (policy.defaultProvider ?? "monetag").toLowerCase();
    const fallback = enabledKeys.includes(preferred)
      ? preferred
      : enabledKeys[0];
    setSelectedProvider((current) =>
      enabledKeys.includes(current) ? current : fallback,
    );
    setActiveProvider((current) =>
      enabledKeys.includes(current) ? current : fallback,
    );
  }, [policy, providerOptions]);

  const prepareMutation = useMutation(prepareRewardedAd);

  useEffect(() => {
    if (!["idle", "success", "error"].includes(status)) {
      return;
    }
    setActiveProvider((current) =>
      current === selectedProvider ? current : selectedProvider,
    );
  }, [selectedProvider, status]);
  const waitForWalletUpdate = useCallback(
    async (previousBalance: number): Promise<number> => {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1_200));
        const result = await refetchWallet();
        const currentBalance = result.data?.balance ?? previousBalance;
        if (currentBalance > previousBalance) return currentBalance;
      }
      return previousBalance;
    },
    [refetchWallet],
  );

  const handleWatchAd = useCallback(async () => {
    if (!profile) {
      setMessage("Please sign in to earn rewards.");
      return;
    }

    if (!policy) {
      setMessage("Reward policy is loading. Please try again shortly.");
      return;
    }

    if (cooldownUntil && cooldownUntil > Date.now()) {
      setStatus("error");
      setMessage(
        `You're still on cooldown for ${formatSeconds(cooldownRemaining)}.`,
      );
      return;
    }

    setStatus("preparing");
    setMessage(null);
    
    const turnstileToken = await executeTurnstile().catch((error) => {
      console.warn("Turnstile verification failed", error);

      return null;
    });

    const clientNonce = crypto.randomUUID();
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = await signPrepareRequest(
      profile.id,
      clientNonce,
      timestamp,
      PLACEMENT,
    );

    const hints = collectClientHints();
    const providerChoice = (
      selectedProvider ||
      policy.defaultProvider ||
      "monetag"
    ).toLowerCase();

    const startingBalance = walletBalance;
    let prepareResponse: PrepareAdResponse;
    try {
      prepareResponse = await prepareMutation.mutateAsync({
        placement: PLACEMENT,
        provider: providerChoice,
        turnstileToken,
        clientNonce,
        timestamp,
        signature,
        hints,
      });
    } catch (error) {
      setStatus("error");

      if (error instanceof ApiError) {
        const detail =
          (error.data as { detail?: string })?.detail ?? error.message;

        setMessage(detail);

        if (detail?.toLowerCase().includes("cooldown")) {
          setCooldownUntil(Date.now() + minIntervalSeconds * 1000);
        }
      } else if (error instanceof Error) {
        setMessage(error.message);
      } else {
        setMessage("Unable to prepare the ad. Please try again.");
      }

      return;
    }

    const effectiveProvider = (
      prepareResponse.provider ?? providerChoice
    ).toLowerCase();

    setActiveProvider(effectiveProvider);
    }

    if (effectiveProvider === "gma") {
      try {
        setStatus("loading");
        setMessage(null);
        stopMonetagWatcher();
        setMonetagElapsed(0);
        setMonetagPaused(false);

        if (!prepareResponse.adTagUrl) {
          throw new Error("Missing ad tag URL for Google Ads playback.");
        }

        await runImaAd(prepareResponse.adTagUrl);
        setStatus("verifying");
        const newBalance = await waitForWalletUpdate(startingBalance);

        if (newBalance > startingBalance) {
          const gained = newBalance - startingBalance;
          setStatus("success");
          setMessage(`+${gained} coins added to your wallet.`);
          setCooldownUntil(Date.now() + minIntervalSeconds * 1000);
          refresh();
          refetchWallet();
          refetchMetrics();
        } else {
          setStatus("success");
          setMessage("Ad completed. Your balance will refresh shortly.");
          setCooldownUntil(Date.now() + minIntervalSeconds * 1000);
        }
      } catch (error) {
        setStatus("error");
        if (error instanceof Error) {
          setMessage(error.message);
        } else {
          setMessage("Failed to play the advertisement. Please try again.");
        }
      }
      return;
    }
    setStatus("error");
    setMessage("Unsupported ad provider selected.");
  }, [
    profile,
    policy,
    cooldownUntil,
    cooldownRemaining,
    selectedProvider,
    walletBalance,
    prepareMutation,
    minIntervalSeconds,
    runMonetagFlow,
    requiredDuration,
        runImaAd,
    waitForWalletUpdate,
    refresh,
    refetchWallet,
    refetchMetrics,
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold">Xem quß║úng c├ío nhß║¡n th╞░ß╗ƒng</h1>
        <p className="text-muted-foreground">
          Xem quß║úng c├ío 30 gi├óy ─æß╗â nhß║¡n 5 xu. Phß║ºn th╞░ß╗ƒng chß╗ë ─æ╞░ß╗úc cß╗Öng khi m├íy
          chß╗º x├íc minh th├ánh c├┤ng.
        </p>
      </div>

      <div className="grid gap-6 w-full">

        <Card className="glass-card w-full">
          <CardHeader>
            <CardTitle>Nhß║¡n +5 xu</CardTitle>
            <CardDescription>
              Mß╗ùi l╞░ß╗út xem hß╗úp lß╗ç sß║╜ ─æ╞░ß╗úc cß╗Öng xu sau khi x├íc minh.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 rounded-lg border border-border/40 px-3 py-2">
                <span className="text-sm text-muted-foreground">
                  Sß╗æ d╞░ hiß╗çn tß║íi
                </span>
                <Badge variant="secondary" className="text-base font-semibold">
                  {walletBalance} xu
                </Badge>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-border/40 px-3 py-2">
                <span className="text-sm text-muted-foreground">
                  Th╞░ß╗ƒng mß╗ùi l╞░ß╗út
                </span>
                <Badge variant="outline">{policy?.rewardPerView ?? 5} xu</Badge>
              </div>
            </div>

            {providerOptions.length > 1 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Ad provider</p>
                <RadioGroup
                  value={selectedProvider}
                  onValueChange={(value) => setSelectedProvider(value)}
                  className="flex flex-wrap gap-2"
                >
                  {providerOptions.map(([value, cfg]) => {
                    const id = `provider-${value}`;
                    return (
                      <div
                        key={value}
                        className={`flex items-center gap-2 rounded-md border border-border/40 px-3 py-2 transition ring-offset-background ${
                          selectedProvider === value
                            ? "ring-1 ring-primary"
                            : ""
                        }`}
                      >
                        <RadioGroupItem id={id} value={value} />
                        <div className="flex flex-col">
                          <Label htmlFor={id} className="text-sm font-medium">
                            {providerDisplayName(value)}
                          </Label>
                          <span className="text-xs text-muted-foreground">
                            {value === "monetag"
                              ? "Client-side timer + server ticket"
                              : "Google IMA + server verification"}
                          </span>
                          {value === "monetag" && cfg?.zoneId && (
                            <span className="text-xs text-muted-foreground">
                              Zone {cfg.zoneId}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </RadioGroup>
              </div>
            )}

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
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> ─Éang chuß║⌐n
                    bß╗ï quß║úng c├ío
                  </>
                ) : status === "playing" ? (
                  <>
                    <Play className="mr-2 h-4 w-4" /> Quß║úng c├ío ─æang chß║íy
                  </>
                ) : (
                  <>
                    <Play className="mr-2 h-4 w-4" /> Xem quß║úng c├ío (+
                    {policy?.rewardPerView ?? 5} xu)
                  </>
                )}
              </Button>
              {cooldownUntil && cooldownUntil > Date.now() && (
                <div className="text-sm text-muted-foreground">
                  Vui long doi {formatSeconds(cooldownRemaining)} truoc khi xem
                  quang cao tiep theo.
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
                    {status === "idle" && "Sß║╡n s├áng nhß║¡n th╞░ß╗ƒng"}
                    {status === "preparing" && "─Éang chuß║⌐n bß╗ï quß║úng c├ío..."}
                    {status === "loading" && "─Éang tß║úi quß║úng c├ío..."}
                    {status === "playing" &&
                      "Quß║úng c├ío ─æang ph├ít, vui l├▓ng xem hß║┐t ─æß╗â nhß║¡n th╞░ß╗ƒng."}
                    {status === "verifying" && "─Éang x├íc minh phß║ºn th╞░ß╗ƒng..."}
                    {status === "success" && "Ho├án tß║Ñt"}
                    {status === "error" && "Kh├┤ng thß╗â ho├án th├ánh l╞░ß╗út xem"}
                  </p>
                  {message && (
                    <p className="text-sm text-muted-foreground mt-1">
                      {message}
                    </p>
                  )}
                </div>
              </div>
            </div>
                    {requiredDuration}s
                  </span>
                  {monetagPaused && (
                    <span className="font-medium text-amber-500">
                      Keep this tab visible
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="relative w-full overflow-hidden rounded-lg border border-border/40 bg-black aspect-video">
              <div
                ref={monetagContainerRef}
                className={`absolute inset-0 flex h-full w-full items-center justify-center transition-opacity ${
                  activeProvider === "monetag"
                    ? "opacity-100"
                    : "pointer-events-none opacity-0"
                }`}
              />
              <div
                ref={adContainerRef}
                className={`absolute inset-0 flex h-full w-full transition-opacity ${
                  activeProvider === "gma"
                    ? "opacity-100"
                    : "pointer-events-none opacity-0"
                }`}
              >
                <video
                  ref={videoRef}
                  className="h-full w-full object-contain"
                  playsInline
                  muted
                  controls={false}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card h-fit">
          <CardHeader>
            <CardTitle>Quota & Ch├¡nh s├ích</CardTitle>
            <CardDescription>C├ái ─æß║╖t phß║ºn th╞░ß╗ƒng hiß╗çn tß║íi</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {isLoadingPolicy && (
              <p className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> ─Éang tß║úi ch├¡nh
                s├ích...
              </p>
            )}
            {policy && (
              <ul className="space-y-2">
                <li>
                  <span className="font-medium">Thuong moi luot:</span>{" "}
                  {policy.rewardPerView} xu (xem toi thieu{" "}
                  {policy.requiredDuration}s)
                </li>
                <li>
                  <span className="font-medium">Thoi gian cho:</span>{" "}
                  {formatSeconds(policy.minInterval)} giua cac luot tren cung
                  thiet bi.
                </li>
                <li>
                  <span className="font-medium">Gioi han theo nguoi dung:</span>{" "}
                  {policy.effectivePerDay}/{policy.perDay} luot moi ngay.
                </li>
                <li>
                  <span className="font-medium">Gioi han theo thiet bi:</span>{" "}
                  {policy.perDevice} luot moi ngay.
                </li>
                {policy.priceFloor !== null && (
                  <li>
                    <span className="font-medium">Gia san hien tai:</span> CPM{" "}
                    {policy.priceFloor}
                  </li>
                )}
              </ul>
            )}
            {!isLoadingPolicy && !policy && (
              <div className="flex items-center gap-2 text-destructive">
                <AlertCircle className="h-4 w-4" />
                Kh├┤ng thß╗â tß║úi cß║Ñu h├¼nh th╞░ß╗ƒng.{" "}
                <button
                  type="button"
                  onClick={() => refetchPolicy()}
                  className="underline"
                >
                  Thß╗¡ lß║íi
                </button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Earn;
