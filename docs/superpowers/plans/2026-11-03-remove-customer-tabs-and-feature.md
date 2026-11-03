# Implementation Plan: Complete Removal of Customer Tabs & Feature in Favor of Unified Debtors

**Date:** 2026-11-03  
**Status:** DRAFT (Awaiting User Review — No Code Modifications Yet)  
**Target Modules:** `server/`, `web/`, `mobile/`  

---

## 1. Intent & Context

### 1.1 User Request
> "REMOVE THE CUSTOMER TABS AND BACKEND FEATURE ALSO COMPLETELY"

### 1.2 Objective
Eliminate the redundant "Customers" module (`/customers` tabs and backend `/api/v1/customers` store) and unify 100% of party/dealer operations under the **Debtor Master & Ledger** (`/debtors`, HR-PB master dealer list, SQLite `parties`).

---

## 2. Component Inspection & Scope

### 2.1 Web UI (`web/src/`)
1. **Sidebar Navigation (`Shell.tsx`)**:
   - Currently includes `{ label: 'Customers', to: '/customers', icon: Users }`.
   - Remove this entry so "Customers" is no longer shown in the navigation bar.
2. **Page Routing (`App.tsx`)**:
   - Route `/customers` & `/customers/:id` should redirect directly to `/debtors` so any old bookmark or direct URL lands on the active Debtor Ledger.
3. **Internal Links**:
   - [`Dashboard.tsx`](file:///C:/NewProject_Frontend/web/src/pages/Dashboard.tsx): Any links pointing to `/customers` point to `/debtors`.
   - [`OrderDetail.tsx`](file:///C:/NewProject_Frontend/web/src/pages/OrderDetail.tsx), [`Orders.tsx`](file:///C:/NewProject_Frontend/web/src/pages/Orders.tsx), [`EmployeeDetail.tsx`](file:///C:/NewProject_Frontend/web/src/pages/EmployeeDetail.tsx): Replace `/customers/${id}` links with `/debtors`.
4. **Contract Test Alignment**:
   - Update [`web/scripts/stock-preview-contract-test.mjs`](file:///C:/NewProject_Frontend/web/scripts/stock-preview-contract-test.mjs) navigation label assertions to reflect the removed Customer tab so all 210 tests pass.

### 2.2 Backend API (`server/`)
1. **In-Memory Store (`server/main.py`)**:
   - Remove `STATE["customers"]`.
   - All party lookups in `orders`, `dispatches`, and `payments` will reference `STATE["debtors"]` directly.
2. **Endpoints (`/api/v1/customers`)**:
   - Alias/route `/api/v1/customers` to `/api/v1/debtors` or consolidate party operations so external API calls gracefully resolve debtors.
   - Consolidate debtor opening balance and ledger on `/api/v1/debtors`.
3. **Dashboard Aggregations (`get_dashboard_summary` & `get_dashboard_cockpit`)**:
   - Derive receivables solely from `STATE["debtors"]` and SQLite `parties`.
4. **Test Suite (`server/test_server.py`)**:
   - Update `test_13` to test opening balances and ledger against debtor endpoints, preserving all 20/20 passing tests.

### 2.3 Mobile App (`mobile/`)
1. **Route Mapping (`mobile/lib/app.dart`)**:
   - Map route `'/customers'` directly to `DebtorListScreen()` so any internal action resolves to the Debtor list.
2. **Preserve Suite**:
   - Ensure all 36 Flutter mobile tests pass without regression.

---

## 3. Step-by-Step Implementation Sequence

1. **Step 1: Backend Consolidation**:
   - In `server/main.py`: Consolidate `STATE["customers"]` into `STATE["debtors"]`.
   - Redirect `/api/v1/customers` to `get_debtors`.
   - Remove customer-specific duplicate functions.
2. **Step 2: Web UI Navigation & Routing**:
   - In `web/src/components/layout/Shell.tsx`: Remove `'Customers'` from navigation list.
   - In `web/src/App.tsx`: Redirect `/customers` to `/debtors`.
   - In `web/src/pages/Dashboard.tsx`, `OrderDetail.tsx`, `Orders.tsx`, `EmployeeDetail.tsx`: Replace `/customers` links with `/debtors`.
3. **Step 3: Contract Test Suite Sync**:
   - Adjust `web/scripts/stock-preview-contract-test.mjs` for the new 17-item navigation list.
4. **Step 4: Mobile Route Consolidation**:
   - Route `/customers` to `DebtorListScreen` in `mobile/lib/app.dart`.
5. **Step 5: Full Verification & Cloud Deployment**:
   - Run pytest (20/20), vitest (210/210), flutter test (36/36).
   - Commit, push to `origin main`, and verify live on Render cloud.
