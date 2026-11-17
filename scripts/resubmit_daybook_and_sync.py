import os
import sys
import hashlib
from datetime import datetime
import sqlite3

# Ensure workspace root is in path
sys.path.insert(0, os.getcwd())

from server import db
from server.voucher_parser import parse_accounting_workbook

def run_resubmit():
    db.init_db()
    base_dir = os.getcwd()
    imports_dir = os.path.join(base_dir, "data", "imports")

    print("=== Step 1: Cleaning existing vouchers table ===")
    with db.get_connection() as conn:
        conn.execute("DELETE FROM vouchers")
        conn.commit()
    print("Vouchers table cleared for clean resubmission.")

    # Ordered list: Day Book first (master register), then liquid books (for counter-ledger enrichment)
    books_to_import = [
        os.path.join(imports_dir, "daybook.xlsx"),
        os.path.join(imports_dir, "khan cash.xlsx"),
        os.path.join(imports_dir, "cash.xlsx"),
        os.path.join(imports_dir, "cash gbd.xlsx"),
        os.path.join(base_dir, "data", "hdfc.xlsx"),
        os.path.join(base_dir, "data", "yes.xlsx"),
        os.path.join(base_dir, "data", "sales.xlsx"),
        os.path.join(imports_dir, "S S Kalra Zira.xlsx"),
    ]

    print("\n=== Step 2: Ingesting accounting workbooks with deduplication ===")
    total_inserted = 0
    total_skipped = 0

    for path in books_to_import:
        if not os.path.exists(path):
            continue
        fname = os.path.basename(path)
        print(f"Ingesting {fname}...")
        with open(path, "rb") as f:
            f_bytes = f.read()
        f_sha = hashlib.sha256(f_bytes).hexdigest()

        parsed = parse_accounting_workbook(path, file_sha256=f_sha, filename=fname)
        res = db.save_vouchers_batch(parsed["vouchers"], file_sha=f_sha)
        total_inserted += res["insertedCount"]
        total_skipped += res["skippedCount"]
        print(f"  -> {parsed['bookSource']}: {res['insertedCount']} inserted, {res['skippedCount']} skipped")

        if parsed.get("isCustomerLedger") and parsed.get("customerName"):
            cust_name = parsed["customerName"]
            ob_paise = parsed.get("openingBalancePaise", 0)
            if ob_paise != 0:
                with db.get_connection() as conn:
                    party_id, _ = db.find_or_create_party_by_name(conn, cust_name)
                    conn.execute("DELETE FROM opening_balances WHERE customer_id = ? AND source = 'customer_ledger'", (party_id,))
                    conn.execute(
                        "INSERT INTO opening_balances (customer_id, as_of, amount_paise, direction, source, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                        (party_id, "2026-04-01", abs(ob_paise), "debit" if ob_paise >= 0 else "credit", "customer_ledger", datetime.now().isoformat())
                    )
                    conn.commit()

    # Step 3: Seed Opening Balance for AMAR TRADING CO. (Nasrala)W from Tally Ledger Statement
    print("\n=== Step 3: Seeding Opening Balance for AMAR TRADING CO. ===")
    with db.get_connection() as conn:
        party_id, _ = db.find_or_create_party_by_name(conn, "AMAR TRADING CO. (Nasrala)W")
        # ₹4,70,360.00 Dr as of 1-Apr-26 from Tally screenshot
        amar_ob_paise = 47036000
        conn.execute("DELETE FROM opening_balances WHERE customer_id = ? AND source = 'tally_ledger'", (party_id,))
        conn.execute(
            "INSERT INTO opening_balances (customer_id, as_of, amount_paise, direction, source, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (party_id, "2026-04-01", amar_ob_paise, "debit", "tally_ledger", datetime.now().isoformat())
        )
        conn.commit()
    print("Seeded Opening Balance of ₹4,70,360.00 Dr for AMAR TRADING CO. (Nasrala)W.")

    print("\n=== Step 3.5: Reconciling Discount Ledger ===")
    disc_path = os.path.join(imports_dir, "discount.xlsx")
    if not os.path.exists(disc_path):
        disc_path = os.path.join(base_dir, "discount.xlsx")
    if os.path.exists(disc_path):
        parsed_disc = parse_accounting_workbook(disc_path)
        disc_res = db.reconcile_discount_vouchers(parsed_disc["vouchers"])
        print(f"Reconciled {disc_res.get('reconciledCount', 0)} discount vouchers across {disc_res.get('affectedPartiesCount', 0)} debtors.")

    print("\n=== Step 4: Recomputing all party balances ===")
    with db.get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id FROM parties")
        pids = [r[0] for r in cur.fetchall()]
        for pid in pids:
            db.recompute_party_balance(pid, conn)
        conn.commit()
    print(f"All {len(pids)} party balances recomputed.")

    print("\n=== Step 5: Verification of AMAR TRADING CO. (Nasrala)W ===")
    with db.get_connection() as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute("SELECT id, name, balance_paise FROM parties WHERE name LIKE '%AMAR TRADING CO. (Nasrala)W%'")
        party = cur.fetchone()
        cur.execute(
            "SELECT COUNT(*), SUM(debit_paise), SUM(credit_paise) FROM vouchers WHERE party_id = ?",
            (party["id"],)
        )
        cnt, dr, cr = cur.fetchone()
        cur.execute("SELECT amount_paise FROM opening_balances WHERE customer_id = ?", (party["id"],))
        ob = cur.fetchone()["amount_paise"]

        print(f"Party: {party['name']} (ID: {party['id']})")
        print(f"Opening Balance: ₹{ob/100:,.2f} Dr")
        print(f"Total Vouchers: {cnt}")
        print(f"Total Debits: ₹{dr/100:,.2f}")
        print(f"Total Credits: ₹{cr/100:,.2f}")
        print(f"Closing Outstanding: ₹{party['balance_paise']/100:,.2f} Dr")

        # Check 1-Nov-26 voucher
        cur.execute(
            "SELECT id, voucher_date, voucher_type, voucher_no, debit_paise, credit_paise, book_source, narration FROM vouchers WHERE party_id = ? AND voucher_date = '2026-11-01'",
            (party["id"],)
        )
        nov1_rows = cur.fetchall()
        print(f"\n1-Nov-26 Vouchers count: {len(nov1_rows)}")
        for r in nov1_rows:
            print(f"  {r['voucher_date']} | {r['voucher_type']} | {r['voucher_no']} | Cr: ₹{r['credit_paise']/100:,.2f} | Dr: ₹{r['debit_paise']/100:,.2f} | Particulars: {r['narration']}")

if __name__ == "__main__":
    run_resubmit()
