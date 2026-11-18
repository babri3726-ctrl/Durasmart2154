import os
import sqlite3
import pytest
from server.voucher_parser import is_accounting_workbook, parse_accounting_workbook
from server import db

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def find_test_file(name: str) -> str:
    for p in [
        os.path.join(BASE_DIR, "data", "imports", name),
        os.path.join(BASE_DIR, "data", name),
        os.path.join(BASE_DIR, name),
    ]:
        if os.path.exists(p):
            return p
    return os.path.join(BASE_DIR, "data", "imports", name)


SALES_PATH = find_test_file("sales.xlsx")
HDFC_PATH = find_test_file("hdfc.xlsx")
YES_PATH = find_test_file("yes.xlsx")


def test_accounting_workbook_detection():
    assert is_accounting_workbook(SALES_PATH) is True
    assert is_accounting_workbook(HDFC_PATH) is True
    assert is_accounting_workbook(YES_PATH) is True


def test_sales_workbook_parsing():
    res = parse_accounting_workbook(SALES_PATH)
    assert res["bookSource"] == "Sales Register"
    # 125 active sales vouchers (1 cancelled bill with 0 amount skipped)
    assert res["voucherCount"] == 125
    # Total debit in sales.xlsx row 132 is 55630258
    assert res["totalDebitPaise"] == 5563025800
    assert res["totalCreditPaise"] == 0

    first_v = res["vouchers"][0]
    assert first_v["voucherType"] == "Sales"
    assert first_v["partyName"] == "Jaswinder Steel Works Weilding Ludhiana"
    assert first_v["debitPaise"] == 7752000


def test_hdfc_bank_parsing():
    res = parse_accounting_workbook(HDFC_PATH)
    assert res["bookSource"] == "HDFC Bank Book"
    # 124 transaction vouchers (opening balance row excluded)
    assert res["voucherCount"] == 124
    # Liquid book: sheet debit (receipts from parties) is party credit
    assert res["totalCreditPaise"] == 3141641800
    # Total credit excluding Opening Balance (60271001.59 - 24104343.59 = 36166658.00) is party debit (payments)
    assert res["totalDebitPaise"] == 3616665800

    # Verify 'To' prefix was cleaned
    gagan_v = next((v for v in res["vouchers"] if "GAGAN" in v["partyName"]), None)
    assert gagan_v is not None
    assert gagan_v["partyName"] == "GAGAN EASTMAN CHOCK W"
    assert gagan_v["voucherType"] == "Receipt"
    assert gagan_v["creditPaise"] == 20000000
    assert gagan_v["debitPaise"] == 0


def test_yes_bank_parsing():
    res = parse_accounting_workbook(YES_PATH)
    assert res["bookSource"] == "Yes Bank Book"
    # 110 transaction vouchers (opening balance row excluded)
    assert res["voucherCount"] == 110
    # Liquid book: sheet debit (receipts from parties) is party credit
    assert res["totalCreditPaise"] == 4598705600
    # Total credit excluding Opening Balance (46443766.47 - 7490874.79 = 38952891.68) is party debit (payments)
    assert res["totalDebitPaise"] == 3895289168


def test_idempotent_import_and_balance_update():
    db.init_db()

    # Clear vouchers and opening balances to ensure clean test baseline
    with db.get_connection() as conn:
        conn.execute("DELETE FROM vouchers")
        conn.execute("DELETE FROM opening_balances")
        conn.commit()

    # 1. Parse and apply sales.xlsx
    sales_data = parse_accounting_workbook(SALES_PATH)
    sales_res = db.save_vouchers_batch(sales_data["vouchers"], file_sha="test_sales_sha")
    assert sales_res["insertedCount"] > 0 or sales_res["skippedCount"] > 0

    # Check Gagan Eastman Chock initial balance after sales
    with db.get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id, balance_paise FROM parties WHERE name LIKE '%GAGAN%EASTMAN%'")
        row = cur.fetchone()
        assert row is not None
        gagan_id, gagan_sales_bal = row
        assert gagan_sales_bal == 42468000  # ₹4,24,680.00

    # 2. Parse and apply hdfc.xlsx (Receipt of ₹2,00,000 for Gagan)
    hdfc_data = parse_accounting_workbook(HDFC_PATH)
    hdfc_res = db.save_vouchers_batch(hdfc_data["vouchers"], file_sha="test_hdfc_sha")
    assert hdfc_res["insertedCount"] > 0

    # Check Gagan Eastman Chock balance after receipt deduction
    with db.get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT balance_paise FROM parties WHERE id = ?", (gagan_id,))
        bal_after_rcpt = cur.fetchone()[0]
        # ₹4,24,680 - ₹2,00,000 = ₹2,24,680.00 (22468000 paise)
        assert bal_after_rcpt == 22468000

    # 3. Test Deduplication: Re-applying HDFC should skip all vouchers
    re_hdfc_res = db.save_vouchers_batch(hdfc_data["vouchers"], file_sha="test_hdfc_sha")
    assert re_hdfc_res["insertedCount"] == 0
    assert re_hdfc_res["skippedCount"] == len(hdfc_data["vouchers"])

    # Balance must remain unchanged
    with db.get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT balance_paise FROM parties WHERE id = ?", (gagan_id,))
        assert cur.fetchone()[0] == 22468000

        # Clean up test vouchers and reset test party balance so main test suite remains clean
        conn.execute("DELETE FROM vouchers WHERE file_sha256 IN ('test_sales_sha', 'test_hdfc_sha')")
        conn.execute("UPDATE parties SET balance_paise = 0 WHERE id = ?", (gagan_id,))
        conn.commit()


def test_1click_sync_accounting_books_endpoint():
    from fastapi.testclient import TestClient
    from server.main import app

    client = TestClient(app)
    resp = client.post("/api/v1/imports/excel/accounting-books/sync")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "success"
    assert "Sales Register" in data["booksSynced"]
    assert "HDFC Bank Book" in data["booksSynced"]
    assert "Yes Bank Book" in data["booksSynced"]

    # Clean up test-synced vouchers
    with db.get_connection() as conn:
        conn.execute("DELETE FROM vouchers WHERE book_source IN ('Sales Register', 'HDFC Bank Book', 'Yes Bank Book')")
        conn.commit()
    persisted = db.load_all_persisted_state()
    from server.main import STATE
    STATE["debtors"] = persisted["debtors"]
    STATE["customers"] = persisted["customers"]


def test_voucher_crud_and_transfer_and_journal_and_merge():
    from fastapi.testclient import TestClient
    from server.main import app

    client = TestClient(app)

    with db.get_connection() as conn:
        # Create Party A (Haryana) and Party B (Punjab)
        conn.execute("INSERT OR REPLACE INTO parties (id, name, state, balance_paise, created_at, updated_at) VALUES ('TEST-HR-1', 'Alpha Steels HR', 'Haryana', 0, '2026-11-16', '2026-11-16')")
        conn.execute("INSERT OR REPLACE INTO parties (id, name, state, balance_paise, created_at, updated_at) VALUES ('TEST-PB-2', 'Alpha Steels PB', 'Punjab', 0, '2026-11-16', '2026-11-16')")
        # Insert initial sales voucher for Party A: ₹50,000 (5000000 paise)
        conn.execute("INSERT INTO vouchers (id, voucher_no, voucher_type, voucher_date, party_name, party_id, debit_paise, credit_paise, book_source, file_sha256, created_at) VALUES ('VCH-TEST-1', 'INV-101', 'Sales', '2026-11-16', 'Alpha Steels HR', 'TEST-HR-1', 5000000, 0, 'Sales Book', 'test_sha', '2026-11-16')")
        conn.commit()
    db.recompute_party_balance("TEST-HR-1")

    # 1. Verify initial balance of Party A is 50,000
    with db.get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT balance_paise FROM parties WHERE id = 'TEST-HR-1'")
        assert cur.fetchone()[0] == 5000000

    # 2. Test Journal Entry: Credit note (discount) of ₹5,000
    jv_resp = client.post("/api/v1/debtors/TEST-HR-1/journal", json={
        "type": "CREDIT",
        "amount": 5000.0,
        "reference": "JV-DISCOUNT",
        "notes": "5000 discount"
    })
    assert jv_resp.status_code == 200
    with db.get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT balance_paise FROM parties WHERE id = 'TEST-HR-1'")
        # Balance should now be 50,000 - 5,000 = 45,000 (4500000 paise)
        assert cur.fetchone()[0] == 4500000

    # 3. Test Voucher Edit: Update INV-101 from 50,000 to 60,000
    edit_resp = client.put("/api/v1/vouchers/VCH-TEST-1", json={
        "debitAmount": 60000.0,
        "voucherNo": "INV-101-REV"
    })
    assert edit_resp.status_code == 200
    with db.get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT balance_paise FROM parties WHERE id = 'TEST-HR-1'")
        # Balance should now be 60,000 - 5,000 = 55,000 (5500000 paise)
        assert cur.fetchone()[0] == 5500000

    # 4. Test Voucher Transfer: Shift VCH-TEST-1 from Party A (HR) to Party B (PB)
    xfer_resp = client.post("/api/v1/vouchers/VCH-TEST-1/transfer", json={
        "targetPartyId": "TEST-PB-2",
        "notes": "Booked to HR by mistake"
    })
    assert xfer_resp.status_code == 200
    with db.get_connection() as conn:
        cur = conn.cursor()
        # Party A balance: only the credit note remains (0 net receivable)
        cur.execute("SELECT balance_paise FROM parties WHERE id = 'TEST-HR-1'")
        assert cur.fetchone()[0] == 0
        # Party B balance: gets the 60,000 sales voucher
        cur.execute("SELECT balance_paise FROM parties WHERE id = 'TEST-PB-2'")
        assert cur.fetchone()[0] == 6000000

    # 5. Test Opening Balance Update on Party A
    ob_resp = client.put("/api/v1/debtors/TEST-HR-1/opening-balance", json={
        "amount": 25000.0,
        "asOf": "2026-11-01"
    })
    assert ob_resp.status_code == 200
    with db.get_connection() as conn:
        cur = conn.cursor()
        # 25,000 opening - 5,000 credit note = 20,000
        cur.execute("SELECT balance_paise FROM parties WHERE id = 'TEST-HR-1'")
        assert cur.fetchone()[0] == 2000000

    # 6. Test Merge Parties: Consolidate Party A into Party B
    merge_resp = client.post("/api/v1/debtors/merge", json={
        "sourcePartyId": "TEST-HR-1",
        "targetPartyId": "TEST-PB-2"
    })
    assert merge_resp.status_code == 200
    merge_data = merge_resp.json()
    assert merge_data["targetPartyId"] == "TEST-PB-2"
    assert merge_data["vouchersMoved"] == 1  # The JV credit note moved

    with db.get_connection() as conn:
        cur = conn.cursor()
        # Party A is gone
        cur.execute("SELECT id FROM parties WHERE id = 'TEST-HR-1'")
        assert cur.fetchone() is None
        # Party B has combined: 60,000 sales + 25,000 opening - 5,000 JV = 80,000 (8000000 paise)
        cur.execute("SELECT balance_paise FROM parties WHERE id = 'TEST-PB-2'")
        assert cur.fetchone()[0] == 8000000

        # 7. Test Voucher Delete: delete the sales voucher
        del_resp = client.delete("/api/v1/vouchers/VCH-TEST-1")
        assert del_resp.status_code == 200
        # Party B balance drops by 60,000 -> 20,000
        cur.execute("SELECT balance_paise FROM parties WHERE id = 'TEST-PB-2'")
        assert cur.fetchone()[0] == 2000000

        # Clean up test records
        conn.execute("DELETE FROM parties WHERE id = 'TEST-PB-2'")
        conn.execute("DELETE FROM vouchers WHERE party_id IN ('TEST-HR-1', 'TEST-PB-2')")
        conn.execute("DELETE FROM opening_balances WHERE customer_id IN ('TEST-HR-1', 'TEST-PB-2')")
        conn.commit()


def test_opening_balance_and_receipt_credit_recomputation():
    """Verify that opening balance with debit direction and customer ledger receipts with credit_paise recompute party balance accurately."""
    from fastapi.testclient import TestClient
    from server.main import app
    client = TestClient(app)

    party_id = "TEST-RECOMP-1"
    with db.get_connection() as conn:
        conn.execute("DELETE FROM parties WHERE id = ?", (party_id,))
        conn.execute("DELETE FROM opening_balances WHERE customer_id = ?", (party_id,))
        conn.execute("DELETE FROM vouchers WHERE party_id = ?", (party_id,))

        # 1. Insert party with 0 balance
        conn.execute(
            "INSERT INTO parties (id, name, state, city, balance_paise, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (party_id, "Test Party Recompute", "Punjab", "Ludhiana", 0, "2026-11-16T12:00:00", "2026-11-16T12:00:00")
        )

        # 2. Add opening balance: 20,000 (2000000 paise) with direction 'debit'
        conn.execute(
            "INSERT INTO opening_balances (customer_id, as_of, amount_paise, direction, source, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (party_id, "2026-04-01", 2000000, "debit", "customer_ledger", "2026-11-16T12:00:00")
        )

        # 3. Add Sales voucher: 50,000 (5000000 debit_paise)
        conn.execute(
            "INSERT INTO vouchers (id, voucher_no, voucher_type, voucher_date, party_name, party_id, debit_paise, credit_paise, book_source, file_sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            ("VCH-REC-S1", "INV-101", "Sales", "2026-04-05", "Test Party Recompute", party_id, 5000000, 0, "Ledger", "sha", "2026-11-16T12:00:00")
        )

        # 4. Add Customer Ledger Receipt voucher: 30,000 (3000000 credit_paise, 0 debit_paise)
        conn.execute(
            "INSERT INTO vouchers (id, voucher_no, voucher_type, voucher_date, party_name, party_id, debit_paise, credit_paise, book_source, file_sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            ("VCH-REC-R1", "REC-201", "Receipt", "2026-04-10", "Test Party Recompute", party_id, 0, 3000000, "Ledger", "sha", "2026-11-16T12:00:00")
        )

        # Recompute
        db.recompute_party_balance(party_id, conn)

        # Net balance should be: 20,000 (OB) + 50,000 (Sales) - 30,000 (Receipt) = 40,000 (4000000 paise)
        cur = conn.cursor()
        cur.execute("SELECT balance_paise FROM parties WHERE id = ?", (party_id,))
        assert cur.fetchone()[0] == 4000000

    # Test load_all_persisted_state correctly surfaces openingBalance and openingPaise
    state = db.load_all_persisted_state()
    test_d = next((d for d in state["debtors"] if d["id"] == party_id), None)
    assert test_d is not None
    assert test_d["openingPaise"] == 2000000
    assert test_d["openingBalance"] == 20000.0
    assert test_d["balance"] == 40000.0

    # Rehydrate in-memory STATE for API testing
    from server.main import STATE
    STATE["debtors"] = state["debtors"]
    STATE["customers"] = state["customers"]

    # Test API endpoint /api/v1/debtors returns openingBalance
    resp = client.get(f"/api/v1/debtors?q=Test Party Recompute")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["items"]) >= 1
    api_item = next(i for i in data["items"] if i["id"] == party_id)
    assert api_item["openingBalance"] == 20000.0
    assert api_item["openingPaise"] == 2000000

    # Clean up
    with db.get_connection() as conn:
        conn.execute("DELETE FROM parties WHERE id = ?", (party_id,))
        conn.execute("DELETE FROM opening_balances WHERE customer_id = ?", (party_id,))
        conn.execute("DELETE FROM vouchers WHERE party_id = ?", (party_id,))
        conn.commit()


def test_daybook_parsing_and_import():
    """Verify that Day Book spreadsheets parse all voucher types and non-currency units without error."""
    import os
    from fastapi.testclient import TestClient
    from server.main import app
    from server.voucher_parser import parse_accounting_workbook

    daybook_path = find_test_file("daybook.xlsx")
    if not os.path.exists(daybook_path):
        return

    parsed = parse_accounting_workbook(daybook_path)
    assert parsed["bookSource"] == "Day Book"
    assert parsed["voucherCount"] >= 480

    types = {v["voucherType"] for v in parsed["vouchers"]}
    assert "Sales" in types
    assert "Receipt" in types
    assert "Payment" in types
    assert "Contra" in types

    client = TestClient(app)
    with open(daybook_path, "rb") as f:
        content = f.read()

    prev_res = client.post("/api/v1/debtors/imports/preview?fileName=daybook.xlsx", content=content)
    assert prev_res.status_code == 200
    prev_data = prev_res.json()
    assert prev_data["source"] == "tally-vouchers"
    assert len(prev_data["rows"]) >= 480


def test_comprehensive_deduplication():
    """Verify that cross-book, case-varying, and manual payment duplicates are strictly prevented."""
    from fastapi.testclient import TestClient
    from server.main import app

    client = TestClient(app)

    # 1. Test cross-book and case-insensitive deduplication in save_vouchers_batch
    batch_1 = [{
        "id": "VCH-DEDUP-1",
        "voucherNo": "DB-100",
        "voucherType": "Receipt",
        "voucherDate": "2026-11-17",
        "partyName": "DEDUP TEST PARTY",
        "debitPaise": 0,
        "creditPaise": 500000,
        "bookSource": "Day Book"
    }]
    res1 = db.save_vouchers_batch(batch_1)
    assert res1["insertedCount"] == 1

    # Same receipt from bank book with blank voucher_no and mixed-case party name
    batch_2 = [{
        "id": "VCH-DEDUP-2",
        "voucherNo": "",
        "voucherType": "Receipt",
        "voucherDate": "2026-11-17",
        "partyName": "Dedup Test Party",
        "debitPaise": 0,
        "creditPaise": 500000,
        "bookSource": "HDFC Bank Book"
    }]
    res2 = db.save_vouchers_batch(batch_2)
    assert res2["insertedCount"] == 0
    assert res2["skippedCount"] == 1

    # 2. Test manual payment duplicate rejection (HTTP 409)
    pmt_payload = {
        "customerId": "DEBTOR-DEDUP-1",
        "customerName": "Manual Dedup Customer",
        "amount": 25000.0,
        "paymentDate": "2026-11-17",
        "method": "NEFT"
    }
    # First submission -> 200 OK
    p1 = client.post("/api/v1/payments", json=pmt_payload)
    assert p1.status_code == 200

    # Second duplicate submission with same customer, date, amount -> 409 Conflict
    p2 = client.post("/api/v1/payments", json=pmt_payload)
    assert p2.status_code == 409
    assert "Duplicate payment" in p2.json()["detail"]

    # Clean up test artifacts
    with db.get_connection() as conn:
        conn.execute("DELETE FROM vouchers WHERE id IN ('VCH-DEDUP-1', 'VCH-DEDUP-2')")
        conn.execute("DELETE FROM payments WHERE customer_id = 'DEBTOR-DEDUP-1'")
        conn.commit()


def test_discount_ledger_parsing_and_reconciliation():
    discount_path = find_test_file("discount.xlsx")
    if not os.path.exists(discount_path):
        pytest.skip("discount.xlsx not present in workspace")

    parsed = parse_accounting_workbook(discount_path)
    assert parsed["isDiscountLedger"] is True
    assert parsed["bookSource"] == "Discount Ledger"
    assert parsed["voucherCount"] >= 270

    # Verify Amar Trading row exists
    amar_v = next((v for v in parsed["vouchers"] if "AMAR TRADING" in v["partyName"]), None)
    assert amar_v is not None
    assert amar_v["partyName"] == "AMAR TRADING CO. (Nasrala)W"
    assert amar_v["voucherDate"] == "2026-06-01"
    assert amar_v["voucherNo"] == "3"
    assert amar_v["creditPaise"] == 209200
    assert amar_v["debitPaise"] == 0


def test_opening_balance_parsing_and_import():
    from fastapi.testclient import TestClient
    from server.main import app
    client = TestClient(app)

    opening_path = find_test_file("opening.xlsx")
    if not os.path.exists(opening_path):
        pytest.skip("opening.xlsx not present in workspace")

    from server.voucher_parser import is_opening_balance_workbook, parse_opening_balance_workbook
    assert is_opening_balance_workbook(opening_path) is True

    parsed = parse_opening_balance_workbook(opening_path)
    assert parsed["count"] >= 450
    assert parsed["totalDebitPaise"] > 0

    with open(opening_path, "rb") as f:
        content = f.read()

    res = client.post("/api/v1/imports/excel/opening-balance?fileName=opening.xlsx", content=content)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "success"
    assert data["details"]["updatedCount"] >= 430

    # Verify Amar Trading was updated accurately
    with db.get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT balance_paise FROM parties WHERE name LIKE '%AMAR TRADING CO. (Nasrala)W%'")
        row = cur.fetchone()
        assert row is not None
        assert row[0] == 55556200


def test_roundoff_ledger_parsing_and_reconciliation():
    roundoff_path = find_test_file("rounoff.xlsx")
    if not os.path.exists(roundoff_path):
        pytest.skip("rounoff.xlsx not present in workspace")

    parsed = parse_accounting_workbook(roundoff_path)
    assert parsed["isRoundoffLedger"] is True
    assert parsed["bookSource"] == "Round Off Ledger"
    assert parsed["voucherCount"] >= 50

    # Verify New Jindal row exists
    jindal_v = next((v for v in parsed["vouchers"] if "New Jindal" in v["partyName"]), None)
    assert jindal_v is not None
    assert jindal_v["voucherDate"] == "2026-04-01"
    assert jindal_v["creditPaise"] == 10000000

    res = db.reconcile_roundoff_vouchers(parsed["vouchers"], file_sha="test_roundoff_sha")
    assert res["status"] == "success"
    assert res["affectedPartiesCount"] >= 30


def test_identical_vouchers_preservation_and_reconciliation():
    """Verify that multiple legitimate identical vouchers on same date & amount are never dropped or deleted."""
    from server.voucher_parser import parse_accounting_workbook
    daybook_path = find_test_file("daybook.xlsx")
    discount_path = find_test_file("discount.xlsx")
    if not os.path.exists(daybook_path) or not os.path.exists(discount_path):
        pytest.skip("daybook.xlsx or discount.xlsx not present")

    # Daybook parse produces distinct IDs for row 5184 and 5185
    parsed_db = parse_accounting_workbook(daybook_path)
    disc_31 = [v for v in parsed_db["vouchers"] if v.get("voucherDate") == "2026-07-31" and v.get("debitPaise") == 1508300]
    assert len(disc_31) == 2
    assert disc_31[0]["id"] != disc_31[1]["id"], "Both vouchers must receive unique row-indexed IDs"

    with db.get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id FROM parties WHERE name LIKE '%RR BOBBY SAMANA%'")
        row = cur.fetchone()
        assert row is not None
        p_id = row[0]
        cur.execute("SELECT id, credit_paise FROM vouchers WHERE party_id = ? AND voucher_date = '2026-07-31' AND credit_paise = 1508300", (p_id,))
        bobby_discounts = cur.fetchall()
        assert len(bobby_discounts) == 2, f"Expected 2 identical discount vouchers for RR BOBBY SAMANA, found {len(bobby_discounts)}"
        # Verify balance is 26,22,593.00 (262259300 paise)
        cur.execute("SELECT balance_paise FROM parties WHERE id = ?", (p_id,))
        assert cur.fetchone()[0] == 262259300





