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
    """Infers state and city from party name keywords using comprehensive gazetteer."""
    try:
        from .ledger_classifier import resolve_location
        city, district, state = resolve_location(name)
        return state, city or district
    except Exception:
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


def parse_cell_amount(val: Any) -> tuple[float, str]:
    """Safely extracts float amount and unit/quantity string from a cell."""
    if val is None:
        return 0.0, ""
    if isinstance(val, (int, float)):
        return float(val), ""
    s = str(val).strip()
    if not s:
        return 0.0, ""
    cleaned = s.replace(",", "").strip()
    try:
        return float(cleaned), ""
    except ValueError:
        return 0.0, s


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
                elif val in ("VCH NO.", "VCH NO", "VOUCHER NO", "VCH NO ."):
                    col_map["vch_no"] = c_idx
                elif val.startswith("DEBIT"):
                    col_map["debit"] = c_idx
                elif val.startswith("CREDIT"):
                    col_map["credit"] = c_idx
            break

    if not header_row_idx or "date" not in col_map or "particulars" not in col_map:
        raise ValueError("Could not find standard accounting headers (Date, Particulars, etc.) in workbook")

    # Detect book title and period from top rows and filename
    fn_lower = os.path.basename(filename or filepath).lower()
    top_3_rows = " ".join(str(ws.cell(r, 1).value or "") for r in range(1, 4)).strip()
    top_text = top_3_rows.lower()
    row2_val = str(ws.cell(2, 1).value or "").strip()
    row3_val = str(ws.cell(3, 1).value or "").strip()

    is_customer_ledger = False
    is_discount_ledger = False
    is_roundoff_ledger = False
    customer_name = ""
    opening_balance_paise = 0

    if "discount" in top_text or "discount" in fn_lower:
        is_discount_ledger = True
        book_source = "Discount Ledger"
    elif "round off" in top_text or "roundoff" in fn_lower or "rounoff" in fn_lower or "round off" in row2_val.lower():
        is_roundoff_ledger = True
        book_source = "Round Off Ledger"
    elif "ledger account" in top_text or "ledger" in row3_val.lower() or "ledger" in row2_val.lower():
        is_customer_ledger = True
        if "ledger" in row2_val.lower():
            customer_name = clean_party_name(ws.cell(1, 1).value)
        else:
            customer_name = clean_party_name(row2_val)
        if not customer_name and filename:
            customer_name = clean_party_name(os.path.splitext(os.path.basename(filename))[0])
        book_source = f"Customer Ledger: {customer_name}"
    elif "khan" in top_text or "khan" in fn_lower:
        book_source = "Khan Cash Book"
    elif "gbd" in top_text or "gbd" in fn_lower:
        book_source = "Cash GBD Book"
    elif "cash" in top_text or "cash" in fn_lower:
        book_source = "Cash Book"
    elif "hdfc" in top_text or "hdfc" in fn_lower:
        book_source = "HDFC Bank Book"
    elif "yes" in top_text or "yes" in fn_lower:
        book_source = "Yes Bank Book"
    elif "sales" in top_text or "sales" in fn_lower:
        book_source = "Sales Register"
    elif "day book" in top_text or "daybook" in top_text or "daybook" in fn_lower or "day book" in fn_lower:
        book_source = "Day Book"
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

        # Stop parsing if a secondary concatenated book header is encountered (e.g. DAYBOOK duplicated block)
        if "1-apr-26 to 30-nov-27" in date_str_raw or (r > 100 and date_str_raw.startswith("dura ldh")):
            break

        # Extract particulars
        p_col = col_map["particulars"]
        raw_part = ws.cell(r, p_col).value
        prefix = ""
        part_detail = ""
        if str(raw_part).strip().lower() in ["to", "by"]:
            prefix = str(raw_part).strip()
            part_detail = clean_party_name(ws.cell(r, p_col + 1).value)
        else:
            part_detail = clean_party_name(raw_part)

        # Check for Opening Balance row
        if "opening balance" in str(raw_part or "").lower() or "opening balance" in str(part_detail or "").lower():
            dr_ob = float(ws.cell(r, col_map.get("debit", 5)).value or 0.0)
            cr_ob = float(ws.cell(r, col_map.get("credit", 6)).value or 0.0)
            opening_balance_paise = round(dr_ob * 100) if dr_ob > 0 else -round(cr_ob * 100)
            continue

        is_liquid = book_source in (
            "Khan Cash Book", "Cash Book", "Cash GBD Book", "HDFC Bank Book", "Yes Bank Book"
        )

        if is_customer_ledger:
            party_name = customer_name
            opposing_account = part_detail
            narration = f"{prefix} {opposing_account}".strip()
        elif is_discount_ledger:
            party_name = part_detail
            narration = "Discount"
        elif is_roundoff_ledger:
            party_name = part_detail
            narration = "Round Off"
        elif is_liquid:
            party_name = part_detail
            liquid_name = book_source.replace(" Book", "").strip()
            narration = f"{prefix} {liquid_name}".strip() if prefix else liquid_name
        else:
            party_name = part_detail
            narration = ""

        if not party_name or party_name.lower().startswith(("opening balance", "total", "grand total")):
            skipped_count += 1
            continue

        # Voucher type and number
        vch_type_val = ws.cell(r, col_map.get("vch_type", p_col + 1)).value if "vch_type" in col_map else ""
        vch_type = str(vch_type_val or "").strip()
        
        # STRICT USER SPECIFICATION: Stock entries strictly disabled
        if vch_type.lower() in ("stock journal", "physical stock", "material in", "material out") or "stock" in vch_type.lower():
            skipped_count += 1
            continue

        vch_no_val = ws.cell(r, col_map.get("vch_no", p_col + 2)).value if "vch_no" in col_map else ""
        if isinstance(vch_no_val, datetime):
            vch_no = vch_no_val.strftime("%d-%b-%y")
        elif vch_no_val is not None:
            vch_no = str(vch_no_val).strip()
        else:
            vch_no = ""

        # Classify party account type and normalize special ledgers
        p_lower = (party_name or "").strip().lower()
        party_type = "customer"
        party_id = ""

        if not is_roundoff_ledger and p_lower in ("round off", "roundoff", "rounoff"):
            party_name = "Round Off Ledger"
            party_id = "LEDGER-ROUNDOFF"
            party_type = "roundoff"
        elif not is_discount_ledger and p_lower in ("discount", "cd discount"):
            party_name = "Discount Ledger"
            party_id = "LEDGER-DISCOUNT"
            party_type = "discount"
        elif p_lower in ("khan cash", "khancash"):
            party_name = "KHAN CASH"
            party_id = "LEDGER-KHANCASH"
            party_type = "cash"
        elif p_lower in ("cash gbd", "cashgbd"):
            party_name = "Cash Gbd"
            party_id = "LEDGER-CASHGBD"
            party_type = "cash"
        elif p_lower in ("cash", "cash book"):
            party_name = "Cash"
            party_id = "LEDGER-CASH"
            party_type = "cash"
        elif p_lower in ("yes bank", "yes bank deemand loan", "yes"):
            party_name = "Yes Bank"
            party_id = "LEDGER-YESBANK"
            party_type = "bank"
        elif any(k == p_lower or p_lower.startswith(k) for k in ("hdfc p.o.finance", "hdfc dura", "hdfc bank", "hdfc loan account")):
            party_name = "HDFC Bank"
            party_id = "LEDGER-HDFC"
            party_type = "bank"

        if (is_discount_ledger or is_roundoff_ledger) and vch_no:
            prefix_label = "Discount" if is_discount_ledger else "Round Off"
            narration = f"{prefix_label} ({vch_no})"

        # Debit and Credit amounts / unit quantities
        raw_debit, d_qty = parse_cell_amount(ws.cell(r, col_map.get("debit", 5)).value)
        raw_credit, c_qty = parse_cell_amount(ws.cell(r, col_map.get("credit", 6)).value)
        if d_qty:
            narration = f"{narration} (Inwards: {d_qty})".strip()
        if c_qty:
            narration = f"{narration} (Outwards: {c_qty})".strip()

        # In a Liquid Cash/Bank book:
        # Sheet Debit = Cash/Bank received from party -> Party's ledger is CREDITED (Receipt)
        # Sheet Credit = Cash/Bank paid to party/expense -> Party's ledger is DEBITED (Payment)
        if is_liquid:
            debit = raw_credit
            credit = raw_debit
            if not vch_type:
                vch_type = "Receipt" if credit > 0 else "Payment"
        elif is_discount_ledger:
            debit = 0.0
            credit = raw_debit
            if not vch_type:
                vch_type = "Journal"
        elif is_roundoff_ledger:
            # If Round Off sheet has "To <Party>" (Debit) -> Party ledger is CREDITED
            # If Round Off sheet has "By <Party>" (Credit) -> Party ledger is DEBITED
            if raw_debit > 0:
                debit = 0.0
                credit = raw_debit
            else:
                debit = raw_credit
                credit = 0.0
            if not vch_type:
                vch_type = "Journal"
        else:
            debit = raw_debit
            credit = raw_credit
            if not vch_type:
                vch_type = "Sales" if debit > 0 else "Receipt"

        debit_paise = round(debit * 100)
        credit_paise = round(credit * 100)

        # Skip rows with no money and no inventory movements
        if debit_paise == 0 and credit_paise == 0 and not (d_qty or c_qty):
            continue

        if not vch_no and book_source == "Day Book":
            vch_no = f"DB-{r}"

        # Format date as YYYY-MM-DD
        vch_date = normalize_date_str(date_cell)

        # Deterministic unique hash ID for idempotency (includes row number 'r' so identical legitimate transactions are preserved)
        hash_src = f"{book_source}:{r}:{vch_date}:{vch_type}:{vch_no}:{party_name}:{debit_paise}:{credit_paise}:{d_qty or c_qty}"
        vch_id = f"VCH-{hashlib.md5(hash_src.encode('utf-8')).hexdigest()[:16]}"

        vouchers.append({
            "id": vch_id,
            "voucherNo": vch_no,
            "voucherType": vch_type or ("Sales" if "Sales" in book_source else "Receipt"),
            "voucherDate": vch_date,
            "partyName": party_name,
            "partyId": party_id,
            "partyType": party_type,
            "narration": narration,
            "prefix": prefix,
            "debitPaise": debit_paise,
            "creditPaise": credit_paise,
            "debitAmount": debit,
            "creditAmount": credit,
            "bookSource": book_source
        })

    total_debit_paise = sum(v["debitPaise"] for v in vouchers)
    total_credit_paise = sum(v["creditPaise"] for v in vouchers)

    return {
        "bookSource": book_source,
        "isCustomerLedger": is_customer_ledger,
        "isDiscountLedger": is_discount_ledger,
        "isRoundoffLedger": is_roundoff_ledger,
        "customerName": customer_name,
        "openingBalancePaise": opening_balance_paise,
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


def is_opening_balance_workbook(filepath: str) -> bool:
    """Checks if a workbook is a Trial Balance / Opening Balance register."""
    try:
        wb = openpyxl.load_workbook(filepath, data_only=True, read_only=True)
        ws = wb.active
        found_part = False
        found_balance = False
        for row in ws.iter_rows(max_row=12, values_only=True):
            vals = [str(c).strip().upper() if c is not None else "" for c in row]
            if "PARTICULARS" in vals:
                found_part = True
            if "DEBIT" in vals or "CREDIT" in vals or "CLOSING BALANCE" in vals or "TRIAL BALANCE" in vals:
                found_balance = True
        return found_part and found_balance
    except Exception:
        return False


def parse_opening_balance_workbook(filepath: str) -> dict[str, Any]:
    """Parses a Trial Balance / Opening Balance workbook (e.g. opening.xlsx)."""
    wb = openpyxl.load_workbook(filepath, data_only=True)
    ws = wb.active
    part_col, debit_col, credit_col, data_start_row = None, None, None, None
    period_text = ""

    for r in range(1, 15):
        for c in range(1, ws.max_column + 1):
            val = str(ws.cell(r, c).value or "").strip().upper()
            if "PARTICULARS" in val and part_col is None:
                part_col = c
            if val == "DEBIT" and debit_col is None:
                debit_col = c
            if val == "CREDIT" and credit_col is None:
                credit_col = c
        if part_col and debit_col and credit_col:
            data_start_row = r + 1
            break
        for c in range(1, ws.max_column + 1):
            c_val = str(ws.cell(r, c).value or "").strip()
            if "TO" in c_val.upper() and ("-" in c_val or "/" in c_val) and not period_text:
                period_text = c_val

    if not part_col or not debit_col or not credit_col or not data_start_row:
        raise ValueError("Could not find Particulars, Debit, and Credit columns in workbook")

    entries = []
    for r in range(data_start_row, ws.max_row + 1):
        name_val = ws.cell(r, part_col).value
        if not name_val:
            continue
        name_str = str(name_val).strip()
        if not name_str or name_str.lower() in ("total", "grand total", "opening stock"):
            continue
        debit_amt, _ = parse_cell_amount(ws.cell(r, debit_col).value)
        credit_amt, _ = parse_cell_amount(ws.cell(r, credit_col).value)
        if debit_amt == 0.0 and credit_amt == 0.0:
            continue
        direction = "debit" if debit_amt > 0 else "credit"
        amount = debit_amt if debit_amt > 0 else credit_amt
        amount_paise = round(amount * 100)
        entries.append({
            "name": name_str,
            "debit": debit_amt,
            "credit": credit_amt,
            "amount": amount,
            "amountPaise": amount_paise,
            "direction": direction,
        })

    return {
        "periodText": period_text or "1-Dec-24 to 30-Nov-26",
        "entries": entries,
        "count": len(entries),
        "totalDebitPaise": sum(e["amountPaise"] for e in entries if e["direction"] == "debit"),
        "totalCreditPaise": sum(e["amountPaise"] for e in entries if e["direction"] == "credit"),
    }


def detect_excel_type(filepath: str) -> str:
    """
    Auto-detects whether an Excel workbook is:
    - 'daybook': Day Book with vouchers (Sales, Payment, Receipt, Contra, Journal)
    - 'roundoff': Dedicated Round Off ledger
    - 'discount': Dedicated Discount ledger
    - 'trialbalance': Trial Balance / Master Opening Balance register
    - 'unknown': Other/unrecognized format
    """
    fn = os.path.basename(filepath).lower()
    if any(k in fn for k in ("roundoff", "round_off", "round off", "rounoff")):
        return "roundoff"
    if "discount" in fn:
        return "discount"
    if any(k in fn for k in ("trial", "opening", "tb.", "trialbalance", "trial_balance", "op.", "op_")) or fn == "op.xlsx" or fn == "op.xlsm":
        return "trialbalance"
    if any(k in fn for k in ("daybook", "day_book", "day book")):
        return "daybook"

    try:
        wb = openpyxl.load_workbook(filepath, data_only=True, read_only=True)
        ws = wb.active
        top_text = ""
        for r in range(1, 10):
            row_vals = [str(ws.cell(r, c).value or "").lower() for c in range(1, 10)]
            top_text += " ".join(row_vals) + " "
        wb.close()

        if "round off" in top_text or "roundoff" in top_text or "rounoff" in top_text:
            return "roundoff"
        if "discount" in top_text and "vch type" not in top_text:
            return "discount"
        if "trial balance" in top_text or ("particulars" in top_text and "closing balance" in top_text):
            return "trialbalance"
        if "day book" in top_text or "vch type" in top_text or "contra" in top_text:
            return "daybook"
    except Exception:
        pass

    return "unknown"
