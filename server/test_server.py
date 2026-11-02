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

if __name__ == '__main__':
    unittest.main()
