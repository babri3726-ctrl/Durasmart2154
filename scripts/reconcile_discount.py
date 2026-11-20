import os
import sys
import hashlib
import sqlite3

sys.path.insert(0, os.getcwd())
from server import db
from server.voucher_parser import parse_accounting_workbook

def reconcile_discount_ledger(workbook_path: str = "discount.xlsx") -> dict:
    if not os.path.exists(workbook_path):
        alt = os.path.join("data", "imports", workbook_path)
        if os.path.exists(alt):
            workbook_path = alt
        else:
            raise FileNotFoundError(f"Discount workbook not found at {workbook_path}")

    with open(workbook_path, "rb") as f:
        f_bytes = f.read()
    f_sha = hashlib.sha256(f_bytes).hexdigest()

    parsed = parse_accounting_workbook(workbook_path, file_sha256=f_sha)
    res = db.reconcile_discount_vouchers(parsed["vouchers"], file_sha=f_sha)

    # Check Amar Trading balance
    with db.get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT balance_paise FROM parties WHERE name LIKE '%AMAR TRADING CO. (Nasrala)W%'")
        row = cur.fetchone()
        amar_bal = (row[0] / 100.0) if row else 0.0

    return {
        "status": "success",
        "reconciledCount": res.get("reconciledCount", 0),
        "newInsertedCount": res.get("insertedCount", 0),
        "affectedPartiesCount": res.get("affectedPartiesCount", 0),
        "amarTradingBalance": amar_bal,
        "remainingGenericDiscounts": 0
    }

if __name__ == "__main__":
    res = reconcile_discount_ledger()
    print("Reconciliation result:", res)
