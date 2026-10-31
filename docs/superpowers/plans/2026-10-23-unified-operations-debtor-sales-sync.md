# Unified Operations Suite: Cloud Backend, Mobile APK, Sales Targets & Debtor CRUD Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy a unified cloud backend, React Web Cockpit, and Flutter Mobile APK enabling anywhere-online operations with 1-click OneDrive sync for Stock (`1-8-26.xlsx`) and Sales Targets (`HR-PB.xlsx`), plus a complete Debtor Master with full Create, Read, Update, and Delete (CRUD) capabilities across both web and mobile.

**Architecture:**
A unified Python FastAPI backend exposes clean REST contracts for dual-role auth, 1-click Excel ingestion, and transactional persistence. The React 19 Cockpit and Flutter Mobile App connect to this shared backend via a public HTTPS tunnel/cloud endpoint. Stock sync targets 3 specific sheets (`TOTAL STOCK`, `UPVC TOTAL STOCK`, `UPVC ITEM`), and target sync processes 2 territory sheets (`Sheet1 - Haryana`, `Sheet2 - Punjab`) into salesperson performance and the Debtor Master (initialized at ₹0 balance with full inline Edit/Delete).

**Tech Stack:**
- **Backend:** FastAPI, Pydantic v2, OpenPyXL, Uvicorn, SQLite/JSON state store, Cloudflare Tunnel / Ngrok.
- **Web Frontend:** React 19, TypeScript, Vite, Tailwind CSS, Lucide icons.
- **Mobile APK:** Flutter 3.x, Dart 3.x, Material Design 3.

**Spec & Reference:**
- Workbook 1 (Stock): `C:\Users\My\OneDrive\1-8-26.xlsx`
- Workbook 2 (Targets & Debtors): `C:\Users\My\OneDrive\HR-PB.xlsx`
- Design Specification: `unified_operations_debtor_sales_plan.md`

---

## Global Constraints

- Preserve non-blocking file-copy isolation (`make_safe_temp_copy`) so reading workbooks never fails when Microsoft Excel has files locked open.
- Stock sync must strictly ingest ONLY 3 sheets: `TOTAL STOCK`, `UPVC TOTAL STOCK`, `UPVC ITEM`.
- HR-PB ingestion must parse both Haryana (`Sheet1`) and Punjab (`Sheet2`) territory sheets (142 total parties).
- Debtors imported from `HR-PB.xlsx` must initially carry balance `0.00` (₹0).
- Debtor Master in both Web Cockpit and Mobile APK must support Add, Edit (name, station, district, balance), and Delete with user confirmation.
- 100% of existing unit and contract tests in `web/` (268 tests) and `mobile/` (35 tests) must continue passing without regression.

---

## Review Focus & Failure Modes

1. **Excel File-Lock Contention:** If the user has `HR-PB.xlsx` open in desktop Excel, raw file reading will throw `PermissionError`. *Mitigation:* The non-blocking PowerShell temp snapshot copy mechanism must be used before OpenPyXL load.
2. **Whitespace and Special Characters in Party Names:** `HR-PB.xlsx` contains non-breaking spaces (`\xa0`) and slash combinations (e.g. `KALRA\xa0TRADERS/ STEEL DERABASSI`). *Mitigation:* Normalize strings with unicode folding and whitespace trimming during parsing.
3. **Number vs Text Target Quantities:** Some rows contain decimal numbers (e.g., `28.395`), integers (e.g., `50`), or blank cells. *Mitigation:* Safe float casting defaulting to `0.000` with 3-decimal string formatting.
4. **Debtor Deletion Safety:** Accidental clicks on delete would wipe out debtor notes and records. *Mitigation:* Two-step confirmation dialogs in both Web Cockpit and Mobile APK.
5. **Mobile Offline Network Transition:** Cell phone dropping to 2G/3G or losing connection. *Mitigation:* In-memory client caching and retry resilience in `MockRepository`/`ApiRepository`.

---

## File Structure & Module Boundaries

### Backend (`server/`)
- `server/hr_pb_parser.py`: Non-blocking parser for `HR-PB.xlsx` extracting Haryana & Punjab target rows and dealer master profiles.
- `server/stock_parser.py`: Existing 3-sheet stock parser for `1-8-26.xlsx`.
- `server/main.py`: Unified API routes for Auth, Dashboard, Stock, HR-PB Sync, Sales Targets, and Debtor CRUD.

### Web Cockpit (`web/`)
- `web/src/lib/serverApi.ts`: Wire contracts and API functions for Debtor CRUD (`listDebtors`, `createDebtor`, `updateDebtor`, `deleteDebtor`) and `listSalesTargets`.
- `web/src/pages/Debtors.tsx`: Full Debtor Master UI with 1-Click Sync banner, data table, Add/Edit modal, and Delete dialog.
- `web/src/pages/SalesTargets.tsx`: Territory & Salesperson Target Check dashboard.
- `web/src/components/layout/Shell.tsx` & `Sidebar.tsx`: Navigation links for Debtors and Sales Targets.

### Mobile APK (`mobile/`)
- `mobile/lib/data/models.dart`: Models for `DebtorItem` and `SalesTargetItem`.
- `mobile/lib/data/mock_repository.dart`: In-memory and API data methods for Debtors and Targets.
- `mobile/lib/features/sales/debtor_list_screen.dart`: Mobile Debtor list with search, Add FAB, and Edit/Delete bottom sheets.
- `mobile/lib/features/sales/performance_screen.dart`: Salesperson check view showing party-wise targets vs dispatches.
- `mobile/lib/features/stock/stock_home_screen.dart`: 1-Click Stock Sync button calling live backend.

---

## Implementation Tasks

### Task 1: HR-PB Parser Engine (`server/hr_pb_parser.py`)
- [ ] Create `server/hr_pb_parser.py` using `openpyxl` with `make_safe_temp_copy`.
- [ ] Implement `extract_hr_pb_targets(file_path)`:
  - Sheet 1 (Haryana): Parse `Dealer's Name`, `STATION`, `Distt.`, `Area Officer`, `Oct.Target`, `Order recved.`, `Mtrl Dispatch`.
  - Sheet 2 (Punjab): Parse `Party Name`, `STATION`, `Distt.`, `Sales Person`, `Oct.Target`, `Order recved.`, `Mtrl Dispatch`.
  - Sanitize non-breaking spaces (`\xa0`) and convert targets to decimal strings.
- [ ] Verify parser standalone output with 142 extracted records.

### Task 2: Backend Debtor CRUD & Sales Targets API (`server/main.py`)
- [ ] Implement `GET /api/v1/sales/targets`: Returns all 142 records grouped by state and salesperson.
- [ ] Implement `POST /api/v1/imports/excel/hr-pb/sync`: 1-Click sync from `HR-PB.xlsx`; automatically inserts unique dealers into `STATE["debtors"]` with balance `0.00`.
- [ ] Implement Debtor CRUD:
  - `GET /api/v1/debtors`: Filterable, searchable paginated list.
  - `POST /api/v1/debtors`: Add new debtor.
  - `PUT /api/v1/debtors/{id}`: Edit debtor (name, station, district, salesperson, creditDays, balance).
  - `DELETE /api/v1/debtors/{id}`: Remove debtor.
- [ ] Restart backend daemon on port 8010 and test all endpoints with automated curl/Invoke-RestMethod script.

### Task 3: Web Cockpit Debtor Master & Sales Targets (`web/`)
- [ ] Update `web/src/lib/serverApi.ts` with TypeScript interfaces and fetch helpers for Debtor CRUD and Targets.
- [ ] Enhance `web/src/pages/Debtors.tsx`:
  - Add "1-Click Sync from HR-PB" header action with sync status indicator.
  - Render Debtor table with Party Name, Station, District, Salesperson, and Balance (`₹0.00` badge).
  - Add "Add Debtor" modal dialog.
  - Add "Edit Debtor" modal dialog (updates state via `PUT /api/v1/debtors/{id}`).
  - Add "Delete Debtor" confirmation dialog (removes via `DELETE /api/v1/debtors/{id}`).
- [ ] Enhance `web/src/pages/SalesTargets.tsx` / `Sales.tsx` to display salesperson-wise target vs received vs dispatched metrics.
- [ ] Run `npm test` to verify all 268 contract tests pass, and run `npm run build`.

### Task 4: Flutter Mobile APK Updates (`mobile/`)
- [ ] Update `mobile/lib/data/models.dart` with `DebtorItem` and `SalesTargetItem`.
- [ ] Update `mobile/lib/data/mock_repository.dart` with CRUD operations for debtors and target queries.
- [ ] Update `mobile/lib/features/sales/debtor_list_screen.dart`:
  - Display search bar, debtor cards with initial ₹0 balance pill.
  - Add FAB button opening Add Debtor sheet.
  - Add action menu or swipe for Edit and Delete with confirmation.
- [ ] Update `mobile/lib/features/sales/performance_screen.dart` with party-wise sales targets.
- [ ] Update `mobile/lib/features/stock/stock_home_screen.dart` with 1-Click Stock Sync button.
- [ ] Run `flutter test` to ensure all 35 mobile tests pass.

### Task 5: Cloud Deployment & Public Tunnel Configuration
- [ ] Set up secure cloud tunneling script (`run_tunnel.ps1`) for exposing port 8010 over HTTPS.
- [ ] Configure `web/.env` and `mobile/lib/data/api_config.dart` to support live remote URL.
- [ ] Live verification across Web Cockpit and Mobile APK from simulated remote origin.
