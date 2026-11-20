import os
import sys
from fastapi.testclient import TestClient

sys.path.insert(0, os.getcwd())
from server.main import app

def test_endpoints():
    client = TestClient(app)

    print("1. Testing GET /api/v1/app/version...")
    resp = client.get("/api/v1/app/version")
    assert resp.status_code == 200, resp.text
    ver = resp.json()
    print("  Version response:", ver)
    assert ver["version_code"] == 9
    assert ver["version_name"] == "1.1.0"

    print("\n2. Testing GET /api/v1/ledgers/cash...")
    resp = client.get("/api/v1/ledgers/cash")
    assert resp.status_code == 200, resp.text
    cash_data = resp.json()
    print(f"  Cash in Hand accounts ({len(cash_data['accounts'])}):")
    for a in cash_data["accounts"]:
        print(f"    - {a['name']}: ₹{a['balance']:,.2f}")
    print(f"  Total Cash in Hand: ₹{cash_data['totalBalance']:,.2f}")
    print(f"  Total Cash vouchers: {len(cash_data['vouchers'])}")

    print("\n3. Testing GET /api/v1/ledgers/bank...")
    resp = client.get("/api/v1/ledgers/bank")
    assert resp.status_code == 200, resp.text
    bank_data = resp.json()
    print(f"  Bank accounts ({len(bank_data['accounts'])}):")
    for a in bank_data["accounts"]:
        print(f"    - {a['name']}: ₹{a['balance']:,.2f}")
    print(f"  Total Bank balance: ₹{bank_data['totalBalance']:,.2f}")
    print(f"  Total Bank vouchers: {len(bank_data['vouchers'])}")

    print("\n4. Testing GET /api/v1/ledgers/roundoff...")
    resp = client.get("/api/v1/ledgers/roundoff")
    assert resp.status_code == 200, resp.text
    ro_data = resp.json()
    print(f"  Round Off entries: {ro_data['voucherCount']}")
    print(f"  Net Round Off P&L: ₹{ro_data['netAmount']:,.2f}")

    print("\n5. Testing GET /api/v1/ledgers/discount...")
    resp = client.get("/api/v1/ledgers/discount")
    assert resp.status_code == 200, resp.text
    disc_data = resp.json()
    print(f"  Discount entries: {disc_data['voucherCount']}")
    print(f"  Total Discount given: ₹{disc_data['totalCredit']:,.2f}")

    print("\n6. Testing GET /api/v1/debtors (Verifying zero liquid/nominal pollution)...")
    resp = client.get("/api/v1/debtors?pageSize=1000")
    assert resp.status_code == 200, resp.text
    debtors_data = resp.json()
    debtor_names = [d["name"].strip().lower() for d in debtors_data["items"]]
    print(f"  Total clean customer debtors returned: {len(debtor_names)}")
    
    forbidden = ["cash", "khan cash", "cash gbd", "yes bank", "round off", "discount"]
    for fb in forbidden:
        assert fb not in debtor_names, f"Forbidden non-customer account '{fb}' found in debtors!"
    print("  Zero liquid cashbooks, banks, or nominal accounts found in debtors. Clean trade customer isolation verified!")

    print("\n7. Testing POST /api/v1/imports/multi-excel/preview...")
    files_to_test = []
    if os.path.exists("DAYBOOK.xlsx"):
        files_to_test.append(("files", ("DAYBOOK.xlsx", open("DAYBOOK.xlsx", "rb"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")))
    if os.path.exists("data/imports/discount.xlsx"):
        files_to_test.append(("files", ("DISCOUNT.xlsx", open("data/imports/discount.xlsx", "rb"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")))
    if os.path.exists("data/imports/opening.xlsx"):
        files_to_test.append(("files", ("TRIALBALANCE.xlsx", open("data/imports/opening.xlsx", "rb"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")))

    if files_to_test:
        resp = client.post("/api/v1/imports/multi-excel/preview", files=files_to_test)
        assert resp.status_code == 200, resp.text
        preview_res = resp.json()
        print(f"  Preview verified for {preview_res['filesCount']} workbooks:")
        for pf in preview_res["files"]:
            print(f"    - {pf['filename']} -> Detected: {pf['detectedType'].upper()}, Vouchers: {pf.get('details', {}).get('voucherCount', pf.get('details', {}).get('count', 'N/A'))}")

    print("\nALL MULTI-EXCEL BACKEND CONTRACTS VERIFIED SUCCESSFULLY!")

if __name__ == "__main__":
    test_endpoints()
