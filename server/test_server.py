import unittest

from fastapi.testclient import TestClient

from server.main import app


class TestServerApi(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        cls.client.post("/api/v1/payments/purge-tests")

    @classmethod
    def tearDownClass(cls):
        cls.client.post("/api/v1/payments/purge-tests")

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
        # 1. Owner Ishu Jindal Login
        r = self.client.post("/api/v1/auth/login", json={"username": "owner", "password": "Ishu@DuraSmart#2026"})
        self.assertEqual(r.status_code, 200, f"Login failed: {r.text}")
        data = r.json()
        self.assertIn("user", data)
        self.assertEqual(data["user"]["role"], "owner")
        self.assertEqual(data["user"]["name"], "Ishu Jindal")

        # 2. Owner Ishu Jindal Login via username
        r2 = self.client.post("/api/v1/auth/login", json={"username": "ishujindal", "password": "Ishu@DuraSmart#2026"})
        self.assertEqual(r2.status_code, 200)

        # 3. Real HR-PB Sales Employee Login
        r3 = self.client.post("/api/v1/auth/login", json={"username": "EMP-SP-01", "password": "DuraSmart@2026"})
        self.assertEqual(r3.status_code, 200)
        emp_data = r3.json()
        self.assertEqual(emp_data["user"]["name"], "AJAY JI")
        self.assertEqual(emp_data["user"]["role"], "employee")

        # 4. Insecure / dummy passwords strictly rejected
        r_bad_pwd = self.client.post("/api/v1/auth/login", json={"username": "owner", "password": "demo"})
        self.assertEqual(r_bad_pwd.status_code, 401)

        r_bad_user = self.client.post("/api/v1/auth/login", json={"username": "harpreet", "password": "demo"})
        self.assertEqual(r_bad_user.status_code, 401)

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
        from server.main import STATE
        import server.db as db

        # Ensure a test debtor has temporary balance and overdue for this test
        test_cust = next((c for c in STATE["customers"] if c["id"] == "DEBTOR-MAN-0140"), None)
        if not test_cust:
            test_cust = next((c for c in STATE["customers"] if c["id"] == "DEBTOR-HR-001"), None)

        initial_bal = float(test_cust.get("balance", 0.0))
        test_cust["balance"] = 50000.0
        test_cust["balance_formatted"] = "50000.00"
        test_cust["outstandingPaise"] = 5000000
        test_cust["overduePaise"] = 5000000
        test_cust["isOverdue"] = True
        try:
            db.save_party(test_cust)
        except Exception:
            pass

        payment_id = None
        try:
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
                "customerId": test_cust["id"],
                "customerName": test_cust["name"],
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
        finally:
            if payment_id:
                try:
                    self.client.delete(f"/api/v1/payments/{payment_id}")
                except Exception:
                    pass
            test_cust["balance"] = initial_bal
            test_cust["balance_formatted"] = f"{initial_bal:.2f}"
            test_cust["outstandingPaise"] = round(initial_bal * 100)
            test_cust["overduePaise"] = round(initial_bal * 100)
            test_cust["isOverdue"] = initial_bal > 0
            try:
                db.save_party(test_cust)
            except Exception:
                pass

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
        pay_id = None
        try:
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
        finally:
            if pay_id:
                try:
                    self.client.delete(f"/api/v1/payments/{pay_id}")
                except Exception:
                    pass

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
        try:
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
        finally:
            import server.db as db
            from server.main import STATE
            try:
                with db.get_connection() as conn:
                    conn.execute("DELETE FROM opening_balances WHERE customer_id = ?", (cust_id,))
                    conn.commit()
            except Exception:
                pass
            if cust_id in STATE.get("opening_balances", {}):
                STATE["opening_balances"][cust_id] = []
            cust = next((c for c in STATE.get("customers", []) if c["id"] == cust_id), None)
            if cust:
                cust["openingPaise"] = 0
                cust["outstandingPaise"] = 0
                cust["balance"] = 0.0
                cust["balance_formatted"] = "0.00"
                cust["overduePaise"] = 0
                cust["isOverdue"] = False
                try:
                    db.save_party(cust)
                except Exception:
                    pass

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

        try:
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
        finally:
            # 6. Delete the order and clean up any dispatches
            if o_id:
                self.client.delete(f"/api/v1/orders/{o_id}", headers={"X-User-Role": "owner"})
                from server.main import STATE
                import server.db as db
                STATE["dispatches"] = [d for d in STATE.get("dispatches", []) if d.get("orderId") != o_id]
                try:
                    conn = db.get_connection()
                    with conn:
                        conn.execute("DELETE FROM dispatches WHERE order_id = ?", (o_id,))
                except Exception:
                    pass

        # Verify dashboard completely reverted to baseline
        s_final = self.client.get("/api/v1/dashboard/summary").json()
        self.assertEqual(s_final["ordersValuePaise"], val_base)
        self.assertEqual(s_final["orderCount"], s_base["orderCount"])

    def test_18_top_receivables_dashboard_deduplication_and_order_updates(self):
        """Verifies Top Receivables feed in dashboard cockpit is strictly deduplicated and updates on orders and payments."""
        # 1. Baseline cockpit query
        cockpit_base = self.client.get("/api/v1/dashboard/cockpit").json()
        top_debtors_base = cockpit_base.get("topDebtors", [])
        
        # Check strict deduplication: no duplicate dealer names in topDebtors
        names = [d["name"].strip().lower() for d in top_debtors_base]
        self.assertEqual(len(names), len(set(names)), "topDebtors must contain strictly unique dealer names")

        # Find or use KALRA TRADERS
        dealer_name = "KALRA TRADERS/ STEEL DERABASSI"
        cust_id = "DEBTOR-HR-001"
        base_dealer_entry = next((d for d in top_debtors_base if d["name"].strip().lower() == dealer_name.lower()), None)
        base_bal = float(base_dealer_entry["balance"]) if base_dealer_entry else 0.0

        o_id = None
        p_id = None
        try:
            # 2. Book an order for this dealer with total amount 2,500,000 paise (25,000 INR)
            order_res = self.client.post("/api/v1/orders", json={
                "customerId": cust_id,
                "customerName": dealer_name,
                "status": "confirmed",
                "lines": [
                    {
                        "productName": "Color Coated Sheets",
                        "quantity": "5.000",
                        "unit": "MT",
                        "ratePaise": 500000,
                        "amountPaise": 2500000
                    }
                ]
            }, headers={"X-User-Role": "owner"})
            self.assertEqual(order_res.status_code, 200)
            o_id = order_res.json()["id"]

            # 3. Verify cockpit topDebtors balance reflects the new order (+25,000 INR)
            cockpit_after_order = self.client.get("/api/v1/dashboard/cockpit").json()
            dealer_after_order = next((d for d in cockpit_after_order["topDebtors"] if d["name"].strip().lower() == dealer_name.lower()), None)
            self.assertIsNotNone(dealer_after_order, "Dealer must appear in topDebtors")
            self.assertAlmostEqual(dealer_after_order["balance"], base_bal + 25000.0, places=2)

            # 4. Record a payment of 10,000 INR (1,000,000 paise) for this dealer
            pay_res = self.client.post("/api/v1/payments", json={
                "customerId": cust_id,
                "customerName": dealer_name,
                "amount": 10000.0,
                "amountPaise": 1000000,
                "method": "NEFT",
                "reference": "TEST-TOP-REC-PAY"
            })
            self.assertEqual(pay_res.status_code, 200)
            p_id = pay_res.json()["id"]

            # 5. Verify cockpit topDebtors balance decreased by 10,000 INR
            cockpit_after_pay = self.client.get("/api/v1/dashboard/cockpit").json()
            dealer_after_pay = next((d for d in cockpit_after_pay["topDebtors"] if d["name"].strip().lower() == dealer_name.lower()), None)
            self.assertAlmostEqual(dealer_after_pay["balance"], base_bal + 15000.0, places=2)

            # 6. Void payment
            void_res = self.client.post(f"/api/v1/payments/{p_id}/void")
            self.assertEqual(void_res.status_code, 200)

        finally:
            if p_id:
                try:
                    self.client.delete(f"/api/v1/payments/{p_id}")
                except Exception:
                    pass
            if o_id:
                self.client.delete(f"/api/v1/orders/{o_id}", headers={"X-User-Role": "owner"})
            from server.main import STATE
            import server.db as db
            cust = next((c for c in STATE.get("customers", []) if c["id"] == cust_id), None)
            if not cust:
                cust = next((d for d in STATE.get("debtors", []) if d["id"] == cust_id), None)
            if cust:
                cust["balance"] = base_bal
                cust["balance_formatted"] = f"{base_bal:.2f}"
                cust["outstandingPaise"] = round(base_bal * 100)
                cust["overduePaise"] = round(base_bal * 100)
                cust["isOverdue"] = base_bal > 0
                try:
                    db.save_party(cust)
                except Exception:
                    pass

        # 8. Verify clean reversion
        cockpit_final = self.client.get("/api/v1/dashboard/cockpit").json()
        dealer_final = next((d for d in cockpit_final["topDebtors"] if d["name"].strip().lower() == dealer_name.lower()), None)
        final_bal = float(dealer_final["balance"]) if dealer_final else 0.0
        self.assertAlmostEqual(final_bal, base_bal, places=2)

    def test_21_dispatch_salesperson_target_dynamic_adjustment(self):
        # 1. Fetch initial targets
        tgts_res = self.client.get("/api/v1/sales/targets")
        self.assertEqual(tgts_res.status_code, 200)
        tgts_data = tgts_res.json()
        self.assertTrue(len(tgts_data["items"]) > 0, "Targets list must not be empty")

        sample_tgt = tgts_data["items"][0]
        sp_name = sample_tgt["salesperson"]
        party_name = sample_tgt["party_name"]

        sp_summary_before = next((s for s in tgts_data["salesperson_summary"] if s["salesperson"].lower() == sp_name.lower()), None)
        self.assertIsNotNone(sp_summary_before, f"Salesperson {sp_name} must exist in summary")
        initial_disp = float(sp_summary_before["total_dispatched_mt"])
        initial_pending = float(sp_summary_before["total_pending_mt"])

        order_id = None
        dsp_id = None

        try:
            # 2. Create order for this party and salesperson
            order_res = self.client.post("/api/v1/orders", json={
                "customerName": party_name,
                "salespersonName": sp_name,
                "notes": "Target Auto-Adjustment Integration Test Order",
                "lines": [
                    {
                        "productId": "PRD-STEEL-BAR",
                        "productName": "TMT Rebar 500D",
                        "quantity": "10.000",
                        "unit": "MT",
                        "unitPrice": 50000.0
                    }
                ]
            })
            self.assertEqual(order_res.status_code, 200)
            order_data = order_res.json()
            order_id = order_data["id"]

            # 3. Create a dispatch of 4.000 MT
            dsp_res = self.client.post("/api/v1/dispatches", json={
                "orderId": order_id,
                "dispatchDate": "2026-11-03",
                "vehicle": "PB 10 Z 9999",
                "driver": "Test Yard Driver",
                "lines": [
                    {
                        "orderLineId": 1,
                        "productName": "TMT Rebar 500D",
                        "quantity": "4.000",
                        "unit": "MT"
                    }
                ]
            })
            self.assertEqual(dsp_res.status_code, 200)
            dsp_data = dsp_res.json()
            dsp_id = dsp_data["id"]

            # Verify target auto-adjustment: dispatched increases by 4.0, pending decreases by 4.0
            tgts_after_dsp = self.client.get("/api/v1/sales/targets").json()
            sp_after_dsp = next((s for s in tgts_after_dsp["salesperson_summary"] if s["salesperson"].lower() == sp_name.lower()), None)
            self.assertAlmostEqual(float(sp_after_dsp["total_dispatched_mt"]), initial_disp + 4.000, places=3)
            self.assertAlmostEqual(float(sp_after_dsp["total_pending_mt"]), max(0.0, initial_pending - 4.000), places=3)

            # Verify in /api/v1/dashboard/salesperson-performance
            perf_after_dsp = self.client.get("/api/v1/dashboard/salesperson-performance").json()
            sp_perf = next((r for r in perf_after_dsp["rows"] if r["employeeName"].lower() == sp_name.lower()), None)
            self.assertIsNotNone(sp_perf)
            self.assertAlmostEqual(float(sp_perf["units"][0]["dispatchedQuantity"]), initial_disp + 4.000, places=3)

            # 4. Edit dispatch weight (Increase weight: from 4.000 MT to 7.000 MT -> delta +3.000 MT)
            edit_res = self.client.patch(f"/api/v1/dispatches/{dsp_id}", json={
                "lines": [
                    {
                        "dispatchLineId": 1,
                        "orderLineId": 1,
                        "quantity": "7.000",
                        "unit": "MT"
                    }
                ],
                "notes": "Weighbridge updated weight to 7 MT"
            })
            self.assertEqual(edit_res.status_code, 200)

            tgts_after_inc = self.client.get("/api/v1/sales/targets").json()
            sp_after_inc = next((s for s in tgts_after_inc["salesperson_summary"] if s["salesperson"].lower() == sp_name.lower()), None)
            self.assertAlmostEqual(float(sp_after_inc["total_dispatched_mt"]), initial_disp + 7.000, places=3)
            self.assertAlmostEqual(float(sp_after_inc["total_pending_mt"]), max(0.0, initial_pending - 7.000), places=3)

            # 5. Edit dispatch weight (Decrease weight: from 7.000 MT to 5.000 MT -> delta -2.000 MT)
            edit_dec_res = self.client.patch(f"/api/v1/dispatches/{dsp_id}", json={
                "lines": [
                    {
                        "dispatchLineId": 1,
                        "orderLineId": 1,
                        "quantity": "5.000",
                        "unit": "MT"
                    }
                ],
                "notes": "Tare deduction applied: 5 MT net"
            })
            self.assertEqual(edit_dec_res.status_code, 200)

            tgts_after_dec = self.client.get("/api/v1/sales/targets").json()
            sp_after_dec = next((s for s in tgts_after_dec["salesperson_summary"] if s["salesperson"].lower() == sp_name.lower()), None)
            self.assertAlmostEqual(float(sp_after_dec["total_dispatched_mt"]), initial_disp + 5.000, places=3)
            self.assertAlmostEqual(float(sp_after_dec["total_pending_mt"]), max(0.0, initial_pending - 5.000), places=3)

            # 6. Void dispatch -> Should cleanly revert by -5.000 MT back to initial baseline
            void_res = self.client.post(f"/api/v1/dispatches/{dsp_id}/void")
            self.assertEqual(void_res.status_code, 200)

            tgts_after_void = self.client.get("/api/v1/sales/targets").json()
            sp_after_void = next((s for s in tgts_after_void["salesperson_summary"] if s["salesperson"].lower() == sp_name.lower()), None)
            self.assertAlmostEqual(float(sp_after_void["total_dispatched_mt"]), initial_disp, places=3)
            self.assertAlmostEqual(float(sp_after_void["total_pending_mt"]), initial_pending, places=3)

        finally:
            # 7. Complete cleanup of test data so state remains pristine
            from server.main import STATE
            import server.db as db

            if dsp_id:
                STATE["dispatches"] = [d for d in STATE.get("dispatches", []) if d["id"] != dsp_id]
                try:
                    conn = db.get_connection()
                    with conn:
                        conn.execute("DELETE FROM dispatches WHERE id = ?", (dsp_id,))
                except Exception:
                    pass

            if order_id:
                STATE["orders"] = [o for o in STATE.get("orders", []) if o["id"] != order_id]
                try:
                    conn = db.get_connection()
                    with conn:
                        conn.execute("DELETE FROM orders WHERE id = ?", (order_id,))
                except Exception:
                    pass

            # Restore original target figures on matching targets
            for t in STATE.get("targets", []):
                if t.get("salesperson", "").lower() == sp_name.lower() and t.get("party_name", "").lower() == party_name.lower():
                    t["dispatched_mt"] = f"{float(sample_tgt.get('dispatched_mt', 0.0)):.3f}"
                    t["pending_mt"] = f"{float(sample_tgt.get('pending_mt', 0.0)):.3f}"
                    try:
                        db.save_target(t)
                    except Exception:
                        pass

        # Final verification: targets back to original
        tgts_clean = self.client.get("/api/v1/sales/targets").json()
        sp_clean = next((s for s in tgts_clean["salesperson_summary"] if s["salesperson"].lower() == sp_name.lower()), None)
        self.assertAlmostEqual(float(sp_clean["total_dispatched_mt"]), initial_disp, places=3)
        self.assertAlmostEqual(float(sp_clean["total_pending_mt"]), initial_pending, places=3)

    def test_22_payment_permanent_deletion_and_purge(self):
        # 1. Create a payment
        res = self.client.post("/api/v1/payments", json={
            "customerId": "DEBTOR-HR-001",
            "customerName": "KALRA TRADERS/ STEEL DERABASSI",
            "amount": 10000.0,
            "method": "NEFT",
            "reference": "TEST-DELETE-VERIFY"
        })
        self.assertEqual(res.status_code, 200)
        pay_id = res.json()["id"]

        # 2. Check it appears in payments list
        p_list = self.client.get("/api/v1/payments").json()["items"]
        self.assertTrue(any(p["id"] == pay_id for p in p_list))

        # 3. Permanently delete payment
        del_res = self.client.delete(f"/api/v1/payments/{pay_id}")
        self.assertEqual(del_res.status_code, 200)
        self.assertTrue(del_res.json()["deleted"])

        # 4. Confirm it no longer exists anywhere
        p_list2 = self.client.get("/api/v1/payments").json()["items"]
        self.assertFalse(any(p["id"] == pay_id for p in p_list2))

        # 5. Purge test endpoint
        purge_res = self.client.post("/api/v1/payments/purge-tests")
        self.assertEqual(purge_res.status_code, 200)
        self.assertTrue(purge_res.json()["success"])

if __name__ == '__main__':
    unittest.main()
