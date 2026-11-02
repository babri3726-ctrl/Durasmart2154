import os
import sys

sys.path.insert(0, os.path.abspath("."))

from fastapi.testclient import TestClient

from server.main import app


def run_tests():
    client = TestClient(app)
    print("================ LIVE TEST SUITE ================")

    # 1. Test Customer Search by Station / City
    print("\n[1] Testing Customer Search by Station / City:")
    r = client.get("/api/v1/customers?q=Ludhiana&pageSize=10")
    assert r.status_code == 200, r.text
    data = r.json()
    print(f"  -> 'Ludhiana': found {data['total']} dealers. First: {data['items'][0]['name']} ({data['items'][0]['city']}, {data['items'][0]['state']})")
    assert data["total"] > 0
    assert any("ludhiana" in c["city"].lower() or "ludhiana" in c["name"].lower() for c in data["items"])

    r = client.get("/api/v1/customers?q=Rohtak&pageSize=10")
    assert r.status_code == 200, r.text
    data = r.json()
    print(f"  -> 'Rohtak': found {data['total']} dealers. First: {data['items'][0]['name']} ({data['items'][0]['city']}, {data['items'][0]['state']})")
    assert data["total"] > 0

    # 2. Test Customer Search by Salesperson
    print("\n[2] Testing Customer Search by Salesperson (Mozi Ram):")
    r = client.get("/api/v1/customers?q=Mozi&pageSize=10")
    assert r.status_code == 200, r.text
    data = r.json()
    print(f"  -> Found {data['total']} dealers under officer Mozi Ram.")
    assert data["total"] > 0
    assert all("mozi" in c.get("salesperson", "").lower() or "mozi" in c.get("name", "").lower() for c in data["items"])

    # 3. Test Territory Filtering (Punjab vs Haryana)
    print("\n[3] Testing Territory Filtering (Punjab vs Haryana):")
    r_pb = client.get("/api/v1/customers?state=Punjab&pageSize=100")
    assert r_pb.status_code == 200
    pb_total = r_pb.json()["total"]

    r_hr = client.get("/api/v1/customers?state=Haryana&pageSize=100")
    assert r_hr.status_code == 200
    hr_total = r_hr.json()["total"]
    print(f"  -> Active Punjab dealers: {pb_total}")
    print(f"  -> Active Haryana dealers: {hr_total}")
    assert pb_total >= 80
    assert hr_total >= 30

    # 4. Test Employees Territory Assignment
    print("\n[4] Testing Employees Territory Assignment:")
    r = client.get("/api/v1/employees?activeOnly=true&pageSize=50")
    assert r.status_code == 200
    employees = r.json()["items"]
    pb_officers = [e["name"] for e in employees if "punjab" in str(e.get("salesTerritory", "")).lower()]
    hr_officers = [e["name"] for e in employees if "haryana" in str(e.get("salesTerritory", "")).lower()]
    print(f"  -> Punjab Officers ({len(pb_officers)}): {', '.join(pb_officers[:3])}...")
    print(f"  -> Haryana Officers ({len(hr_officers)}): {', '.join(hr_officers[:3])}...")
    assert len(pb_officers) >= 8
    assert len(hr_officers) >= 5

    # 5. Test Order Creation with Handwritten Slip Photo alone
    print("\n[5] Testing Order Creation with Handwritten Slip Photo alone:")
    slip_data = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP..."
    order_payload = {
        "customerId": "DEBTOR-HR-001",
        "customerName": "KALRA TRADERS/ STEEL DERABASSI",
        "state": "Haryana",
        "salespersonId": "EMP-SP-07",
        "salespersonName": "Mozi Ram",
        "orderDate": "2026-10-24",
        "notes": "Booked from field diary chit photo",
        "status": "pending",
        "lines": [
            {
                "productName": "Material list as per attached slip",
                "quantity": "1.000",
                "unit": "MT",
                "ratePaise": 0,
                "gstRatePercent": None
            }
        ],
        "slipImageData": slip_data
    }
    r = client.post("/api/v1/orders", json=order_payload, headers={"Idempotency-Key": "test-key-live-slip-001"})
    assert r.status_code == 200, r.text
    created = r.json()
    order_id = created["id"]
    order_num = created["number"]
    print(f"  -> Order Created: ID={order_id}, Printed Number={order_num}")
    print(f"  -> Customer: {created['customerName']} ({created.get('state')})")
    print(f"  -> Assigned Officer: {created.get('salespersonName')}")
    print(f"  -> Slip Image Attached: {bool(created.get('slipImageData'))}")
    assert created.get("slipImageData") == slip_data

    # 6. Test Fetching Order Detail with Attached Slip
    print("\n[6] Testing Fetching Order Detail with Attached Slip:")
    r = client.get(f"/api/v1/orders/{order_id}")
    assert r.status_code == 200
    detail = r.json()
    assert detail["slipImageData"] == slip_data
    assert detail["salespersonName"] == "Mozi Ram"
    print("  -> Successfully retrieved order detail with verified slip photo data!")

    # 7. Test Updating Order (PATCH)
    print("\n[7] Testing Order PATCH:")
    r = client.patch(f"/api/v1/orders/{order_id}", json={"notes": "Updated note: Priority dispatch"})
    assert r.status_code == 200
    patched = r.json()
    assert patched["notes"] == "Updated note: Priority dispatch"
    assert patched["slipImageData"] == slip_data
    print("  -> Order patched successfully while preserving slip image!")

    # 8. Test Dashboard Sales Performance Endpoint
    print("\n[8] Testing Sales Performance Endpoint:")
    r = client.get("/api/v1/dashboard/salesperson-performance")
    assert r.status_code == 200
    perf = r.json()
    print(f"  -> Found {len(perf.get('rows', []))} performance records across Punjab & Haryana.")
    assert len(perf.get("rows", [])) > 0

    # 9. Test Quick Dispatch Action
    print("\n[9] Testing 1-Click Quick Dispatch Action:")
    # Verify order starts as pending dispatch
    r_check = client.get(f"/api/v1/orders/{order_id}")
    assert r_check.json()["dispatchStatus"] == "pending"
    print(f"  -> Order {order_id} dispatch status before: {r_check.json()['dispatchStatus']} (Pending)")

    # Execute quick dispatch
    r_dsp = client.post(
        f"/api/v1/orders/{order_id}/quick-dispatch",
        json={"vehicleNo": "PB 10 CT 4421", "notes": "Dispatched via gate pass #4421"}
    )
    assert r_dsp.status_code == 200, r_dsp.text
    dispatched_order = r_dsp.json()
    assert dispatched_order["dispatchStatus"] == "dispatched"
    assert dispatched_order["lastDispatchDate"] is not None
    assert dispatched_order["lines"][0]["dispatchedQuantity"] == dispatched_order["lines"][0]["orderedQuantity"]
    assert dispatched_order["lines"][0]["remainingQuantity"] == "0.000"
    print(f"  -> Order {order_id} dispatch status after: {dispatched_order['dispatchStatus']} (Dispatched / Done)")
    print("  -> Vehicle assigned: PB 10 CT 4421, Consignment recorded successfully!")

    # 10. Test Orders Queue Filtering (by dispatchStatus and salespersonId)
    print("\n[10] Testing Orders Queue Filtering (by dispatchStatus and salespersonId):")
    r_q_dsp = client.get("/api/v1/orders?dispatchStatus=dispatched")
    assert r_q_dsp.status_code == 200
    dsp_orders = r_q_dsp.json()["items"]
    assert any(o["id"] == order_id for o in dsp_orders)
    print(f"  -> Successfully verified dispatched orders queue filter: found {len(dsp_orders)} dispatched orders.")

    r_sp = client.get("/api/v1/orders?salespersonId=EMP-SP-07")
    assert r_sp.status_code == 200
    sp_orders = r_sp.json()["items"]
    assert len(sp_orders) > 0
    assert all(o.get("salespersonId") == "EMP-SP-07" for o in sp_orders)
    print(f"  -> Successfully verified salesperson filter: found {len(sp_orders)} orders belonging to EMP-SP-07 (Mozi Ram).")

    print("\n================ ALL TESTS PASSED SUCCESSFULLY! ================")

if __name__ == "__main__":
    run_tests()
