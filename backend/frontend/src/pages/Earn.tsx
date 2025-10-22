import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Play,
  ShieldAlert,
  MoreHorizontal,
  Minimize2,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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
  registerWorkerTokenForCoin,
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

type RegStatus = "idle" | "pending" | "done" | "error";

type RegPersistedState = {
  open: boolean;
  minimized: boolean;
};

const REG_STATE_STORAGE_KEY = "earn-reg-dialog-state";

const defaultRegState: RegPersistedState = { open: false, minimized: false };

const readPersistedRegState = (): RegPersistedState => {
  if (typeof window === "undefined") {
    return defaultRegState;
  }
  try {
    const raw = window.localStorage.getItem(REG_STATE_STORAGE_KEY);
    if (!raw) {
      return defaultRegState;
    }
    const parsed = JSON.parse(raw) as Partial<RegPersistedState>;
    return {
      open: Boolean(parsed?.open),
      minimized: Boolean(parsed?.minimized),
    };
  } catch {
    return defaultRegState;
  }
};

const writePersistedRegState = (state: RegPersistedState): void => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(
      REG_STATE_STORAGE_KEY,
      JSON.stringify({
        open: Boolean(state.open),
        minimized: Boolean(state.minimized),
      }),
    );
  } catch {
    // ignore storage failures
  }
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
  const [activeProvider, setActiveProvider] = useState<string>("monetag");
  const [monetagElapsed, setMonetagElapsed] = useState<number>(0);
  const [monetagPaused, setMonetagPaused] = useState<boolean>(false);
  const monetagTimerRef = useRef<number | null>(null);
  const monetagElapsedRef = useRef<number>(0);
  const monetagActiveRef = useRef<boolean>(false);
  const monetagCancelRef = useRef<((reason: Error) => void) | null>(null);
  const [regOpen, setRegOpen] = useState<boolean>(
    () => readPersistedRegState().open,
  );
  const [regMinimized, setRegMinimized] = useState<boolean>(
    () => readPersistedRegState().minimized,
  );
  const [regStatus, setRegStatus] = useState<RegStatus>("idle");
  const [regEmail, setRegEmail] = useState("");
  const [regPass, setRegPass] = useState("");
  const [regConfirm, setRegConfirm] = useState(false);
  const [regCopied, setRegCopied] = useState(false);
  const [regMsg, setRegMsg] = useState<string | null>(null);
  const persistReg = useCallback((update: Partial<RegPersistedState>) => {
    const current = readPersistedRegState();
    const next: RegPersistedState = {
      open: update.open ?? current.open,
      minimized: update.minimized ?? current.minimized,
    };
    writePersistedRegState(next);
  }, []);

  const {
    data: policy,
    isLoading: isLoadingPolicy,
    refetch: refetchPolicy,
  } = useQuery<RewardPolicy>({
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
  const registerMutation = useMutation(registerWorkerTokenForCoin);

  useEffect(() => {
    if (!["idle", "success", "error"].includes(status)) {
      return;
    }
    setActiveProvider((current) =>
      current === selectedProvider ? current : selectedProvider,
    );
  }, [selectedProvider, status]);

  const onRegStart = useCallback(async () => {
    const email = regEmail.trim();
    const password = regPass.trim();
    if (!email || !password || !regConfirm) {
      setRegMsg("Please provide the registration details and confirm.");
      return;
    }

    setRegStatus("pending");
    setRegMsg(null);
    setRegMinimized(false);
    setRegOpen(true);
    persistReg({ open: true, minimized: false });

    try {
      await registerMutation.mutateAsync({
        email,
        password,
        confirm: true,
      });
      setRegStatus("done");
      setRegMsg(null);
      setRegEmail("");
      setRegPass("");
      setRegConfirm(false);
      refresh();
      refetchWallet();
      refetchMetrics();
    } catch (error) {
      let detailMessage = "Failed to submit registration. Please try again.";
      if (error instanceof ApiError) {
        const detail = (error.data as { detail?: string } | undefined)?.detail;
        if (detail === "duplicate_mail") {
          detailMessage = "Email has already been submitted.";
        } else if (
          detail === "no_worker_available" ||
          detail === "no_tokens_available"
        ) {
          detailMessage =
            "Reward service is temporarily unavailable. Please try again later.";
        } else if (detail === "worker_error" || detail === "worker_rejected") {
          detailMessage = "Worker rejected the request. Please retry shortly.";
        } else if (detail) {
          detailMessage = detail;
        } else {
          detailMessage = error.message;
        }
      } else if (error instanceof Error) {
        detailMessage = error.message;
      }
      setRegStatus("error");
      setRegMsg(detailMessage);
    }
  }, [
    regEmail,
    regPass,
    regConfirm,
    registerMutation,
    persistReg,
    refresh,
    refetchWallet,
    refetchMetrics,
  ]);

  useEffect(() => {
    persistReg({ open: regOpen, minimized: regMinimized });
  }, [regOpen, regMinimized, persistReg]);

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

  const stopMonetagWatcher = useCallback(() => {
    if (monetagTimerRef.current !== null) {
      window.clearTimeout(monetagTimerRef.current);
      monetagTimerRef.current = null;
    }
    monetagActiveRef.current = false;
    const cancel = monetagCancelRef.current;
    if (cancel) {
      monetagCancelRef.current = null;
      cancel(new Error("Ad cancelled"));
    }
  }, []);

  const waitForMonetagDuration = useCallback(
    (requiredSeconds: number) =>
      new Promise<number>((resolve, reject) => {
        if (typeof window === "undefined") {
          reject(new Error("Monetag tracking requires a browser environment"));
          return;
        }
        monetagElapsedRef.current = 0;
        monetagActiveRef.current = true;
        setMonetagElapsed(0);
        setMonetagPaused(false);

        let settled = false;
        const handleResolve = (value: number) => {
          if (settled) {
            return;
          }
          settled = true;
          monetagCancelRef.current = null;
          resolve(value);
        };
        const handleCancel = (reason: Error) => {
          if (settled) {
            return;
          }
          settled = true;
          monetagCancelRef.current = null;
          reject(reason);
        };

        monetagCancelRef.current = handleCancel;

        const tick = () => {
          if (!monetagActiveRef.current) {
            handleCancel(new Error("Ad cancelled"));
            return;
          }

          const visible =
            typeof document !== "undefined" &&
            document.visibilityState === "visible" &&
            document.hasFocus();

          setMonetagPaused((prev) => {
            const next = !visible;
            return prev === next ? prev : next;
          });

          if (visible) {
            monetagElapsedRef.current += 0.25;
            const elapsed = monetagElapsedRef.current;
            setMonetagElapsed((prev) => {
              const next = Math.min(requiredSeconds, Math.floor(elapsed));
              return next === prev ? prev : next;
            });
            if (elapsed >= requiredSeconds) {
              handleResolve(Math.round(elapsed));
              return;
            }
          }

          monetagTimerRef.current = window.setTimeout(tick, 250);
        };
        monetagTimerRef.current = window.setTimeout(tick, 250);
      }),
    [],
  );

  useEffect(
    () => () => {
      stopMonetagWatcher();
    },
    [stopMonetagWatcher],
  );

  const runImaAd = useCallback(async (adTagUrl: string) => {
    await ensureImaSdk();
    const google = window.google;
    const videoElement = videoRef.current;
    const containerElement = adContainerRef.current;
    if (!google?.ima || !videoElement || !containerElement) {
      throw new Error("IMA SDK is not ready");
    }

    return new Promise<void>((resolve, reject) => {
      const adDisplayContainer = new google.ima.AdDisplayContainer(
        containerElement,
        videoElement,
      );
      try {
        adDisplayContainer.initialize();
      } catch {}

      const adsLoader = new google.ima.AdsLoader(adDisplayContainer);
      adsLoader.addEventListener(
        google.ima.AdErrorEvent.Type.AD_ERROR,
        (event: any) => {
          adsLoader.destroy();
          reject(
            new Error(event.getError()?.toString() ?? "IMA playback error"),
          );
        },
      );

      adsLoader.addEventListener(
        google.ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED,
        (event: any) => {
          try {
            const adsManager = event.getAdsManager(videoElement);
            adsManager.addEventListener(
              google.ima.AdEvent.Type.CONTENT_RESUME_REQUESTED,
              () => videoElement.pause(),
            );
            adsManager.addEventListener(google.ima.AdEvent.Type.STARTED, () =>
              setStatus("playing"),
            );
            adsManager.addEventListener(google.ima.AdEvent.Type.COMPLETE, () =>
              resolve(),
            );
            adsManager.addEventListener(
              google.ima.AdEvent.Type.ALL_ADS_COMPLETED,
              () => resolve(),
            );
            adsManager.addEventListener(
              google.ima.AdErrorEvent.Type.AD_ERROR,
              (err: any) => {
                reject(
                  new Error(err.getError()?.toString() ?? "Ad playback error"),
                );
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
      );

      const request = new google.ima.AdsRequest();
      request.adTagUrl = adTagUrl;
      request.linearAdSlotWidth = containerElement.clientWidth || 640;
      request.linearAdSlotHeight = containerElement.clientHeight || 360;
      request.nonLinearAdSlotWidth = containerElement.clientWidth || 640;
      request.nonLinearAdSlotHeight =
        (containerElement.clientHeight || 360) / 3;
      request.setAdWillAutoPlay(true);
      request.setAdWillPlayMuted(false);

      try {
        adsLoader.requestAds(request);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }, []);

  const runMonetagFlow = useCallback(
    async (
      session: PrepareAdResponse,
      requiredSeconds: number,
      minInterval: number,
    ) => {
      if (!session.ticket || !session.zoneId || !session.scriptUrl) {
        throw new Error("Monetag configuration is incomplete");
      }
      const container = monetagContainerRef.current;
      if (!container) {
        throw new Error("Monetag container unavailable");
      }

      setStatus("loading");
      setMessage(null);

      await ensureMonetagScript(session.scriptUrl);
      container.innerHTML = "";
      showMonetagAd(session.zoneId, container);
      setStatus("playing");

      try {
        const watchedSeconds = await waitForMonetagDuration(requiredSeconds);
        setStatus("verifying");
        const result = await completeMonetagAd({
          nonce: session.nonce,
          ticket: session.ticket,
          durationSec: Math.round(watchedSeconds),
          deviceHash: session.deviceHash,
          provider: "monetag",
        });
        const gained = Number(result.added ?? 0);
        setStatus("success");
        if (gained > 0) {
          setMessage(`+${gained} coins added to your wallet.`);
        } else {
          setMessage("Verification complete. Balance will refresh shortly.");
        }
        setCooldownUntil(Date.now() + minInterval * 1000);
        setMonetagElapsed(requiredSeconds);
        setMonetagPaused(false);
        refresh();
        refetchWallet();
        refetchMetrics();
      } finally {
        monetagCancelRef.current = null;
        stopMonetagWatcher();
      }
    },
    [
      waitForMonetagDuration,
      refresh,
      refetchWallet,
      refetchMetrics,
      stopMonetagWatcher,
    ],
  );

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
    setMonetagElapsed(0);
    setMonetagPaused(false);

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

    if (effectiveProvider === "monetag") {
      try {
        await runMonetagFlow(
          prepareResponse,
          requiredDuration,
          minIntervalSeconds,
        );
      } catch (error) {
        setStatus("error");

        if (error instanceof Error) {
          setMessage(error.message);
        } else {
          setMessage("Failed to complete the Monetag session.");
        }

        setMonetagElapsed(0);
        setMonetagPaused(false);
      }
      return;
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
    stopMonetagWatcher,
    runImaAd,
    waitForWalletUpdate,
    refresh,
    refetchWallet,
    refetchMetrics,
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold">Xem quảng cáo nhận thưởng</h1>
        <p className="text-muted-foreground">
          Xem quảng cáo 30 giây để nhận 5 xu. Phần thưởng chỉ được cộng khi máy
          chủ xác minh thành công.
        </p>
      </div>

      <div className="grid gap-6 w-full">
        {/* Reg Account For Coin card */}
        <Card className="glass-card h-fit w-full">
          <CardHeader className="py-3">
            <CardTitle className="text-base font-semibold">
              Reg Account For Coin
            </CardTitle>
            <CardDescription className="text-sm">
              Tạo tài khoản mới để nhận +15 xu
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Button
              className="w-full h-11 text-base"
              variant="secondary"
              onClick={() => {
                setRegOpen(true);
                setRegMinimized(false);
                persistReg({ open: true, minimized: false });
              }}
            >
              <MoreHorizontal className="mr-2 h-4 w-4" /> More
            </Button>
          </CardContent>
        </Card>

        {/* Floating minimized indicator */}
        {regMinimized && regStatus === "pending" && (
          <div className="fixed bottom-4 right-4 z-50">
            <Button
              onClick={() => {
                setRegMinimized(false);
                setRegOpen(true);
              }}
              variant="secondary"
              className="rounded-full shadow-lg px-4 py-2 text-sm"
            >
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Confirming...
            </Button>
          </div>
        )}

        {/* Dialog */}
        <Dialog
          open={regOpen}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              if (regStatus === "pending") {
                setRegOpen(false);
                setRegMinimized(true);
                persistReg({ open: false, minimized: true });
              } else {
                setRegOpen(false);
                setRegMinimized(false);
                persistReg({ open: false, minimized: false });
              }
            } else {
              setRegOpen(true);
              persistReg({ open: true });
            }
          }}
        >
          <DialogContent className="sm:max-w-[720px] md:max-w-[820px]">
            <DialogHeader>
              <DialogTitle className="text-xl font-bold tracking-tight">
                How ?
              </DialogTitle>
            </DialogHeader>
            {regStatus === "idle" && (
              <div className="space-y-6 text-base leading-relaxed">
                <ol className="list-decimal pl-6 space-y-3">
                  <li>
                    Step 1: Go to website
                    <button
                      className="ml-2 underline font-medium relative"
                      title="Click to copy"
                      onClick={async () => {
                        await navigator.clipboard.writeText(
                          "https://learn.nvidia.com/join?auth=login&redirectPath=/my-learning",
                        );
                        setRegCopied(true);
                        setTimeout(() => setRegCopied(false), 1500);
                      }}
                    >
                      learn.nvidia.com/join?auth=login&redirectPath=/my-learning
                    </button>
                    <span className="ml-2 text-xs text-emerald-500 align-middle">
                      {regCopied ? "Copied" : ""}
                    </span>
                  </li>
                  <li>
                    Step 2: Create a new account with an email you don't use
                    (like hotmail, gmail, etc)
                  </li>
                  <li>Step 3: Go back and input your account here:</li>
                </ol>
                <div className="space-y-3">
                  <Input
                    placeholder="Mail"
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    className="h-11 text-base"
                  />
                  <Input
                    placeholder="Pass"
                    type="password"
                    value={regPass}
                    onChange={(e) => setRegPass(e.target.value)}
                    className="h-11 text-base"
                  />
                  <div className="flex items-center space-x-3">
                    <Checkbox
                      id="confirm"
                      checked={regConfirm}
                      onCheckedChange={(v) => setRegConfirm(Boolean(v))}
                    />
                    <label htmlFor="confirm" className="text-sm md:text-base">
                      Confirm that this account is not your official account for
                      security reasons
                    </label>
                  </div>
                </div>
                <div className="flex items-center justify-center gap-3">
                  <Button
                    className="h-11 px-6 text-base"
                    disabled={
                      !regEmail ||
                      !regPass ||
                      !regConfirm ||
                      registerMutation.isPending
                    }
                    onClick={onRegStart}
                  >
                    {registerMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />{" "}
                        Submitting...
                      </>
                    ) : (
                      <>Done</>
                    )}
                  </Button>
                </div>
              </div>
            )}
            {regStatus === "pending" && (
              <div className="space-y-4 text-center">
                <div className="flex items-start justify-between">
                  <p className="whitespace-pre-line text-base md:text-lg font-medium text-left">
                    we are confirming{"\n"}please wait ...{"\n"}and check your
                    mailbox to confirm if there is a confirmation email
                  </p>
                  <Button
                    aria-label="Minimize"
                    title="Minimize"
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setRegMinimized(true);
                      setRegOpen(false);
                      persistReg({ open: false, minimized: true });
                    }}
                  >
                    <Minimize2 className="h-5 w-5" />
                  </Button>
                </div>
                <div className="flex items-center justify-center text-base text-muted-foreground">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />{" "}
                  Processing...
                </div>
              </div>
            )}
            {regStatus === "done" && (
              <div className="space-y-3 text-center">
                <p className="text-2xl font-bold">Done</p>
                <p className="text-base">thank you so much</p>
                <p className="text-lg font-semibold text-emerald-500">
                  added 15 coin
                </p>
                <div className="flex justify-center gap-2">
                  <Button
                    className="h-10 px-6"
                    onClick={() => {
                      setRegOpen(false);
                      setRegMinimized(false);
                      setRegStatus("idle");
                      setRegMsg(null);
                      persistReg({
                        open: false,
                        minimized: false,
                        status: "idle",
                        msg: null,
                      });
                    }}
                  >
                    Close
                  </Button>
                </div>
              </div>
            )}
            {regStatus === "error" && (
              <div className="space-y-3 text-center">
                <p className="text-base text-destructive">
                  {regMsg ?? "Failed"}
                </p>
                <div className="flex justify-center gap-2">
                  <Button
                    className="h-10 px-6"
                    variant="secondary"
                    onClick={() => {
                      setRegStatus("idle");
                      setRegMsg(null);
                    }}
                  >
                    Back
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        <Card className="glass-card w-full">
          <CardHeader>
            <CardTitle>Nhận +5 xu</CardTitle>
            <CardDescription>
              Mỗi lượt xem hợp lệ sẽ được cộng xu sau khi xác minh.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 rounded-lg border border-border/40 px-3 py-2">
                <span className="text-sm text-muted-foreground">
                  Số dư hiện tại
                </span>
                <Badge variant="secondary" className="text-base font-semibold">
                  {walletBalance} xu
                </Badge>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-border/40 px-3 py-2">
                <span className="text-sm text-muted-foreground">
                  Thưởng mỗi lượt
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
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Đang chuẩn
                    bị quảng cáo
                  </>
                ) : status === "playing" ? (
                  <>
                    <Play className="mr-2 h-4 w-4" /> Quảng cáo đang chạy
                  </>
                ) : (
                  <>
                    <Play className="mr-2 h-4 w-4" /> Xem quảng cáo (+
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
                    {status === "idle" && "Sẵn sàng nhận thưởng"}
                    {status === "preparing" && "Đang chuẩn bị quảng cáo..."}
                    {status === "loading" && "Đang tải quảng cáo..."}
                    {status === "playing" &&
                      "Quảng cáo đang phát, vui lòng xem hết để nhận thưởng."}
                    {status === "verifying" && "Đang xác minh phần thưởng..."}
                    {status === "success" && "Hoàn tất"}
                    {status === "error" && "Không thể hoàn thành lượt xem"}
                  </p>
                  {message && (
                    <p className="text-sm text-muted-foreground mt-1">
                      {message}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {activeProvider === "monetag" && (
              <div className="space-y-2">
                <Progress value={monetagProgress} />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {Math.min(monetagElapsed, requiredDuration)}s /{" "}
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
            <CardTitle>Quota & Chính sách</CardTitle>
            <CardDescription>Cài đặt phần thưởng hiện tại</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {isLoadingPolicy && (
              <p className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Đang tải chính
                sách...
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
                Không thể tải cấu hình thưởng.{" "}
                <button
                  type="button"
                  onClick={() => refetchPolicy()}
                  className="underline"
                >
                  Thử lại
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
