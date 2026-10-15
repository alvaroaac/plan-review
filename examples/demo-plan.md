# User Authentication System — Implementation Plan

**Goal:** Add email/password authentication with session management to the web app.

**Architecture:** Express middleware + bcrypt + opaque session tokens + PostgreSQL sessions table. Three milestones: database schema, auth endpoints, session management.

**Tech Stack:** Node.js, Express, PostgreSQL, bcrypt

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

```assumption id=bcrypt-cost
label: bcrypt cost
statement: A bcrypt cost factor of 12 keeps a login under 300 ms on production hardware.
quote: cost factor 12
context: Measured at 250 ms on a staging box; production uses the same instance type.
```

### Task 2.2: POST /auth/login

**Depends On:** 1.1
**Blocks:** 2.3
**Related Files:** `src/routes/auth.ts`, `src/services/auth.ts`, `tests/auth.test.ts`
**Verification:** `npm test -- --grep "login"`

Accepts `{ email, password }`. Compares against stored bcrypt hash.

On success: create a session (Task 3.1), return `200 { token, expiresAt }`.
On failure: return `401 { error: "Invalid credentials" }`. Do **not** reveal whether the email exists.

Rate limiting: 5 attempts per email per 15 minutes. Counters live in the API process for now.

```decision id=rate-limit-store
label: Rate limit store
question: Where should login attempt counters live?
quote: 5 attempts per email per 15 minutes
context: Counters only need to survive for 15 minutes, but every API instance must see the same count.
- A: In-memory map in the API process | No new infrastructure; resets on deploy [pick]
- B: Postgres table keyed by email | Shared across instances; one extra write per login
- C: Redis with key expiry | Built for this; adds a service to run
```

```assumption id=single-instance
label: Single API instance
statement: The API runs as one process, so an in-memory counter sees every login attempt.
quote: the API is deployed as a single instance
context: The current deploy config pins one instance. Autoscaling would break this.
```

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

Logout needs a scope decision before the endpoint is written.

```decision id=logout-scope
label: Logout scope
question: Should logout end only the current session, or every session for the user?
- A: Current session only | Matches what users expect on a shared computer
- B: Every session for the user | Safer after a stolen token; signs out other devices too
```
