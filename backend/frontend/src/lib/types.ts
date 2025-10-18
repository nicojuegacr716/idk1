export interface UserProfile {
  id: string;
  email: string | null;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  phone_number: string | null;
  coins: number;
}

export interface ChecklistItem {
  key: string | null;
  label: string | null;
  done: boolean;
  ts: string | null;
  meta?: Record<string, unknown> | null;\n  attachments?: SupportAttachment[];
}

export interface VpsProduct {
  id: string;
  name: string;
  description: string | null;
  price_coins: number;
  provision_action?: number;
  is_active?: boolean;
  created_at?: string | null;
  updated_at?: string | null;
  workers?: WorkerInfo[];
}

export interface VpsSessionRdp {
  host: string | null;
  port: number | null;
  user: string | null;
  password: string | null;
}

export interface VpsSessionProductSummary {
  id: string;
  name?: string | null;
  description?: string | null;
  price_coins?: number | null;
}

export interface VpsSession {
  id: string;
  status: string;
  checklist: ChecklistItem[];
  created_at: string | null;
  updated_at: string | null;
  expires_at: string | null;
  product: VpsSessionProductSummary | null;
  worker_id: string | null;
  stream?: string;
  rdp?: VpsSessionRdp;
  has_log?: boolean;
}

export interface AnnouncementAttachment {
  label?: string | null;
  url: string;
}

export interface AnnouncementSummary {
  id: string;
  slug: string;
  title: string;
  excerpt?: string | null;
  hero_image_url?: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface AnnouncementDetail extends AnnouncementSummary {
  content: string;
  attachments: AnnouncementAttachment[];
  created_by?: string | null;
}

export interface SupportAttachment {
  url: string;
  label?: string | null;
  kind?: "link" | "image" | "file" | null;
}

export interface SupportMessage {
  id: string;
  sender: "user" | "ai" | "admin";
  role: string | null;
  content: string | null;
  meta?: Record<string, unknown> | null;
  attachments?: SupportAttachment[];
  created_at: string | null;
}

export interface SupportThread {
  id: string;
  source: "ai" | "human";
  status: "open" | "pending" | "resolved" | "closed";
  created_at: string | null;
  updated_at: string | null;
  user_id?: string | null;
  messages: SupportMessage[];
}

export interface SupportThreadSummary {
  id: string;
  user_id: string | null;
  source: "ai" | "human";
  status: "open" | "pending" | "resolved" | "closed";
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
}

export interface SupportThreadsResponse {
  threads: SupportThread[];
}

export interface Permission {
  id: string;
  code: string;
  description: string | null;
}

export interface RoleSummary {
  id: string;
  name: string;
}

export interface AdminRole extends RoleSummary {
  description?: string | null;
  created_at?: string;
  updated_at?: string;
  permissions?: Permission[];
}

export interface AdminUser {
  id: string;
  username: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  discord_id: string;
  phone_number: string | null;
  coins: number;
  roles: RoleSummary[];
}

export interface AdminUserListItem {
  id: string;
  username: string;
  email_masked: string | null;
  display_name: string | null;
  avatar_url: string | null;
  coins: number;
  discord_id_suffix: string | null;
  roles: RoleSummary[];
}

export interface AdminUsersResponse {
  items: AdminUserListItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface WorkerEndpointsInfo {
  health: string;
  login: string;
  create_vm: string;
  stop_template: string;
  log_template: string;
}

export interface WorkerInfo {
  id: string;
  name: string | null;
  base_url: string;
  status: string;
  max_sessions: number;
  active_sessions: number;
  created_at: string;
  updated_at: string;
  actions?: string[];
}

export interface WorkerDetail extends WorkerInfo {
  endpoints: WorkerEndpointsInfo;
}

export interface WorkerHealthStatus {
  ok: boolean;
  latency_ms?: number | null;
  payload?: Record<string, unknown> | null;
}

export interface AdsSettings {
  enabled: boolean;
}

export interface KyaroPrompt {
  prompt: string;
  version: number | null;
  updated_at: string | null;
  updated_by: string | null;
}

export interface StatusHealth {
  api_up: boolean;
  version: string | null;
  build_time: string | null;
}

export interface HealthConfig {
  allowed_origins: string[];
  allow_credentials: boolean;
}

export interface StatusDeps {
  db_ping_ms: number | null;
  redis_ping_ms: number | null;
  disk_free_mb: number | null;
  cpu_percent: number | null;
  memory_percent: number | null;
}

export interface SlowQuery {
  query: string;
  duration_ms: number;
}

export interface StatusDb {
  version: string | null;
  active_connections: number | null;
  slow_queries: SlowQuery[];
  last_migration: string | null;
}
