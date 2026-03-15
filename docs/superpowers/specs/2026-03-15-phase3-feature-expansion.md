# Phase 3: Feature Expansion — Design Specification

**Date:** 2026-03-15
**Status:** Approved
**Scope:** API key management UI, multi-tenancy (organizations), alert notifications, LLM content viewer

---

## Overview

Phase 3 transforms Tracion from a personal observability tool into a team-ready platform. It adds the features most commonly requested by AI teams: self-managed API keys, organization-level data isolation, cost/error alerting, and full LLM message content viewing.

**Schema note:** BetterAuth uses the `public` schema (not a dedicated `auth` schema). All new tables in this spec are created in `public` unless otherwise noted. The existing BetterAuth tables are `public.user`, `public.session`, `public.account`.

**Build order within Phase 3:**
1. API Key Management UI
2. LLM Content Viewer (standalone frontend, no backend changes)
3. Multi-tenancy / Organizations
4. Alert Notifications (depends on organizations)

---

## Feature 1 — API Key Management UI

### Problem

API keys are currently validated against a single env-var (`TRACION_API_KEY`). There is no way for users to create or revoke keys from the UI. SDK and MCP users need self-service key management.

### DB Migration

```sql
-- Migration: 0002_api_keys.sql
CREATE TABLE IF NOT EXISTS public.api_keys (
  id          TEXT PRIMARY KEY,             -- ULID
  user_id     TEXT NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  -- org_id column added later in Feature 3 migration (0004_organizations.sql)
  name        TEXT NOT NULL,
  key_hash    TEXT NOT NULL UNIQUE,         -- Bun.password hash (bcrypt)
  key_prefix  TEXT NOT NULL,               -- first 8 chars, for display only
  last_used   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ                  -- NULL = active
);
CREATE INDEX ON public.api_keys (user_id) WHERE revoked_at IS NULL;
```

### Auth Middleware Rewrite

Current `requireAuth` validates against a single env-var. It must be rewritten to:

1. Extract key from `X-Tracion-Api-Key` header
2. Look up `api_keys` rows by `key_prefix` (first 8 chars of submitted key) where `revoked_at IS NULL`
3. For each candidate row, run `Bun.password.verify(submittedKey, row.key_hash)`
4. On match: set `user_id` on context, update `last_used = now()` async (fire-and-forget), continue
5. On no match: fall through to session check (BetterAuth session cookie), then 401

**DB injection:** `requireAuth` receives `db` as a factory argument:
```ts
export const makeRequireAuth = (db: Database) => createMiddleware(async (c, next) => { ... })
```
Called in `apps/api/src/index.ts` as `app.use('/trpc/*', makeRequireAuth(db))`.

**Hashing library:** `Bun.password` (built-in, bcrypt algorithm). No additional dependency.

**Performance:** The prefix-lookup approach ensures at most 1 bcrypt comparison per request (prefix is a fast indexed lookup; bcrypt only runs on the matched candidate).

**Dev bypass preserved:** If no key header and no session cookie, AND `NODE_ENV === 'development'` and `TRACION_DEV_BYPASS=true`, allow request through (existing behavior).

### tRPC Procedures (new router: `apiKeys`)

- `apiKeys.list()` → returns `{ id, name, keyPrefix, lastUsed, createdAt }[]` for current user (never the raw key)
- `apiKeys.create(name: string)` → generates a `tracion_` prefixed random key (32 bytes hex), bcrypt hashes it, inserts row, returns `{ id, rawKey }` — raw key shown ONCE
- `apiKeys.revoke(id: string)` → sets `revoked_at = now()` for the key owned by current user

### UI Page: `/settings/api-keys`

- Table: name, prefix (e.g. `tracion_ab12ef34…`), created date, last used, Revoke button
- "Create API Key" button → modal → name input → submit → success modal showing raw key with copy button and warning "This key will not be shown again"
- Revoke: confirmation dialog → `apiKeys.revoke(id)` mutation
- Settings layout: new sidebar section "Settings" in `apps/web/components/nav/sidebar.tsx`

---

## Feature 2 — LLM Content Viewer

### Problem

Span attributes contain raw LLM prompts and completions but are only visible as collapsed JSON. Developers need a conversation-style view.

### Design

**No backend changes required.** Attribute data is already stored in `otel.spans.attributes` JSON column.

**SpanAttributes component enhancement (`apps/web/components/trace/span-attributes.tsx`):**

When `span.kind === 'llm'`, add a "Messages" tab:

```
[Overview] [Messages] [Raw Attributes]
```

**OTel attribute keys to check (in order):**
1. `gen_ai.prompt` — JSON array of `{ role, content }` objects (OpenAI-style)
2. `llm.input_messages` — alternative key used by some SDKs
3. Fallback: display "No message content available"

Output: `gen_ai.completion` or `llm.output_messages`.

**Messages tab rendering:**
- Each message is a bubble: `system` = gray full-width, `user` = right-aligned blue, `assistant` = left-aligned gray, `tool` = monospace collapsible
- Messages > 300 chars: truncated with "Show more" toggle
- JSON content (tool calls, structured outputs): rendered in `<pre>` with syntax highlighting via `highlight.js` (already in web deps, or add if missing)

---

## Feature 3 — Multi-tenancy / Organizations

### Problem

All authenticated users see all traces. Teams need per-organization data isolation.

### DB Migration (`0004_organizations.sql`)

```sql
-- Run after 0002_api_keys.sql
-- Note: active_org_id on session is added at the END of this file (after organizations is created)

CREATE TABLE IF NOT EXISTS public.organizations (
  id         TEXT PRIMARY KEY,    -- ULID
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.org_members (
  org_id     TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member',  -- 'owner' | 'admin' | 'member'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);

-- Add org_id to traces (nullable for backward compat)
-- Note: traces table is in the otel schema (see apps/api/src/db/schema.ts)
ALTER TABLE otel.traces ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES public.organizations(id);
CREATE INDEX ON otel.traces (org_id, created_at DESC) WHERE org_id IS NOT NULL;

-- Add org_id to api_keys (was deferred from Feature 1)
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES public.organizations(id) ON DELETE CASCADE;

-- Add active_org_id to BetterAuth session table
-- Must be at END of this file, after organizations table is created above
ALTER TABLE public.session ADD COLUMN IF NOT EXISTS active_org_id TEXT REFERENCES public.organizations(id);
```

**No separate `0003` migration file.** The `active_org_id` column on `session` is part of `0004_organizations.sql` because it has a FK dependency on `organizations`. Migration files are numbered: `0002_api_keys.sql` → `0004_organizations.sql` → `0005_alerts.sql`.

### activeOrgId mechanism

`active_org_id` is stored directly on the BetterAuth `session` row. When the user switches org in the UI, the web app calls a new tRPC mutation `orgs.setActive(orgId)` which updates `session.active_org_id` via raw Drizzle query. The tRPC context reads it from the session object.

BetterAuth session extension: the `session` table extension is done via a raw Drizzle migration (not BetterAuth's schema API), so BetterAuth's `getSession()` returns the base session; the tRPC context factory does an additional `db.query.session.findFirst()` to get `active_org_id`.

### Trace scoping

All `traces.*` tRPC queries add `WHERE org_id = ctx.user.activeOrgId` when `activeOrgId` is set. Fallback behavior:

- If `activeOrgId` is NULL (user has no active org yet): show traces where `org_id IS NULL` (legacy data). This ensures no data loss during the migration window.
- Lazy org creation: on first login after Phase 3 deploy, if user has no org membership, create a personal org (`slug = user.id`, `name = user.name + "'s workspace"`) and set it as `active_org_id`.

### API key ingest scoping

`POST /v1/traces` using an API key: the key's `org_id` is set as the `org_id` on the created trace. If the key has no `org_id` (legacy key), `org_id = NULL`.

### UI additions

- Org switcher: top of sidebar, shows active org name, click → dropdown of user's orgs
- `/settings/organization` — org name, member list, invite by email (sends invite link, not implemented in Phase 3.0 — stubbed as "Coming soon")
- Onboarding: personal org created automatically on first login

---

## Feature 4 — Alert Notifications

### Problem

Teams want proactive notification when cost or error thresholds are exceeded.

### DB Migration (`0005_alerts.sql`)

```sql
CREATE TABLE IF NOT EXISTS public.alert_rules (
  id           TEXT PRIMARY KEY,   -- ULID
  org_id       TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  condition    JSONB NOT NULL,      -- see condition schema below
  channel      JSONB NOT NULL,      -- see channel schema below
  enabled      BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.alert_firings (
  id           TEXT PRIMARY KEY,   -- ULID
  rule_id      TEXT NOT NULL REFERENCES public.alert_rules(id) ON DELETE CASCADE,
  fired_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at  TIMESTAMPTZ,
  payload      JSONB NOT NULL
);
```

**Condition schema (JSONB):**
```json
// cost_per_trace: { "type": "cost_per_trace", "threshold_usd": 1.00 }
// error_rate:     { "type": "error_rate", "threshold_pct": 10, "window_minutes": 60 }
// daily_cost:     { "type": "daily_cost", "threshold_usd": 10.00 }
```

**Channel schema (JSONB):**
```json
// email:   { "type": "email", "to": "user@example.com" }
// webhook: { "type": "webhook", "url": "https://..." }
// slack:   { "type": "slack", "webhook_url": "https://hooks.slack.com/..." }
```

### BullMQ Worker

**File:** `apps/api/src/workers/alert-eval.ts`

**Bootstrap:** Imported in `apps/api/src/index.ts` (same process as Hono server). No new Docker service needed for Phase 3.

**Queue:** `tracion:alert-eval` (BullMQ repeatable job, every 60 seconds)

**Worker logic per rule type:**

- `cost_per_trace`: `SELECT id, total_cost_usd FROM otel.traces WHERE org_id = $1 AND created_at > now() - interval '5 minutes' AND total_cost_usd > $2`
- `error_rate`: `SELECT COUNT(*) FILTER (WHERE status = 'error') / COUNT(*)::float FROM otel.traces WHERE org_id = $1 AND created_at > now() - interval 'N minutes'`
- `daily_cost`: `SELECT SUM(total_cost_usd) FROM otel.traces WHERE org_id = $1 AND created_at > now()::date`

On threshold exceeded: insert `alert_firings` row, send notification via channel handler.

### Notification channels

**Email:** Uses `nodemailer` with env vars:
```
TRACION_SMTP_HOST=
TRACION_SMTP_PORT=587
TRACION_SMTP_USER=
TRACION_SMTP_PASSWORD=
TRACION_SMTP_FROM=alerts@tracion.dev
```
Add all to `.env.example`.

**Webhook:** `fetch(url, { method: 'POST', body: JSON.stringify(payload) })`

**Slack:** `fetch(webhookUrl, { method: 'POST', body: JSON.stringify({ text: message, blocks: [...] }) })`

### UI: `/settings/alerts`

- List of alert rules: name, condition summary, channel type, enabled toggle, edit/delete
- "Create alert rule" → multi-step form: condition type → threshold → channel type → channel config → save
- Firing history: last 20 firings with timestamp and payload excerpt

---

## Dependencies Between Features

```
Feature 1 (API Keys)           ─── independent, ships first
Feature 2 (LLM Content)        ─── independent, frontend only
Feature 3 (Multi-tenancy)      ─── requires Feature 1 (org_id on api_keys)
Feature 4 (Alerts)             ─── requires Feature 3 (org_id on alert_rules)
```

---

## Success Criteria

Phase 3 is complete when:

- [ ] Users can create, view, and revoke API keys from `/settings/api-keys`
- [ ] Span detail shows LLM messages in conversation-style view when `gen_ai.prompt` attribute exists
- [ ] Organizations exist; `traces.list` returns only org-scoped traces
- [ ] Legacy traces (org_id NULL) visible to users with no active org
- [ ] `cost_per_trace` alert rule evaluates every 60s and fires email/webhook
- [ ] `.env.example` includes all `TRACION_SMTP_*` variables
- [ ] All new tRPC procedures have unit tests
- [ ] All new DB migrations are idempotent (`IF NOT EXISTS`)
