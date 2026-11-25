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


def is_accounting_workbook(filepath: str | bytes) -> bool:
    """Quickly tests if a workbook contains accounting register headers."""
    try:
        import io
        if isinstance(filepath, bytes):
            wb = openpyxl.load_workbook(io.BytesIO(filepath), data_only=True, read_only=True)
        else:
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
    cleaned = s.replace(",", "").replace("Dr", "").replace("Cr", "").strip()
    try:
        return float(cleaned), ""
    except ValueError:
        return 0.0, s


def parse_accounting_workbook(
    filepath: str,
    file_sha256: str | None = None,
    filename: str | None = None,
    disable_payment_receipt: bool = False
) -> dict[str, Any]:
    """
    Parses Sales Register or Bank Book spreadsheets into a standardized transaction ledger.
    Handles variable column mappings, merged cells, and 'To'/'By' prefixes dynamically.
    """
    import io
    if isinstance(filepath, bytes):
        wb = openpyxl.load_workbook(io.BytesIO(filepath), data_only=True)
    else:
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

    if "journal register" in top_text or ("journal" in fn_lower and "day" not in fn_lower and "stock" not in fn_lower):
        return parse_journal_register_workbook(filepath, file_sha256=file_sha256)
    elif "discount" in top_text or "discount" in fn_lower:
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
        return parse_bank_workbook(filepath, file_sha256=file_sha256, filename=filename)
    elif "yes" in top_text or "yes" in fn_lower:
        return parse_bank_workbook(filepath, file_sha256=file_sha256, filename=filename)
    elif "sales" in top_text or "sales" in fn_lower:
        book_source = "Sales Register"
    elif "day book" in top_text or "daybook" in top_text or "daybook" in fn_lower or "day book" in fn_lower:
        book_source = "Day Book"
    else:
        book_source = "Accounting Book"

    period_text = str(ws.cell(header_row_idx - 1, 1).value or "").strip()
    if not period_text or len(period_text) > 40:
        period_text = datetime.now().strftime("%B %Y")

    def classify_party_account(name: str) -> tuple[str, str, str]:
        p_lower = (name or "").strip().lower()
        if p_lower in ("round off", "roundoff", "rounoff"):
            return "Round Off Ledger", "LEDGER-ROUNDOFF", "roundoff"
        elif p_lower in ("discount", "cd discount"):
            return "Discount Ledger", "LEDGER-DISCOUNT", "discount"
        elif p_lower in ("khan cash", "khancash"):
            return "KHAN CASH", "LEDGER-KHANCASH", "cash"
        elif p_lower in ("cash gbd", "cashgbd"):
            return "Cash Gbd", "LEDGER-CASHGBD", "cash"
        elif p_lower in ("cash", "cash book"):
            return "Cash", "LEDGER-CASH", "cash"
        elif p_lower in ("yes bank", "yes bank deemand loan", "yes"):
            return "Yes Bank", "LEDGER-YESBANK", "bank"
        elif any(k == p_lower or p_lower.startswith(k) for k in ("hdfc p.o.finance", "hdfc dura", "hdfc bank", "hdfc loan account")):
            return "HDFC Bank", "LEDGER-HDFC", "bank"
        return name, "", "customer"

    if book_source == "Day Book":
        rows = list(ws.iter_rows(values_only=True))
        c_date = col_map["date"] - 1
        c_part = col_map["particulars"] - 1
        c_type = col_map.get("vch_type", 3) - 1
        c_no = col_map.get("vch_no", 4) - 1 if "vch_no" in col_map else None
        c_dr = col_map.get("debit", 5) - 1 if "debit" in col_map else None
        c_cr = col_map.get("credit", 6) - 1 if "credit" in col_map else None

        tx_blocks = []
        current_tx = []
        for r_idx in range(header_row_idx, len(rows)):
            row = rows[r_idx]
            r = r_idx + 1
            d_val = row[c_date] if c_date < len(row) else None
            if d_val is not None:
                d_str = str(d_val).strip().lower()
                if d_str.startswith(("total", "amount", "date", "grand total", "inwards", "outwards")):
                    continue
                if "1-apr-26 to 30-nov-27" in d_str or (r > 100 and d_str.startswith("dura ldh")):
                    break
                if current_tx:
                    tx_blocks.append(current_tx)
                current_tx = [(r, row)]
            else:
                p_val = row[c_part] if c_part < len(row) else None
                dr_val = row[c_dr] if c_dr is not None and c_dr < len(row) else None
                cr_val = row[c_cr] if c_cr is not None and c_cr < len(row) else None
                if p_val is not None or dr_val is not None or cr_val is not None:
                    if current_tx:
                        current_tx.append((r, row))
        if current_tx:
            tx_blocks.append(current_tx)

        vouchers = []
        for tx in tx_blocks:
            r0, row0 = tx[0]
            vch_date = normalize_date_str(row0[c_date])
            vch_type_val = row0[c_type] if c_type < len(row0) else ""
            vch_type = str(vch_type_val or "").strip()
            
            if vch_type.lower() in ("stock journal", "physical stock", "material in", "material out") or "stock" in vch_type.lower():
                continue
            if vch_type.lower() == "contra":
                continue
            if disable_payment_receipt and vch_type.lower() in ("payment", "receipt"):
                continue

            vch_no_val = row0[c_no] if c_no is not None and c_no < len(row0) else None
            if isinstance(vch_no_val, datetime):
                vch_no = vch_no_val.strftime("%d-%b-%y")
            else:
                vch_no = str(vch_no_val or "").strip()

            lines = []
            for r, row in tx:
                p = clean_party_name(row[c_part] if c_part < len(row) else None)
                dr, d_qty = parse_cell_amount(row[c_dr] if c_dr is not None and c_dr < len(row) else None)
                cr, c_qty = parse_cell_amount(row[c_cr] if c_cr is not None and c_cr < len(row) else None)
                if p and p.lower() not in ("(cancelled)", "total", "grand total", "opening balance"):
                    lines.append((r, p, dr, cr, d_qty, c_qty))
                    
            if not lines:
                continue

            vt_lower = vch_type.lower()
            
            def make_vch_id(r, vdate, vtype, vno, pname, dr_p, cr_p, extra=""):
                clean_vno = re.sub(r'\(optional\)', '', str(vno or ''), flags=re.IGNORECASE).strip().lower()
                is_real = clean_vno and not clean_vno.startswith("db-") and '@' not in clean_vno and not any(clean_vno.startswith(m) for m in ('aug ', 'spt ', 'oct ', 'nov ', 'dec ', 'jan ', 'feb ', 'mar ', 'apr ', 'may ', 'jun ', 'jul '))
                if is_real:
                    h_src = f"{vdate}:{vtype}:{clean_vno}:{pname.strip().lower()}:{dr_p}:{cr_p}"
                else:
                    h_src = f"Day Book:{r}:{vdate}:{vtype}:{vno}:{pname}:{dr_p}:{cr_p}:{extra}"
                return f"VCH-{hashlib.md5(h_src.encode('utf-8')).hexdigest()[:16]}"

            if len(lines) == 1:
                r, p, dr, cr, d_qty, c_qty = lines[0]
                if dr > 0 or cr > 0:
                    pname, pid, ptype = classify_party_account(p)
                    vtype = vch_type or ("Sales" if dr > 0 else "Receipt")
                    dr_p = round(dr * 100)
                    cr_p = round(cr * 100)
                    v_id = make_vch_id(r, vch_date, vtype, vch_no or f"DB-{r}", pname, dr_p, cr_p, d_qty or c_qty)
                    vouchers.append({
                        "id": v_id,
                        "voucherNo": vch_no or f"DB-{r}",
                        "voucherType": vtype,
                        "voucherDate": vch_date,
                        "partyName": pname,
                        "partyId": pid,
                        "partyType": ptype,
                        "debitPaise": dr_p,
                        "creditPaise": cr_p,
                        "debitAmount": dr,
                        "creditAmount": cr,
                        "narration": "",
                        "prefix": "",
                        "bookSource": "Day Book"
                    })
            elif vt_lower == "sales":
                r, p, dr, cr, d_qty, c_qty = lines[0]
                pname, pid, ptype = classify_party_account(p)
                dr_p = round(dr * 100)
                opposing = [l[1] for l in lines[1:] if clean_party_name(l[1]).lower() not in ("sales dura", "sales", "bill gst", "gst", "round off")]
                narr = opposing[0] if opposing else "Sales Dura"
                v_id = make_vch_id(r, vch_date, "Sales", vch_no or f"DB-{r}", pname, dr_p, 0, d_qty or c_qty)
                vouchers.append({
                    "id": v_id,
                    "voucherNo": vch_no or f"DB-{r}",
                    "voucherType": "Sales",
                    "voucherDate": vch_date,
                    "partyName": pname,
                    "partyId": pid,
                    "partyType": ptype,
                    "debitPaise": dr_p,
                    "creditPaise": 0,
                    "debitAmount": dr,
                    "creditAmount": 0.0,
                    "narration": narr,
                    "prefix": "",
                    "bookSource": "Day Book"
                })
            elif vt_lower == "purchase":
                r, p, dr, cr, d_qty, c_qty = lines[0]
                pname, pid, ptype = classify_party_account(p)
                cr_p = round(cr * 100)
                v_id = make_vch_id(r, vch_date, "Purchase", vch_no or f"DB-{r}", pname, 0, cr_p, d_qty or c_qty)
                vouchers.append({
                    "id": v_id,
                    "voucherNo": vch_no or f"DB-{r}",
                    "voucherType": "Purchase",
                    "voucherDate": vch_date,
                    "partyName": pname,
                    "partyId": pid,
                    "partyType": ptype,
                    "debitPaise": 0,
                    "creditPaise": cr_p,
                    "debitAmount": 0.0,
                    "creditAmount": cr,
                    "narration": "Purchage",
                    "prefix": "",
                    "bookSource": "Day Book"
                })
            elif vt_lower == "credit note":
                r, p, dr, cr, d_qty, c_qty = lines[0]
                pname, pid, ptype = classify_party_account(p)
                cr_p = round(cr * 100)
                v_id = make_vch_id(r, vch_date, "Credit Note", vch_no or f"DB-{r}", pname, 0, cr_p, d_qty or c_qty)
                vouchers.append({
                    "id": v_id,
                    "voucherNo": vch_no or f"DB-{r}",
                    "voucherType": "Credit Note",
                    "voucherDate": vch_date,
                    "partyName": pname,
                    "partyId": pid,
                    "partyType": ptype,
                    "debitPaise": 0,
                    "creditPaise": cr_p,
                    "debitAmount": 0.0,
                    "creditAmount": cr,
                    "narration": "Sales Dura",
                    "prefix": "",
                    "bookSource": "Day Book"
                })
            elif vt_lower == "debit note":
                r, p, dr, cr, d_qty, c_qty = lines[0]
                pname, pid, ptype = classify_party_account(p)
                dr_p = round(dr * 100)
                v_id = make_vch_id(r, vch_date, "Debit Note", vch_no or f"DB-{r}", pname, dr_p, 0, d_qty or c_qty)
                vouchers.append({
                    "id": v_id,
                    "voucherNo": vch_no or f"DB-{r}",
                    "voucherType": "Debit Note",
                    "voucherDate": vch_date,
                    "partyName": pname,
                    "partyId": pid,
                    "partyType": ptype,
                    "debitPaise": dr_p,
                    "creditPaise": 0,
                    "debitAmount": dr,
                    "creditAmount": 0.0,
                    "narration": "Purchage",
                    "prefix": "",
                    "bookSource": "Day Book"
                })
            elif vt_lower == "receipt":
                d_names = [l[1] for l in lines if l[2] > 0]
                bank_label = ", ".join(d_names) if d_names else "Bank"
                for r, p, dr, cr, d_qty, c_qty in lines:
                    if cr > 0:
                        pname, pid, ptype = classify_party_account(p)
                        cr_p = round(cr * 100)
                        v_id = make_vch_id(r, vch_date, "Receipt", vch_no or f"DB-{r}", pname, 0, cr_p, d_qty or c_qty)
                        vouchers.append({
                            "id": v_id,
                            "voucherNo": vch_no or f"DB-{r}",
                            "voucherType": "Receipt",
                            "voucherDate": vch_date,
                            "partyName": pname,
                            "partyId": pid,
                            "partyType": ptype,
                            "debitPaise": 0,
                            "creditPaise": cr_p,
                            "debitAmount": 0.0,
                            "creditAmount": cr,
                            "narration": f"To {bank_label}",
                            "prefix": "",
                            "bookSource": "Day Book"
                        })
            elif vt_lower == "payment":
                c_names = [l[1] for l in lines if l[3] > 0]
                bank_label = ", ".join(c_names) if c_names else "Bank"
                for r, p, dr, cr, d_qty, c_qty in lines:
                    if dr > 0:
                        pname, pid, ptype = classify_party_account(p)
                        dr_p = round(dr * 100)
                        v_id = make_vch_id(r, vch_date, "Payment", vch_no or f"DB-{r}", pname, dr_p, 0, d_qty or c_qty)
                        vouchers.append({
                            "id": v_id,
                            "voucherNo": vch_no or f"DB-{r}",
                            "voucherType": "Payment",
                            "voucherDate": vch_date,
                            "partyName": pname,
                            "partyId": pid,
                            "partyType": ptype,
                            "debitPaise": dr_p,
                            "creditPaise": 0,
                            "debitAmount": dr,
                            "creditAmount": 0.0,
                            "narration": f"By {bank_label}",
                            "prefix": "",
                            "bookSource": "Day Book"
                        })
            else:
                debits = [(r, p, dr, dq, cq) for r, p, dr, cr, dq, cq in lines if dr > 0]
                credits = [(r, p, cr, dq, cq) for r, p, dr, cr, dq, cq in lines if cr > 0]
                c_names = [c[1] for c in credits]
                d_names = [d[1] for d in debits]
                
                for r, p, dr, d_qty, c_qty in debits:
                    pname, pid, ptype = classify_party_account(p)
                    dr_p = round(dr * 100)
                    opp = [c for c in c_names if c != p]
                    narr = f"To {', '.join(opp)}" if opp else "Journal"
                    v_id = make_vch_id(r, vch_date, "Journal", vch_no or f"DB-{r}", pname, dr_p, 0, d_qty or c_qty)
                    vouchers.append({
                        "id": v_id,
                        "voucherNo": vch_no or f"DB-{r}",
                        "voucherType": "Journal",
                        "voucherDate": vch_date,
                        "partyName": pname,
                        "partyId": pid,
                        "partyType": ptype,
                        "debitPaise": dr_p,
                        "creditPaise": 0,
                        "debitAmount": dr,
                        "creditAmount": 0.0,
                        "narration": narr,
                        "prefix": "",
                        "bookSource": "Day Book"
                    })
                for r, p, cr, d_qty, c_qty in credits:
                    pname, pid, ptype = classify_party_account(p)
                    cr_p = round(cr * 100)
                    opp = [d for d in d_names if d != p]
                    narr = f"By {', '.join(opp)}" if opp else "Journal"
                    v_id = make_vch_id(r, vch_date, "Journal", vch_no or f"DB-{r}", pname, 0, cr_p, d_qty or c_qty)
                    vouchers.append({
                        "id": v_id,
                        "voucherNo": vch_no or f"DB-{r}",
                        "voucherType": "Journal",
                        "voucherDate": vch_date,
                        "partyName": pname,
                        "partyId": pid,
                        "partyType": ptype,
                        "debitPaise": 0,
                        "creditPaise": cr_p,
                        "debitAmount": 0.0,
                        "creditAmount": cr,
                        "narration": narr,
                        "prefix": "",
                        "bookSource": "Day Book"
                    })

        total_debit_paise = sum(v["debitPaise"] for v in vouchers)
        total_credit_paise = sum(v["creditPaise"] for v in vouchers)

        return {
            "bookSource": "Day Book",
            "isCustomerLedger": False,
            "isDiscountLedger": False,
            "isRoundoffLedger": False,
            "customerName": "",
            "openingBalancePaise": 0,
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

        # STRICT USER SPECIFICATION: In Day Book, disable Payment and Receipt
        # Bank payments and receipts are authoritatively handled by dedicated bank books (HDFC & Yes Bank)
        if book_source == "Day Book" and disable_payment_receipt and vch_type.lower() in ("payment", "receipt"):
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

        # Deterministic unique hash ID for idempotency:
        # If a real invoice/voucher_no is present (not generic DB-* and not a discount formula with @ or month prefixes),
        # do not tie it to row number 'r', so that identical vouchers in re-uploaded Excel sheets produce identical IDs.
        # Multi-row discount entries (e.g. 'SPT QD ST 91250@.75') MUST include 'r' so all lines are preserved!
        clean_vno_str = re.sub(r'\(optional\)', '', str(vch_no or ''), flags=re.IGNORECASE).strip().lower()
        is_real_inv = (
            clean_vno_str 
            and not clean_vno_str.startswith("db-") 
            and '@' not in clean_vno_str 
            and not any(clean_vno_str.startswith(p) for p in ('aug ', 'spt ', 'oct ', 'nov ', 'dec ', 'jan ', 'feb ', 'mar ', 'apr ', 'may ', 'jun ', 'jul '))
        )
        if is_real_inv:
            hash_src = f"{vch_date}:{vch_type}:{clean_vno_str}:{party_name.strip().lower()}:{debit_paise}:{credit_paise}"
        else:
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
    import io
    if isinstance(filepath, bytes):
        wb = openpyxl.load_workbook(io.BytesIO(filepath), data_only=True)
    else:
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


def parse_journal_register_workbook(filepath: str, file_sha256: str | None = None) -> dict[str, Any]:
    """
    Parses Tally Master Double-Entry Journal Register (journal.xlsx).
    Handles multi-line compound transactions with both Debit and Credit legs,
    generating complete double-entry vouchers with counterparty narrations.
    """
    import io
    if isinstance(filepath, bytes):
        wb = openpyxl.load_workbook(io.BytesIO(filepath), data_only=True)
    else:
        wb = openpyxl.load_workbook(filepath, data_only=True)
    ws = wb.active

    # Detect header row
    header_row_idx = 4
    for r in range(1, 10):
        row_vals = [str(ws.cell(r, c).value or "").strip().upper() for c in range(1, 9)]
        if "DATE" in row_vals and "PARTICULARS" in row_vals:
            header_row_idx = r
            break

    period_text = str(ws.cell(header_row_idx - 1, 1).value or "").strip()
    if not period_text:
        period_text = "1-Apr-26 to 30-Nov-26"

    # Group rows into transaction blocks
    tx_blocks = []
    current_tx = []
    for r in range(header_row_idx + 2, ws.max_row + 1):
        vals = [ws.cell(r, c).value for c in range(1, 9)]
        if vals[0] is not None:
            if current_tx:
                tx_blocks.append(current_tx)
            current_tx = [(r, vals)]
        else:
            if current_tx:
                current_tx.append((r, vals))
    if current_tx:
        tx_blocks.append(current_tx)

    def clean_amt(val: Any) -> float:
        if val is None:
            return 0.0
        if isinstance(val, (int, float)):
            return float(val)
        s = str(val).replace("Cr", "").replace("Dr", "").replace(",", "").strip()
        try:
            return float(s)
        except Exception:
            return 0.0

    vouchers = []
    for tx in tx_blocks:
        r0, v0 = tx[0]
        date_val = v0[0]
        vch_date = normalize_date_str(date_val)
        vch_type = str(v0[4] or "Journal").strip()
        vch_no = str(v0[5] or "").strip()

        debits = []
        credits = []
        for r, vals in tx:
            part = clean_party_name(vals[1])
            if not part or part.lower() in ("(cancelled)", "total", "grand total"):
                continue
            dr = clean_amt(vals[6])
            cr = clean_amt(vals[7])
            if dr > 0:
                debits.append((r, part, dr))
            elif cr > 0:
                credits.append((r, part, cr))

        # Debit vouchers
        for r, deb_party, dr in debits:
            c_names = [c[1] for c in credits]
            narration = f"To {', '.join(c_names)} {vch_no}".strip() if c_names else vch_no
            clean_jv_no = re.sub(r'\(optional\)', '', str(vch_no or ''), flags=re.IGNORECASE).strip().lower()
            if clean_jv_no and not clean_jv_no.startswith("jv-"):
                hash_src = f"JV-DR:{vch_date}:{deb_party.strip().lower()}:{round(dr*100)}:{clean_jv_no}"
                vch_id = f"JV-{hashlib.md5(hash_src.encode('utf-8')).hexdigest()[:16]}"
            else:
                hash_src = f"JV-DR:{r}:{vch_date}:{deb_party}:{round(dr*100)}:{vch_no}"
                vch_id = f"JV-{r}-{hashlib.md5(hash_src.encode('utf-8')).hexdigest()[:10]}"
            vouchers.append({
                "id": vch_id,
                "voucherNo": vch_no or f"JV-{r}",
                "voucherType": "Journal",
                "voucherDate": vch_date,
                "partyName": deb_party,
                "partyId": "",
                "partyType": "customer",
                "narration": narration,
                "debitPaise": round(dr * 100),
                "creditPaise": 0,
                "debitAmount": dr,
                "creditAmount": 0.0,
                "bookSource": "Journal Register"
            })

        # Credit vouchers
        for r, cred_party, cr in credits:
            d_names = [d[1] for d in debits]
            narration = f"By {', '.join(d_names)} {vch_no}".strip() if d_names else vch_no
            clean_jv_no = re.sub(r'\(optional\)', '', str(vch_no or ''), flags=re.IGNORECASE).strip().lower()
            if clean_jv_no and not clean_jv_no.startswith("jv-"):
                hash_src = f"JV-CR:{vch_date}:{cred_party.strip().lower()}:{round(cr*100)}:{clean_jv_no}"
                vch_id = f"JV-{hashlib.md5(hash_src.encode('utf-8')).hexdigest()[:16]}"
            else:
                hash_src = f"JV-CR:{r}:{vch_date}:{cred_party}:{round(cr*100)}:{vch_no}"
                vch_id = f"JV-{r}-{hashlib.md5(hash_src.encode('utf-8')).hexdigest()[:10]}"
            vouchers.append({
                "id": vch_id,
                "voucherNo": vch_no or f"JV-{r}",
                "voucherType": "Journal",
                "voucherDate": vch_date,
                "partyName": cred_party,
                "partyId": "",
                "partyType": "customer",
                "narration": narration,
                "debitPaise": 0,
                "creditPaise": round(cr * 100),
                "debitAmount": 0.0,
                "creditAmount": cr,
                "bookSource": "Journal Register"
            })

    total_debit_paise = sum(v["debitPaise"] for v in vouchers)
    total_credit_paise = sum(v["creditPaise"] for v in vouchers)

    return {
        "bookSource": "Journal Register",
        "isJournalRegister": True,
        "isCustomerLedger": False,
        "isDiscountLedger": False,
        "isRoundoffLedger": False,
        "customerName": "",
        "openingBalancePaise": 0,
        "periodText": period_text,
        "voucherCount": len(vouchers),
        "totalDebitPaise": total_debit_paise,
        "totalCreditPaise": total_credit_paise,
        "totalDebitFormatted": f"{total_debit_paise / 100.0:,.2f}",
        "totalCreditFormatted": f"{total_credit_paise / 100.0:,.2f}",
        "vouchers": vouchers,
        "fileSha256": file_sha256 or "",
    }


def parse_bank_workbook(
    filepath: str,
    file_sha256: str | None = None,
    filename: str | None = None
) -> dict[str, Any]:
    """
    Parses dedicated Bank Books (HDFC Bank Book, Yes Bank Book).
    Properly extracts compound transactions with child rows under '(as per details)',
    assigning the parent Date, Voucher Type, and Voucher No to each child split leg.

    Double-Entry Bank Accounting Rules:
    - Sheet Debit (Deposits / Inflow): Party account is CREDITED (Receipt from party)
    - Sheet Credit (Withdrawals / Outflow): Party account is DEBITED (Payment to party)
    """
    import io
    if isinstance(filepath, bytes):
        wb = openpyxl.load_workbook(io.BytesIO(filepath), data_only=True)
    else:
        wb = openpyxl.load_workbook(filepath, data_only=True)
    ws = wb.active

    fn_lower = os.path.basename(filename or filepath).lower()
    top_3_rows = " ".join(str(ws.cell(r, 1).value or "") for r in range(1, 4)).strip().lower()

    if "hdfc" in top_3_rows or "hdfc" in fn_lower:
        bank_source = "HDFC Bank Book"
        bank_party_id = "LEDGER-HDFC"
        bank_party_name = "HDFC Bank"
    elif "yes" in top_3_rows or "yes" in fn_lower:
        bank_source = "Yes Bank Book"
        bank_party_id = "LEDGER-YESBANK"
        bank_party_name = "Yes Bank"
    elif any(k in top_3_rows or k in fn_lower for k in ("khan cash", "khancash")):
        bank_source = "Khan Cash Book"
        bank_party_id = "LEDGER-KHANCASH"
        bank_party_name = "KHAN CASH"
    elif any(k in top_3_rows or k in fn_lower for k in ("cash gbd", "cashgbd")):
        bank_source = "Cash GBD Book"
        bank_party_id = "LEDGER-CASHGBD"
        bank_party_name = "Cash Gbd"
    elif "cash" in top_3_rows or "cash" in fn_lower:
        bank_source = "Cash Book"
        bank_party_id = "LEDGER-CASH"
        bank_party_name = "Cash"
    else:
        bank_source = "Bank Book"
        bank_party_id = "LEDGER-BANK"
        bank_party_name = "Bank"

    # Find header row
    h_row = None
    col_map = {}
    for r in range(1, 15):
        vals = [str(ws.cell(r, c).value or "").strip().upper() for c in range(1, 15)]
        if "DATE" in vals and "PARTICULARS" in vals:
            h_row = r
            for c_idx, val in enumerate(vals, start=1):
                if val == "DATE":
                    col_map["date"] = c_idx
                elif val == "PARTICULARS":
                    col_map["particulars"] = c_idx
                elif val in ("VCH TYPE", "VOUCHER TYPE"):
                    col_map["vch_type"] = c_idx
                elif val in ("VCH NO.", "VCH NO", "VOUCHER NO", "VCH NO ."):
                    col_map["vch_no"] = c_idx
                elif val.startswith("DEBIT"):
                    col_map["debit"] = c_idx
                elif val.startswith("CREDIT"):
                    col_map["credit"] = c_idx
            break

    if not h_row or "debit" not in col_map or "credit" not in col_map:
        raise ValueError(f"Could not find Date/Particulars header in liquid workbook {filepath}")

    dr_col = col_map["debit"]
    cr_col = col_map["credit"]
    vtype_col = col_map.get("vch_type")
    vno_col = col_map.get("vch_no")

    period_text = str(ws.cell(h_row - 1, 1).value or "").strip()
    if not period_text or len(period_text) > 40:
        period_text = datetime.now().strftime("%B %Y")

    vouchers = []
    cur_parent = None
    opening_balance_paise = 0

    for r in range(h_row + 1, ws.max_row + 1):
        c1 = ws.cell(r, 1).value
        c2 = ws.cell(r, 2).value
        c3 = ws.cell(r, 3).value
        vtype_val = ws.cell(r, vtype_col).value if vtype_col else None
        vno_val = ws.cell(r, vno_col).value if vno_col else None
        dr_val = ws.cell(r, dr_col).value
        cr_val = ws.cell(r, cr_col).value

        # Check for Opening Balance row
        row_str = f"{c1} {c2} {c3}".lower()
        if "opening balance" in row_str:
            dr_amt = float(dr_val or 0)
            cr_amt = float(cr_val or 0)
            opening_balance_paise = round((dr_amt - cr_amt) * 100)
            continue

        # Parent row check (contains valid date)
        if c1 is not None and str(c1).strip().lower() not in ("total", "grand total", "date"):
            # Stop if another title block is hit
            if "1-apr-26 to" in str(c1).lower():
                break

            vch_date = normalize_date_str(c1)
            prefix = str(c2 or "").strip()
            raw_part = str(c3 or "").strip() if prefix in ("To", "By") else str(c2 or "").strip()
            if not raw_part:
                raw_part = str(c3 or c2 or "").strip()

            if "opening balance" in raw_part.lower():
                continue

            part = clean_party_name(raw_part)
            vtype = str(vtype_val or "").strip()
            vno = str(vno_val or "").strip() if vno_val is not None else ""

            # Check if this is a parent row for compound split entries
            if "(as per details)" in raw_part.lower():
                cur_parent = {
                    "row": r,
                    "date": vch_date,
                    "vtype": vtype or ("Payment" if cr_val else "Receipt"),
                    "vno": vno,
                    "prefix": prefix,
                    "dr": float(dr_val or 0),
                    "cr": float(cr_val or 0)
                }
                continue
            else:
                cur_parent = None

            # Normal single row
            p_dr = float(cr_val or 0) # Sheet Cr -> Party Dr (Payment)
            p_cr = float(dr_val or 0) # Sheet Dr -> Party Cr (Receipt)

            if p_dr == 0 and p_cr == 0:
                continue

            v_type_assigned = vtype or ("Payment" if p_dr > 0 else "Receipt")

            # Party classification
            p_lower = part.lower()
            party_type = "customer"
            party_id = ""
            if p_lower in ("round off", "roundoff", "rounoff"):
                part = "Round Off Ledger"
                party_id = "LEDGER-ROUNDOFF"
                party_type = "roundoff"
            elif p_lower in ("discount", "cd discount"):
                part = "Discount Ledger"
                party_id = "LEDGER-DISCOUNT"
                party_type = "discount"
            elif p_lower in ("khan cash", "khancash"):
                part = "KHAN CASH"
                party_id = "LEDGER-KHANCASH"
                party_type = "cash"
            elif p_lower in ("cash gbd", "cashgbd"):
                part = "Cash Gbd"
                party_id = "LEDGER-CASHGBD"
                party_type = "cash"
            elif p_lower in ("cash", "cash book"):
                part = "Cash"
                party_id = "LEDGER-CASH"
                party_type = "cash"
            elif p_lower in ("yes bank", "yes bank deemand loan", "yes"):
                part = "Yes Bank"
                party_id = "LEDGER-YESBANK"
                party_type = "bank"
            elif any(k == p_lower or p_lower.startswith(k) for k in ("hdfc p.o.finance", "hdfc dura", "hdfc bank", "hdfc loan account")):
                part = "HDFC Bank"
                party_id = "LEDGER-HDFC"
                party_type = "bank"

            debit_paise = round(p_dr * 100)
            credit_paise = round(p_cr * 100)

            clean_bnk_vno = re.sub(r'\(optional\)', '', str(vno or ''), flags=re.IGNORECASE).strip().lower()
            if clean_bnk_vno and not clean_bnk_vno.startswith(('hdfc-', 'yes-', 'cash-')):
                hash_src = f"{bank_source}:{vch_date}:{v_type_assigned}:{clean_bnk_vno}:{part.strip().lower()}:{debit_paise}:{credit_paise}"
            else:
                hash_src = f"{bank_source}:{r}:{vch_date}:{v_type_assigned}:{vno}:{part}:{debit_paise}:{credit_paise}"
            vch_id = f"BNK-{hashlib.md5(hash_src.encode('utf-8')).hexdigest()[:16]}"

            vouchers.append({
                "id": vch_id,
                "voucherNo": vno or f"{bank_party_name[:4].upper()}-{r}",
                "voucherType": v_type_assigned,
                "voucherDate": vch_date,
                "partyName": part,
                "partyId": party_id,
                "partyType": party_type,
                "narration": f"{prefix} {bank_party_name}".strip() if prefix else bank_party_name,
                "debitPaise": debit_paise,
                "creditPaise": credit_paise,
                "debitAmount": p_dr,
                "creditAmount": p_cr,
                "bookSource": bank_source
            })
        else:
            # Child row under (as per details)
            if not cur_parent:
                continue
            raw_part = str(c3 or c2 or "").strip()
            if not raw_part or raw_part.lower() in ("total", "grand total", "(cancelled)"):
                continue

            part = clean_party_name(raw_part)
            amt_str = str(dr_val or cr_val or "").strip()
            p_dr = 0.0
            p_cr = 0.0
            if "dr" in amt_str.lower():
                p_dr = float(re.sub(r"[^\d.]", "", amt_str) or 0)
            elif "cr" in amt_str.lower():
                p_cr = float(re.sub(r"[^\d.]", "", amt_str) or 0)
            else:
                amt = float(re.sub(r"[^\d.]", "", amt_str) or 0)
                if cur_parent["cr"] > 0:
                    p_dr = amt
                else:
                    p_cr = amt

            if p_dr == 0 and p_cr == 0:
                continue

            v_type_assigned = cur_parent["vtype"] or ("Payment" if p_dr > 0 else "Receipt")

            # Party classification
            p_lower = part.lower()
            party_type = "customer"
            party_id = ""
            if p_lower in ("round off", "roundoff", "rounoff"):
                part = "Round Off Ledger"
                party_id = "LEDGER-ROUNDOFF"
                party_type = "roundoff"
            elif p_lower in ("discount", "cd discount"):
                part = "Discount Ledger"
                party_id = "LEDGER-DISCOUNT"
                party_type = "discount"
            elif p_lower in ("khan cash", "khancash"):
                part = "KHAN CASH"
                party_id = "LEDGER-KHANCASH"
                party_type = "cash"
            elif p_lower in ("cash gbd", "cashgbd"):
                part = "Cash Gbd"
                party_id = "LEDGER-CASHGBD"
                party_type = "cash"
            elif p_lower in ("cash", "cash book"):
                part = "Cash"
                party_id = "LEDGER-CASH"
                party_type = "cash"
            elif p_lower in ("yes bank", "yes bank deemand loan", "yes"):
                part = "Yes Bank"
                party_id = "LEDGER-YESBANK"
                party_type = "bank"
            elif any(k == p_lower or p_lower.startswith(k) for k in ("hdfc p.o.finance", "hdfc dura", "hdfc bank", "hdfc loan account")):
                part = "HDFC Bank"
                party_id = "LEDGER-HDFC"
                party_type = "bank"

            debit_paise = round(p_dr * 100)
            credit_paise = round(p_cr * 100)

            clean_child_vno = re.sub(r'\(optional\)', '', str(cur_parent.get('vno') or ''), flags=re.IGNORECASE).strip().lower()
            if clean_child_vno and not clean_child_vno.startswith(('hdfc-', 'yes-', 'cash-')):
                hash_src = f"{bank_source}:{cur_parent['date']}:{v_type_assigned}:{clean_child_vno}:{part.strip().lower()}:{debit_paise}:{credit_paise}"
            else:
                hash_src = f"{bank_source}:{cur_parent['row']}:{r}:{cur_parent['date']}:{v_type_assigned}:{cur_parent['vno']}:{part}:{debit_paise}:{credit_paise}"
            vch_id = f"BNK-{hashlib.md5(hash_src.encode('utf-8')).hexdigest()[:16]}"

            vouchers.append({
                "id": vch_id,
                "voucherNo": cur_parent["vno"] or f"{bank_party_name[:4].upper()}-{cur_parent['row']}-{r}",
                "voucherType": v_type_assigned,
                "voucherDate": cur_parent["date"],
                "partyName": part,
                "partyId": party_id,
                "partyType": party_type,
                "narration": f"{cur_parent['prefix']} {bank_party_name} (split)".strip(),
                "debitPaise": debit_paise,
                "creditPaise": credit_paise,
                "debitAmount": p_dr,
                "creditAmount": p_cr,
                "bookSource": bank_source
            })

    total_debit_paise = sum(v["debitPaise"] for v in vouchers)
    total_credit_paise = sum(v["creditPaise"] for v in vouchers)

    return {
        "bookSource": bank_source,
        "isCustomerLedger": False,
        "isDiscountLedger": False,
        "isRoundoffLedger": False,
        "isBankBook": True,
        "bankName": bank_party_name,
        "customerName": "",
        "openingBalancePaise": opening_balance_paise,
        "periodText": period_text,
        "voucherCount": len(vouchers),
        "totalDebitPaise": total_debit_paise,
        "totalCreditPaise": total_credit_paise,
        "totalDebitFormatted": f"{total_debit_paise / 100.0:,.2f}",
        "totalCreditFormatted": f"{total_credit_paise / 100.0:,.2f}",
        "vouchers": vouchers,
        "fileSha256": file_sha256 or "",
    }


def parse_debtor_balance_workbook(
    filepath_or_bytes: str | bytes,
    file_sha256: str | None = None
) -> dict[str, Any]:
    """
    Parses Tally Prime 'Sundry Debtors Group Summary' export (e.g. debtor balance.xlsx).
    Extracts Opening Balance, Debit, Credit, and Closing Balance ground truth benchmarks.
    Auto-detects:
    1. New Format (split_dr_cr):
       - Header rows with 'Opening Balance' and 'Closing Balance'
       - Sub-headers with 'Debit', 'Credit', 'Debit', 'Credit' across columns B, C, D, E
    2. Legacy Format:
       - Columns: Particulars, Opening, Debit, Credit, Closing (with Dr/Cr strings)
    """
    import io
    if isinstance(filepath_or_bytes, bytes):
        wb = openpyxl.load_workbook(io.BytesIO(filepath_or_bytes), data_only=True)
    else:
        wb = openpyxl.load_workbook(filepath_or_bytes, data_only=True)
    
    ws = wb.active

    # Auto-detect header row and layout
    header_row = 1
    layout = "legacy"
    start_row = 2

    for r in range(1, min(15, ws.max_row + 1)):
        c1 = ws.cell(r, 1).value
        if c1 and "particular" in str(c1).lower():
            header_row = r
            break

    for r in range(header_row, min(header_row + 4, ws.max_row + 1)):
        vals = [str(ws.cell(r, c).value or "").lower().strip() for c in range(1, 7)]
        if "closing balance" in vals[3:5] or ("debit" in vals[3:5] and "credit" in vals[4:6]):
            layout = "split_dr_cr"
            start_row = r + 1
        elif len(vals) >= 5 and vals[1] == "debit" and vals[2] == "credit" and vals[3] == "debit" and vals[4] == "credit":
            layout = "split_dr_cr"
            start_row = r + 1

    def to_float(val):
        if val is None:
            return 0.0
        try:
            s = str(val).strip()
            num = float(re.sub(r"[^\d.]", "", s) or 0)
            if "cr" in s.lower() and not s.startswith("-"):
                return -num
            return num
        except Exception:
            return 0.0

    def _parse_amt(val):
        if not val:
            return 0, 'debit'
        s = str(val).strip().lower()
        num = float(re.sub(r'[^\d.]', '', s) or 0)
        paise = int(round(num * 100))
        if 'cr' in s:
            return -paise, 'credit'
        return paise, 'debit'

    benchmarks = []
    for r in range(start_row, ws.max_row + 1):
        c1 = ws.cell(r, 1).value
        if not c1:
            continue
        s = str(c1).strip()
        s_low = s.lower()
        if s_low.startswith(('total', 'grand total', 'closing balance', 'particulars', 'dura ldh', 'sundry debtors', 'group summary')) or '1-apr' in s_low or 'opening balance' in s_low:
            continue
        if not any(c.isalpha() for c in s):
            continue
        # Avoid corrupted binary lines (e.g. trailing row in some exports)
        ascii_ratio = sum(1 for c in s if ord(c) < 128) / len(s)
        if ascii_ratio < 0.7:
            continue
        
        pname = clean_party_name(s)

        if layout == "split_dr_cr":
            op_dr = to_float(ws.cell(r, 2).value)
            op_cr = to_float(ws.cell(r, 3).value)
            cl_dr = to_float(ws.cell(r, 4).value)
            cl_cr = to_float(ws.cell(r, 5).value)

            net_op = op_dr - op_cr
            net_cl = cl_dr - cl_cr
            op_paise = int(round(net_op * 100))
            cl_paise = int(round(net_cl * 100))
            cl_dir = 'credit' if net_cl < 0 else 'debit'
            dr_paise = int(round(cl_dr * 100)) if cl_dr > 0 else 0
            cr_paise = int(round(cl_cr * 100)) if cl_cr > 0 else 0
        else:
            op_paise, op_dir = _parse_amt(ws.cell(r, 2).value)
            dr_paise, _ = _parse_amt(ws.cell(r, 3).value)
            cr_paise, _ = _parse_amt(ws.cell(r, 4).value)
            cl_paise, cl_dir = _parse_amt(ws.cell(r, 5).value)

        benchmarks.append({
            "partyName": pname,
            "rawName": s,
            "openingPaise": op_paise,
            "debitPaise": dr_paise,
            "creditPaise": cr_paise,
            "closingPaise": cl_paise,
            "closingFormatted": f"₹{abs(cl_paise) / 100.0:,.2f} {'Cr.' if cl_paise < 0 else 'Dr.' if cl_paise > 0 else ''}".strip(),
            "direction": cl_dir
        })

    wb.close()
    return {
        "fileSha256": file_sha256 or "",
        "totalBenchmarks": len(benchmarks),
        "benchmarks": benchmarks
    }


def detect_excel_type(filepath: str) -> str:
    """
    Auto-detects whether an Excel workbook is:
    - 'daybook': Day Book with vouchers (Sales, Purchases, Contra, Notes, Cash payments/receipts)
    - 'hdfc': Dedicated HDFC Bank Book (hdfc.xlsx)
    - 'yesbank': Dedicated Yes Bank Book (yesbank.xlsx)
    - 'cash': Dedicated Cash Book (cash.xlsx)
    - 'khancash': Dedicated Khan Cash Book (khancash.xlsx)
    - 'cashgbd': Dedicated Cash GBD Book (cashgbd.xlsx)
    - 'roundoff': Dedicated Round Off ledger
    - 'discount': Dedicated Discount ledger
    - 'journal': Master Double-Entry Journal Register (journal.xlsx)
    - 'trialbalance': Trial Balance / Master Opening Balance register
    - 'customer_ledger': Individual party/customer ledger statement exported from Tally
    - 'unknown': Other/unrecognized format
    """
    fn = os.path.basename(filepath).lower()
    if any(k in fn for k in ("debtor balance", "debtor_balance", "debtorbalance", "sundry debtors", "sundry_debtors")):
        return "debtor_balance"
    if "hdfc" in fn:
        return "hdfc"
    if any(k in fn for k in ("yesbank", "yes_bank", "yes bank", "yes.xlsx")):
        return "yesbank"
    if any(k in fn for k in ("khancash", "khan_cash", "khan cash")):
        return "khancash"
    if any(k in fn for k in ("cashgbd", "cash_gbd", "cash gbd")):
        return "cashgbd"
    if "cash" in fn and "day" not in fn and "khan" not in fn and "gbd" not in fn:
        return "cash"
    if any(k in fn for k in ("roundoff", "round_off", "round off", "rounoff")):
        return "roundoff"
    if "discount" in fn:
        return "discount"
    if "journal" in fn and "stock" not in fn and "day" not in fn:
        return "journal"
    if any(k in fn for k in ("trial", "opening", "tb.", "trialbalance", "trial_balance", "op.", "op_")) or fn in ("op.xlsx", "op.xlsm"):
        return "trialbalance"
    if any(k in fn for k in ("daybook", "day_book", "day book")):
        return "daybook"

    try:
        wb = openpyxl.load_workbook(filepath, data_only=True, read_only=True)
        ws = wb.active
        r1 = str(ws.cell(1, 1).value or "").strip().lower()
        r2 = str(ws.cell(2, 1).value or "").strip().lower()
        r3 = str(ws.cell(3, 1).value or "").strip().lower()
        wb.close()

        if "sundry debtors" in r2 or "sundry debtors" in r1 or "sundry debtors" in r3:
            return "debtor_balance"
        if "day book" in r2:
            return "daybook"
        if "journal register" in r2:
            return "journal"
        if "trial balance" in r2:
            return "trialbalance"
        if "round off" in r2 or "roundoff" in r2:
            return "roundoff"
        if "discount" in r2:
            return "discount"
        if "hdfc" in r2:
            return "hdfc"
        if "yes bank" in r2:
            return "yesbank"
        if "khan cash" in r2 or "khancash" in r2:
            return "khancash"
        if "cash gbd" in r2 or "cashgbd" in r2:
            return "cashgbd"
        if "cash" in r2 and "day" not in r2:
            return "cash"
        if "ledger account" in r3 or "ledger account" in r2 or "ledger:" in r2 or "ledger:" in r3:
            return "customer_ledger"
    except Exception:
        pass

    return "unknown"
