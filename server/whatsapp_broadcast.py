"""
WhatsApp Excel Broadcast Module
Allows parsing any Excel file containing phone numbers, names, and balances/amounts,
validating recipients, generating personalized messages, and queuing broadcasts.
"""

import asyncio
import io
import logging
import random
import re
from typing import Any, Dict, List, Optional, Tuple, Union
import openpyxl

logger = logging.getLogger(__name__)

PHONE_HEADER_KEYWORDS = [
    "phone", "mobile", "contact", "whatsapp", "cell", "mob", "tel", "ph", "wa_number", "number"
]
NAME_HEADER_KEYWORDS = [
    "name", "party", "customer", "client", "debtor", "creditor", "dealing per", "person", "recipient"
]
BALANCE_HEADER_KEYWORDS = [
    "balance", "outstanding", "pending", "amount", "total", "closing", "debit", "due", "net"
]


def normalize_phone_number(raw: Any, default_country_code: str = "91") -> Optional[str]:
    """
    Normalizes phone input into standard international format (e.g., 919876543210).
    Filters out invalid/dummy numbers.
    """
    if raw is None:
        return None

    # Convert numeric/float from Excel (e.g., 9876543210.0 -> '9876543210')
    if isinstance(raw, (int, float)):
        raw_str = f"{int(raw)}"
    else:
        raw_str = str(raw).strip()

    # Extract all digits
    digits = re.sub(r"\D", "", raw_str)

    if not digits or len(digits) < 10:
        return None

    # Check for all-identical dummy numbers (e.g., '0000000000', '1111111111')
    if len(set(digits)) <= 1:
        return None

    # 10-digit standard Indian mobile (starts with 6, 7, 8, 9)
    if len(digits) == 10:
        if digits[0] in "6789":
            return f"{default_country_code}{digits}"
        return f"{default_country_code}{digits}"

    # 11-digit starting with 0 (e.g. 09876543210)
    if len(digits) == 11 and digits.startswith("0"):
        return f"{default_country_code}{digits[1:]}"

    # 12-digit starting with 91
    if len(digits) == 12 and digits.startswith(default_country_code):
        return digits

    # Already includes international code (10-15 digits)
    if 10 <= len(digits) <= 15:
        return digits

    return None


def format_broadcast_message(template: str, context: Dict[str, Any]) -> str:
    """
    Safely formats a message template using keys from context.
    Supports case-insensitive matching for placeholders like {name}, {balance}, etc.
    """
    if not template:
        template = "Hello {name}, your balance is Rs. {balance}."

    msg = template
    # Normalizing context keys for matching
    lower_context = {k.lower().replace(" ", "_"): ("" if v is None else str(v)) for k, v in context.items()}
    lower_context.update({k.lower(): ("" if v is None else str(v)) for k, v in context.items()})

    def replacer(match):
        key = match.group(1).lower().replace(" ", "_")
        if key in lower_context:
            return lower_context[key]
        raw_key = match.group(1).lower()
        if raw_key in lower_context:
            return lower_context[raw_key]
        return match.group(0)

    formatted = re.sub(r"\{([a-zA-Z0-9_\s]+)\}", replacer, msg)
    return formatted.strip()


def _detect_header_row(rows: List[Tuple[Any, ...]]) -> Tuple[int, Dict[str, int]]:
    """
    Scans the first 25 rows to find the row that most likely represents column headers.
    Returns (header_row_index, mapping_of_column_name_to_index).
    """
    best_row_idx = 0
    best_score = -1
    best_mapping: Dict[str, int] = {}

    for idx, row in enumerate(rows[:25]):
        if not row:
            continue
        row_str_cells = [str(c).strip().lower() for c in row if c is not None]
        if not row_str_cells:
            continue

        score = 0
        mapping: Dict[str, int] = {}
        for col_idx, cell in enumerate(row):
            if cell is None:
                continue
            text = str(cell).strip()
            lower_text = text.lower()

            # Check for phone keywords
            if any(k in lower_text for k in PHONE_HEADER_KEYWORDS):
                score += 5
            # Check for name keywords
            if any(k in lower_text for k in NAME_HEADER_KEYWORDS):
                score += 3
            # Check for balance keywords
            if any(k in lower_text for k in BALANCE_HEADER_KEYWORDS):
                score += 2

            mapping[text] = col_idx

        if score > best_score and score >= 3:
            best_score = score
            best_row_idx = idx
            best_mapping = mapping

    # Fallback to row 0 if no score
    if best_score < 3:
        best_row_idx = 0
        best_mapping = {str(cell).strip(): i for i, cell in enumerate(rows[0]) if cell is not None}

    return best_row_idx, best_mapping


def parse_excel_for_broadcast(
    file_source: Union[str, bytes, io.BytesIO],
    template: str = "Hello {name}, your outstanding balance is Rs. {balance}.",
    sheet_name: Optional[str] = None,
    default_country_code: str = "91"
) -> Dict[str, Any]:
    """
    Parses any Excel file containing phone numbers and party details.
    
    Returns:
    {
        "headers": [...],
        "valid_recipients": [
            {
                "row": 4,
                "phone": "919876543210",
                "name": "Aarav Bikes",
                "balance": 25000,
                "message": "...",
                "row_data": {...}
            }
        ],
        "invalid_rows": [
            {
                "row": 6,
                "reason": "Missing or invalid phone number",
                "raw_phone": "00000",
                "row_data": {...}
            }
        ],
        "summary": {
            "total_data_rows": 10,
            "valid_count": 8,
            "invalid_count": 2
        }
    }
    """
    if isinstance(file_source, bytes):
        file_obj = io.BytesIO(file_source)
    elif isinstance(file_source, str):
        file_obj = file_source
    else:
        file_obj = file_source

    wb = openpyxl.load_workbook(file_obj, data_only=True)
    if sheet_name and sheet_name in wb.sheetnames:
        sheet = wb[sheet_name]
    else:
        sheet = wb.active

    all_rows = list(sheet.iter_rows(values_only=True))
    if not all_rows:
        return {
            "headers": [],
            "valid_recipients": [],
            "invalid_rows": [],
            "summary": {"total_data_rows": 0, "valid_count": 0, "invalid_count": 0}
        }

    header_row_idx, header_map = _detect_header_row(all_rows)
    headers = list(header_map.keys())

    # Identify primary columns
    phone_col_idx = None
    name_col_idx = None
    balance_col_idx = None

    for h_name, col_idx in header_map.items():
        hl = h_name.lower()
        if phone_col_idx is None and any(k in hl for k in PHONE_HEADER_KEYWORDS):
            phone_col_idx = col_idx
        elif name_col_idx is None and any(k in hl for k in NAME_HEADER_KEYWORDS):
            name_col_idx = col_idx
        elif balance_col_idx is None and any(k in hl for k in BALANCE_HEADER_KEYWORDS):
            balance_col_idx = col_idx

    valid_recipients = []
    invalid_rows = []

    # Iterate through data rows after header
    for row_num, row_data in enumerate(all_rows[header_row_idx + 1:], start=header_row_idx + 2):
        if not row_data or all(v is None for v in row_data):
            continue

        # Build row dictionary
        row_dict: Dict[str, Any] = {}
        for h_name, col_idx in header_map.items():
            val = row_data[col_idx] if col_idx < len(row_data) else None
            row_dict[h_name] = val

        # Extract values
        raw_phone = row_data[phone_col_idx] if (phone_col_idx is not None and phone_col_idx < len(row_data)) else None
        norm_phone = normalize_phone_number(raw_phone, default_country_code)

        party_name = (
            str(row_data[name_col_idx]).strip()
            if (name_col_idx is not None and name_col_idx < len(row_data) and row_data[name_col_idx] is not None)
            else "Customer"
        )
        balance_val = (
            row_data[balance_col_idx]
            if (balance_col_idx is not None and balance_col_idx < len(row_data))
            else 0
        )

        context = dict(row_dict)
        context["name"] = party_name
        context["party"] = party_name
        context["balance"] = balance_val
        context["amount"] = balance_val
        context["phone"] = norm_phone or ""

        if not norm_phone:
            invalid_rows.append({
                "row": row_num,
                "reason": "Missing or invalid phone number",
                "raw_phone": raw_phone,
                "row_data": row_dict
            })
            continue

        personalized_msg = format_broadcast_message(template, context)

        valid_recipients.append({
            "row": row_num,
            "phone": norm_phone,
            "name": party_name,
            "balance": balance_val,
            "message": personalized_msg,
            "row_data": row_dict
        })

    return {
        "headers": headers,
        "valid_recipients": valid_recipients,
        "invalid_rows": invalid_rows,
        "summary": {
            "total_data_rows": len(valid_recipients) + len(invalid_rows),
            "valid_count": len(valid_recipients),
            "invalid_count": len(invalid_rows)
        }
    }


async def broadcast_whatsapp_messages(
    recipients: List[Dict[str, Any]],
    sender_api_url: str = "http://localhost:3001/api/send-message",
    min_delay: float = 3.0,
    max_delay: float = 6.0
) -> Dict[str, Any]:
    """
    Asynchronously broadcasts messages to validated recipients with safe anti-ban delays.
    """
    import httpx

    results = []
    sent_count = 0
    failed_count = 0

    async with httpx.AsyncClient(timeout=30.0) as client:
        for idx, item in enumerate(recipients):
            phone = item.get("phone")
            message = item.get("message")
            name = item.get("name")

            if not phone or not message:
                continue

            try:
                response = await client.post(
                    sender_api_url,
                    json={"phone": phone, "message": message, "name": name}
                )
                success = response.status_code == 200
                if success:
                    sent_count += 1
                else:
                    failed_count += 1

                results.append({
                    "phone": phone,
                    "name": name,
                    "status": "sent" if success else "failed",
                    "http_status": response.status_code,
                    "response": response.text
                })
            except Exception as e:
                failed_count += 1
                logger.error(f"Error broadcasting to {phone}: {e}")
                results.append({
                    "phone": phone,
                    "name": name,
                    "status": "error",
                    "error": str(e)
                })

            # Random anti-ban delay between dispatches (skip for the last recipient)
            if idx < len(recipients) - 1:
                sleep_sec = random.uniform(min_delay, max_delay)
                await asyncio.sleep(sleep_sec)

    return {
        "total": len(recipients),
        "sent_count": sent_count,
        "failed_count": failed_count,
        "results": results
    }
