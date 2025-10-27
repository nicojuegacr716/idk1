import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";

declare global {
  interface Window {
    turnstile?: {
      render?: (
        container: HTMLElement | string,
        options: Record<string, unknown>
      ) => string | undefined;
      reset?: (widgetId?: string) => void;
      remove?: (widgetId?: string) => void;
    };
  }
}

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? "";

let turnstileLoader: Promise<void> | null = null;

const ensureTurnstileScript = async (): Promise<void> => {
  if (!TURNSTILE_SITE_KEY || typeof window === "undefined") return;
  if (window.turnstile) return;
  if (!turnstileLoader) {
    turnstileLoader = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `https://challenges.cloudflare.com/turnstile/v0/api.js?render=${TURNSTILE_SITE_KEY}`;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Không tải được script Turnstile"));
      document.head.appendChild(script);
    });
  }
  await turnstileLoader;
};

type UseTurnstileResult = {
  containerRef: MutableRefObject<HTMLDivElement | null>;
  token: string | null;
  error: string | null;
  ready: boolean;
  reset: () => void;
  configured: boolean;
};

export const useTurnstile = (action: string): UseTurnstileResult => {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    let retryHandle: number | null = null;

    if (!TURNSTILE_SITE_KEY) {
      setError("Thiếu cấu hình Turnstile. Vui lòng báo cho quản trị viên.");
      return () => {
        isMounted = false;
      };
    }

    setReady(false);
    setError(null);

    const attemptRender = () => {
      if (!isMounted) {
        return;
      }
      const container = containerRef.current;
      const turnstile = window.turnstile;
      if (!container || !turnstile?.render) {
        retryHandle = window.setTimeout(attemptRender, 200);
        return;
      }
      const widgetId = turnstile.render(container, {
        sitekey: TURNSTILE_SITE_KEY,
        action,
        callback: (value: string) => {
          if (!isMounted) return;
          setToken(value);
          setError(null);
        },
        "error-callback": () => {
          if (!isMounted) return;
          setToken(null);
          setError("Xác thực Turnstile thất bại, vui lòng thử lại.");
        },
        "expired-callback": () => {
          if (!isMounted) return;
          setToken(null);
          turnstile.reset?.(widgetId ?? undefined);
        },
      });
      widgetIdRef.current = widgetId ?? null;
      setReady(true);
    };

    ensureTurnstileScript()
      .then(() => {
        attemptRender();
      })
      .catch((loadError: unknown) => {
        if (!isMounted) return;
        console.error("turnstile-load", loadError);
        setError("Không thể tải Cloudflare Turnstile. Vui lòng tải lại trang.");
      });

    return () => {
      isMounted = false;
      if (retryHandle !== null) {
        window.clearTimeout(retryHandle);
      }
      const widgetId = widgetIdRef.current;
      if (widgetId && window.turnstile?.remove) {
        window.turnstile.remove(widgetId);
      }
      widgetIdRef.current = null;
    };
  }, [action]);

  const reset = useCallback(() => {
    setToken(null);
    const widgetId = widgetIdRef.current;
    if (widgetId && window.turnstile?.reset) {
      window.turnstile.reset(widgetId);
    }
  }, []);

  return {
    containerRef,
    token,
    error,
    ready,
    reset,
    configured: Boolean(TURNSTILE_SITE_KEY),
  };
};

export const getTurnstileSiteKey = (): string => TURNSTILE_SITE_KEY;
