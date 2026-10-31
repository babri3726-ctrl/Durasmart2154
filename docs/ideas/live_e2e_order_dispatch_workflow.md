# Live End-to-End Order & Ledger Verification Workflow

## Problem Statement
How might we prove that our live running full-stack application (FastAPI backend + Vite React cockpit + SQLite database) flawlessly processes an entire business order-to-ledger lifecycle with photographic and cryptographic proof, while strictly preserving operational data integrity?

## Recommended Direction
**Direction: Autonomous Browser-Driven E2E Workflow with Database Ledger Audit**

We execute an automated Playwright session running against the live server (`http://127.0.0.1:5173` and `http://127.0.0.1:8010`). The automated operator:
1. Signs into the live Operations Cockpit as Managing Director (`owner`).
2. Navigates to `/orders/new`, selects an active regional customer (e.g., `GURU KIRPA INDUSTRY BARNALA`), configures line items (e.g., 2.5 MT UPVC Roofing), and submits the order.
3. Observes the backend persist the order into SQLite `data/operations.db` with status `submitted`.
4. Navigates to the live `/orders` board, views the newly created order, transitions its status, and inspects the resulting customer ledger entries.
5. Captures high-resolution visual proof of the order confirmation and ledger balance update, printing exact transaction IDs and database record hashes.

This direction provides 100% end-to-end reality testing without mocking, validating the frontend React form state, Zod validation, API proxying, SQLite ACID transactions, and UI reactivity in one verifiable pass.

## Key Assumptions to Validate
- [ ] **Assumption 1: Order Form Schema Validation:** The live `OrderNew` form properly accepts party selection, product SKU, and integer paise conversion without triggering client-side Zod errors.
  - *Validation:* Playwright script inspects form validity and submission network payload (`POST /api/v1/orders`).
- [ ] **Assumption 2: Database State Transition & ACID Safety:** The FastAPI server writes the new order record to `data/operations.db` with proper UUID, timestamps, and idempotency key handling.
  - *Validation:* Direct query to SQLite checking row insertion before and after browser submission.
- [ ] **Assumption 3: React Live Sync & UI Reflection:** Upon order submission, the React UI cache invalidates and renders the new record on `/orders` without requiring a hard page reload.
  - *Validation:* Browser DOM query verifying the order appears in the table with its active status badge.

## MVP Scope
- **In Scope:**
  - Automated Playwright script executing against live Google Chrome 64-bit.
  - Order creation flow using active local regional dealer `DEBTOR-PB-001` (Barnala, Punjab).
  - Verification of backend API status `200/201` and SQLite row creation.
  - High-resolution visual screenshots of the live submitted order and ledger.
  - Verification with zero destructive changes to existing seed data.
- **Out of Scope (Not Doing):**
  - External WhatsApp/SMS notification triggers (disabled in local dev environment).
  - OneDrive cloud sync overwrite during order creation (isolated to local SQLite).
  - Multi-vehicle yard dispatch weighing scale hardware integration.

## Not Doing (and Why)
- **Not mocking API network requests:** Mocking defeats the purpose of a live test; all requests must traverse the live Vite dev server proxy to the FastAPI backend.
- **Not modifying seed dealer data:** Regional dealers and initial ledger baselines are preserved intact; the test order is distinctly tagged (`TEST-E2E-*`).
- **Not using headless virtual fake browsers:** Testing uses actual Google Chrome installed on Windows for authentic DOM rendering.

## Open Questions & Success Criteria
1. Should the test order be left in the database as an active historical record, or cleanly rolled back/deleted after visual verification?
