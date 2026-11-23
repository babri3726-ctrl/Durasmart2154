import sys
import os
import json
from fastapi.testclient import TestClient

# Add project root to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from server.main import app, STATE, db

client = TestClient(app)

def run_tests():
    print("=================================================================")
    print("RUNNING RBAC, SCOPING, AND AUTHORITY AUTOMATED VERIFICATION TESTS")
    print("=================================================================")

    # Test 1: Debtor Scoping for Salespersons vs Dispatch vs Owner
    print("\n--- Test 1: Debtor Balance Scoping ---")
    
    # 1. Ajay Ji (Sales EMP-SP-01)
    res_ajay_debtors = client.get(
        "/api/v1/debtors",
        headers={"X-User-Role": "sales", "X-Employee-Id": "EMP-SP-01"}
    )
    assert res_ajay_debtors.status_code == 200, f"Expected 200, got {res_ajay_debtors.status_code}"
    ajay_debtors = res_ajay_debtors.json()["items"]
    print(f"Ajay Ji (EMP-SP-01) Debtors count: {len(ajay_debtors)}")
    assert len(ajay_debtors) > 0, "Ajay Ji should have assigned debtors"
    # Verify EVERY debtor returned to Ajay belongs to him
    for d in ajay_debtors:
        assert (d.get("salesperson") or "").strip().lower() == "ajay ji" or d.get("salespersonId") == "EMP-SP-01", \
            f"Debtor {d.get('name')} does not belong to Ajay Ji!"

    # 2. Aksit (Sales EMP-SP-02)
    res_aksit_debtors = client.get(
        "/api/v1/debtors",
        headers={"X-User-Role": "sales", "X-Employee-Id": "EMP-SP-02"}
    )
    assert res_aksit_debtors.status_code == 200
    aksit_debtors = res_aksit_debtors.json()["items"]
    print(f"Aksit (EMP-SP-02) Debtors count: {len(aksit_debtors)}")
    assert len(aksit_debtors) > 0, "Aksit should have assigned debtors"
    for d in aksit_debtors:
        assert (d.get("salesperson") or "").strip().lower() == "aksit" or d.get("salespersonId") == "EMP-SP-02", \
            f"Debtor {d.get('name')} does not belong to Aksit!"

    # Cross-check: No overlap between Ajay and Aksit
    ajay_names = {d["name"] for d in ajay_debtors}
    aksit_names = {d["name"] for d in aksit_debtors}
    overlap = ajay_names.intersection(aksit_names)
    assert len(overlap) == 0, f"Debtor scoping leaked: overlap found {overlap}"

    # 3. Dispatch Person sees ALL debtors
    res_dispatch_debtors = client.get(
        "/api/v1/debtors?pageSize=1000",
        headers={"X-User-Role": "dispatch", "X-User-Id": "DSP-01"}
    )
    assert res_dispatch_debtors.status_code == 200
    dispatch_debtors = res_dispatch_debtors.json()["items"]
    dispatch_names = {d["name"] for d in dispatch_debtors}
    print(f"Dispatch Person Debtors count: {len(dispatch_debtors)}")
    assert len(dispatch_debtors) >= len(ajay_debtors) + len(aksit_debtors), "Dispatch should see ALL debtors"
    assert next(iter(ajay_names)) in dispatch_names, "Dispatch must see Ajay's debtors"
    assert next(iter(aksit_names)) in dispatch_names, "Dispatch must see Aksit's debtors"

    # 4. Owner sees ALL debtors
    res_owner_debtors = client.get(
        "/api/v1/debtors?pageSize=1000",
        headers={"X-User-Role": "owner", "X-User-Id": "EMP-OWNER-01"}
    )
    assert res_owner_debtors.status_code == 200
    owner_debtors = res_owner_debtors.json()["items"]
    print(f"Owner Debtors count: {len(owner_debtors)}")
    assert len(owner_debtors) == len(dispatch_debtors), "Owner and Dispatch both see the entire debtor ledger"

    print("✓ Debtor scoping tests PASSED 100%!")

    # Test 2: Order Booking & Scoping
    print("\n--- Test 2: Order Visibility Scoping ---")

    # Ajay Ji (Sales EMP-SP-01) creates Order 1 for one of his debtors
    target_debtor = ajay_debtors[0]
    new_order_payload = {
        "customerId": target_debtor["id"],
        "customerName": target_debtor["name"],
        "orderDate": "2026-11-23",
        "lines": [
            {
                "productCode": "TMT-12MM",
                "productName": "TMT 550D 12mm",
                "quantity": 12.5,
                "unit": "MT",
                "rate": 52000.0,
                "taxRate": 18.0,
            }
        ],
        "notes": "Urgent yard dispatch test"
    }

    res_create = client.post(
        "/api/v1/orders",
        json=new_order_payload,
        headers={"X-User-Role": "sales", "X-Employee-Id": "EMP-SP-01"}
    )
    assert res_create.status_code in [200, 201], f"Order creation failed: {res_create.text}"
    created_order = res_create.json()
    order_id = created_order["id"]
    print(f"Created Order ID: {order_id} by Ajay Ji (EMP-SP-01) for {target_debtor['name']}")

    # 1. Ajay (Creator) queries /orders -> Sees the order
    res_ajay_orders = client.get(
        "/api/v1/orders",
        headers={"X-User-Role": "sales", "X-Employee-Id": "EMP-SP-01"}
    )
    ajay_order_ids = [o["id"] for o in res_ajay_orders.json()["items"]]
    print("Ajay Ji visible orders count:", len(ajay_order_ids))
    assert order_id in ajay_order_ids, "Ajay Ji should see his created order"

    # 2. Aksit (Different Salesperson) queries /orders -> Does NOT see Ajay's order
    res_aksit_orders = client.get(
        "/api/v1/orders",
        headers={"X-User-Role": "sales", "X-Employee-Id": "EMP-SP-02"}
    )
    aksit_order_ids = [o["id"] for o in res_aksit_orders.json()["items"]]
    print("Aksit visible orders count:", len(aksit_order_ids))
    assert order_id not in aksit_order_ids, "Aksit MUST NOT see Ajay Ji's order"

    # 3. Dispatch Person queries /orders -> Sees Ajay's order
    res_dispatch_orders = client.get(
        "/api/v1/orders",
        headers={"X-User-Role": "dispatch", "X-User-Id": "DSP-01"}
    )
    dispatch_order_ids = [o["id"] for o in res_dispatch_orders.json()["items"]]
    print("Dispatch visible orders count:", len(dispatch_order_ids))
    assert order_id in dispatch_order_ids, "Dispatch person MUST see the order"

    # 4. Owner queries /orders -> Sees Ajay's order
    res_owner_orders = client.get(
        "/api/v1/orders",
        headers={"X-User-Role": "owner", "X-User-Id": "EMP-OWNER-01"}
    )
    owner_order_ids = [o["id"] for o in res_owner_orders.json()["items"]]
    print("Owner visible orders count:", len(owner_order_ids))
    assert order_id in owner_order_ids, "Owner MUST see the order"

    print("✓ Order scoping tests PASSED 100%!")

    # Test 3: Dispatch Authority Gating
    print("\n--- Test 3: Dispatch Authority Gating ---")

    # Salesperson attempts quick dispatch -> 403 Forbidden
    res_sales_dispatch = client.post(
        f"/api/v1/orders/{order_id}/quick-dispatch",
        json={"vehicleNo": "PB 10 CT 9999", "notes": "Unauthorized sales dispatch attempt"},
        headers={"X-User-Role": "sales", "X-Employee-Id": "EMP-SP-01"}
    )
    print("Salesperson quick-dispatch response code:", res_sales_dispatch.status_code)
    assert res_sales_dispatch.status_code == 403, "Salesperson MUST be forbidden from dispatching (403)"

    # Dispatch Person executes quick dispatch -> 200 OK
    res_dispatch_exec = client.post(
        f"/api/v1/orders/{order_id}/quick-dispatch",
        json={"vehicleNo": "PB 10 CT 4421", "notes": "Authorized yard dispatch"},
        headers={"X-User-Role": "dispatch", "X-User-Id": "DSP-01"}
    )
    print("Dispatch Person quick-dispatch response code:", res_dispatch_exec.status_code)
    assert res_dispatch_exec.status_code == 200, f"Dispatch Person should succeed: {res_dispatch_exec.text}"
    dispatched_order = res_dispatch_exec.json()
    assert dispatched_order["dispatchStatus"] == "dispatched", "Order status should be dispatched"

    print("✓ Dispatch authority gating tests PASSED 100%!")

    # Test 4: Master Settings Access
    print("\n--- Test 4: Master Settings Authority ---")
    # Read settings (any user)
    res_settings_read = client.get("/api/v1/settings")
    assert res_settings_read.status_code == 200
    assert "companyName" in res_settings_read.json()

    # Salesperson attempts PATCH /settings -> 403 Forbidden
    res_sales_patch = client.patch(
        "/api/v1/settings",
        json={"defaultCreditDays": 30},
        headers={"X-User-Role": "sales", "X-Employee-Id": "EMP-SP-01"}
    )
    assert res_sales_patch.status_code == 403, "Salesperson cannot patch master settings (403)"

    # Owner attempts PATCH /settings -> 200 OK
    res_owner_patch = client.patch(
        "/api/v1/settings",
        json={"defaultCreditDays": 20},
        headers={"X-User-Role": "owner", "X-User-Id": "EMP-OWNER-01"}
    )
    assert res_owner_patch.status_code == 200, "Owner can patch master settings"
    assert res_owner_patch.json()["settings"]["defaultCreditDays"] == 20

    print("✓ Settings authority tests PASSED 100%!")

    print("\n=================================================================")
    print("ALL 4 RBAC, SCOPING, AND AUTHORITY VERIFICATION TESTS PASSED 100%!")
    print("=================================================================")

if __name__ == "__main__":
    run_tests()
