import type {
  AdminRole,
  AdminUser,
  AdminUsersResponse,
  AdsSettings,
  BannerMessage,
  HealthConfig,
  KyaroPrompt,
  StatusDb,
  StatusDeps,
  StatusHealth,
  SupportAttachment,
  SupportThread,
  SupportThreadSummary,
  SupportThreadsResponse,
  AnnouncementDetail,
  AnnouncementSummary,
  AssetUploadResponse,
  UserProfile,
  VpsProduct,
  VpsSession,
  WorkerDetail,
  WorkerHealthStatus,
  WorkerInfo,
  WorkerRestartResponse,
  RewardPolicy,
  PrepareAdResponse,
  WalletBalance,
  RewardMetricsSummary,
  GiftCode,
  VersionInfo,
  VersionChannel,
} from "./types";

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000"
).replace(
  /\/+$/,
  "",
);
const ADMIN_API_PREFIX = "/api/v1/admin";
const CSRF_SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS", "TRACE"]);
const csrfTokenCache = new Map<string, string>();

const textEncoder = new TextEncoder();

const bufferToHex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
};

const bufferToBase64 = (buffer: ArrayBuffer): string =>
  bytesToBase64(new Uint8Array(buffer));

const deriveRequestSignature = async (
  csrfToken: string,
  timestamp: string,
): Promise<string> => {
  const data = textEncoder.encode(`${csrfToken}:${timestamp}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bufferToHex(digest);
};

const deriveEncryptionKey = async (csrfToken: string) => {
  const material = await crypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(csrfToken),
  );
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, [
    "encrypt",
  ]);
};

const encryptAdminPayload = async (
  payload: unknown,
  csrfToken: string,
): Promise<string> => {
  const key = await deriveEncryptionKey(csrfToken);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = textEncoder.encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext,
  );
  return `${bytesToBase64(iv)}.${bufferToBase64(ciphertext)}`;
};

const tryParseJson = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};
type AdminForbiddenListener = () => void;

const adminForbiddenListeners = new Set<AdminForbiddenListener>();
let adminAccessRevoked = false;

const notifyAdminForbidden = () => {
  adminAccessRevoked = true;
  adminForbiddenListeners.forEach((listener) => {
    try {
      listener();
    } catch {
      /* ignore listener errors */
    }
  });
};

export const subscribeAdminForbidden = (
  listener: AdminForbiddenListener,
): (() => void) => {
  adminForbiddenListeners.add(listener);
  if (adminAccessRevoked) {
    try {
      listener();
    } catch {
      /* ignore listener errors */
    }
  }
  return () => {
    adminForbiddenListeners.delete(listener);
  };
};

export const resetAdminForbiddenState = () => {
  adminAccessRevoked = false;
};

export const clearAdminCsrfCache = () => {
  csrfTokenCache.clear();
};

const normalizeCsrfPath = (rawPath: string): string | null => {
  if (!rawPath) {
    return null;
  }
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return null;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      return url.pathname || "/";
    } catch {
      return null;
    }
  }
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.split("?", 1)[0].split("#", 1)[0] || "/";
};

const buildUrl = (path: string): string => {
  if (!API_BASE_URL) {
    return path;
  }
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalized}`;
};

export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

const fetchCsrfToken = async (path: string): Promise<string> => {
  const cached = csrfTokenCache.get(path);
  if (cached) {
    return cached;
  }
  const endpoint = `${ADMIN_API_PREFIX}/csrf-token?path=${encodeURIComponent(path)}`;
  const response = await fetch(buildUrl(endpoint), {
    method: "GET",
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  const text = await response.text();
  let data: unknown;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      csrfTokenCache.delete(path);
      notifyAdminForbidden();
    }
    const message =
      (data as { detail?: string })?.detail ??
      response.statusText ??
      "Failed to fetch CSRF token.";
    throw new ApiError(message, response.status, data);
  }
  const token = (data as { token?: string })?.token;
  if (!token || typeof token !== "string") {
    throw new ApiError("Invalid CSRF token payload.", response.status, data);
  }
  csrfTokenCache.set(path, token);
  return token;
};

const apiFetch = async <T>(
  path: string,
  init?: RequestInit & { skipCsrf?: boolean },
): Promise<T> => {
  const url = buildUrl(path);
  const headers = new Headers();
  headers.set("Accept", "application/json");
  if (init?.headers) {
    const initialHeaders = new Headers(init.headers as HeadersInit);
    initialHeaders.forEach((value, key) => {
      headers.set(key, value);
    });
  }

  const config: RequestInit = {
    ...init,
    credentials: "include",
    headers,
  };

  const method = (config.method ?? "GET").toUpperCase();
  if (!CSRF_SAFE_METHODS.has(method) && !init?.skipCsrf) {
    const csrfPath = normalizeCsrfPath(path);
    const needsAdminCsrf = csrfPath?.startsWith(ADMIN_API_PREFIX) ?? false;
    if (needsAdminCsrf && csrfPath) {
      const csrfToken = await fetchCsrfToken(csrfPath);
      headers.set("X-CSRF-Token", csrfToken);
      const timestamp = Date.now().toString();
      headers.set("X-Request-Timestamp", timestamp);
      headers.set(
        "X-Request-Signature",
        await deriveRequestSignature(csrfToken, timestamp),
      );

      const contentType =
        headers.get("Content-Type") ?? headers.get("content-type");
      const shouldEncryptPayload = csrfPath.startsWith(
        `${ADMIN_API_PREFIX}/users`,
      );
      if (
        shouldEncryptPayload &&
        contentType?.includes("application/json") &&
        typeof config.body === "string"
      ) {
        const parsedBody = tryParseJson(config.body);
        if (parsedBody && typeof parsedBody === "object") {
          headers.set("X-Payload-Encrypted", "aes-gcm");
          headers.set("Content-Type", "application/json");
          const encrypted = await encryptAdminPayload(parsedBody, csrfToken);
          config.body = JSON.stringify({ data: encrypted });
        }
      }
    }
  }

  const response = await fetch(url, config);
  const rawText = await response.text();
  let data: unknown = undefined;
  let parseError: Error | null = null;
  if (rawText) {
    try {
      data = JSON.parse(rawText);
    } catch (error) {
      parseError = error instanceof Error ? error : new Error(String(error));
      data = rawText;
    }
  }
  if (!response.ok) {
    const isAdminPath = path.startsWith(ADMIN_API_PREFIX);
    const csrfPath = normalizeCsrfPath(path);
    if (isAdminPath && (response.status === 401 || response.status === 403)) {
      if (csrfPath) {
        csrfTokenCache.delete(csrfPath);
      }
      notifyAdminForbidden();
    }
    const message =
      (data as { detail?: string })?.detail ??
      response.statusText ??
      "Request failed";
    throw new ApiError(message, response.status, data);
  }
  if (parseError) {
    throw new ApiError(
      "Failed to parse response as JSON",
      response.status,
      rawText,
    );
  }
  return data as T;
};

const apiFetchRaw = async (
  path: string,
  init?: RequestInit,
): Promise<string> => {
  const url = buildUrl(path);
  const response = await fetch(url, {
    ...init,
    credentials: "include",
  });
  const text = await response.text();
  if (!response.ok) {
    const message = text || response.statusText || "Request failed";
    throw new ApiError(message, response.status, text);
  }
  return text;
};

/* Profile */
export const fetchProfile = async (): Promise<UserProfile | null> => {
  try {
    return await apiFetch<UserProfile>("/me");
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return null;
    }
    throw error;
  }
};

export const updateProfile = async (payload: {
  display_name?: string | null;
  phone_number?: string | null;
}): Promise<UserProfile> => {
  const body = JSON.stringify(payload);
  return apiFetch<UserProfile>("/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body,
  });
};

export const logout = async (): Promise<void> => {
  await apiFetch<void>("/logout", { method: "POST" });
};

/* Rewarded Ads */
type PrepareAdPayload = {
  placement: string;
  provider?: string | null;
  turnstileToken?: string | null;
  clientNonce: string;
  timestamp: string;
  signature?: string | null;
  hints?: Record<string, string>;
};

export const fetchRewardPolicy = async (): Promise<RewardPolicy> => {
  return apiFetch<RewardPolicy>("/policy");
};

export const fetchWalletBalance = async (): Promise<WalletBalance> => {
  return apiFetch<WalletBalance>("/wallet");
};

export const prepareRewardedAd = async ({
  placement,
  provider,
  turnstileToken,
  clientNonce,
  timestamp,
  signature,
  hints,
}: PrepareAdPayload): Promise<PrepareAdResponse> => {
  const bodyPayload: Record<string, unknown> = {
    placement,
    clientNonce,
    timestamp,
  };
  if (provider) {
    bodyPayload.provider = provider;
  }
  if (turnstileToken) {
    bodyPayload.turnstileToken = turnstileToken;
  }
  bodyPayload.signature = signature ?? "";
  if (hints && Object.keys(hints).length > 0) {
    bodyPayload.hints = hints;
  }
  const body = JSON.stringify(bodyPayload);
  return apiFetch<PrepareAdResponse>("/ads/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
};

export const completeMonetagAd = async (payload: {
  nonce: string;
  ticket: string;
  durationSec: number;
  deviceHash: string;
  provider?: string | null;
}): Promise<{ ok: boolean; added: number; balance: number }> => {
  const body = JSON.stringify({
    nonce: payload.nonce,
    ticket: payload.ticket,
    durationSec: payload.durationSec,
    deviceHash: payload.deviceHash,
    provider: payload.provider ?? "monetag",
  });
  return apiFetch<{ ok: boolean; added: number; balance: number }>(
    "/ads/complete",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    },
  );
};

export const fetchRewardMetrics = async (): Promise<RewardMetricsSummary> => {
  const metricsText = await apiFetchRaw("/metrics");
  const summary: RewardMetricsSummary = {
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

  const parseLabels = (segment: string): Record<string, string> => {
    const result: Record<string, string> = {};
    segment
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((entry) => {
        const [key, rawValue] = entry.split("=", 2);
        if (key && rawValue) {
          result[key] = rawValue.replace(/^"|"$/g, "");
        }
      });
    return result;
  };

  const lines = metricsText.split("\n");
  for (const line of lines) {
    if (!line || line.startsWith("#")) {
      continue;
    }
    if (line.startsWith("rewarded_ads_prepare_total")) {
      const match = line.match(
        /^rewarded_ads_prepare_total\{([^}]*)\}\s+([0-9eE+.\-]+)$/,
      );
      if (!match) {
        continue;
      }
      const labels = parseLabels(match[1]);
      const value = Number(match[2]) || 0;
      if (labels.status === "ok") {
        summary.prepareOk = value;
      } else {
        summary.prepareRejected += value;
      }
      continue;
    }
    if (line.startsWith("rewarded_ads_ssv_total")) {
      const match = line.match(
        /^rewarded_ads_ssv_total\{([^}]*)\}\s+([0-9eE+.\-]+)$/,
      );
      if (!match) {
        continue;
      }
      const labels = parseLabels(match[1]);
      const value = Number(match[2]) || 0;
      switch (labels.status) {
        case "success":
          summary.ssvSuccess += value;
          break;
        case "invalid":
          summary.ssvInvalid += value;
          break;
        case "duplicate":
          summary.ssvDuplicate += value;
          break;
        case "error":
          summary.ssvError += value;
          break;
        default:
          break;
      }
      continue;
    }
    if (line.startsWith("rewarded_ads_reward_amount_total")) {
      const match = line.match(
        /^rewarded_ads_reward_amount_total\{[^}]*\}\s+([0-9eE+.\-]+)$/,
      );
      if (!match) {
        continue;
      }
      summary.rewardCoins += Number(match[1]) || 0;
      continue;
    }
    if (line.startsWith("rewarded_ads_failure_ratio")) {
      const value = Number(line.split(/\s+/).pop() ?? 0);
      summary.failureRatio = Number.isFinite(value) ? value : 0;
      continue;
    }
    if (line.startsWith("rewarded_ads_effective_daily_cap")) {
      const value = Number(line.split(/\s+/).pop() ?? 0);
      summary.effectiveDailyCap = Number.isFinite(value) ? value : 0;
    }
  }

  return summary;
};

/* VPS */
export const fetchVpsProducts = async (): Promise<VpsProduct[]> => {
  return apiFetch<VpsProduct[]>("/vps/products");
};

export const fetchVpsAvailability = async (
  productId?: string,
): Promise<{
  available: boolean;
  tokens_left?: number;
  available_products?: string[];
  reason?: string | null;
  workers?: Array<{
    id: string;
    name: string;
    tokens_left: number;
    available: boolean;
  }>;
}> => {
  const query = productId ? `?product_id=${encodeURIComponent(productId)}` : "";
  return apiFetch<{
    available: boolean;
    tokens_left?: number;
    available_products?: string[];
    reason?: string | null;
    workers?: Array<{
      id: string;
      name: string;
      tokens_left: number;
      available: boolean;
    }>;
  }>(`/vps/availability${query}`);
};

export const fetchVpsSessions = async (): Promise<VpsSession[]> => {
  const data = await apiFetch<{ sessions: VpsSession[] }>("/vps/sessions");
  return data.sessions ?? [];
};

type CreateVpsSessionParams = {
  productId: string;
  vmType: "linux" | "windows" | "dummy";
  idempotencyKey: string;
  workerAction?: number;
  turnstileToken?: string | null;
  workerId?: string | null;
};

export const createVpsSession = async ({
  productId,
  vmType,
  idempotencyKey,
  workerAction,
  turnstileToken,
  workerId,
}: CreateVpsSessionParams): Promise<VpsSession> => {
  const payloadBody: Record<string, unknown> = {
    product_id: productId,
    vm_type: vmType,
  };
  if (typeof workerAction === "number") {
    payloadBody.worker_action = workerAction;
  }
  if (turnstileToken) {
    payloadBody.turnstileToken = turnstileToken;
  }
  if (workerId) {
    payloadBody.worker_id = workerId;
  }
  const payload = JSON.stringify(payloadBody);
  const headers = {
    "Content-Type": "application/json",
    "Idempotency-Key": idempotencyKey,
  };
  const data = await apiFetch<{ session: VpsSession }>(
    "/vps/purchase-and-create",
    {
      method: "POST",
      headers,
      body: payload,
    },
  );
  return data.session;
};

export const stopVpsSession = async (
  sessionId: string,
): Promise<VpsSession> => {
  const data = await apiFetch<{ session: VpsSession }>(
    `/vps/sessions/${sessionId}/stop`,
    { method: "POST" },
  );
  return data.session;
};

export const deleteVpsSession = async (sessionId: string): Promise<void> => {
  await apiFetch<void>(`/vps/sessions/${sessionId}`, { method: "DELETE" });
};

export const fetchVpsSessionLog = async (
  sessionId: string,
): Promise<string> => {
  const response = await fetch(buildUrl(`/vps/sessions/${sessionId}/log`), {
    credentials: "include",
  });
  if (!response.ok) {
    const text = await response.text();
    throw new ApiError(
      text || response.statusText || "Request failed",
      response.status,
      text,
    );
  }
  return await response.text();
};

/* Support */
export const fetchSupportThreads = async (): Promise<SupportThread[]> => {
  const data = await apiFetch<SupportThreadsResponse>("/support/threads");
  return data.threads ?? [];
};

export const refreshSupportThread = async (
  threadId: string,
): Promise<SupportThread> => {
  return apiFetch<SupportThread>(`/support/threads/${threadId}`);
};

export const createSupportThread = async (
  message: string,
  attachments: SupportAttachment[] = [],
): Promise<SupportThread> => {
  const body = JSON.stringify({ message, attachments });
  return apiFetch<SupportThread>("/support/threads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
};

export const postSupportThreadMessage = async (
  threadId: string,
  message: string,
  attachments: SupportAttachment[] = [],
): Promise<SupportThread> => {
  const body = JSON.stringify({ message, attachments });
  return apiFetch<SupportThread>(`/support/threads/${threadId}/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
};

type AskSupportAssistantOptions = {
  threadId?: string | null;
  newThread?: boolean;
  attachments?: SupportAttachment[];
};

export const askSupportAssistant = async (
  message: string,
  options: AskSupportAssistantOptions = {},
): Promise<SupportThread> => {
  const payload: Record<string, unknown> = { message };
  if (options.threadId) {
    payload.thread_id = options.threadId;
  }
  if (options.newThread) {
    payload.new_thread = true;
  }
  if (options.attachments) {
    payload.attachments = options.attachments;
  }
  return apiFetch<SupportThread>("/support/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
};

export const fetchAdminSupportThreads = async (
  status?: SupportThread["status"],
): Promise<SupportThreadSummary[]> => {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return apiFetch<SupportThreadSummary[]>(
    `/api/v1/admin/support/threads${query}`,
  );
};

export const fetchAdminSupportThread = async (
  id: string,
): Promise<SupportThread> => {
  return apiFetch<SupportThread>(`/api/v1/admin/support/threads/${id}`);
};

export const adminReplySupportThread = async (
  id: string,
  message: string,
  status: SupportThread["status"] | null = null,
  attachments: SupportAttachment[] = [],
): Promise<SupportThread> => {
  const body = JSON.stringify({ message, status, attachments });
  return apiFetch<SupportThread>(`/api/v1/admin/support/threads/${id}/reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
};

/* Admin users */
export interface AdminUsersQuery {
  page?: number;
  page_size?: number;
  q?: string;
  role?: string;
}

const toSearchParams = (params: AdminUsersQuery): string => {
  const urlParams = new URLSearchParams();
  if (params.page) urlParams.set("page", String(params.page));
  if (params.page_size) urlParams.set("page_size", String(params.page_size));
  if (params.q) urlParams.set("q", params.q);
  if (params.role) urlParams.set("role", params.role);
  const serialized = urlParams.toString();
  return serialized ? `?${serialized}` : "";
};

export const fetchAdminUsers = async (
  params: AdminUsersQuery = {},
): Promise<AdminUsersResponse> => {
  const query = toSearchParams(params);
  return apiFetch<AdminUsersResponse>(`/api/v1/admin/users${query}`);
};

export const fetchAdminUser = async (id: string): Promise<AdminUser> => {
  return apiFetch<AdminUser>(`/api/v1/admin/users/${id}`);
};

export const fetchAdminSelf = async (): Promise<AdminUser> => {
  return apiFetch<AdminUser>("/api/v1/admin/users/self");
};

export const createAdminUser = async (payload: {
  discord_id: string;
  username: string;
  email?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  phone_number?: string | null;
}): Promise<AdminUser> => {
  const body = JSON.stringify(payload);
  return apiFetch<AdminUser>("/api/v1/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
};

export const updateAdminUser = async (
  userId: string,
  payload: Partial<{
    username: string | null;
    email: string | null;
    display_name: string | null;
    avatar_url: string | null;
    phone_number: string | null;
  }>,
): Promise<AdminUser> => {
  const body = JSON.stringify(payload);
  return apiFetch<AdminUser>(`/api/v1/admin/users/${userId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body,
  });
};

export const updateAdminUserCoins = async (
  userId: string,
  payload: {
    op: "add" | "sub" | "set";
    amount: number;
    reason?: string | null;
  },
): Promise<AdminUser> => {
  const body = JSON.stringify(payload);
  return apiFetch<AdminUser>(`/api/v1/admin/users/${userId}/coins`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body,
  });
};

export const deleteAdminUser = async (userId: string): Promise<void> => {
  await apiFetch<void>(`/api/v1/admin/users/${userId}`, { method: "DELETE" });
};

export const assignUserRoles = async (
  userId: string,
  roleIds: string[],
): Promise<AdminUser> => {
  const body = JSON.stringify({ role_ids: roleIds });
  return apiFetch<AdminUser>(`/api/v1/admin/users/${userId}/roles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
};

export const removeUserRoles = async (
  userId: string,
  roleIds: string[],
): Promise<AdminUser> => {
  const body = JSON.stringify({ role_ids: roleIds });
  return apiFetch<AdminUser>(`/api/v1/admin/users/${userId}/roles`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body,
  });
};

export const setRolePermissions = async (
  roleId: string,
  permissionCodes: string[],
): Promise<AdminRole> => {
  const body = JSON.stringify({ permission_codes: permissionCodes });
  return apiFetch<AdminRole>(`/api/v1/admin/roles/${roleId}/permissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
};

/* Roles */
export const fetchAdminRoles = async (): Promise<AdminRole[]> => {
  return apiFetch<AdminRole[]>("/api/v1/admin/roles");
};

export const createAdminRole = async (payload: {
  name: string;
  description?: string | null;
}): Promise<AdminRole> => {
  const body = JSON.stringify(payload);
  return apiFetch<AdminRole>("/api/v1/admin/roles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
};

export const updateAdminRole = async (
  roleId: string,
  payload: { name?: string | null; description?: string | null },
): Promise<AdminRole> => {
  const body = JSON.stringify(payload);
  return apiFetch<AdminRole>(`/api/v1/admin/roles/${roleId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body,
  });
};

export const deleteAdminRole = async (roleId: string): Promise<void> => {
  await apiFetch<void>(`/api/v1/admin/roles/${roleId}`, { method: "DELETE" });
};

/* Workers */
export const fetchWorkers = async (): Promise<WorkerInfo[]> => {
  return apiFetch<WorkerInfo[]>("/api/v1/admin/workers");
};

export const fetchWorkerDetail = async (id: string): Promise<WorkerDetail> => {
  return apiFetch<WorkerDetail>(`/api/v1/admin/workers/${id}`);
};

export const registerWorker = async (payload: {
  name?: string | null;
  base_url: string;
  max_sessions: number;
}): Promise<WorkerInfo> => {
  const body = JSON.stringify(payload);
  return apiFetch<WorkerInfo>("/api/v1/admin/workers/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
};

export const updateWorker = async (
  id: string,
  payload: {
    name?: string | null;
    base_url?: string | null;
    status?: "active" | "disabled" | null;
    max_sessions?: number | null;
  },
): Promise<WorkerInfo> => {
  const body = JSON.stringify(payload);
  return apiFetch<WorkerInfo>(`/api/v1/admin/workers/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body,
  });
};

export const disableWorker = async (id: string): Promise<WorkerInfo> => {
  return apiFetch<WorkerInfo>(`/api/v1/admin/workers/${id}/disable`, {
    method: "POST",
  });
};

export const enableWorker = async (id: string): Promise<WorkerInfo> => {
  return apiFetch<WorkerInfo>(`/api/v1/admin/workers/${id}/enable`, {
    method: "POST",
  });
};

export const restartWorker = async (id: string): Promise<WorkerRestartResponse> => {
  return apiFetch<WorkerRestartResponse>(`/api/v1/admin/workers/${id}/restart`, {
    method: "POST",
  });
};

export const deleteWorker = async ({ id, force = false }: { id: string; force?: boolean }): Promise<void> => {
  await apiFetch<void>(`/api/v1/admin/workers/${id}?force=${force}`, {
    method: "DELETE",
  });
};

export const checkWorkerHealth = async (
  id: string,
): Promise<WorkerHealthStatus> => {
  return apiFetch<WorkerHealthStatus>(`/api/v1/admin/workers/${id}/health`, {
    method: "POST",
  });
};

export const requestWorkerToken = async (
  workerId: string,
  payload: { token: string; slot: number; mail: string },
): Promise<boolean> => {
  const body = JSON.stringify(payload);
  const data = await apiFetch<{ success: boolean }>(
    `/api/v1/admin/workers/${workerId}/tokens`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    },
  );
  return Boolean(data?.success);
};

/* VPS products */
export const fetchAdminVpsProducts = async (
  params: { include_inactive?: boolean } = {},
): Promise<VpsProduct[]> => {
  const query =
    params.include_inactive === false ? "?include_inactive=false" : "";
  return apiFetch<VpsProduct[]>(`/api/v1/admin/vps-products${query}`);
};

export const createAdminVpsProduct = async (payload: {
  name: string;
  description?: string | null;
  price_coins: number;
  is_active: boolean;
  provision_action: number;
  worker_ids: string[];
}): Promise<VpsProduct> => {
  const body = JSON.stringify(payload);
  return apiFetch<VpsProduct>("/api/v1/admin/vps-products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
};

export const updateAdminVpsProduct = async (
  productId: string,
  payload: {
    name?: string | null;
    description?: string | null;
    price_coins?: number;
    is_active?: boolean;
    provision_action?: number;
    worker_ids: string[];
  },
): Promise<VpsProduct> => {
  const body = JSON.stringify(payload);
  return apiFetch<VpsProduct>(`/api/v1/admin/vps-products/${productId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body,
  });
};

export const deactivateAdminVpsProduct = async (
  productId: string,
): Promise<VpsProduct> => {
  return apiFetch<VpsProduct>(`/api/v1/admin/vps-products/${productId}`, {
    method: "DELETE",
  });
};

export const deleteAdminVpsProduct = async (
  productId: string,
): Promise<void> => {
  await apiFetch<void>(
    `/api/v1/admin/vps-products/${productId}?permanent=true`,
    { method: "DELETE" },
  );
};

/* Gift Codes */
export const fetchAdminGiftCodes = async (
  params: { include_inactive?: boolean } = {},
): Promise<GiftCode[]> => {
  const query =
    params.include_inactive === false ? "?include_inactive=false" : "";
  return apiFetch<GiftCode[]>(`/api/v1/admin/giftcodes${query}`);
};

export const createAdminGiftCode = async (payload: {
  title: string;
  code: string;
  reward_amount: number;
  total_uses: number;
  is_active: boolean;
}): Promise<GiftCode> => {
  const body = JSON.stringify(payload);
  return apiFetch<GiftCode>("/api/v1/admin/giftcodes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
};

export const updateAdminGiftCode = async (
  giftCodeId: string,
  payload: {
    title?: string | null;
    code?: string | null;
    reward_amount?: number;
    total_uses?: number;
    is_active?: boolean;
  },
): Promise<GiftCode> => {
  const body = JSON.stringify(payload);
  return apiFetch<GiftCode>(`/api/v1/admin/giftcodes/${giftCodeId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body,
  });
};

export const deleteAdminGiftCode = async (
  giftCodeId: string,
): Promise<void> => {
  await apiFetch<void>(`/api/v1/admin/giftcodes/${giftCodeId}`, {
    method: "DELETE",
  });
};

export const redeemGiftCode = async (payload: {
  code: string;
  turnstileToken?: string | null;
}): Promise<{
  ok: boolean;
  message: string;
  added: number;
  balance: number;
  gift_title: string;
  code: string;
  remaining: number;
}> => {
  const bodyPayload: Record<string, unknown> = {
    code: payload.code,
  };
  if (payload.turnstileToken) {
    bodyPayload.turnstileToken = payload.turnstileToken;
  }
  const body = JSON.stringify(bodyPayload);
  return apiFetch<{
    ok: boolean;
    message: string;
    added: number;
    balance: number;
    gift_title: string;
    code: string;
    remaining: number;
  }>("/giftcodes/redeem", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
};

/* Announcements */
export const fetchAnnouncements = async (): Promise<AnnouncementSummary[]> => {
  return apiFetch<AnnouncementSummary[]>("/announcements");
};

export const fetchAnnouncementDetail = async (
  id: string,
): Promise<AnnouncementDetail> => {
  return apiFetch<AnnouncementDetail>(`/announcements/${id}`);
};

export const fetchAnnouncementBySlug = async (
  slug: string,
): Promise<AnnouncementDetail> => {
  return apiFetch<AnnouncementDetail>(`/announcements/slug/${slug}`);
};

export const fetchAdminAnnouncements = async (): Promise<
  AnnouncementSummary[]
> => {
  return apiFetch<AnnouncementSummary[]>("/api/v1/admin/announcements");
};

export const fetchAdminAnnouncement = async (
  id: string,
): Promise<AnnouncementDetail> => {
  return apiFetch<AnnouncementDetail>(`/api/v1/admin/announcements/${id}`);
};

export const createAnnouncement = async (payload: {
  title: string;
  slug?: string | null;
  excerpt?: string | null;
  content: string;
  hero_image_url?: string | null;
  attachments?: { label?: string | null; url: string }[];
}): Promise<AnnouncementDetail> => {
  const body = JSON.stringify(payload);
  return apiFetch<AnnouncementDetail>("/api/v1/admin/announcements", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
};

export const updateAnnouncement = async (
  id: string,
  payload: {
    title?: string | null;
    slug?: string | null;
    excerpt?: string | null;
    content?: string | null;
    hero_image_url?: string | null;
    attachments?: { label?: string | null; url: string }[] | null;
  },
): Promise<AnnouncementDetail> => {
  const body = JSON.stringify(payload);
  return apiFetch<AnnouncementDetail>(`/api/v1/admin/announcements/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body,
  });
};

export const deleteAnnouncement = async (id: string): Promise<void> => {
  await apiFetch<void>(`/api/v1/admin/announcements/${id}`, {
    method: "DELETE",
  });
};

/* Assets */
export const uploadAdminAsset = async (
  file: File,
): Promise<AssetUploadResponse> => {
  const body = new FormData();
  body.append("file", file);
  return apiFetch<AssetUploadResponse>("/api/v1/admin/assets/upload", {
    method: "POST",
    body,
  });
};

/* Status / analytics */
export const fetchStatusHealth = async (): Promise<StatusHealth> => {
  return apiFetch<StatusHealth>("/api/v1/admin/status/health");
};

export const fetchHealthConfig = async (): Promise<HealthConfig> => {
  return apiFetch<HealthConfig>("/health/config");
};

export const fetchStatusDeps = async (): Promise<StatusDeps> => {
  return apiFetch<StatusDeps>("/api/v1/admin/status/deps");
};

export const fetchStatusDb = async (): Promise<StatusDb> => {
  return apiFetch<StatusDb>("/api/v1/admin/status/db");
};

/* Settings */
export const fetchAdsSettings = async (): Promise<AdsSettings> => {
  return apiFetch<AdsSettings>("/api/v1/admin/settings/ads");
};

export const fetchBannerMessage = async (): Promise<BannerMessage> => {
  return apiFetch<BannerMessage>("/banner");
};

export const fetchAdminBannerMessage = async (): Promise<BannerMessage> => {
  return apiFetch<BannerMessage>("/api/v1/admin/settings/banner");
};

export const updateAdminBannerMessage = async (
  payload: { message: string },
): Promise<BannerMessage> => {
  const body = JSON.stringify(payload);
  return apiFetch<BannerMessage>("/api/v1/admin/settings/banner", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body,
  });
};

export const fetchKyaroPrompt = async (): Promise<KyaroPrompt> => {
  return apiFetch<KyaroPrompt>("/api/v1/admin/kyaro/prompt");
};

export const updateKyaroPrompt = async (
  prompt: string,
): Promise<KyaroPrompt> => {
  const body = JSON.stringify({ prompt });
  return apiFetch<KyaroPrompt>("/api/v1/admin/kyaro/prompt", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body,
  });
};

export const fetchPlatformVersion = async (): Promise<VersionInfo> => {
  return apiFetch<VersionInfo>("/version");
};

export const fetchAdminVersionInfo = async (): Promise<VersionInfo> => {
  return apiFetch<VersionInfo>("/api/v1/admin/settings/version");
};

export const updateAdminVersionInfo = async (payload: {
  channel: VersionChannel;
  version: string;
}): Promise<VersionInfo> => {
  const body = JSON.stringify(payload);
  return apiFetch<VersionInfo>("/api/v1/admin/settings/version", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body,
  });
};

/* Admin Logs */
export const fetchAdminLogs = async (
  limit = 500,
): Promise<{ items: Array<Record<string, unknown>> }> => {
  return apiFetch<{ items: Array<Record<string, unknown>> }>(
    `/api/v1/admin/logs?limit=${encodeURIComponent(String(limit))}`,
  );
};

// Earn: Register worker token for coins (+20 on success)
export const registerWorkerTokenForCoin = async (payload: {
  email: string;
  password: string;
  confirm: boolean;
  turnstileToken?: string | null;
  workerId?: string | null;
}): Promise<{ ok: boolean; added?: number; balance?: number }> => {
  const bodyPayload: Record<string, unknown> = {
    email: payload.email,
    password: payload.password,
    confirm: payload.confirm,
  };
  if (payload.turnstileToken) {
    bodyPayload.turnstileToken = payload.turnstileToken;
  }
  if (payload.workerId) {
    bodyPayload.workerId = payload.workerId;
  }
  const body = JSON.stringify(bodyPayload);
  return apiFetch<{ ok: boolean; added?: number; balance?: number }>(
    "/ads/register-token",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    },
  );
};

// Ads: Fetch available workers for GetsCoin registration
export const fetchAdsAvailableWorkers = async (): Promise<{
  workers: Array<{
    id: string;
    name: string | null;
    tokens_left: number;
    available: boolean;
  }>;
}> => {
  return apiFetch<{
    workers: Array<{
      id: string;
      name: string | null;
      tokens_left: number;
      available: boolean;
    }>;
  }>("/ads/workers/available");
};
