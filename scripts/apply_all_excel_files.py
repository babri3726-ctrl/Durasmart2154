import os
import sys
import time
import hashlib
from datetime import datetime

# Ensure project root in sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server import db
from server.voucher_parser import parse_accounting_workbook, parse_opening_balance_workbook
from scripts.clean_and_classify_ledgers import run_cleanup

def main():
    start_time = time.time()
    print("=" * 70)
    print("DURASMART UNIFIED EXCEL & LEDGER IMPORT PIPELINE")
    print("=" * 70)

    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    data_dir = os.path.join(base_dir, "data")
    
    # 0. Initialize DB and verify indices
    print("\n[Step 0] Initializing SQLite database and indices...")
    db.init_db()

    # 1. Clear previous vouchers and opening balances for clean atomic resubmission
    print("\n[Step 1] Purging old vouchers and balances for clean baseline...")
    clean_res = db.clean_accounting_balances()
    print(f"Purged: {clean_res}")

    # 2. Apply Master Opening Balances (OP.xlsx / trialbalance)
    op_path = os.path.join(base_dir, "OP.xlsx")
    if not os.path.exists(op_path):
        op_path = os.path.join(data_dir, "imports", "opening.xlsx")
    
    if os.path.exists(op_path):
        print(f"\n[Step 2] Importing Master Opening Balances from {os.path.basename(op_path)}...")
        t0 = time.time()
        tb_res = db.import_opening_balances(op_path)
        print(f"  -> Imported opening balances in {time.time()-t0:.2f}s: {tb_res}")
    else:
        print("  -> Notice: OP.xlsx not found.")

    # Check if Master Journal Register is present
    journal_path = os.path.join(base_dir, "journal.xlsx")
    if not os.path.exists(journal_path):
        journal_path = os.path.join(base_dir, "JOURNAL.xlsx")
    if not os.path.exists(journal_path):
        journal_path = os.path.join(data_dir, "imports", "journal.xlsx")

    has_journal = os.path.exists(journal_path)

    # 3. Apply Dedicated Liquid Books (HDFC, Yes Bank, Cash, Khan Cash, Cash GBD) for Universal Liquid Deduplication Pool
    from collections import Counter
    from server.voucher_parser import parse_bank_workbook, clean_party_name
    
    liquid_lookup = Counter()
    total_liquid_vchs = 0

    liquid_definitions = [
        ("hdfc", ["hdfc.xlsx", "HDFC.xlsx"], "HDFC Bank Book"),
        ("yesbank", ["yesbank.xlsx", "YESBANK.xlsx"], "Yes Bank Book"),
        ("cash", ["cash.xlsx", "CASH.xlsx"], "Cash Book"),
        ("khancash", ["khancash.xlsx", "KHANCASH.xlsx", "khan cash.xlsx", "KHAN CASH.xlsx"], "Khan Cash Book"),
        ("cashgbd", ["cashgbd.xlsx", "CASHGBD.xlsx", "cash gbd.xlsx", "CASH GBD.xlsx"], "Cash GBD Book"),
    ]

    for key, fnames, label in liquid_definitions:
        found_path = None
        for candidate_name in fnames:
            p1 = os.path.join(base_dir, candidate_name)
            p2 = os.path.join(data_dir, candidate_name)
            p3 = os.path.join(data_dir, "imports", candidate_name)
            if os.path.exists(p1):
                found_path = p1
                break
            elif os.path.exists(p2):
                found_path = p2
                break
            elif os.path.exists(p3):
                found_path = p3
                break

        if found_path:
            print(f"\n[Step 3.{key}] Parsing and Ingesting {label} from {os.path.basename(found_path)}...")
            t0 = time.time()
            with open(found_path, "rb") as f:
                f_bytes = f.read()
            f_sha = hashlib.sha256(f_bytes).hexdigest()
            parsed_l = parse_bank_workbook(found_path, file_sha256=f_sha)
            l_vchs = parsed_l.get("vouchers", [])
            print(f"  -> Parsed {len(l_vchs)} {label} vouchers in {time.time()-t0:.2f}s (Dr: ₹{parsed_l['totalDebitFormatted']}, Cr: ₹{parsed_l['totalCreditFormatted']}).")
            l_res = db.save_vouchers_batch(l_vchs, file_sha=f_sha)
            print(f"  -> Ingested {label} vouchers: {l_res['insertedCount']} inserted, {l_res['skippedCount']} skipped.")
            total_liquid_vchs += len(l_vchs)
            for b_vch in l_vchs:
                k = (
                    b_vch.get("voucherDate"),
                    clean_party_name(b_vch.get("partyName", "")).lower().strip(),
                    b_vch.get("debitPaise", 0),
                    b_vch.get("creditPaise", 0)
                )
                liquid_lookup[k] += 1
        else:
            print(f"  -> Notice: {label} ({fnames[0]}) not found.")

    print(f"\n  -> Total authoritative Liquid vouchers in deduplication pool: {total_liquid_vchs} across {len(liquid_lookup)} unique keys")

    # 4. Apply Day Book (DAYBOOK.xlsx - Master Voucher Register) with Universal Liquid Deduplication
    daybook_path = os.path.join(base_dir, "DAYBOOK.xlsx")
    if not os.path.exists(daybook_path):
        daybook_path = os.path.join(base_dir, "daybook.xlsx")
    if not os.path.exists(daybook_path):
        daybook_path = os.path.join(data_dir, "imports", "daybook.xlsx")

    if os.path.exists(daybook_path):
        print(f"\n[Step 4] Parsing Day Book from {os.path.basename(daybook_path)} with Universal Liquid Deduplication...")
        t0 = time.time()
        with open(daybook_path, "rb") as f:
            f_bytes = f.read()
        f_sha = hashlib.sha256(f_bytes).hexdigest()
        parsed_db = parse_accounting_workbook(daybook_path, file_sha256=f_sha, disable_payment_receipt=False)
        all_db_vchs = parsed_db.get("vouchers", [])
        
        clean_vouchers = []
        skipped_liquid_duplicates = 0
        skipped_stock = 0
        skipped_journals = 0
        retained_pmt_rcpt_contra = 0

        for v in all_db_vchs:
            vt = (v.get("voucherType") or "").lower()
            if vt in ("stock journal", "physical stock", "material in", "material out") or "stock" in vt:
                skipped_stock += 1
                continue
            if has_journal and vt == "journal":
                skipped_journals += 1
                continue
            if vt in ("payment", "receipt", "contra"):
                key = (
                    v.get("voucherDate"),
                    clean_party_name(v.get("partyName", "")).lower().strip(),
                    v.get("debitPaise", 0),
                    v.get("creditPaise", 0)
                )
                if liquid_lookup[key] > 0:
                    liquid_lookup[key] -= 1
                    skipped_liquid_duplicates += 1
                    continue
                else:
                    retained_pmt_rcpt_contra += 1
            clean_vouchers.append(v)

        print(f"  -> Daybook Processing Statistics:")
        print(f"     Total Raw Daybook: {len(all_db_vchs)}")
        print(f"     Skipped Stock Vouchers: {skipped_stock}")
        print(f"     Skipped Single-Leg Journals: {skipped_journals}")
        print(f"     Skipped Liquid Duplicates (present in Bank/Cash Books): {skipped_liquid_duplicates}")
        print(f"     Retained Non-Liquid / Standalone Payments & Receipts: {retained_pmt_rcpt_contra}")
        print(f"     Final Daybook Vouchers to Ingest: {len(clean_vouchers)}")
        
        t1 = time.time()
        db_res = db.save_vouchers_batch(clean_vouchers, file_sha=f_sha)
        print(f"  -> Ingested Day Book vouchers in {time.time()-t1:.2f}s:")
        print(f"     Inserted: {db_res['insertedCount']}, Skipped: {db_res['skippedCount']}, New Parties: {db_res['newPartiesCount']}")
    else:
        print("  -> Notice: DAYBOOK.xlsx not found.")

    # 5. Apply Master Double-Entry Journal Register (journal.xlsx)
    if has_journal:
        print(f"\n[Step 5] Parsing and Ingesting Master Double-Entry Journal Register from {os.path.basename(journal_path)}...")
        t0 = time.time()
        with open(journal_path, "rb") as f:
            f_bytes = f.read()
        f_sha = hashlib.sha256(f_bytes).hexdigest()
        from server.voucher_parser import parse_journal_register_workbook
        parsed_j = parse_journal_register_workbook(journal_path, file_sha256=f_sha)
        j_vchs = parsed_j.get("vouchers", [])
        print(f"  -> Parsed {len(j_vchs)} double-entry journal vouchers in {time.time()-t0:.2f}s (Total Dr: ₹{parsed_j['totalDebitFormatted']}, Total Cr: ₹{parsed_j['totalCreditFormatted']}).")
        
        t1 = time.time()
        j_res = db.save_vouchers_batch(j_vchs, file_sha=f_sha)
        print(f"  -> Ingested Journal vouchers in {time.time()-t1:.2f}s:")
        print(f"     Inserted: {j_res['insertedCount']}, Skipped: {j_res['skippedCount']}, New Parties: {j_res['newPartiesCount']}")

    # 6. Apply Dedicated Round Off Ledger (ROUNDOFF.xlsx)
    ro_path = os.path.join(base_dir, "ROUNDOFF.xlsx")
    if not os.path.exists(ro_path):
        ro_path = os.path.join(data_dir, "imports", "rounoff.xlsx")

    if os.path.exists(ro_path):
        print(f"\n[Step 6] Reconciling Round Off Ledger from {os.path.basename(ro_path)}...")
        t0 = time.time()
        with open(ro_path, "rb") as f:
            f_bytes = f.read()
        f_sha = hashlib.sha256(f_bytes).hexdigest()
        parsed_ro = parse_accounting_workbook(ro_path, file_sha256=f_sha)
        ro_res = db.reconcile_adjustment_vouchers(
            parsed_ro.get("vouchers", []),
            target_generic_party="round off",
            book_source="Round Off Ledger",
            file_sha=f_sha
        )
        print(f"  -> Reconciled Round Off vouchers in {time.time()-t0:.2f}s: {ro_res}")

    # 7. Apply Dedicated Discount Ledger (DISCOUNT.xlsx)
    disc_path = os.path.join(base_dir, "DISCOUNT.xlsx")
    if not os.path.exists(disc_path):
        disc_path = os.path.join(data_dir, "imports", "discount.xlsx")

    if os.path.exists(disc_path):
        print(f"\n[Step 7] Reconciling Discount Ledger from {os.path.basename(disc_path)}...")
        t0 = time.time()
        with open(disc_path, "rb") as f:
            f_bytes = f.read()
        f_sha = hashlib.sha256(f_bytes).hexdigest()
        parsed_disc = parse_accounting_workbook(disc_path, file_sha256=f_sha)
        disc_res = db.reconcile_adjustment_vouchers(
            parsed_disc.get("vouchers", []),
            target_generic_party="discount",
            book_source="Discount Ledger",
            file_sha=f_sha
        )
        print(f"  -> Reconciled Discount vouchers in {time.time()-t0:.2f}s: {disc_res}")

    # 8. Dynamic Authoritative Customer Ledgers Scanner
    print("\n[Step 8] Scanning and Ingesting Dynamic Authoritative Customer Ledgers...")
    from server.voucher_parser import detect_excel_type
    
    # Candidate search paths: workspace root and data folder
    seen_files = set()
    candidate_files = []
    for search_dir in [base_dir, data_dir, os.path.join(data_dir, "imports")]:
        if not os.path.exists(search_dir):
            continue
        for fname in os.listdir(search_dir):
            if not fname.lower().endswith((".xlsx", ".xlsm")):
                continue
            if fname.lower().startswith(("~$", ".")):
                continue
            fpath = os.path.join(search_dir, fname)
            f_canon = os.path.abspath(fpath)
            if f_canon in seen_files:
                continue
            seen_files.add(f_canon)
            
            ftype = detect_excel_type(fpath)
            if ftype == "customer_ledger":
                candidate_files.append(fpath)

    print(f"  -> Found {len(candidate_files)} Authoritative Customer Ledger(s): {[os.path.basename(f) for f in candidate_files]}")
    for c_path in candidate_files:
        fname = os.path.basename(c_path)
        with open(c_path, "rb") as f:
            f_bytes = f.read()
        f_sha = hashlib.sha256(f_bytes).hexdigest()
        parsed_c = parse_accounting_workbook(c_path, file_sha256=f_sha, filename=fname)
        vchs = parsed_c.get("vouchers", [])
        if not vchs:
            continue
        c_name = parsed_c.get("customerName") or vchs[0]["partyName"]
        with db.get_connection() as conn:
            pid, _ = db.find_or_create_party_by_name(conn, c_name)
            # Update opening balance if present in the authoritative ledger
            ob_paise = parsed_c.get("openingBalancePaise", 0)
            if ob_paise != 0:
                conn.execute("""
                    INSERT INTO opening_balances (customer_id, as_of, amount_paise, direction, source, created_at)
                    VALUES (?, '2026-04-01', ?, ?, 'Authoritative Ledger', datetime('now'))
                """, (pid, abs(ob_paise), "debit" if ob_paise >= 0 else "credit"))
            # Replace previous vouchers for this party with the authoritative Tally ledger
            conn.execute("DELETE FROM vouchers WHERE party_id = ?", (pid,))
            conn.commit()
        res = db.save_vouchers_batch(vchs, file_sha=f_sha)
        print(f"  -> {fname} ({c_name}): Applied {res['insertedCount']} authoritative vouchers.")

    # 7. Ingest HR-PB Sales Targets & Dealers Master
    hrpb_path = os.path.join(data_dir, "HR-PB.xlsx")
    if os.path.exists(hrpb_path):
        print(f"\n[Step 7] Ingesting Sales Targets & Dealers Master from {os.path.basename(hrpb_path)}...")
        try:
            from server.hr_pb_parser import extract_hr_pb_targets
            hrpb_snap = extract_hr_pb_targets(hrpb_path)
            if hrpb_snap:
                summary = hrpb_snap.get("summary", {})
                print(f"  -> HR-PB Targets Parsed: {summary.get('total_parties_count', 0)} party targets across {summary.get('sheets_count', 0)} sheets.")
        except Exception as e:
            print(f"  -> HR-PB notice: {e}")

    # 8. Ingest Master Stock from 1-8-26.xlsx
    stock_path = os.path.join(data_dir, "1-8-26.xlsx")
    if os.path.exists(stock_path):
        print(f"\n[Step 8] Ingesting 3-Sheet Master Stock from {os.path.basename(stock_path)}...")
        try:
            from server.stock_parser import extract_3sheet_stock
            stock_snap = extract_3sheet_stock(stock_path)
            if stock_snap:
                print(f"  -> Master Stock Parsed: {len(stock_snap.get('items', []))} items, {len(stock_snap.get('bands', []))} bands.")
        except Exception as e:
            print(f"  -> Stock notice: {e}")

    # 9. Ledger Reclassification & Final Balance Recomputation
    print("\n[Step 9] Running Ledger Classifier and Final Party Balance Recomputation...")
    run_cleanup()

    total_time = time.time() - start_time
    print("\n" + "=" * 70)
    print(f"ALL EXCEL FILES SUCCESSFULLY APPLIED IN {total_time:.2f}s!")
    print("=" * 70)

if __name__ == "__main__":
    main()
