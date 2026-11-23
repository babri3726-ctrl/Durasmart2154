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

    # 3. Apply Day Book (DAYBOOK.xlsx - Master Voucher Register)
    daybook_path = os.path.join(base_dir, "DAYBOOK.xlsx")
    if not os.path.exists(daybook_path):
        daybook_path = os.path.join(data_dir, "imports", "daybook.xlsx")

    if os.path.exists(daybook_path):
        print(f"\n[Step 3] Parsing and Importing Day Book from {os.path.basename(daybook_path)}...")
        t0 = time.time()
        with open(daybook_path, "rb") as f:
            f_bytes = f.read()
        f_sha = hashlib.sha256(f_bytes).hexdigest()
        parsed_db = parse_accounting_workbook(daybook_path, file_sha256=f_sha)
        vouchers = parsed_db.get("vouchers", [])
        print(f"  -> Parsed {len(vouchers)} vouchers in {time.time()-t0:.2f}s.")
        
        t1 = time.time()
        db_res = db.save_vouchers_batch(vouchers, file_sha=f_sha)
        print(f"  -> Ingested Day Book vouchers in {time.time()-t1:.2f}s:")
        print(f"     Inserted: {db_res['insertedCount']}, Skipped: {db_res['skippedCount']}, New Parties: {db_res['newPartiesCount']}")
    else:
        print("  -> Notice: DAYBOOK.xlsx not found.")

    # 4. Apply Dedicated Round Off Ledger (ROUNDOFF.xlsx)
    ro_path = os.path.join(base_dir, "ROUNDOFF.xlsx")
    if not os.path.exists(ro_path):
        ro_path = os.path.join(data_dir, "imports", "rounoff.xlsx")

    if os.path.exists(ro_path):
        print(f"\n[Step 4] Reconciling Round Off Ledger from {os.path.basename(ro_path)}...")
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

    # 5. Apply Dedicated Discount Ledger (DISCOUNT.xlsx)
    disc_path = os.path.join(base_dir, "DISCOUNT.xlsx")
    if not os.path.exists(disc_path):
        disc_path = os.path.join(data_dir, "imports", "discount.xlsx")

    if os.path.exists(disc_path):
        print(f"\n[Step 5] Reconciling Discount Ledger from {os.path.basename(disc_path)}...")
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

    # 6. Apply Additional Cash and Bank Books if present
    additional_books = [
        os.path.join(data_dir, "cash.xlsx"),
        os.path.join(data_dir, "cash gbd.xlsx"),
        os.path.join(data_dir, "khan cash.xlsx"),
        os.path.join(data_dir, "hdfc.xlsx"),
        os.path.join(data_dir, "yes.xlsx"),
        os.path.join(data_dir, "sales.xlsx"),
        os.path.join(data_dir, "S S Kalra Zira.xlsx"),
    ]
    print("\n[Step 6] Ingesting auxiliary cash and bank registers with cross-deduplication...")
    for bpath in additional_books:
        if os.path.exists(bpath):
            fname = os.path.basename(bpath)
            with open(bpath, "rb") as f:
                f_bytes = f.read()
            f_sha = hashlib.sha256(f_bytes).hexdigest()
            parsed = parse_accounting_workbook(bpath, file_sha256=f_sha, filename=fname)
            res = db.save_vouchers_batch(parsed.get("vouchers", []), file_sha=f_sha)
            print(f"  -> {fname} ({parsed.get('bookSource', 'Book')}): {res['insertedCount']} inserted, {res['skippedCount']} skipped")

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
