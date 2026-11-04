# Owner Invitation System, User Signup & Profile Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a robust, end-to-end user invitation, signup, authentication, and profile management system where the business owner generates invitation codes with pre-configured roles/territories, new staff members register via web panel or mobile APK, and users can view and update their profile across both platforms.

**Architecture:** 
- **Backend (`server/`)**: SQLite-backed persistent `users` and `invitations` tables in `operations.db`, secured with salted SHA-256 password hashing. Endpoints for owner invitation management (`POST`, `GET`, `DELETE /api/v1/auth/invitations`), public verification (`POST /api/v1/auth/invitations/verify`), user registration (`POST /api/v1/auth/signup`), verified login (`POST /api/v1/auth/login`), and profile inspection/mutation (`GET`, `PATCH /api/v1/auth/me`).
- **Web Panel (`web/`)**: Owner invitation manager in `Employees.tsx` (generating copyable invite codes with role/territory/expiry presets), dedicated `/signup` route with live code verification, and a comprehensive `/profile` page linked from the header profile menu for identity, quota tracking, and credential management.
- **Mobile APK (`mobile/`)**: Live backend integration for `RegisterScreen` (code validation & persistent signup), `LoginScreen` (online API authentication with offline fallback), and `ProfileScreen` (real profile telemetry, target quotas, and phone/password updates via `ApiSyncService`).

**Tech Stack:** 
- Backend: Python 3.11+, FastAPI, SQLite3 (WAL mode), Pydantic, hashlib, secrets
- Web Frontend: React 18, TypeScript, Tailwind CSS, Lucide icons, Vite, Vitest
- Mobile Frontend: Flutter 3.x / Dart 3.x, Provider, HTTP Client

**Spec:** User request: *"now make user login system like owner make inviatation code by signup the new person check apk system and find gaps missing and make plan how make user profile show in panel and apk check all plan it"*

---

## Global Constraints

- Never commit or log plaintext passwords; use salted cryptographic hashing.
- Maintain backwards compatibility: existing mock credentials and demo accounts must continue functioning seamlessly if no SQLite user matches.
- All database mutations must use parameterized SQL queries against `operations.db`.
- Web panel must pass TypeScript typecheck (`tsc --noEmit`), Vite production build, and Vitest test suite.
- Flutter mobile app must pass static analysis (`flutter analyze` / `dart analyze`) and widget tests (`flutter test`).
- Full polyglot quality check gate (`.\scripts\quality_check.ps1 -Check All`) must remain 100% green.

---

## Review Focus

1. **Invitation Code Exhaustion & Expiry:** Attempting to register with an expired invitation code or a code whose `used_count >= max_uses` must be rejected with an unambiguous 400 Bad Request error.
2. **Duplicate Identity Prevention:** Attempting to signup with an already registered email, phone number, or username must return a clean, user-friendly 409 Conflict error without crashing the server.
3. **Role & Territory Auto-Provisioning:** When a sales representative signs up with an invitation code specifying a territory and target quota, the backend must automatically link or create their employee record in `STATE["employees"]` and `targets`.
4. **Mobile Offline / Degraded Connectivity Resilience:** If the mobile APK loses connectivity, login attempts should gracefully fall back to cached/demo credentials, and clear error banners should guide the user if live registration cannot reach the server.
5. **Profile Mutation Security:** Calling `PATCH /api/v1/auth/me` with a password change must require verifying the caller's existing password before setting the new hash.

---

## Architecture & Data Models

### 1. SQLite Schema (`server/db.py`)

```sql
CREATE TABLE IF NOT EXISTS invitations (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL DEFAULT 'employee',
    department TEXT NOT NULL DEFAULT 'Sales',
    employee_id TEXT DEFAULT '',
    sales_territory TEXT DEFAULT '',
    monthly_target_qty REAL DEFAULT 100.0,
    target_unit TEXT DEFAULT 'MT',
    may_dispatch INTEGER DEFAULT 0,
    max_uses INTEGER DEFAULT 1,
    used_count INTEGER DEFAULT 0,
    expires_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_by TEXT NOT NULL DEFAULT 'USR-OWNER',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT DEFAULT '',
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'employee',
    department TEXT NOT NULL DEFAULT 'Sales',
    employee_id TEXT DEFAULT '',
    sales_territory TEXT DEFAULT '',
    active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

---

## Implementation Tasks

### Task 1: Backend Database & Invitation/User Persistence Layer

**Files:**
- Modify: `server/db.py`
- Modify: `server/main.py`
- Test: `tests/test_auth_invitations.py`

**Interfaces:**
- Consumes: `operations.db` connection pool.
- Produces: 
  - `create_invitation(code, role, dept, emp_id, territory, target_qty, target_unit, may_dispatch, max_uses, expires_at, created_by) -> dict`
  - `get_invitation_by_code(code) -> dict | None`
  - `list_invitations() -> list[dict]`
  - `revoke_invitation(code) -> bool`
  - `create_user(name, username, email, phone, password, role, dept, emp_id, territory) -> dict`
  - `get_user_by_identifier(identifier) -> dict | None`
  - `verify_user_password(user, password) -> bool`
  - `update_user_profile(user_id, updates) -> dict`

- [ ] **Step 1: Write the failing tests**
  Create `tests/test_auth_invitations.py` testing invitation creation, verification, single-use exhaustion, and user password hashing/verification.

- [ ] **Step 2: Run test to verify it fails**
  Run: `powershell -Command "$env:PYTHONPATH='.'; pytest tests/test_auth_invitations.py -v"`
  Expected: FAIL with `ModuleNotFoundError` or missing table/functions.

- [ ] **Step 3: Implement DB tables and helper functions in `server/db.py`**
  Add tables `invitations` and `users` to `init_db()`. Add CRUD helper methods for invitations and salted hash user authentication.

- [ ] **Step 4: Run test to verify it passes**
  Run: `powershell -Command "$env:PYTHONPATH='.'; pytest tests/test_auth_invitations.py -v"`
  Expected: PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add server/db.py tests/test_auth_invitations.py
  git commit -m "feat(auth): add persistent invitations and users tables in sqlite"
  ```

---

### Task 2: Backend REST Endpoints for Invitations, Signup & Profile

**Files:**
- Modify: `server/main.py`
- Test: `tests/test_auth_endpoints.py`

**Interfaces:**
- Produces:
  - `POST /api/v1/auth/invitations`: Owner creates an invitation code with configurable role, department, territory, and target.
  - `GET /api/v1/auth/invitations`: Owner lists all active and historical invitation codes.
  - `DELETE /api/v1/auth/invitations/{code}`: Owner revokes an active invitation code.
  - `POST /api/v1/auth/invitations/verify`: Public endpoint to validate an invite code prior to signup.
  - `POST /api/v1/auth/signup`: Public endpoint to register a new user using a valid invitation code.
  - `GET /api/v1/auth/me`: Authenticated endpoint returning user profile details and role targets.
  - `PATCH /api/v1/auth/me`: Authenticated endpoint for profile updates (phone, name, password change).

- [ ] **Step 1: Write the failing API tests**
  Add test cases in `tests/test_auth_endpoints.py` covering owner code creation, verification, signup flow, token return, and `/auth/me` profile retrieval.

- [ ] **Step 2: Run test to verify it fails**
  Run: `powershell -Command "$env:PYTHONPATH='.'; pytest tests/test_auth_endpoints.py -v"`
  Expected: FAIL with 404 or 405 endpoint not found.

- [ ] **Step 3: Implement endpoints in `server/main.py`**
  Implement Pydantic models `CreateInvitationRequest`, `VerifyInvitationRequest`, `SignupRequest`, `UpdateProfileRequest`, and the corresponding route handlers.

- [ ] **Step 4: Run test to verify it passes**
  Run: `powershell -Command "$env:PYTHONPATH='.'; pytest tests/test_auth_endpoints.py -v"`
  Expected: PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add server/main.py tests/test_auth_endpoints.py
  git commit -m "feat(api): add invitation generation, verification, signup, and profile endpoints"
  ```

---

### Task 3: Web Panel Owner Invitation Manager & Signup Flow

**Files:**
- Create: `web/src/pages/Signup.tsx`
- Modify: `web/src/pages/Employees.tsx`
- Modify: `web/src/pages/Login.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/lib/serverApi.ts`
- Test: `web/src/pages/__tests__/Signup.test.tsx`

**Interfaces:**
- Consumes: Backend `/api/v1/auth/invitations`, `/api/v1/auth/invitations/verify`, `/api/v1/auth/signup`.
- Produces:
  - Invitation modal in `Employees.tsx` allowing the owner to generate codes, specify roles (`Sales`, `Dispatch`, `Accounts`), set territory/targets, and copy invite links.
  - `/signup` page where prospective staff can enter or auto-fill their invite code, view the role offered, enter their details, and create their account.

- [ ] **Step 1: Add frontend API wrappers in `web/src/lib/serverApi.ts`**
  Add `createInvitation`, `listInvitations`, `revokeInvitation`, `verifyInvitationCode`, `signUpUser`, `fetchUserProfile`, and `updateUserProfile`.

- [ ] **Step 2: Create `web/src/pages/Signup.tsx` with test**
  Build the Signup form with real-time invite code verification banner, name, email/mobile, password fields, and error handling.

- [ ] **Step 3: Add Invite Staff section to `web/src/pages/Employees.tsx`**
  Add "+ Generate Invite Code" button for the owner, displaying active invitations, copy-to-clipboard button, and revoke actions.

- [ ] **Step 4: Run web test suite & typecheck**
  Run: `powershell -Command "cd web; npm run typecheck; npm run test:unit -- --run"`
  Expected: PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add web/src/
  git commit -m "feat(web): add owner invite code manager and staff signup page"
  ```

---

### Task 4: Web Panel User Profile Page & Header Integration

**Files:**
- Create: `web/src/pages/Profile.tsx`
- Modify: `web/src/components/layout/Shell.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: `fetchUserProfile()` and `updateUserProfile()` from `serverApi.ts`.
- Produces:
  - Dedicated `/profile` route displaying user identity, role privileges, territory targets, and personal settings (phone update, password change).
  - Profile menu in `Shell.tsx` navigating directly to `/profile`.

- [ ] **Step 1: Implement `web/src/pages/Profile.tsx`**
  Build clean profile view showing initials avatar, full name, email, phone, role badge, assigned territory, monthly target quota, and forms for updating phone and changing password.

- [ ] **Step 2: Register `/profile` in `web/src/App.tsx` and link in `Shell.tsx`**
  Add `/profile` route and update `ProfileMenu` dropdown in `Shell.tsx` to include "My Profile".

- [ ] **Step 3: Run web test suite & typecheck**
  Run: `powershell -Command "cd web; npm run typecheck; npm run test:unit -- --run"`
  Expected: PASS.

- [ ] **Step 4: Commit**
  ```bash
  git add web/src/
  git commit -m "feat(web): add user profile view and settings management"
  ```

---

### Task 5: Mobile APK Registration & Real Auth Integration

**Files:**
- Modify: `mobile/lib/core/api_sync_service.dart`
- Modify: `mobile/lib/features/auth/register_screen.dart`
- Modify: `mobile/lib/features/auth/login_screen.dart`
- Modify: `mobile/lib/data/mock_repository.dart`
- Test: `mobile/test/features/auth/register_screen_test.dart`

**Interfaces:**
- Consumes: Backend `/api/v1/auth/invitations/verify`, `/api/v1/auth/signup`, `/api/v1/auth/login`.
- Produces:
  - Live invite code verification and account creation in `RegisterScreen`.
  - Backend authentication with offline fallback in `LoginScreen`.

- [ ] **Step 1: Add API methods to `mobile/lib/core/api_sync_service.dart`**
  Implement `verifyInviteCode(code)`, `signupUser(payload)`, `loginUser(identifier, password)`, and `fetchProfile()`.

- [ ] **Step 2: Wire `RegisterScreen` (`mobile/lib/features/auth/register_screen.dart`)**
  Replace hardcoded demo validation with `ApiSyncService.verifyInviteCode()` and submit payload via `ApiSyncService.signupUser()`.

- [ ] **Step 3: Wire `LoginScreen` (`mobile/lib/features/auth/login_screen.dart`)**
  Update `_submit()` to authenticate against `ApiSyncService.loginUser()`. On success, update `MockRepository.currentUser` and route to `/home`.

- [ ] **Step 4: Run Flutter test suite**
  Run: `powershell -Command "cd mobile; flutter test"`
  Expected: PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add mobile/
  git commit -m "feat(mobile): integrate live invite registration and backend login into flutter app"
  ```

---

### Task 6: Mobile APK Profile Screen Live Sync & Telemetry

**Files:**
- Modify: `mobile/lib/features/org/profile_screen.dart`
- Modify: `mobile/lib/core/api_sync_service.dart`
- Test: `mobile/test/features/org/profile_screen_test.dart`

**Interfaces:**
- Consumes: Backend `GET /api/v1/auth/me` and `PATCH /api/v1/auth/me`.
- Produces: Live profile telemetry, target quota progress, phone update sync, and password change modal.

- [ ] **Step 1: Update `ProfileScreen` with live refresh and mutation**
  In `initState()`, fetch live profile from backend if online. Implement phone update with `ApiSyncService.updateProfile()`. Add Change Password action dialog.

- [ ] **Step 2: Run Flutter tests and static analysis**
  Run: `powershell -Command "cd mobile; flutter test"`
  Expected: PASS.

- [ ] **Step 3: Commit**
  ```bash
  git add mobile/
  git commit -m "feat(mobile): connect profile screen to live backend telemetry and profile updates"
  ```

---

### Task 7: End-to-End Verification & Automated Quality Gate

**Files:**
- Verification: Polyglot Quality Gate (`scripts/quality_check.ps1`)

- [ ] **Step 1: Run comprehensive backend tests**
  Run: `powershell -Command "$env:PYTHONPATH='.'; pytest tests/ -v"`
  Expected: All tests pass.

- [ ] **Step 2: Run web unit & contract tests**
  Run: `powershell -Command "cd web; npm run typecheck; npm run test:unit -- --run"`
  Expected: 210+ tests pass.

- [ ] **Step 3: Run mobile flutter test suite**
  Run: `powershell -Command "cd mobile; flutter test"`
  Expected: 36+ tests pass.

- [ ] **Step 4: Execute master quality check gate**
  Run: `powershell -Command ".\scripts\quality_check.ps1 -Check All"`
  Expected: All gates GREEN.
