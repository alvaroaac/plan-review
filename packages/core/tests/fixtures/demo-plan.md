# User Authentication System — Implementation Plan

**Goal:** Add email/password authentication with session management to the web app.

**Architecture:** Express middleware + bcrypt + JWT tokens + PostgreSQL sessions table. Three milestones: database schema, auth endpoints, session management.

**Tech Stack:** Node.js, Express, PostgreSQL, bcrypt, jsonwebtoken

---

## Milestone 1: Database Foundation

### Task 1.1: Create users table

**Depends On:** (none)
**Blocks:** 1.2, 2.1, 2.2
**Related Files:** `src/db/migrations/001_users.sql`, `src/db/schema.ts`
**Verification:** `npm run migrate && npm test`

Create the users table with the following columns:

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() |
| email | VARCHAR(255) | UNIQUE, NOT NULL |
| password_hash | VARCHAR(255) | NOT NULL |
| created_at | TIMESTAMP | DEFAULT NOW() |
| updated_at | TIMESTAMP | DEFAULT NOW() |

Add an index on `email` for login lookups. The migration should be idempotent (use `IF NOT EXISTS`).

### Task 1.2: Create sessions table

**Depends On:** 1.1
**Blocks:** 3.1, 3.2
**Related Files:** `src/db/migrations/002_sessions.sql`, `src/db/schema.ts`
**Verification:** `npm run migrate && npm test`

Sessions table for server-side session tracking:

- `id` (UUID, primary key)
- `user_id` (UUID, foreign key → users.id, ON DELETE CASCADE)
- `token` (VARCHAR, unique, indexed)
- `expires_at` (TIMESTAMP, NOT NULL)
- `created_at` (TIMESTAMP, DEFAULT NOW())

Add a cleanup index on `expires_at` for the session pruning job.

---

## Milestone 2: Authentication Endpoints

### Task 2.1: POST /auth/register

**Depends On:** 1.1
**Blocks:** 2.3
**Related Files:** `src/routes/auth.ts`, `src/services/user.ts`, `tests/auth.test.ts`
**Verification:** `npm test -- --grep "register"`

Accepts `{ email, password }`. Validates:
- Email format (basic regex, no need for RFC 5322 compliance)
- Password minimum 8 characters
- Email not already registered (unique constraint handles race conditions)

Hash password with bcrypt (cost factor 12). Return `201 { user: { id, email } }` on success, `400` with validation errors, `409` if email exists.

### Task 2.2: POST /auth/login

**Depends On:** 1.1
**Blocks:** 2.3
**Related Files:** `src/routes/auth.ts`, `src/services/auth.ts`, `tests/auth.test.ts`
**Verification:** `npm test -- --grep "login"`

Accepts `{ email, password }`. Compares against stored bcrypt hash.

On success: create a session (Task 3.1), return `200 { token, expiresAt }`.
On failure: return `401 { error: "Invalid credentials" }`. Do **not** reveal whether the email exists.

Rate limiting: 5 attempts per email per 15 minutes. Use a simple in-memory counter (Redis in v2).

### Task 2.3: Auth middleware

**Depends On:** 2.1, 2.2
**Blocks:** 3.2
**Related Files:** `src/middleware/auth.ts`, `tests/middleware.test.ts`
**Verification:** `npm test -- --grep "middleware"`

Express middleware that:
1. Extracts `Authorization: Bearer <token>` header
2. Looks up session by token
3. Checks `expires_at > NOW()`
4. Attaches `req.user = { id, email }` if valid
5. Returns `401` if missing/invalid/expired

Should be composable: `router.get('/profile', requireAuth, handler)`.

---

## Milestone 3: Session Management

### Task 3.1: Session creation and token generation

**Depends On:** 1.2
**Blocks:** 3.2
**Related Files:** `src/services/session.ts`, `tests/session.test.ts`
**Verification:** `npm test -- --grep "session"`

Generate tokens using `crypto.randomBytes(32).toString('hex')` — not JWT for session tokens (JWTs can't be revoked without a blacklist, defeating the purpose of server-side sessions).

Default expiry: 7 days. Configurable via `SESSION_TTL_HOURS` env var.

### Task 3.2: Session cleanup and logout

**Depends On:** 1.2, 2.3
**Blocks:** (none)
**Related Files:** `src/services/session.ts`, `src/routes/auth.ts`, `tests/session.test.ts`
**Verification:** `npm test -- --grep "logout|cleanup"`

Two features:

**Logout endpoint** — `POST /auth/logout` (requires auth middleware). Deletes the current session row. Returns `204`.

**Cleanup job** — Runs every hour via `setInterval`. Deletes sessions where `expires_at < NOW()`. Log the count of pruned sessions.

```sql
DELETE FROM sessions WHERE expires_at < NOW();
```

Consider: should logout invalidate all sessions for the user, or just the current one? Start with current-only. Add "logout everywhere" as a v2 feature.
