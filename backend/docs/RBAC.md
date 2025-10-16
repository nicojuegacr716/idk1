# RBAC Overview

## Roles

| Role | Description | Default Permissions |
|------|-------------|---------------------|
| `admin` | Full administrative access | All permissions listed below |
| `moderator` | Limited management access | `user:read`, `user:update`, `user:assign-role`, `sys:status:read` |
| `user` | Baseline authenticated state | _(none)_ |

## Permissions

| Code | Description | Notes |
|------|-------------|-------|
| `user:create` | Create user records | Requires velocity controls (rate limiter) |
| `user:read` | Read user profiles | Enables admin UI listings |
| `user:update` | Modify user profile fields | Adheres to existing schema |
| `user:delete` | Remove user records | Writes audit entry + cascade role membership |
| `user:assign-role` | Attach or detach roles | Invalidates permission cache |
| `role:create` | Create new roles | Adds audit entry |
| `role:read` | Enumerate roles | Required for UI role management |
| `role:update` | Rename/describe roles | |
| `role:delete` | Drop roles | Removes role links, flushes cache |
| `role:set-perms` | Overwrite a role's permission set | Accepts list of permission codes, creates missing permissions |
| `sys:status:read` | View system and dependency health | Covers `/status/health` and `/status/deps` |
| `sys:db:read` | View database diagnostics | Used for `/status/db` |

## Data Model Additions

- `roles` - canonical role definitions (UUID primary keys, unique names)
- `permissions` - permission catalog keyed by unique code
- `role_permissions` - mapping table linking roles to permissions
- `user_roles` - mapping table linking users to roles
- `audit_logs` - immutable trail capturing actor, target, diff, IP, UA
- `service_status` - generic service health records leveraged for bootstrap state

All tables are introduced by the idempotent Alembic migration `20251002_admin_rbac` and rely on cascading foreign keys to keep data consistent when roles or users are removed.

## Caching

User permission lookups are cached via `PermissionCache`, which stores a short-lived memoization in-memory or in Redis (when `ADMIN_REDIS_URL` is configured). Any mutation that affects role assignments or permission graphs invalidates the relevant cache entries.

## Audit Trail

Every mutating API endpoint calls `record_audit`, producing a diff of before/after state. Diff payloads are persisted in `audit_logs.diff_json` as JSONB. The UI surfaces the audit feed per user or role.
