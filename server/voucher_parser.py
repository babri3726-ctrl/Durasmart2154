"""
Universal Voucher and Accounting Register Parser for DuraSmart.
Parses Tally / ERP Excel exports:
- Sales Register (e.g. sales.xlsx: Sales vouchers, Debit = bill amount)
- Bank Books (e.g. hdfc.xlsx, yes.xlsx: Receipts, Payments, Debit/Credit)
"""
import hashlib
import os
import re
from datetime import datetime
from typing import Any

import openpyxl


def clean_party_name(raw: Any) -> str:
    """Strips leading 'To ' or 'By ' prefix and normalizes whitespace."""
    s = re.sub(r"^(To|By)\s+", "", str(raw or ""), flags=re.IGNORECASE)
    # Collapse multiple whitespace characters
    return " ".join(s.strip().split())


def detect_state_and_city(name: str) -> tuple[str, str]:
    """Infers state and city from party name keywords."""
    name_upper = name.upper()
    punjab_cities = [
        "LUDHIANA", "AMRITSAR", "JALANDHAR", "PATIALA", "BATHINDA", "HOSHIARPUR",
        "BARNALA", "FEROZPUR", "FARIDKOT", "KAPURTHALA", "SANGRUR", "MANSA",
        "BATALA", "MOGA", "ZIRA", "MALOUT", "AJNALA", "BHIKHIWIND", "JAGRAON", "JAGROUN"
    ]
    haryana_cities = [
        "SIRSA", "HISAR", "AMBALA", "PANIPAT", "KARNAL", "KURUKSHETRA",
        "YAMUNANAGAR", "ROHTAK", "JHAJJAR", "NARNAUL", "HANSI", "PEHOWA",
        "CHEEKA", "DABWALI", "KAITHAL", "AGROHA"
    ]
    up_cities = ["GHAZIABAD", "GBD", "NOIDA", "KANPUR", "LUCKNOW", "MEERUT"]
    hp_cities = ["KANGRA", "SHIMLA", "SOLAN", "MANDI", "DHARAMSHALA"]
    rajasthan_cities = ["HANUMANGARH", "HANUMANGRH", "JAIPUR", "SRI GANGANAGAR"]

    for city in punjab_cities:
        if city in name_upper:
            return "Punjab", city.title()
    for city in haryana_cities:
        if city in name_upper:
            return "Haryana", city.title()
    for city in up_cities:
        if city in name_upper:
            return "Uttar Pradesh", "Ghaziabad"
    for city in hp_cities:
        if city in name_upper:
            return "Himachal Pradesh", city.title()
    for city in rajasthan_cities:
        if city in name_upper:
            return "Rajasthan", "Hanumangarh"

    return "Punjab", ""


def normalize_date_str(val: Any) -> str:
    """Normalizes dates of various Tally/Excel formats into standard YYYY-MM-DD."""
    if isinstance(val, datetime):
        return val.strftime("%Y-%m-%d")
    s = str(val or "").strip()
    for fmt in ("%Y-%m-%d", "%d-%b-%y", "%d-%b-%Y", "%d-%m-%Y", "%d/%m/%Y", "%d-%m-%y", "%d.%m.%Y", "%d.%m.%y"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except Exception:
            pass
    return s[:10]


def is_accounting_workbook(filepath: str) -> bool:
    """Quickly tests if a workbook contains accounting register headers."""
    try:
        wb = openpyxl.load_workbook(filepath, data_only=True, read_only=True)
        ws = wb.active
        for r_idx, row in enumerate(ws.iter_rows(max_row=12, values_only=True), start=1):
            row_vals = [str(c).strip().upper() if c is not None else "" for c in row]
            if "DATE" in row_vals and "PARTICULARS" in row_vals:
                return True
        return False
    except Exception:
        return False


def parse_accounting_workbook(filepath: str, file_sha256: str | None = None, filename: str | None = None) -> dict[str, Any]:
    """
    Parses Sales Register or Bank Book spreadsheets into a standardized transaction ledger.
    Handles variable column mappings, merged cells, and 'To'/'By' prefixes dynamically.
    """
    wb = openpyxl.load_workbook(filepath, data_only=True)
    ws = wb.active

    # Detect header row
    header_row_idx = None
    col_map = {}
    for r in range(1, 15):
        row_vals = [str(ws.cell(r, c).value or "").strip().upper() for c in range(1, 15)]
        if "DATE" in row_vals and "PARTICULARS" in row_vals:
            header_row_idx = r
            for c_idx, val in enumerate(row_vals, start=1):
                if val == "DATE":
                    col_map["date"] = c_idx
                elif val == "PARTICULARS":
                    col_map["particulars"] = c_idx
                elif val == "VCH TYPE":
                    col_map["vch_type"] = c_idx
                elif val == "VCH NO.":
                    col_map["vch_no"] = c_idx
                elif val == "DEBIT":
                    col_map["debit"] = c_idx
                elif val == "CREDIT":
                    col_map["credit"] = c_idx
            break

    if not header_row_idx or "date" not in col_map or "particulars" not in col_map:
        raise ValueError("Could not find standard accounting headers (Date, Particulars, etc.) in workbook")

    # Detect book title and period from top rows and filename
    fn_lower = os.path.basename(filename or filepath).lower()
    top_text = f"{ws.cell(1, 1).value or ''} {ws.cell(2, 1).value or ''}".strip().lower()
    if "khan" in top_text or "khan" in fn_lower:
        book_source = "Khan Cash Book"
    elif "cash" in top_text or "cash" in fn_lower:
        book_source = "Cash Book"
    elif "hdfc" in top_text or "hdfc" in fn_lower:
        book_source = "HDFC Bank Book"
    elif "yes" in top_text or "yes" in fn_lower:
        book_source = "Yes Bank Book"
    elif "sales" in top_text or "sales" in fn_lower:
        book_source = "Sales Register"
    else:
        book_source = "Accounting Book"

    period_text = str(ws.cell(header_row_idx - 1, 1).value or "").strip()
    if not period_text or len(period_text) > 40:
        period_text = datetime.now().strftime("%B %Y")

    vouchers = []
    skipped_count = 0

    for r in range(header_row_idx + 1, ws.max_row + 1):
        date_cell = ws.cell(r, col_map["date"]).value
        if date_cell is None:
            continue

        date_str_raw = str(date_cell).strip().lower()
        if date_str_raw.startswith(("total", "amount", "date", "grand total")):
            continue

        # Extract party name
        p_col = col_map["particulars"]
        raw_part = ws.cell(r, p_col).value
        prefix = ""
        if str(raw_part).strip().lower() in ["to", "by"]:
            prefix = str(raw_part).strip()
            party_name = clean_party_name(ws.cell(r, p_col + 1).value)
        else:
            party_name = clean_party_name(raw_part)

        if not party_name or party_name.lower().startswith(("opening balance", "total", "grand total")):
            skipped_count += 1
            continue

        # Voucher type and number
        vch_type = str(ws.cell(r, col_map.get("vch_type", p_col + 1)).value or "").strip()
        vch_no_val = ws.cell(r, col_map.get("vch_no", p_col + 2)).value if "vch_no" in col_map else ""
        if isinstance(vch_no_val, datetime):
            vch_no = vch_no_val.strftime("%d-%b-%y")
        elif vch_no_val is not None:
            vch_no = str(vch_no_val).strip()
        else:
            vch_no = ""

        # Debit and Credit
        debit = float(ws.cell(r, col_map.get("debit", 5)).value or 0.0)
        credit = float(ws.cell(r, col_map.get("credit", 6)).value or 0.0)
        debit_paise = round(debit * 100)
        credit_paise = round(credit * 100)

        # Skip zero rows
        if debit_paise == 0 and credit_paise == 0:
            continue

        # Format date as YYYY-MM-DD
        vch_date = normalize_date_str(date_cell)

        # Deterministic unique hash ID for idempotency
        hash_src = f"{book_source}:{vch_date}:{vch_type}:{vch_no}:{party_name}:{debit_paise}:{credit_paise}"
        vch_id = f"VCH-{hashlib.md5(hash_src.encode('utf-8')).hexdigest()[:16]}"

        vouchers.append({
            "id": vch_id,
            "voucherNo": vch_no,
            "voucherType": vch_type or ("Sales" if "Sales" in book_source else "Receipt"),
            "voucherDate": vch_date,
            "partyName": party_name,
            "prefix": prefix,
            "debitPaise": debit_paise,
            "creditPaise": credit_paise,
            "debitAmount": debit,
            "creditAmount": credit,
            "bookSource": book_source,
        })

    total_debit_paise = sum(v["debitPaise"] for v in vouchers)
    total_credit_paise = sum(v["creditPaise"] for v in vouchers)

    return {
        "bookSource": book_source,
        "periodText": period_text,
        "headerRow": header_row_idx,
        "voucherCount": len(vouchers),
        "totalDebitPaise": total_debit_paise,
        "totalCreditPaise": total_credit_paise,
        "totalDebitFormatted": f"{total_debit_paise / 100.0:,.2f}",
        "totalCreditFormatted": f"{total_credit_paise / 100.0:,.2f}",
        "vouchers": vouchers,
        "fileSha256": file_sha256 or "",
    }
