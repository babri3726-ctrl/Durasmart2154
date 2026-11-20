# Implementation Plan: Multi-Excel Daybook Sync & Ledger Separation Architecture

**Date:** 2026-11-20  
**Target:** Web Panel (`web/`), FastAPI Backend (`server/`), SQLite Database (`data/operations.db`), Mobile APK (`mobile/`)  
**Objective:** Clean the current accounting position and implement an automated 4-Excel upload pipeline (`DAYBOOK`, `ROUNDOFF`, `DISCOUNT`, `TRIALBALANCE`) with strict stock entry disabling, dedicated Round Off & Discount ledgers, and automated classification of Cash in Hand (`Cash`, `Khan Cash`, `Cash GBD`) and Banks (`Yes Bank`, `HDFC Bank`).

---

## 1. Current Position Audit & Root Cause Analysis

### A. Current Database State (`data/operations.db`)
- **Total Vouchers:** 9,884 vouchers.
- **Stock Entries Present:** 7 `Stock Journal` vouchers and 1 `Physical Stock` voucher are currently stored in `vouchers`, contaminating financial totals.
- **Phantom Debtors in `parties` Table:**
  - `KHAN CASH` is stored as `DEBTOR-TALLY-KHANCASH-A9D8` with a debtor balance of ₹5,63,698.00.
  - `Cash Gbd` is stored as `DEBTOR-TALLY-CASHGBD-4F0C` with a debtor balance of ₹2,57,695.00.
  - `Cash` is stored as `DEBTOR-TALLY-CASH-069B` with a debtor balance of ₹8,91,500.00.
  - `Yes Bank` is stored as `DEBTOR-TALLY-YESBANK-3915`.
  - `ROUND OFF` is stored as `DEBTOR-TALLY-ROUNDOFF-AD2C`.
  - `Discount` is stored as `DEBTOR-TALLY-DISCOUNT-104D`.
- **Root Cause:** In `server/db.py`, `find_or_create_party_by_name()` treats any string in the `Particulars` column as a customer party. As a result, liquid cash books, banks, and nominal adjustment accounts were converted into trade debtors and displayed in the Debtor Master and Payment Outstanding cards.

### B. Daybook Analysis (`DAYBOOK.xlsx` — 10,040 rows)
- **Voucher Breakdown:**
  - `Receipt`: 3,361
  - `Sales`: 3,011
  - `Payment`: 2,237
  - `Journal`: 598
  - `Credit Note`: 312
  - `Purchase`: 288
  - `Contra`: 170 (e.g., `KHAN CASH` Contra with Credit ₹2,00,000 / ₹9,50,000)
  - `Stock Journal`: 31 (Must be disabled)
  - `Debit Note`: 26
  - `Physical Stock`: 1 (Must be disabled)
- **Round Off Rows:** 33 entries (e.g., `ROUND OFF` in Receipt and Journal).
- **Discount Rows:** 276 entries (e.g., `Discount` in Journal).
- **Bank Rows:** 69 entries (e.g., `Yes Bank`, `Hdfc P.O.Finance`).
- **Cash Rows:** 1,148 entries (`CASH`, `KHAN CASH`, `CASH GBD`).

---

## 2. Proposed Architecture & Ledger Taxonomy

### Account Classification Model (`party_type`)
Add a `party_type` column to the `parties` table to cleanly isolate accounts:

| Category | Account / Particulars | `party_type` | Ledger Treatment |
|---|---|---|---|
| **Trade Debtors** | Arul Steel, Shree Ji, Goyal Agrotech, etc. | `customer` | Debtor Master, Credit Days, Aging, Customer Ledger |
| **Cash in Hand** | `Cash`, `KHAN CASH` / `Khan Cash`, `Cash Gbd` / `Cash GBD` | `cash` | Cashbook Ledger, Liquid Cash balance, Contra transfers |
| **Bank Accounts** | `Yes Bank`, `HDFC Bank` / `Hdfc P.O.Finance` | `bank` | Bank Book Ledger, Bank Reconciliation, Deposits/Payments |
| **Adjustments** | `ROUND OFF` / `Round Off` | `roundoff` | Dedicated Round Off Ledger (P&L expense/income), not a debtor |
| **Discounts** | `Discount` / `DISCOUNT` | `discount` | Dedicated Discount Ledger, customer statement reconciliation |
| **Expenses** | `FEC EXP`, `Insurence Exp`, `Selery Exp`, `Interst Acc` | `expense` | Expense Register / P&L Nominal accounts |
| **Trade Creditors** | Raw material suppliers | `supplier` | Accounts Payable, not mixed with Trade Receivables |

---

## 3. Four-Excel Auto-Setup Specification

The system will feature a **Unified 4-Excel Setup Pipeline** where the user can upload or drag-and-drop four Excel files simultaneously or individually:

```
+-----------------------------------------------------------------------------------------+
|                              UNIFIED 4-EXCEL SYNC HUB                                   |
+-----------------------------+-----------------------------+-----------------------------+
| 1. DAYBOOK.xlsx             | 2. ROUNDOFF.xlsx            | 3. DISCOUNT.xlsx            |
| • All Vouchers (Sales,      | • Round Off Ledger          | • Discount Ledger           |
|   Purchases, Payments,      | • Rounding adjustments      | • Cash/Trade/Scheme Disc    |
|   Receipts, Contras)        | • Dedicated P&L view        | • Customer statement credit |
| • Stock Entries: DISABLED   |                             |                             |
| • Banks: YES & HDFC         |                             |                             |
| • Cash: CASH/KHAN/GBD       |                             |                             |
+-----------------------------+-----------------------------+-----------------------------+
|                                  4. TRIALBALANCE.xlsx                                   |
| • Master Opening Balances for all accounts (Debtors, Creditors, Banks, Cash in Hand)    |
+-----------------------------------------------------------------------------------------+
```

### Auto-Detection Rule (Drop Any File Without Manual Selection):
The backend auto-inspects the uploaded Excel headers and first 10 rows:
1. **Trial Balance / Opening Balance:** Contains `Trial Balance` in title or `Closing Balance` with `Debit` & `Credit` columns (`is_opening_balance_workbook`).
2. **Round Off:** Title or filename contains `Round Off` / `Roundoff` / `Rounoff` (`is_roundoff_ledger`).
3. **Discount:** Title or filename contains `Discount` (`is_discount_ledger`).
4. **Daybook:** Contains `Day Book` / `Daybook` or voucher types `Sales`, `Payment`, `Receipt`, `Contra` (`is_daybook_workbook`).

---

## 4. Detailed Component Implementation Plan

### Phase 1: Database Migration & Schema Cleanup (`server/db.py`)
1. **Schema Enhancement:**
   - Add `party_type TEXT DEFAULT 'customer'` to `parties` table (`customer`, `cash`, `bank`, `roundoff`, `discount`, `expense`, `supplier`).
   - Add index on `parties(party_type)`.
2. **Cleanup Migration Script (`scripts/clean_and_classify_ledgers.py`):**
   - Delete all `Stock Journal` and `Physical Stock` vouchers from `vouchers` table.
   - Reclassify `Cash`, `KHAN CASH`, and `Cash Gbd` as `party_type = 'cash'`.
   - Reclassify `Yes Bank`, `HDFC Bank`, `Hdfc P.O.Finance` as `party_type = 'bank'`.
   - Reclassify `ROUND OFF` as `party_type = 'roundoff'`.
   - Reclassify `Discount` as `party_type = 'discount'`.
   - Reclassify nominal expense accounts (`FEC EXP`, etc.) as `party_type = 'expense'`.
   - Recalculate true debtor balances for pure `customer` accounts.

### Phase 2: Parser Refactoring (`server/voucher_parser.py`)
1. **Stock Entry Disabler:**
   - In `parse_accounting_workbook`, add explicit check:
     ```python
     if vch_type in ("Stock Journal", "Physical Stock", "Material Out", "Material In"):
         continue # Strictly disabled per user specification
     ```
   - Ignore pure item quantity rows (`Inwards Qty` / `Outwards Qty`) without currency values.
2. **Liquid Account Normalization:**
   - Detect `Cash`, `KHAN CASH`, `CASH GBD` and map them to standard cash-in-hand accounts.
   - Detect `Yes Bank` and `HDFC Bank` and map them to standard bank accounts.
   - In Daybook Contra vouchers between Cash and Bank or between Cashbooks, link the transfer cleanly without creating phantom customer debtors.
3. **Round Off & Discount Extraction:**
   - If Daybook contains `Particulars == 'ROUND OFF'`, assign `party_id = 'LEDGER-ROUNDOFF'`, `book_source = 'Day Book (Round Off)'`.
   - If Daybook contains `Particulars == 'Discount'`, assign `party_id = 'LEDGER-DISCOUNT'`, `book_source = 'Day Book (Discount)'`.
4. **Trial Balance Parser Enhancement (`parse_opening_balance_workbook`):**
   - Correctly route opening balances into `parties` table matching by `party_type`:
     - Debtors -> Customer opening balances.
     - Cash in Hand (`Cash`: ₹8.91L, `Khan Cash`: ₹5.63L, `Cash GBD`: ₹2.57L) -> Cash opening balances.
     - Banks (`Yes Bank`: Cr ₹1.20Cr, `HDFC Dura`, `HDFC P.O. Finance`) -> Bank opening balances.

### Phase 3: Backend Multi-Excel Upload Endpoints (`server/main.py`)
1. **`POST /api/v1/imports/multi-excel/preview`**:
   - Accepts multipart form with 1 to 4 files (`daybook`, `roundoff`, `discount`, `trialbalance`).
   - Automatically inspects and categorizes each file.
   - Returns consolidated preview:
     - Daybook voucher count (with stock entries excluded).
     - Round Off adjustments count & sum.
     - Discount entries count & sum.
     - Trial Balance ledger opening balances count (Debtors, Cash, Bank, Expenses).
2. **`POST /api/v1/imports/multi-excel/apply`**:
   - Executes atomic multi-file apply transaction:
     - Step 1: Ingest Trial Balance opening balances.
     - Step 2: Ingest Daybook vouchers (stock disabled, cash/bank linked).
     - Step 3: Ingest Round Off ledger entries into `LEDGER-ROUNDOFF`.
     - Step 4: Ingest Discount ledger entries into `LEDGER-DISCOUNT`.
     - Step 5: Recalculate all balances in SQLite.
3. **Dedicated Ledger Read Endpoints:**
   - `GET /api/v1/ledgers/cash`: Real-time balances and vouchers for `Cash`, `Khan Cash`, and `Cash GBD`.
   - `GET /api/v1/ledgers/bank`: Real-time balances and vouchers for `Yes Bank` and `HDFC Bank`.
   - `GET /api/v1/ledgers/roundoff`: Real-time Round Off transactions and running total.
   - `GET /api/v1/ledgers/discount`: Real-time Discount transactions and running total.
   - `GET /api/v1/debtors`: Updated with `WHERE party_type = 'customer'` so liquid and nominal accounts never leak into customer balances.

### Phase 4: Frontend Web Panel (`web/src/pages/Daybook.tsx` & `web/src/pages/Payment.tsx`)
1. **4-Excel Multi-Upload Hub:**
   - Implement a high-visibility, drag-and-drop 4-slot upload card in `Daybook.tsx` and `Payment.tsx`.
   - Visual slot status indicators:
     - [ ] Daybook (`DAYBOOK.xlsx`)
     - [ ] Round Off (`ROUNDOFF.xlsx`)
     - [ ] Discount (`DISCOUNT.xlsx`)
     - [ ] Trial Balance (`TRIALBALANCE.xlsx` / `opening.xlsx`)
   - 1-Click "Auto-Detect & Process All Files" button.
2. **Ledger Tabs in Daybook:**
   - Tabs: `All Daybook` | `Cash in Hand (Cash, Khan, GBD)` | `Bank Accounts (YES, HDFC)` | `Round Off Ledger` | `Discount Ledger`.
3. **Debtor Master Protection:**
   - Ensure `Cash`, `Khan Cash`, `Cash GBD`, `ROUND OFF`, and `Discount` are excluded from debtor lists, salesperson scoping, and customer overdue totals.

### Phase 5: Mobile App Synchronization (`mobile/`)
1. **`MockRepository` & Models:**
   - Update `DebtorItem` filtering to ensure only trade debtors (`party_type == 'customer'`) are loaded into debtor scope.
   - Add Cashbook & Bank summary models if needed.
2. **Verify ADB on Device `E6CA9LIRWKTWD6WK`:**
   - Re-verify Payments dashboard and Ajay Ji scoping to confirm clean totals with no cash/nominal pollution.

---

## 5. Verification & Testing Protocol

1. **Unit & Parser Verification (`pytest server/test_voucher_import.py`):**
   - Assert `Stock Journal` and `Physical Stock` are dropped (0 stock entries imported).
   - Assert `ROUND OFF` routes to `LEDGER-ROUNDOFF`.
   - Assert `Discount` routes to `LEDGER-DISCOUNT`.
   - Assert `KHAN CASH`, `CASH`, and `CASH GBD` are flagged as cash in hand, not customer debtors.
   - Assert `Yes Bank` and `HDFC` are flagged as banks.
2. **Database Integrity Verification:**
   - Run SQL queries to ensure `SELECT COUNT(*) FROM parties WHERE party_type != 'customer' AND balance_paise > 0` returns 0 debtors in debtor scope.
3. **Web Panel Verification:**
   - Run Vite build (`npm run build`).
   - Test multi-file upload flow with sample Excel workbooks.
4. **Physical Device Verification:**
   - Install release APK on `E6CA9LIRWKTWD6WK` and take ADB UI dumps to confirm zero regression.
