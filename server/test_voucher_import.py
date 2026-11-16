import os
import sqlite3
import pytest
from server.voucher_parser import is_accounting_workbook, parse_accounting_workbook
from server import db

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SALES_PATH = os.path.join(BASE_DIR, "sales.xlsx")
HDFC_PATH = os.path.join(BASE_DIR, "hdfc.xlsx")
YES_PATH = os.path.join(BASE_DIR, "yes.xlsx")


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
    assert res["totalDebitPaise"] == 3141641800
    # Total credit excluding Opening Balance (60271001.59 - 24104343.59 = 36166658.00)
    assert res["totalCreditPaise"] == 3616665800

    # Verify 'To' prefix was cleaned
    gagan_v = next((v for v in res["vouchers"] if "GAGAN" in v["partyName"]), None)
    assert gagan_v is not None
    assert gagan_v["partyName"] == "GAGAN EASTMAN CHOCK W"
    assert gagan_v["voucherType"] == "Receipt"
    assert gagan_v["debitPaise"] == 20000000


def test_yes_bank_parsing():
    res = parse_accounting_workbook(YES_PATH)
    assert res["bookSource"] == "Yes Bank Book"
    # 110 transaction vouchers (opening balance row excluded)
    assert res["voucherCount"] == 110
    assert res["totalDebitPaise"] == 4598705600
    # Total credit excluding Opening Balance (46443766.47 - 7490874.79 = 38952891.68)
    assert res["totalCreditPaise"] == 3895289168


def test_idempotent_import_and_balance_update():
    db.init_db()

    # Clear vouchers to ensure clean test baseline
    with db.get_connection() as conn:
        conn.execute("DELETE FROM vouchers")
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

    # Clean up so test suite isolation is preserved
    with db.get_connection() as conn:
        conn.execute("DELETE FROM vouchers")
        conn.execute("UPDATE parties SET balance_paise = 0")
        conn.commit()
    persisted = db.load_all_persisted_state()
    from server.main import STATE
    STATE["debtors"] = persisted["debtors"]
    STATE["customers"] = persisted["customers"]
