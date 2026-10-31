# Unified Operations Suite: OneDrive Excel Stock, Regional Targets & Debtor Master

## Problem Statement
How might we provide plant executives and remote sales officers with a unified, real-time operating dashboard and mobile app that instantly synchronizes live metal/UPVC stock and regional sales performance from OneDrive workbooks while offering complete debtor ledger control anywhere over the internet?

## Recommended Direction
A lightweight, lock-safe hybrid architecture combining:
1. **Python FastAPI Backend** operating on Port 8010 that reads live OneDrive workbooks (`1-8-26.xlsx` and `HR-PB.xlsx`) using non-blocking Windows VSS snapshot copies. This completely prevents Excel file-lock collisions when team members have the spreadsheets open.
2. **Strict Ingestion Filtering**: Isolates the 3 authorized plant stock sheets (`TOTAL STOCK`, `UPVC TOTAL STOCK`, `UPVC ITEM`) and dynamic territory sheets (`Sheet1` Haryana, `Sheet2` Punjab) while seeding 137 parties into a persistent Debtor Master with ₹0.00 initial balance.
3. **Cross-Platform Access**: A modern React Web Cockpit for factory management and a Flutter Mobile APK for on-field sales officers, capable of connecting locally or over public HTTPS via cloud tunnels (`run_cloud_tunnel.ps1`).

## Key Assumptions to Validate
- [x] **File-Lock Tolerance**: Backend successfully copies and parses workbooks even when Microsoft Excel holds an exclusive file lock.
- [x] **Dynamic Header Normalization**: Parser adapts to varying column offsets across Haryana and Punjab sheets without breaking.
- [x] **Debtor Data Integrity**: User updates, additions, and deletions in the Debtor Master are preserved across successive Excel sync events.
- [ ] **Mobile Field Connectivity**: Mobile APK connects cleanly over public HTTPS tunnels in low-connectivity mobile networks.

## MVP Scope
- **Stock Ingestion**: Slit metal coils (1,344.6 MT), UPVC roofing sheet matrix (2,043 pcs), and UPVC accessories (Caps, Ridge, Jhallar).
- **Target Tracking**: 137 dealers across Haryana and Punjab with Oct. 2026 targets (1,609 MT) and dispatch progress (621.7 MT) across 13 authentic regional sales officers.
- **Executive Dashboard 3-Tab Cockpit**:
  - *Overview & Operations*: Operational KPIs, collections, and line dispatches.
  - *Sales Targets & Quota KPIs*: Real-time quota progress bar, territory split (Punjab vs Haryana), and officer leaderboard.
  - *Financial & Risk Analytics*: Turnover realization simulator (~₹3.86 Cr realized vs ₹6.12 Cr pipeline), run-rate pacing simulator (141 MT/day required), and Pareto 80/20 dealer volume concentration risk analysis.
- **Pure HR-PB Integration**: All mock demo salespeople and fake demo lines have been purged; the system displays 100% authentic sheet figures.
- **Streamlined Sales Tab**: Removed legacy "Set a target", "Stored targets", "Category performance (blank = whole book)", and date range pickers ("From... To... This month/Last month"), leaving a clean, dedicated HR-PB sales quota and dealer matrix.
- **Debtor Management**: Full CRUD (Add, Edit, Delete, Filter by state/territory, Search) in both Web and Mobile.
- **One-Click Sync**: Triggerable via Web button and Mobile refresh icon.

## Not Doing (and Why)
- **Not Doing full-workbook ingestion**: Discarding unverified scratch sheets in `1-8-26.xlsx` to prevent metric contamination.
- **Not Overwriting active debtor balances on sync**: Re-syncing `HR-PB.xlsx` only inserts newly discovered parties without resetting custom-edited balances.
- **Not Enforcing complex cloud database dependencies**: In-memory and local file persistence keeps deployment self-contained on the host machine.

## Open Questions
- What default credit limit or payment terms should be configured when adding new debtors manually in the mobile APK?
