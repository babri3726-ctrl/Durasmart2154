# Implementation Plan: Universal Password Recovery Flow for Owner and HR-PB Employees

**Date:** 2026-11-04  
**Target Architecture:** FastAPI Python Server + SQLite DB, React/Tailwind Web Cockpit, Flutter Mobile APK  
**Requirement:** Provide an automated, secure "Forgot Password" option for both employees (the 13 HR-PB sales officers) and Owner Ishu Jindal across Web and Mobile.

---

## 1. Technical Design & Contracts

### 1.1 Backend & SQLite Database Layer (`server/db.py`, `server/main.py`)
1. **Database Schema (`password_resets` table)**:
   - `id TEXT PRIMARY KEY`
   - `user_id TEXT NOT NULL`
   - `identifier TEXT NOT NULL`
   - `otp TEXT NOT NULL` (6-digit numeric token, e.g. `584920`)
   - `expires_at TEXT NOT NULL` (15-minute validity)
   - `used INTEGER DEFAULT 0`
   - `created_at TEXT NOT NULL`

2. **Endpoints in `server/main.py`**:
   - `POST /api/v1/auth/forgot-password`:
     - Input: `{ "identifier": str }` (email, employee ID like `EMP-SP-01`, username like `ishujindal` or `owner`, or phone)
     - Matches user via `db.get_user_by_identifier(identifier)`
     - Generates 6-digit OTP, saves to `password_resets`
     - Returns `{ "status": "ok", "message": "Verification OTP sent to registered contact", "devOtp": "...", "user": { "name": "...", "role": "...", "maskedContact": "..." } }`
   - `POST /api/v1/auth/reset-password`:
     - Input: `{ "identifier": str, "otp": str, "newPassword": str }`
     - Validates OTP and expiration
     - Hashes `newPassword` with fresh salt via `db.update_user_password(user["id"], newPassword)`
     - Marks OTP as used
     - Returns `{ "status": "ok", "message": "Password updated successfully" }`

### 1.2 Web Cockpit Layer (`web/`)
1. **API Client (`web/src/lib/serverApi.ts`)**:
   - Add `requestPasswordReset(identifier: string)`
   - Add `resetPassword(identifier: string, otp: string, newPassword: string)`
2. **Page (`web/src/pages/ForgotPassword.tsx`)**:
   - 2-Step interactive form with animations & alerts:
     - Step 1: Input Identifier (email, employee ID or username) -> Requests OTP.
     - Step 2: Input OTP + New Password + Confirm Password -> Submits reset.
   - Immediate feedback and redirect button to `/login`.
3. **Route & Links**:
   - Register `/forgot-password` in `web/src/App.tsx`.
   - Add "Forgot password?" link in `web/src/pages/Login.tsx`.

### 1.3 Mobile APK Layer (`mobile/`)
1. **API Service (`mobile/lib/core/api_sync_service.dart`)**:
   - Add `requestPasswordReset(identifier)`
   - Add `resetPassword(identifier, otp, newPassword)`
2. **Screen (`mobile/lib/features/auth/forgot_password_screen.dart`)**:
   - Full 2-step interactive flow:
     - Step 1: Enter email or employee ID -> calls `requestPasswordReset`.
     - Step 2: Enter 6-digit verification code and new password.
     - Fallback: Offline support updating `MockRepository` in memory.
   - Link on `login_screen.dart` wired to `/forgot`.

---

## 2. Testing Strategy (TDD)
1. **Server Unit Tests (`server/test_forgot_password.py`)**:
   - Request OTP for Owner (`ishujindal` / `owner`) -> 200, valid OTP generated.
   - Request OTP for Employee (`EMP-SP-01` / `ajay.ji`) -> 200, valid OTP generated.
   - Reject non-existent user identifier -> 404/400.
   - Reset password with correct OTP -> 200, updates password, allows subsequent login with new password.
   - Reject wrong OTP -> 400.
   - Reject expired OTP -> 400.
2. **Web Tests (`web/scripts/auth-security-test.mjs`)**:
   - Test forgot-password and reset-password flow end-to-end.
3. **Flutter Tests (`mobile/test/auth_security_test.dart`)**:
   - Widget tests for `ForgotPasswordScreen`:
     - Test identifier validation.
     - Test OTP & password input.
     - Test submission and transition to success.
