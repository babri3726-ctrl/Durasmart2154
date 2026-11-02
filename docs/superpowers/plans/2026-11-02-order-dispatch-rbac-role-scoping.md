# Implementation Plan: Role-Based Order & Dispatch Scoping & Dispatcher Authority

**Date:** 2026-11-02  
**Status:** DRAFT (Awaiting User Review — No Execution Yet)  
**Target Modules:** `server/`, `web/`, `mobile/`  

---

## 1. Rule Inspection & Gap Analysis

### 1.1 Existing Project Rules & Current Behavior
1. **User Identity & Roles**:
   - The backend defines two primary roles (`owner`, `employee`) across three departments (`Management`, `Dispatch`, `Sales`).
   - Authentication tokens encode the identity (e.g. `jwt-access-token-owner-owner`, `jwt-access-token-employee-EMP-DSP-01`, `jwt-access-token-employee-EMP-SP-01`).
   - The `/me` endpoint returns `{ id, name, email, role, department, employeeId }`.
2. **Order Listing (`GET /api/v1/orders`)**:
   - **Current State**: `salespersonId` is an optional query parameter. The endpoint does *not* inspect caller identity or headers. If an employee (Sales Officer) requests `/api/v1/orders` without passing `salespersonId`, the server serves **all orders company-wide**.
   - **Gap**: Missing server-side enforcement. A sales officer can see other salespeople's customer orders.
3. **Dispatch Listing (`GET /api/v1/dispatches`)**:
   - **Current State**: Accepts `orderId`, `customerId`, `deliveryStatus`, date filters, and `q`. Does *not* have a `salespersonId` filter and does not inspect which sales officer booked the underlying order.
   - **Gap**: Sales officers see all consignments across the whole company instead of only dispatches for their own sales.
4. **Order Status & Dispatch Authority (`POST /api/v1/orders/{id}/status`, `quick-dispatch`, `OrderDetail.tsx`)**:
   - **Current State**: 
     - In `OrderDetail.tsx`: Order confirmation and cancellation are restricted exclusively to `isOwner`:
       `{!isOwner && !cancelled && 'Confirming an order, and cancelling one already confirmed, are owner decisions'}`.
     - The dispatch desk was blocked from changing status to pending or cancelling orders.
   - **User Mandate**:
     > *"AND DISPACH PERSON SHOW ALL ORDER AND HE HAS AUTHORITY TO TICK OR PENDING OR CANCCELED THE ORDER AUTHORITY FOR DISPACH"*
     - Dispatch desk must have explicit authority to:
       1. **TICK (Mark Dispatched / Quick-Dispatch)**
       2. **Set PENDING** (revert to pending status / mark pending dispatch)
       3. **CANCEL** the order / consignment.

---

## 2. Target Role-Based Access Control (RBAC) Matrix

| Persona / Role | Department | Order List Visibility | Dispatch List Visibility | Status Change Authority |
| :--- | :--- | :--- | :--- | :--- |
| **Managing Director (Owner)** | `Management` | **ALL Orders** (with officer filter) | **ALL Dispatches** | Full (Draft ➔ Pending ➔ Confirmed ➔ Dispatched ➔ Cancelled / Delete) |
| **Yard Dispatch Desk** | `Dispatch` | **ALL Orders** (company-wide, needed to load any order) | **ALL Dispatches** (all trucks & yards) | **TICK (Dispatch)**, **Set PENDING**, **CANCEL Order** |
| **Area Sales Officer (Employee)** | `Sales` | **OWN Orders ONLY** (`salespersonId == employeeId`) | **OWN Dispatches ONLY** (orders booked by this salesperson) | Submit draft ➔ Pending; Cancel only unconfirmed own draft/pending |

---

## 3. Architecture & Contract Specifications

### 3.1 Backend Contract Changes (`server/main.py`)
1. **Caller Identity Resolver**:
   - Extract caller role, department, and employee ID from `Authorization` header and `X-User-Role` / `X-User-Id` / `X-Employee-Id`.
2. **`GET /api/v1/orders`**:
   - If caller is `role == 'employee'` AND `department == 'Sales'`:
     - Force filter: `o.get('salespersonId') == caller.employeeId` (ignore or clamp query param).
   - If caller is `owner` OR `department == 'Dispatch'`:
     - Allow viewing all orders; allow filtering by any `salespersonId` query param.
3. **`GET /api/v1/dispatches`**:
   - Add `salespersonId: str | None = None` query parameter.
   - If caller is a Sales Officer (`department == 'Sales'`), resolve underlying `order.salespersonId` and return **only** dispatches for orders booked by that sales officer.
   - If caller is Owner or Dispatch, allow viewing all dispatches.
4. **`POST /api/v1/orders/{order_id}/status`**:
   - Allow caller if `is_owner` OR `is_dispatch` (`department == 'Dispatch'` or caller token contains `dsp`/`dispatch`).
   - Permitted transitions for Dispatch Desk:
     - `to == 'dispatched'` (Tick / Dispatch)
     - `to == 'pending'` (Revert / Set Pending)
     - `to == 'cancelled'` (Cancel Order)
5. **`POST /api/v1/orders/{order_id}/quick-dispatch`**:
   - Allow caller if `is_owner` OR `is_dispatch`.

### 3.2 Web Frontend Changes (`web/src/`)
1. **`web/src/pages/Orders.tsx`**:
   - Ingest `useLiveSession()`.
   - If `user.role === 'employee' && user.department === 'Sales'`:
     - Automatically lock `salespersonFilter` to `user.employeeId`.
     - Hide/disable officer dropdown, replace with badge: `👤 Your Orders (${user.name})`.
   - If `user.role === 'owner' || user.department === 'Dispatch'`:
     - Keep full company-wide listing with full officer dropdown.
2. **`web/src/pages/OrderDetail.tsx`**:
   - Check `isDispatch = user?.department === 'Dispatch' || user?.email?.includes('dispatch') || canRecord`.
   - If `isOwner || isDispatch`:
     - Show **Tick / Quick Dispatch** button.
     - Show **Mark Pending** button (`move('pending')`).
     - Show **Cancel order** button (`move('cancelled')`).
3. **`web/src/pages/DispatchHistory.tsx` & `web/src/lib/serverApi.ts`**:
   - Add `salespersonId?: string` to `listDispatches()`.
   - In `DispatchHistory.tsx`, pass `salespersonId: user?.department === 'Sales' ? user.employeeId : undefined`.

### 3.3 Mobile App Changes (`mobile/lib/`)
1. **`mobile/lib/data/mock_repository.dart`**:
   - Add helper `List<SalesOrder> ordersForUser(AppUser? user)`:
     - If `user == null || user.isOwner || user.department.toLowerCase() == 'dispatch'`: return `orders`.
     - If `user.role == UserRole.employee`: return `orders.where((o) => o.salespersonId == user.employeeId).toList()`.
   - Add helper `List<Dispatch> dispatchesForUser(AppUser? user)`:
     - If `user == null || user.isOwner || user.department.toLowerCase() == 'dispatch'`: return `dispatches`.
     - If `user.role == UserRole.employee`: return dispatches whose `order.salespersonId == user.employeeId`.
2. **`mobile/lib/features/sales/order_list_screen.dart`**:
   - Replace direct `repo.orders` with `repo.ordersForUser(repo.currentUser)`.
3. **`mobile/lib/features/sales/order_detail_screen.dart`**:
   - Allow Dispatch role (`currentUser.department == 'Dispatch' || currentUser.isOwner`) to change status to `pending`, `dispatched`, or `cancelled`.

---

## 4. Phased Execution Roadmap

### Phase 1: Backend Scoping & Authority (FastAPI)
- [ ] Add `get_caller_identity()` helper in `server/main.py`.
- [ ] Implement automatic employee order partition in `GET /api/v1/orders`.
- [ ] Implement salesperson dispatch partition in `GET /api/v1/dispatches`.
- [ ] Expand status transition authorization for Dispatch Person in `POST /api/v1/orders/{order_id}/status` and `/quick-dispatch`.
- [ ] Add automated pytest tests verifying role-based visibility and dispatch authority.

### Phase 2: Web Frontend Scoping & UI Actions (React/TypeScript)
- [ ] Update `web/src/lib/serverApi.ts` to support `salespersonId` in `listDispatches`.
- [ ] Update `web/src/pages/Orders.tsx` with role-aware filtering and UI locking for Sales Officers.
- [ ] Update `web/src/pages/OrderDetail.tsx` to authorize Dispatch Desk for Tick, Pending, and Cancel.
- [ ] Update `web/src/pages/DispatchHistory.tsx` to scope dispatches for Sales Officers.
- [ ] Run `npm run typecheck` and `npm test`.

### Phase 3: Mobile App Role Scoping (Flutter/Dart)
- [ ] Update `mock_repository.dart` with `ordersForUser` and `dispatchesForUser`.
- [ ] Update `order_list_screen.dart` to use scoped order lists.
- [ ] Update `order_detail_screen.dart` to support Dispatch role status transitions.
- [ ] Run `flutter test`.

### Phase 4: Verification & Cloud Deployment
- [ ] Run complete multi-stack verification gate:
  - `python -m pytest server/test_server.py`
  - `python -m ruff check server/`
  - `npm --prefix web run typecheck`
  - `npm --prefix web test -- --run`
  - `npm --prefix web run build`
  - `cd mobile; flutter test`
- [ ] Commit to git and push to `origin/main`.
- [ ] Test live against Render cloud (`https://durasmart2154.onrender.com`) across all three personas:
  1. Sales Officer (sees only own orders & own dispatches).
  2. Owner (sees all orders & dispatches, full authority).
  3. Dispatcher (sees all orders, ticks/dispatches, sets pending, cancels).

---

## 5. Verification Checkpoints

1. **Sales Officer Isolation**:
   - Logged in as `EMP-SP-01` (`Pankaj Goyal`):
     - Orders count matches only `salespersonId == 'EMP-SP-01'`.
     - Zero orders from `EMP-SP-02` (`Aman Deep Singh`) or others are visible.
     - Dispatches list shows only consignments associated with `EMP-SP-01`'s orders.
2. **Owner Visibility**:
   - Logged in as Owner (`Managing Director`):
     - Orders count shows 100% of orders.
     - Dispatches count shows 100% of dispatches.
     - Can switch filter between any officer or view all.
3. **Dispatch Desk Authority**:
   - Logged in as `EMP-DSP-01` (`Harpreet Singh - Yard Dispatch`):
     - Orders count shows 100% of company orders.
     - Can TICK (Quick-dispatch) any order.
     - Can set order status to PENDING.
     - Can CANCEL order or consignment.
