"""
HR-PB Sales Target and Dealer Parser for OneDrive (HR-PB.xlsx)
Dynamically maps headers:
  - Sheet1: Haryana Dealer Targets (Oct. 2026) -> S.NO, Dealer's Name, STATION, Distt., Area Officer, Oct.Target, Order recved., Mtrl Dispatch
  - Sheet2: Punjab Dealer Targets (Oct. 2026)  -> S.NO, Party Name, STATION, Distt., Sales Person, Oct.Target, Order recved., Mtrl Dispatch
"""
import os
import unicodedata
from datetime import datetime

import openpyxl

from .stock_parser import get_file_sha256, make_safe_temp_copy

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_FALLBACK_HRPB = os.path.join(BASE_DIR, "data", "HR-PB.xlsx")

def get_default_hrpb_path() -> str:
    if os.environ.get("ONEDRIVE_HRPB_PATH") and os.path.exists(os.environ["ONEDRIVE_HRPB_PATH"]):
        return os.environ["ONEDRIVE_HRPB_PATH"]
    user_onedrive = os.path.join(os.environ.get("USERPROFILE", ""), "OneDrive", "HR-PB.xlsx")
    if os.path.exists(user_onedrive):
        try:
            import shutil
            if not os.path.exists(DATA_FALLBACK_HRPB) or os.path.getmtime(user_onedrive) > os.path.getmtime(DATA_FALLBACK_HRPB):
                shutil.copy2(user_onedrive, DATA_FALLBACK_HRPB)
        except Exception:
            pass
        return user_onedrive
    return DATA_FALLBACK_HRPB

DEFAULT_HRPB_PATH = get_default_hrpb_path()

def clean_str(val) -> str:
    if val is None:
        return ""
    text = unicodedata.normalize("NFKD", str(val)).strip()
    return " ".join(text.split())

def clean_float(val) -> float:
    if val is None:
        return 0.0
    try:
        return round(float(val), 3)
    except (ValueError, TypeError):
        return 0.0

def parse_sheet(ws, state_label: str, prefix: str):
    header_col_map = {}
    records = []
    dealers = []
    seen_names = set()

    for row in ws.iter_rows(values_only=True):
        if not row:
            continue

        cleaned_row = [clean_str(c).upper() for c in row]
        if "S.NO" in cleaned_row:
            header_col_map = {name: idx for idx, name in enumerate(cleaned_row) if name}
            continue

        if not header_col_map:
            continue

        name_idx = header_col_map.get("DEALER'S NAME")
        if name_idx is None:
            name_idx = header_col_map.get("PARTY NAME")
        if name_idx is None or name_idx >= len(row):
            continue

        party_name = clean_str(row[name_idx])
        if not party_name or party_name.upper() in ["TOTAL", "DEALER'S NAME", "PARTY NAME"]:
            continue

        station_idx = header_col_map.get("STATION")
        station = clean_str(row[station_idx]) if station_idx is not None and station_idx < len(row) else ""

        distt_idx = header_col_map.get("DISTT.") or header_col_map.get("DISTT") or header_col_map.get("DISTRICT")
        district = clean_str(row[distt_idx]) if distt_idx is not None and distt_idx < len(row) else ""

        officer_idx = header_col_map.get("AREA OFFICER") or header_col_map.get("SALES PERSON")
        officer = clean_str(row[officer_idx]) if officer_idx is not None and officer_idx < len(row) else "Unassigned"

        target_idx = header_col_map.get("OCT.TARGET") or header_col_map.get("TARGET")
        target_mt = clean_float(row[target_idx]) if target_idx is not None and target_idx < len(row) else 0.0

        order_idx = header_col_map.get("ORDER RECVED.") or header_col_map.get("ORDER RECVED")
        orders_mt = clean_float(row[order_idx]) if order_idx is not None and order_idx < len(row) else 0.0

        dispatch_idx = header_col_map.get("MTRL DISPATCH") or header_col_map.get("DISPATCH")
        dispatch_mt = clean_float(row[dispatch_idx]) if dispatch_idx is not None and dispatch_idx < len(row) else 0.0

        pending_idx = header_col_map.get("PENDING")
        pending_mt = clean_float(row[pending_idx]) if pending_idx is not None and pending_idx < len(row) else max(0.0, target_mt - dispatch_mt)

        record_id = f"TGT-{prefix}-{len(records) + 1:03d}"
        record = {
            "id": record_id,
            "state": state_label,
            "party_name": party_name,
            "station": station,
            "district": district,
            "salesperson": officer,
            "target_mt": f"{target_mt:.3f}",
            "order_received_mt": f"{orders_mt:.3f}",
            "dispatched_mt": f"{dispatch_mt:.3f}",
            "pending_mt": f"{pending_mt:.3f}"
        }
        records.append(record)

        if party_name.lower() not in seen_names:
            seen_names.add(party_name.lower())
            dealers.append({
                "id": f"DEBTOR-{prefix}-{len(dealers) + 1:03d}",
                "name": party_name,
                "state": state_label,
                "city": station or district or state_label,
                "district": district,
                "salesperson": officer,
                "balance": 0.0,
                "balance_formatted": "0.00",
                "status": "active"
            })

    return records, dealers

def extract_hr_pb_targets(file_path: str = DEFAULT_HRPB_PATH) -> dict:
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Target workbook not found at {file_path}")

    tmp_path = make_safe_temp_copy(file_path)
    try:
        sha256 = get_file_sha256(tmp_path)
        file_size = os.path.getsize(tmp_path)

        wb = openpyxl.load_workbook(tmp_path, data_only=True, read_only=True)
        haryana_records, haryana_dealers = [], []
        punjab_records, punjab_dealers = [], []

        if "Sheet1" in wb.sheetnames:
            haryana_records, haryana_dealers = parse_sheet(wb["Sheet1"], "Haryana", "HR")

        if "Sheet2" in wb.sheetnames:
            punjab_records, punjab_dealers = parse_sheet(wb["Sheet2"], "Punjab", "PB")

        wb.close()

        all_dealers = haryana_dealers + punjab_dealers
        all_targets = haryana_records + punjab_records

        total_target_haryana = sum(float(r["target_mt"]) for r in haryana_records)
        total_target_punjab = sum(float(r["target_mt"]) for r in punjab_records)
        total_orders_all = sum(float(r["order_received_mt"]) for r in all_targets)
        total_dispatched_all = sum(float(r["dispatched_mt"]) for r in all_targets)

        return {
            "filename": os.path.basename(file_path),
            "file_sha256": sha256,
            "file_size": file_size,
            "synced_at": datetime.now().isoformat() + "+05:30",
            "summary": {
                "haryana_parties_count": len(haryana_records),
                "punjab_parties_count": len(punjab_records),
                "total_parties_count": len(all_targets),
                "unique_dealers_count": len(all_dealers),
                "total_target_mt": f"{total_target_haryana + total_target_punjab:.3f}",
                "total_orders_mt": f"{total_orders_all:.3f}",
                "total_dispatched_mt": f"{total_dispatched_all:.3f}"
            },
            "haryana_targets": haryana_records,
            "punjab_targets": punjab_records,
            "all_targets": all_targets,
            "dealers_master": all_dealers
        }
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass
