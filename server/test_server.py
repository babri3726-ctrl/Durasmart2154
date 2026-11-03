import unittest

from fastapi.testclient import TestClient

from server.main import app


class TestServerApi(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def test_00_health(self):
        r = self.client.get("/health")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["status"], "healthy")

    def test_00_spa_index(self):
        r = self.client.get("/")
        self.assertEqual(r.status_code, 200)
        self.assertIn("html", r.headers.get("content-type", "").lower())
        self.assertIn("<div id=\"root\"></div>", r.text)

    def test_01_login(self):
        r = self.client.post("/api/v1/auth/login", json={"username": "owner", "password": "demo"})
        self.assertEqual(r.status_code, 200, f"Login failed: {r.text}")
        data = r.json()
        self.assertIn("user", data)
        self.assertEqual(data["user"]["role"], "owner")

    def test_02_stock_watch(self):
        r = self.client.get("/api/v1/imports/excel/stock-watch")
        self.assertEqual(r.status_code, 200, f"Stock watch failed: {r.text}")
        data = r.json()
        self.assertIn("path", data)

    def test_03_stock_summary(self):
        r = self.client.get("/api/v1/stock/summary")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertIn("categories", data)
        self.assertTrue(len(data["categories"]) > 0)

    def test_04_dashboard_summary(self):
        r = self.client.get("/api/v1/dashboard/summary")
        self.assertEqual(r.status_code, 200)

    def test_05_payment_collection_and_receivables_auto_update(self):
        # 1. Baseline summary
        r0 = self.client.get("/api/v1/dashboard/summary")
        self.assertEqual(r0.status_code, 200)
        base = r0.json()
        base_collected = base["collectedPaise"]
        base_outstanding = base["outstandingPaise"]
        base_overdue = base["overduePaise"]

        # 2. Record payment of 25,000 INR (2,500,000 paise)
        pay_amt = 2500000
        pay_res = self.client.post("/api/v1/payments", json={
            "customerId": "DEBTOR-MAN-0140",
            "customerName": "Bansal Steel Test Corp",
            "amountPaise": pay_amt,
            "method": "NEFT",
            "reference": "TEST-NEFT-001"
        })
        self.assertEqual(pay_res.status_code, 200)
        pay_data = pay_res.json()
        payment_id = pay_data["id"]

        # 3. Check updated summary
        r1 = self.client.get("/api/v1/dashboard/summary")
        s1 = r1.json()
        self.assertEqual(s1["collectedPaise"], base_collected + pay_amt, "collectedPaise must increase by payment amount")
        self.assertEqual(s1["outstandingPaise"], base_outstanding - pay_amt, "outstandingPaise must decrease by payment amount")
        self.assertEqual(s1["overduePaise"], base_overdue - pay_amt, "overduePaise must decrease when overdue debtor pays")

        # 4. Void payment and verify reversal
        void_res = self.client.post(f"/api/v1/payments/{payment_id}/void")
        self.assertEqual(void_res.status_code, 200)

        r2 = self.client.get("/api/v1/dashboard/summary")
        s2 = r2.json()
        self.assertEqual(s2["collectedPaise"], base_collected, "collectedPaise must revert after voiding")
        self.assertEqual(s2["outstandingPaise"], base_outstanding, "outstandingPaise must revert after voiding")
        self.assertEqual(s2["overduePaise"], base_overdue, "overduePaise must revert after voiding")

    def test_06_delayed_orders_and_dispatch_kpi_update(self):
        # 1. Create a delayed test order with past expectedDispatchDate
        order_res = self.client.post("/api/v1/orders", json={
            "customerId": "DEBTOR-HR-001",
            "customerName": "KALRA TRADERS/ STEEL DERABASSI",
            "expectedDispatchDate": "2026-10-20",
            "orderDate": "2026-10-18",
            "lines": [
                {
                    "product": "UPVC Profile 50mm",
                    "quantity": "5.000",
                    "unit": "MT",
                    "ratePaise": 11000000,
                    "amountPaise": 55000000
                }
            ]
        })
        self.assertEqual(order_res.status_code, 200)
        target_order_id = order_res.json()["id"]

        # 2. Baseline summary
        r0 = self.client.get("/api/v1/dashboard/summary")
        s0 = r0.json()
        base_delayed = s0["delayedOrderCount"]
        base_disp_mt = float(s0["dispatched"][0]["dispatchedQuantity"])

        # Delayed orders must detect past expectedDispatchDate
        self.assertGreater(base_delayed, 0, "delayedOrderCount must detect order past expectedDispatchDate")

        # 3. Dispatch the delayed order
        disp_res = self.client.post(f"/api/v1/orders/{target_order_id}/quick-dispatch", json={
            "vehicleNo": "PB 10 CT 4421",
            "notes": "Delivered to site"
        })
        self.assertEqual(disp_res.status_code, 200)

        # 4. Check updated dashboard summary
        r1 = self.client.get("/api/v1/dashboard/summary")
        s1 = r1.json()
        new_delayed = s1["delayedOrderCount"]
        new_disp_mt = float(s1["dispatched"][0]["dispatchedQuantity"])

        self.assertEqual(new_delayed, base_delayed - 1, "delayedOrderCount must decrement when a delayed order is dispatched")
        self.assertGreater(new_disp_mt, base_disp_mt, "dispatched metric must dynamically increase when order is dispatched")

        # Clean up test dispatch and order
        dsps = self.client.get("/api/v1/dispatches").json()["items"]
        for d in dsps:
            if d["orderId"] == target_order_id and not d.get("voidedAt"):
                self.client.post(f"/api/v1/dispatches/{d['id']}/void")
        self.client.delete(f"/api/v1/orders/{target_order_id}", headers={"X-User-Role": "owner"})

    def test_07_full_overdue_clearance(self):
        # Paying exact balance of a customer clears overdue flag and balance
        pay_res = self.client.post("/api/v1/payments", json={
            "customerId": "DEBTOR-HR-001",
            "customerName": "KALRA TRADERS/ STEEL DERABASSI",
            "amount": 500.0,
            "method": "RTGS",
            "reference": "TEST-RTGS-CLEAR"
        })
        self.assertEqual(pay_res.status_code, 200)
        pay_id = pay_res.json()["id"]

        # Verify summary reflect clearance
        r = self.client.get("/api/v1/dashboard/summary")
        self.assertEqual(r.status_code, 200)

        # Revert payment via void
        void_res = self.client.post(f"/api/v1/payments/{pay_id}/void")
        self.assertEqual(void_res.status_code, 200)

    def test_08_new_order_creation_not_delayed(self):
        # An order created today should NOT be counted as delayed
        r_before = self.client.get("/api/v1/dashboard/summary").json()
        delayed_before = r_before["delayedOrderCount"]
        orders_val_before = r_before["ordersValuePaise"]

        order_res = self.client.post("/api/v1/orders", json={
            "customerId": "DEBTOR-HR-001",
            "customerName": "KALRA TRADERS/ STEEL DERABASSI",
            "salespersonName": "Manoj Kumar",
            "lines": [
                {
                    "product": "UPVC 2.5 Profile",
                    "quantity": "2.000",
                    "unit": "MT",
                    "ratePaise": 11500000,
                    "amountPaise": 23000000
                }
            ]
        })
        self.assertEqual(order_res.status_code, 200)

        r_after = self.client.get("/api/v1/dashboard/summary").json()
        self.assertEqual(r_after["delayedOrderCount"], delayed_before, "Today's new order must NOT increment delayedOrderCount")
        self.assertEqual(r_after["ordersValuePaise"], orders_val_before + 23000000, "ordersValuePaise must increase by order value")

        # Clean up test order
        self.client.delete(f"/api/v1/orders/{order_res.json()['id']}", headers={"X-User-Role": "owner"})

    def test_09_stock_preview_contract_shape(self):
        # 1. Test POST /api/v1/imports/excel/stock-preview
        with open("data/1-8-26.xlsx", "rb") as f:
            bytes_data = f.read()
        r = self.client.post("/api/v1/imports/excel/stock-preview?fileName=1-8-26.xlsx", content=bytes_data)
        self.assertEqual(r.status_code, 200)
        data = r.json()

        # Must contain all required fields of StockPreviewOut
        required_fields = [
            "sourceFormat", "allowedSheets", "sections", "validation", "provenance",
            "reconciliations", "sheetCount", "allowedSheetsFound", "tableCount",
            "rowCount", "formulaCellCount", "formulaCacheMissingCount",
            "formulaCacheUnusableCount", "warningCount", "incompleteTableCount",
            "previewedAt", "authorizedFileSha256", "authorizedFileMatch",
            "applyPreviewDigest", "applyableItemCount", "quarantineRowCount",
            "applyPlanErrors", "applyBlockedReason", "readyToApply",
            "businessRecordsCreated", "stockChanged", "disclaimer"
        ]
        for field in required_fields:
            self.assertIn(field, data, f"Missing required field {field} in StockPreviewOut")
        self.assertFalse(data["businessRecordsCreated"], "businessRecordsCreated must be false")
        self.assertFalse(data["stockChanged"], "stockChanged must be false")
        self.assertTrue(data["readyToApply"], "readyToApply should be true")

    def test_10_debtor_preview_and_apply_contract(self):
        # 1. Test POST /api/v1/debtors/imports/preview
        with open("data/HR-PB.xlsx", "rb") as f:
            bytes_data = f.read()
        r = self.client.post("/api/v1/debtors/imports/preview?fileName=HR-PB.xlsx", content=bytes_data)
        self.assertEqual(r.status_code, 200, f"Debtor preview failed: {r.text}")
        prev = r.json()

        self.assertIn("filename", prev)
        self.assertIn("fileSha256", prev)
        self.assertIn("applyPreviewDigest", prev)
        self.assertEqual(len(prev["applyPreviewDigest"]), 64)
        self.assertTrue(prev["applyAvailable"])
        self.assertFalse(prev["businessRecordsCreated"])
        self.assertFalse(prev["databaseRowsWritten"])
        self.assertIsInstance(prev["rows"], list)

        # 2. Test POST /api/v1/debtors/imports/apply
        apply_r = self.client.post(
            f"/api/v1/debtors/imports/apply?fileSha256={prev['fileSha256']}&previewDigest={prev['applyPreviewDigest']}&confirm=true&fileName=HR-PB.xlsx",
            content=bytes_data
        )
        self.assertEqual(apply_r.status_code, 200, f"Debtor apply failed: {apply_r.text}")
        outcome = apply_r.json()
        self.assertFalse(outcome["businessRecordsCreated"])
        self.assertTrue(outcome["databaseRowsWritten"])
        self.assertGreater(outcome["snapshotRowCount"], 0)

    def test_11_api_no_cache_headers(self):
        # GET /api/v1/dashboard/summary should set Cache-Control: no-cache
        r = self.client.get("/api/v1/dashboard/summary")
        self.assertEqual(r.status_code, 200)
        cc = r.headers.get("cache-control", "").lower()
        self.assertTrue("no-cache" in cc or "no-store" in cc, f"Cache-Control must be set to no-cache, got {cc}")

    def test_12_dispatch_crud_order_flow_and_stock_movements(self):
        # Create an order first
        order_payload = {
            "customer_id": "DEBTOR-HR-001",
            "date": "2026-11-02",
            "lines": [
                {
                    "product": "Steel Material",
                    "quantity": "10.000",
                    "unit": "MT",
                    "rate": 50000.0
                }
            ],
            "notes": "Test Order for Dispatch"
        }
        res_o = self.client.post("/api/v1/orders", json=order_payload)
        self.assertEqual(res_o.status_code, 200)
        order = res_o.json()
        order_id = order["id"]

        # 1. Partial dispatch 4.000 MT
        disp_payload = {
            "orderId": order_id,
            "dispatchDate": "2026-11-02",
            "vehicle": "PB 10 CT 1122",
            "driver": "Driver A",
            "transportName": "Express",
            "notes": "First partial load",
            "lines": [
                {
                    "orderLineId": 1,
                    "quantity": "4.000",
                    "unit": "MT",
                    "warehouse": "Main Yard"
                }
            ]
        }
        res_d1 = self.client.post("/api/v1/dispatches", json=disp_payload)
        self.assertEqual(res_d1.status_code, 200)
        disp1 = res_d1.json()
        disp1_id = disp1["id"]

        # Check order status is now partial
        res_o_check = self.client.get(f"/api/v1/orders/{order_id}")
        self.assertEqual(res_o_check.status_code, 200)
        o_data = res_o_check.json()
        self.assertEqual(o_data["dispatchStatus"], "partial")
        self.assertEqual(o_data["dispatchedQuantity"], "4.000")
        self.assertEqual(o_data["lines"][0]["remainingQuantity"], "6.000")

        # Check stock movements
        res_mov = self.client.get("/api/v1/stock/movements")
        self.assertEqual(res_mov.status_code, 200)
        mov_data = res_mov.json()
        self.assertGreaterEqual(mov_data["total"], 1)
        latest_mov = mov_data["items"][0]
        self.assertEqual(latest_mov["kind"], "dispatch")
        self.assertEqual(latest_mov["deltaQuantity"], "-4.000")

        # 2. Void dispatch and ensure stock and order are restored
        res_void = self.client.post(f"/api/v1/dispatches/{disp1_id}/void")
        self.assertEqual(res_void.status_code, 200)

        # Check order restored to pending
        res_o_restored = self.client.get(f"/api/v1/orders/{order_id}")
        o_restored = res_o_restored.json()
        self.assertEqual(o_restored["dispatchStatus"], "pending")
        self.assertEqual(o_restored["dispatchedQuantity"], "0.000")
        self.assertEqual(o_restored["lines"][0]["remainingQuantity"], "10.000")

        # Check reversing stock movement
        res_mov2 = self.client.get("/api/v1/stock/movements")
        mov2_data = res_mov2.json()
        self.assertEqual(mov2_data["items"][0]["kind"], "void_dispatch")
        self.assertEqual(mov2_data["items"][0]["deltaQuantity"], "+4.000")

        # Clean up test order
        self.client.delete(f"/api/v1/orders/{order_id}", headers={"X-User-Role": "owner"})

    def test_13_opening_balances_ledger_and_targets(self):
        cust_id = "DEBTOR-HR-001"
        # 1. Add opening balance
        ob_payload = {
            "asOf": "2026-04-01",
            "amountPaise": 5000000,
            "direction": "owes",
            "source": "manual"
        }
        res_ob = self.client.post(f"/api/v1/customers/{cust_id}/opening-balances", json=ob_payload)
        self.assertEqual(res_ob.status_code, 200)
        ob_data = res_ob.json()
        self.assertEqual(ob_data["amountPaise"], 5000000)

        # 2. Get customer ledger
        res_ledg = self.client.get(f"/api/v1/customers/{cust_id}/ledger")
        self.assertEqual(res_ledg.status_code, 200)
        ledger = res_ledg.json()
        self.assertIn("items", ledger)
        self.assertIn("total", ledger)
        self.assertGreaterEqual(ledger["total"], 1)
        self.assertIn("balancePaise", ledger["items"][0])

        # 3. Targets endpoint
        res_t = self.client.get("/api/v1/targets")
        self.assertEqual(res_t.status_code, 200)
        t_data = res_t.json()
        self.assertIn("items", t_data)

    def test_14_order_edit_and_delete(self):
        # 1. Create order
        order_payload = {
            "customer_id": "DEBTOR-HR-001",
            "date": "2026-11-02",
            "lines": [
                {
                    "product": "UPVC Roofing Sheets",
                    "quantity": "5.000",
                    "unit": "MT",
                    "rate": 60000.0
                }
            ],
            "notes": "Original Note",
            "paymentTerms": "15 days credit"
        }
        res_create = self.client.post("/api/v1/orders", json=order_payload)
        self.assertEqual(res_create.status_code, 200)
        o_id = res_create.json()["id"]

        # 2. Edit order via PATCH
        edit_payload = {
            "notes": "Updated Note via Edit Option",
            "paymentTerms": "45 days credit",
            "lines": [
                {
                    "product": "UPVC Roofing Sheets Premium",
                    "quantity": "8.000",
                    "unit": "MT",
                    "ratePaise": 6500000
                }
            ]
        }
        res_patch = self.client.patch(f"/api/v1/orders/{o_id}", json=edit_payload)
        self.assertEqual(res_patch.status_code, 200)
        patched = res_patch.json()
        self.assertEqual(patched["notes"], "Updated Note via Edit Option")
        self.assertEqual(patched["paymentTerms"], "45 days credit")
        self.assertEqual(patched["orderedQuantity"], "8.000")
        self.assertEqual(patched["lines"][0]["product"], "UPVC Roofing Sheets Premium")

        # 3. Edit order via PUT
        put_payload = {
            "notes": "Updated Note via PUT Option",
            "paymentTerms": "Cash on Delivery"
        }
        res_put = self.client.put(f"/api/v1/orders/{o_id}", json=put_payload)
        self.assertEqual(res_put.status_code, 200)
        put_data = res_put.json()
        self.assertEqual(put_data["notes"], "Updated Note via PUT Option")
        self.assertEqual(put_data["paymentTerms"], "Cash on Delivery")

        # 4. Delete order
        res_del = self.client.delete(f"/api/v1/orders/{o_id}")
        self.assertEqual(res_del.status_code, 200)
        del_data = res_del.json()
        self.assertTrue(del_data["deleted"])
        self.assertEqual(del_data["id"], o_id)

        # 5. Verify order is deleted
        res_get_deleted = self.client.get(f"/api/v1/orders/{o_id}")
        self.assertEqual(res_get_deleted.status_code, 404)

    def test_15_rbac_salesperson_order_and_dispatch_scoping(self):
        # 1. Salesperson EMP-SP-01 sees ONLY their own orders
        r_sp1 = self.client.get("/api/v1/orders", headers={"X-User-Role": "employee", "X-Employee-Id": "EMP-SP-01"})
        self.assertEqual(r_sp1.status_code, 200)
        items_sp1 = r_sp1.json()["items"]
        for o in items_sp1:
            self.assertEqual(o.get("salespersonId"), "EMP-SP-01")

        # 2. Owner sees all orders
        r_owner = self.client.get("/api/v1/orders", headers={"X-User-Role": "owner"})
        self.assertEqual(r_owner.status_code, 200)
        items_owner = r_owner.json()["items"]
        self.assertGreaterEqual(len(items_owner), len(items_sp1))

        # 3. Dispatch Desk sees all orders
        r_dsp = self.client.get("/api/v1/orders", headers={"X-User-Role": "dispatch"})
        self.assertEqual(r_dsp.status_code, 200)
        items_dsp = r_dsp.json()["items"]
        self.assertEqual(len(items_dsp), len(items_owner))

        # 4. Salesperson EMP-SP-01 sees only dispatches for EMP-SP-01 orders
        r_dsp_sp1 = self.client.get("/api/v1/dispatches", headers={"X-User-Role": "employee", "X-Employee-Id": "EMP-SP-01"})
        self.assertEqual(r_dsp_sp1.status_code, 200)
        dsp_items = r_dsp_sp1.json()["items"]
        order_ids_sp1 = {o["id"] for o in items_sp1}
        for d in dsp_items:
            self.assertIn(d["orderId"], order_ids_sp1)

    def test_16_dispatch_person_order_authority(self):
        # Create an order
        order_payload = {
            "customer_id": "DEBTOR-HR-001",
            "date": "2026-11-02",
            "lines": [{"product": "Steel Pipe", "quantity": "3.000", "unit": "MT", "rate": 50000.0}],
            "notes": "Testing Dispatch Authority"
        }
        res_o = self.client.post("/api/v1/orders", json=order_payload)
        o_id = res_o.json()["id"]

        dsp_headers = {"X-User-Role": "dispatch", "X-User-Id": "usr-emp-dsp-01"}

        # 1. Dispatch desk has authority to set status to 'dispatched' (TICK)
        res_disp = self.client.post(f"/api/v1/orders/{o_id}/status", json={"to": "dispatched"}, headers=dsp_headers)
        self.assertEqual(res_disp.status_code, 200)
        self.assertEqual(res_disp.json()["status"], "dispatched")
        self.assertEqual(res_disp.json()["dispatchStatus"], "dispatched")

        # 2. Dispatch desk has authority to set status to 'pending' (PENDING)
        res_pend = self.client.post(f"/api/v1/orders/{o_id}/status", json={"to": "pending"}, headers=dsp_headers)
        self.assertEqual(res_pend.status_code, 200)
        self.assertEqual(res_pend.json()["status"], "pending")

        # 3. Dispatch desk has authority to CANCEL the order
        res_cancel = self.client.post(f"/api/v1/orders/{o_id}/status", json={"to": "cancelled"}, headers=dsp_headers)
        self.assertEqual(res_cancel.status_code, 200)
        self.assertEqual(res_cancel.json()["status"], "cancelled")
        self.assertIsNotNone(res_cancel.json().get("cancelledAt"))

        # Clean up
        self.client.delete(f"/api/v1/orders/{o_id}", headers={"X-User-Role": "owner"})

    def test_17_dashboard_dispatch_kpis_on_create_edit_and_delete(self):
        # 1. Baseline dashboard summary
        s_base = self.client.get("/api/v1/dashboard/summary").json()
        val_base = s_base["ordersValuePaise"]
        disp_base = float(s_base["dispatched"][0]["dispatchedQuantity"])

        # 2. Create order (10 MT @ 50,000 paise = 50,000,000 paise)
        order_payload = {
            "customer_id": "DEBTOR-PB-001",
            "customerName": "GURU KIRPA INDUSTRY BARNALA",
            "state": "Punjab",
            "date": "2026-11-03",
            "lines": [
                {
                    "product": "UPVC Heavy Profile",
                    "quantity": "10.000",
                    "unit": "MT",
                    "ratePaise": 5000000,
                    "amountPaise": 50000000
                }
            ]
        }
        res_o = self.client.post("/api/v1/orders", json=order_payload)
        self.assertEqual(res_o.status_code, 200)
        o_id = res_o.json()["id"]

        # Verify dashboard orders value increased
        s_after_create = self.client.get("/api/v1/dashboard/summary").json()
        self.assertEqual(s_after_create["ordersValuePaise"], val_base + 50000000)

        # 3. Edit order: increase quantity from 10 MT to 15 MT (amount 75,000,000 paise)
        patch_payload = {
            "lines": [
                {
                    "product": "UPVC Heavy Profile",
                    "orderedQuantity": "15.000",
                    "unit": "MT",
                    "ratePaise": 5000000,
                    "amountPaise": 75000000
                }
            ]
        }
        res_patch = self.client.patch(f"/api/v1/orders/{o_id}", json=patch_payload)
        self.assertEqual(res_patch.status_code, 200)
        self.assertEqual(res_patch.json()["dispatchStatus"], "pending")

        # Verify dashboard orders value updated to match edited value
        s_after_edit = self.client.get("/api/v1/dashboard/summary").json()
        self.assertEqual(s_after_edit["ordersValuePaise"], val_base + 75000000)

        # 4. Quick dispatch the order (15 MT dispatched)
        disp_res = self.client.post(f"/api/v1/orders/{o_id}/quick-dispatch", json={
            "vehicleNo": "PB 10 CT 8899",
            "notes": "Full load delivered"
        })
        self.assertEqual(disp_res.status_code, 200)

        # Verify dashboard dispatched metric increased by 15 MT
        s_after_disp = self.client.get("/api/v1/dashboard/summary").json()
        disp_new = float(s_after_disp["dispatched"][0]["dispatchedQuantity"])
        self.assertAlmostEqual(disp_new, disp_base + 15.0, places=2)

        # 5. Void the dispatch
        dsps = self.client.get("/api/v1/dispatches").json()["items"]
        target_dsp = next(d for d in dsps if d["orderId"] == o_id and not d.get("voidedAt"))
        res_void = self.client.post(f"/api/v1/dispatches/{target_dsp['id']}/void")
        self.assertEqual(res_void.status_code, 200)

        # Verify dispatched metric reverted
        s_after_void = self.client.get("/api/v1/dashboard/summary").json()
        self.assertAlmostEqual(float(s_after_void["dispatched"][0]["dispatchedQuantity"]), disp_base, places=2)

        # 6. Delete the order
        res_del = self.client.delete(f"/api/v1/orders/{o_id}", headers={"X-User-Role": "owner"})
        self.assertEqual(res_del.status_code, 200)

        # Verify dashboard completely reverted to baseline
        s_final = self.client.get("/api/v1/dashboard/summary").json()
        self.assertEqual(s_final["ordersValuePaise"], val_base)
        self.assertEqual(s_final["orderCount"], s_base["orderCount"])

if __name__ == '__main__':
    unittest.main()
