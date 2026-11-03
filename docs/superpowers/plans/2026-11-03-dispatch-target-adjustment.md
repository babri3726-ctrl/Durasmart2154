# Implementation Plan: Dynamic Dispatch Target Auto-Adjustment & Weight Mutation

**Date:** 2026-11-03  
**Status:** In Progress / Pending User Review  
**Specification:** Auto-adjust salesperson dispatch targets upon dispatch creation, line weight mutation (increase/decrease), and dispatch voiding.

---

## 1. Problem Statement & Motivation
In the current ERP workflow:
1. When an order is dispatched (`POST /api/v1/dispatches`), the order line remaining quantities decrease, but the salesperson's monthly and pending dispatch targets in `STATE["targets"]` and dashboard telemetry (`/dashboard/salesperson-performance`, `/sales/targets`) are not automatically updated.
2. If yard dispatch personnel edit the dispatched weight (e.g. weighbridge scale adjustments or corrected loading tally), `PATCH /api/v1/dispatches/{id}` only accepts paperwork fields (vehicle, driver, etc.) and ignores line weight edits.
3. When a dispatch is voided (`POST /api/v1/dispatches/{id}/void`), reversing stock movements and order line quantities are restored, but salesperson dispatch achievements are not reverted.

The user requested:
> *"make logic that when dispach also decreased when the new order is dipached logic check test it by make order then dispach done then dipach target get decreased also ensure when dispach person edit the weight of the item then also incresed decrease the dispach target of each person automatic check and test logic and also check how to implement it and make plan"*

---

## 2. Mathematical Invariants & State Rules

For any salesperson $S$ handling customer/party $P$:
- Initial target quota: $T$ (Metric Tonnes)
- Dispatched achievement: $D$ (Metric Tonnes)
- Pending / Remaining target: $R = \max(0.0, T - D)$ (Metric Tonnes)
- Achievement percentage: $A = \frac{D}{T} \times 100\%$ (if $T > 0$)

### Event Invariants:
1. **New Dispatch Created with weight $W$ (MT):**
   $$D \leftarrow D + W$$
   $$R \leftarrow \max(0.0, T - D)$$
   *(Remaining target decreases by $W$)*

2. **Dispatch Weight Edited from $W_{\text{old}}$ to $W_{\text{new}}$ ($\Delta W = W_{\text{new}} - W_{\text{old}}$):**
   $$D \leftarrow \max(0.0, D + \Delta W)$$
   $$R \leftarrow \max(0.0, T - D)$$
   - If $\Delta W > 0$ (weight increased): $D$ increases, $R$ decreases.
   - If $\Delta W < 0$ (weight decreased): $D$ decreases, $R$ increases.

3. **Dispatch Voided (cancelling dispatch of weight $W$):**
   $$D \leftarrow \max(0.0, D - W)$$
   $$R \leftarrow \max(0.0, T - D)$$
   *(Remaining target is fully restored)*

---

## 3. Architecture & Code Changes

### Phase 2.1: Backend Server (`server/main.py`)
1. **Helper Function `adjust_salesperson_dispatch_target(salesperson_name: str, party_name: str, delta_mt: float)`**:
   - Searches `STATE["targets"]` for matching rows (`salesperson` and `party_name`, or by `salesperson`).
   - If no target exists for the salesperson, creates a dynamically tracked target record.
   - Updates `dispatched_mt` by `+ delta_mt` and recomputes `pending_mt`.
   - Also updates matching employee in `STATE["employees"]` (`dispatchedQty` and `remainingTargetQty`).
   - Persists updates to SQLite database (`db.save_target`).

2. **Dispatch Creation (`POST /api/v1/dispatches`)**:
   - Resolves total dispatched MT across lines (`quantity` / 1000.0 if kg, or `quantity` if MT).
   - Looks up salesperson name from order (`order.get("salespersonName")` or customer's default salesperson).
   - Calls `adjust_salesperson_dispatch_target(salesperson, party, +total_mt)`.

3. **Dispatch Weight Edit (`PATCH /api/v1/dispatches/{dispatch_id}`)**:
   - Enables editing line quantities/weights: accepts `lines: list[dict]`.
   - For each edited line:
     - Calculates $\Delta Q = Q_{\text{new}} - Q_{\text{old}}$.
     - Updates dispatch line quantity.
     - Adjusts order line's `dispatchedQuantity` and `remainingQuantity` by $\Delta Q$.
     - Adjusts stock movement records by $\Delta Q$.
   - Calculates total $\Delta W_{\text{mt}}$ across all modified lines.
   - Calls `adjust_salesperson_dispatch_target(salesperson, party, +\Delta W_{\text{mt}})`.

4. **Dispatch Void (`POST /api/v1/dispatches/{dispatch_id}/void`)**:
   - Reverts salesperson target: calls `adjust_salesperson_dispatch_target(salesperson, party, -total_mt)`.

---

### Phase 2.2: Web Frontend (`web/src/components/Consignments.tsx` & `web/src/lib/serverApi.ts`)
1. Extend `DispatchPatchBody` in `web/src/lib/serverApi.ts` to include optional `lines?: { dispatchLineId: number; quantity: string; unit: string }[]`.
2. In `web/src/components/Consignments.tsx`, add line weight/quantity input in the "Correct consignment" modal so the yard dispatch desk can directly edit actual weighbridge weights.

---

### Phase 2.3: Automated Testing & TDD (`server/test_server.py`)
Implement `test_21_dispatch_salesperson_target_dynamic_adjustment` covering:
1. Target baseline check for a salesperson.
2. Create order for salesperson with 10 MT.
3. Record dispatch of 4 MT -> assert salesperson dispatched MT increases by 4.000 MT, remaining target decreases by 4.000 MT.
4. Patch dispatch weight to 7 MT (+3 MT) -> assert dispatched MT increases by 3.000 MT, remaining target decreases by 3.000 MT.
5. Patch dispatch weight to 5 MT (-2 MT) -> assert dispatched MT decreases by 2.000 MT, remaining target increases by 2.000 MT.
6. Void dispatch -> assert dispatched MT reverts by 5.000 MT, remaining target completely restored.
7. Cleanup test data in `finally:` block.

---

## 4. Verification & Quality Gates
- `python -m pytest server/test_server.py` (Must pass 21/21)
- `npm --prefix web test -- --run` (Must pass 210/210)
- `npm --prefix web run build` (Clean production build)
- `flutter test` (Must pass 36/36)
- Git commit, push to `origin main`, and live verification on Render (`https://durasmart2154.onrender.com`).
