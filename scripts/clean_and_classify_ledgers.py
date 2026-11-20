import os
import sys
import sqlite3
import re
from datetime import datetime

# Workspace root
base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
db_path = os.path.join(base_dir, "data", "operations.db")

def run_cleanup():
    print(f"Connecting to {db_path}...")
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    # 1. Ensure party_type column exists
    cur.execute("PRAGMA table_info(parties)")
    cols = [c[1] for c in cur.fetchall()]
    if "party_type" not in cols:
        print("Adding party_type column to parties table...")
        cur.execute("ALTER TABLE parties ADD COLUMN party_type TEXT DEFAULT 'customer'")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_parties_party_type ON parties(party_type)")
        conn.commit()
        print("Column party_type added successfully.")
    else:
        print("Column party_type already exists.")

    # 2. Drop Stock Journal and Physical Stock vouchers
    cur.execute("SELECT COUNT(*) FROM vouchers WHERE LOWER(voucher_type) IN ('stock journal', 'physical stock') OR LOWER(voucher_type) LIKE '%stock%'")
    stock_count = cur.fetchone()[0]
    print(f"Found {stock_count} stock vouchers in vouchers table.")
    if stock_count > 0:
        cur.execute("DELETE FROM vouchers WHERE LOWER(voucher_type) IN ('stock journal', 'physical stock') OR LOWER(voucher_type) LIKE '%stock%'")
        conn.commit()
        print(f"Deleted {stock_count} stock vouchers. Stock entry is strictly disabled.")

    # 3. Classify parties
    cur.execute("SELECT id, name FROM parties")
    all_parties = cur.fetchall()
    
    cash_keywords = ["cash", "khan cash", "cash gbd", "khancash", "cashgbd", "cash book", "petty cash"]
    bank_keywords = ["yes bank", "hdfc", "hdfc bank", "hdfc p.o.finance", "hdfc dura", "state bank", "pnb", "icici", "axis bank"]
    roundoff_keywords = ["round off", "roundoff", "rounoff"]
    discount_keywords = ["discount", "cd discount", "scheme discount", "trade discount"]
    expense_keywords = [
        " exp", "exp.", "expense", "donation", "interst", "interest", "salary", "selery", 
        "fec exp", "insurance", "insurence", "freight", "cartage", "repair",
        "stationery", "audit fee", "legal fee", "office exp", "house exp", "diwali exp", "loading exp"
    ]

    classified_counts = {
        "customer": 0,
        "cash": 0,
        "bank": 0,
        "roundoff": 0,
        "discount": 0,
        "expense": 0,
        "supplier": 0
    }

    for pid, pname in all_parties:
        name_clean = (pname or "").strip().lower()
        
        # Check round off
        if any(name_clean == kw or name_clean.startswith(kw) for kw in roundoff_keywords) or pid == "LEDGER-ROUNDOFF":
            ptype = "roundoff"
        # Check discount
        elif any(name_clean == kw or name_clean.startswith(kw) for kw in discount_keywords) or pid == "LEDGER-DISCOUNT":
            ptype = "discount"
        # Check cash in hand
        elif name_clean in cash_keywords or any(name_clean == kw for kw in ["cash", "khan cash", "cash gbd", "cash in hand"]):
            ptype = "cash"
        # Check banks
        elif any(kw in name_clean for kw in ["yes bank", "hdfc", "hdfc bank", "hdfc p.o"]):
            ptype = "bank"
        # Check expenses
        elif any(kw in name_clean for kw in expense_keywords) and not any(k in name_clean for k in ["steel", "iron", "pipes", "traders", "enterprises", "industries", "ispat"]):
            ptype = "expense"
        else:
            ptype = "customer"

        classified_counts[ptype] = classified_counts.get(ptype, 0) + 1
        cur.execute("UPDATE parties SET party_type = ? WHERE id = ?", (ptype, pid))

    conn.commit()
    print("Party classification summary:", classified_counts)

    # 4. Ensure dedicated ledgers exist in parties
    dedicated_ledgers = [
        ("LEDGER-ROUNDOFF", "Round Off Ledger", "roundoff"),
        ("LEDGER-DISCOUNT", "Discount Ledger", "discount"),
        ("LEDGER-CASH", "Cash", "cash"),
        ("LEDGER-KHANCASH", "KHAN CASH", "cash"),
        ("LEDGER-CASHGBD", "Cash Gbd", "cash"),
        ("LEDGER-YESBANK", "Yes Bank", "bank"),
        ("LEDGER-HDFC", "HDFC Bank", "bank"),
    ]
    for lid, lname, ltype in dedicated_ledgers:
        cur.execute("SELECT id FROM parties WHERE id = ? OR (LOWER(name) = ? AND party_type = ?)", (lid, lname.lower(), ltype))
        exists = cur.fetchone()
        if not exists:
            cur.execute("""
                INSERT INTO parties (id, name, state, city, district, salesperson, balance_paise, credit_days, status, party_type, created_at, updated_at)
                VALUES (?, ?, 'Punjab', 'Ludhiana', 'Ludhiana', 'System', 0, 0, 'active', ?, datetime('now'), datetime('now'))
            """, (lid, lname, ltype))
            print(f"Created dedicated ledger: {lname} ({lid}) as {ltype}")
        else:
            cur.execute("UPDATE parties SET party_type = ? WHERE id = ?", (ltype, exists[0]))

    conn.commit()

    # 5. Recompute customer debtor balances
    print("Recomputing debtor balances for customers...")
    cur.execute("SELECT id, name FROM parties WHERE party_type = 'customer'")
    customers = cur.fetchall()

    for cid, cname in customers:
        # Opening balance
        cur.execute("SELECT amount_paise, direction FROM opening_balances WHERE customer_id = ? ORDER BY id DESC LIMIT 1", (cid,))
        ob = cur.fetchone()
        if ob:
            ob_paise = ob[0] if (ob[1] or "debit").lower() in ("debit", "owes") else -ob[0]
        else:
            ob_paise = 0

        # Sales & Debit notes (+)
        cur.execute("""
            SELECT COALESCE(SUM(debit_paise - credit_paise), 0)
            FROM vouchers
            WHERE party_id = ? AND (LOWER(voucher_type) = 'sales' OR LOWER(voucher_type) LIKE '%debit note%')
        """, (cid,))
        sales_net = cur.fetchone()[0]

        # Receipts & Credit notes (-)
        cur.execute("""
            SELECT COALESCE(SUM(credit_paise - debit_paise), 0)
            FROM vouchers
            WHERE party_id = ? AND (LOWER(voucher_type) = 'receipt' OR LOWER(voucher_type) LIKE '%credit note%')
        """, (cid,))
        receipts_net = cur.fetchone()[0]

        # Journals & adjustments
        cur.execute("""
            SELECT COALESCE(SUM(debit_paise - credit_paise), 0)
            FROM vouchers
            WHERE party_id = ? AND LOWER(voucher_type) = 'journal'
        """, (cid,))
        journal_net = cur.fetchone()[0]

        final_bal = ob_paise + sales_net - receipts_net + journal_net
        cur.execute("UPDATE parties SET balance_paise = ? WHERE id = ?", (final_bal, cid))

    conn.commit()
    print(f"Successfully recomputed balances for {len(customers)} pure customer accounts.")

    # 6. Verify top debtors and liquid account balances
    cur.execute("""
        SELECT name, party_type, balance_paise / 100.0 
        FROM parties 
        WHERE party_type != 'customer'
        ORDER BY party_type, name
    """)
    non_customers = cur.fetchall()
    print("\nClassified Non-Customer Ledgers:")
    for nc in non_customers:
        print(f"  [{nc[1].upper()}] {nc[0]}: ₹{nc[2]:,.2f}")

    conn.close()
    print("\nCleanup and classification completed successfully.")

if __name__ == "__main__":
    run_cleanup()
