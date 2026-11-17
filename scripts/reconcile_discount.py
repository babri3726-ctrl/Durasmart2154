import sqlite3
import openpyxl
from datetime import datetime
import os
import sys

sys.path.insert(0, os.getcwd())
from server import db
from server.voucher_parser import clean_party_name, normalize_date_str

def reconcile_discount_ledger(workbook_path: str = "discount.xlsx") -> dict:
    if not os.path.exists(workbook_path):
        raise FileNotFoundError(f"Discount workbook not found at {workbook_path}")

    wb = openpyxl.load_workbook(workbook_path, data_only=True)
    ws = wb.active

    reconciled = 0
    new_inserted = 0
    affected_parties = set()

    with db.get_connection() as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        for r in range(8, ws.max_row + 1):
            d = ws.cell(r, 1).value
            part = ws.cell(r, 3).value
            vtype = str(ws.cell(r, 4).value or "Journal").strip()
            vno_raw = ws.cell(r, 5).value
            vno = str(vno_raw).strip() if vno_raw is not None else ""
            amt = ws.cell(r, 6).value
            if not (d and part and amt):
                continue

            vdate = normalize_date_str(d)
            party_name = clean_party_name(part)
            amt_paise = round(float(amt) * 100)
            narration = f"Discount ({vno})" if vno else "Discount"

            party_id, _ = db.find_or_create_party_by_name(conn, party_name)
            affected_parties.add(party_id)

            # Match generic Discount voucher from Day Book on same date and amount
            cur.execute(
                """
                SELECT id, voucher_no FROM vouchers
                WHERE LOWER(party_name) = 'discount'
                  AND voucher_date = ?
                  AND (debit_paise = ? OR credit_paise = ?)
                LIMIT 1
                """,
                (vdate, amt_paise, amt_paise)
            )
            match = cur.fetchone()

            # Check if this voucher already exists for party
            cur.execute(
                """
                SELECT id FROM vouchers
                WHERE party_id = ? AND voucher_date = ? AND (credit_paise = ? OR debit_paise = ?) AND LOWER(voucher_type) = 'journal'
                LIMIT 1
                """,
                (party_id, vdate, amt_paise, amt_paise)
            )
            already_exists = cur.fetchone()

            if match and already_exists:
                # The party already has this voucher from customer ledger, so remove the duplicate generic 'Discount' entry
                cur.execute("DELETE FROM vouchers WHERE id = ?", (match["id"],))
                reconciled += 1
            elif match:
                effective_vno = vno if vno else (match["voucher_no"] or "")
                cur.execute(
                    """
                    UPDATE vouchers
                    SET party_id = ?, party_name = ?, credit_paise = ?, debit_paise = 0, voucher_no = ?, narration = ?, book_source = 'Day Book (Discount)'
                    WHERE id = ?
                    """,
                    (party_id, party_name, amt_paise, effective_vno, narration, match["id"])
                )
                reconciled += 1
            elif not already_exists:
                new_id = f"VCH-DISC-{r}"
                cur.execute(
                    """
                    INSERT OR IGNORE INTO vouchers (id, voucher_no, voucher_type, voucher_date, party_name, party_id, debit_paise, credit_paise, narration, book_source, created_at)
                    VALUES (?, ?, 'Journal', ?, ?, ?, 0, ?, ?, 'Discount Ledger', datetime('now'))
                    """,
                    (new_id, vno, vdate, party_name, party_id, amt_paise, narration)
                )
                new_inserted += 1

        for pid in affected_parties:
            db.recompute_party_balance(pid, conn)

        # Clear fake 'Discount' party balance
        cur.execute("SELECT id FROM parties WHERE LOWER(name) = 'discount'")
        disc_party = cur.fetchone()
        if disc_party:
            db.recompute_party_balance(disc_party["id"], conn)

        conn.commit()

        # Check Amar Trading
        cur.execute("SELECT balance_paise FROM parties WHERE name LIKE '%AMAR TRADING CO. (Nasrala)W%'")
        amar_bal = cur.fetchone()["balance_paise"]

        cur.execute("SELECT COUNT(*) FROM vouchers WHERE LOWER(party_name) = 'discount'")
        rem_disc = cur.fetchone()[0]

    return {
        "status": "success",
        "reconciledCount": reconciled,
        "newInsertedCount": new_inserted,
        "affectedPartiesCount": len(affected_parties),
        "amarTradingBalance": amar_bal / 100.0,
        "remainingGenericDiscounts": rem_disc
    }

if __name__ == "__main__":
    res = reconcile_discount_ledger()
    print("Reconciliation result:", res)
