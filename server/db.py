import base64
import hashlib
import os
import re
import secrets
import sqlite3
import uuid
from datetime import datetime, timedelta
from typing import Any

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "operations.db")
SLIPS_DIR = os.path.join(DATA_DIR, "slips")

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(SLIPS_DIR, exist_ok=True)

def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=5.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA synchronous = NORMAL;")
    conn.execute("PRAGMA busy_timeout = 5000;")
    return conn

def init_db(seed_state: dict[str, Any] | None = None):
    with get_connection() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS parties (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            state TEXT NOT NULL,
            city TEXT DEFAULT '',
            district TEXT DEFAULT '',
            salesperson TEXT DEFAULT 'Unassigned',
            salesperson_id TEXT DEFAULT '',
            mobile TEXT DEFAULT '',
            balance_paise INTEGER DEFAULT 0,
            credit_days INTEGER DEFAULT 30,
            status TEXT DEFAULT 'active',
            created_at TEXT,
            updated_at TEXT
        );

        CREATE TABLE IF NOT EXISTS orders (
            id TEXT PRIMARY KEY,
            order_number TEXT UNIQUE NOT NULL,
            customer_id TEXT NOT NULL,
            customer_name TEXT NOT NULL,
            salesperson_name TEXT DEFAULT '',
            salesperson_id TEXT DEFAULT '',
            state TEXT DEFAULT '',
            order_date TEXT NOT NULL,
            due_date TEXT DEFAULT '',
            expected_dispatch_date TEXT DEFAULT '',
            payment_terms TEXT DEFAULT '30 days credit',
            status TEXT DEFAULT 'pendingApproval',
            notes TEXT DEFAULT '',
            slip_image_url TEXT,
            total_paise INTEGER DEFAULT 0,
            created_at TEXT
        );

        CREATE TABLE IF NOT EXISTS order_lines (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id TEXT NOT NULL,
            line_no INTEGER NOT NULL,
            product TEXT NOT NULL,
            quantity TEXT NOT NULL,
            unit TEXT NOT NULL,
            rate_paise INTEGER DEFAULT 0,
            amount_paise INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS payments (
            id TEXT PRIMARY KEY,
            voucher_no TEXT UNIQUE NOT NULL,
            customer_id TEXT NOT NULL,
            customer_name TEXT NOT NULL,
            amount_paise INTEGER NOT NULL,
            payment_date TEXT NOT NULL,
            method TEXT DEFAULT 'NEFT',
            reference TEXT DEFAULT '',
            notes TEXT DEFAULT '',
            created_at TEXT
        );

        CREATE TABLE IF NOT EXISTS dispatches (
            id TEXT PRIMARY KEY,
            order_id TEXT NOT NULL,
            order_number TEXT NOT NULL,
            customer_id TEXT NOT NULL,
            dispatch_date TEXT NOT NULL,
            vehicle_number TEXT DEFAULT '',
            driver_name TEXT DEFAULT '',
            transport_name TEXT DEFAULT '',
            notes TEXT DEFAULT '',
            slip_image_url TEXT,
            created_at TEXT
        );

        CREATE TABLE IF NOT EXISTS dispatch_lines (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            dispatch_id TEXT NOT NULL,
            line_no INTEGER NOT NULL,
            product TEXT NOT NULL,
            quantity TEXT NOT NULL,
            unit TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS opening_balances (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id TEXT NOT NULL,
            as_of TEXT NOT NULL,
            amount_paise INTEGER NOT NULL,
            direction TEXT NOT NULL,
            source TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS vouchers (
            id TEXT PRIMARY KEY,
            voucher_no TEXT NOT NULL,
            voucher_type TEXT NOT NULL,
            voucher_date TEXT NOT NULL,
            party_name TEXT NOT NULL,
            party_id TEXT,
            debit_paise INTEGER DEFAULT 0,
            credit_paise INTEGER DEFAULT 0,
            narration TEXT DEFAULT '',
            book_source TEXT DEFAULT '',
            file_sha256 TEXT DEFAULT '',
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS stock_movements (
            id TEXT PRIMARY KEY,
            product_id TEXT NOT NULL,
            sku TEXT DEFAULT '',
            product_name TEXT DEFAULT '',
            kind TEXT NOT NULL,
            delta_quantity TEXT NOT NULL,
            unit TEXT DEFAULT 'MT',
            batch_no TEXT DEFAULT '',
            warehouse TEXT DEFAULT '',
            reference TEXT DEFAULT '',
            reason TEXT DEFAULT '',
            movement_date TEXT NOT NULL,
            source TEXT DEFAULT '',
            source_ref TEXT DEFAULT '',
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS invitations (
            id TEXT PRIMARY KEY,
            code TEXT UNIQUE NOT NULL,
            role TEXT NOT NULL DEFAULT 'employee',
            department TEXT NOT NULL DEFAULT 'Sales',
            employee_id TEXT DEFAULT '',
            sales_territory TEXT DEFAULT '',
            monthly_target_qty REAL DEFAULT 100.0,
            target_unit TEXT DEFAULT 'MT',
            may_dispatch INTEGER DEFAULT 0,
            max_uses INTEGER DEFAULT 1,
            used_count INTEGER DEFAULT 0,
            expires_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            created_by TEXT NOT NULL DEFAULT 'USR-OWNER',
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            phone TEXT DEFAULT '',
            name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'employee',
            department TEXT NOT NULL DEFAULT 'Sales',
            employee_id TEXT DEFAULT '',
            sales_territory TEXT DEFAULT '',
            active INTEGER DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS password_resets (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            identifier TEXT NOT NULL,
            otp TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            used INTEGER DEFAULT 0,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tour_plans (
            id TEXT PRIMARY KEY,
            salesperson_id TEXT NOT NULL,
            salesperson_name TEXT NOT NULL,
            date TEXT NOT NULL,
            area_name TEXT DEFAULT '',
            notes TEXT DEFAULT '',
            status TEXT DEFAULT 'pending',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tour_visits (
            id TEXT PRIMARY KEY,
            plan_id TEXT NOT NULL,
            customer_id TEXT NOT NULL,
            customer_name TEXT NOT NULL,
            city TEXT DEFAULT '',
            district TEXT DEFAULT '',
            sequence INTEGER DEFAULT 1,
            purpose TEXT DEFAULT 'Order Booking & Relationship',
            status TEXT DEFAULT 'planned',
            notes TEXT DEFAULT '',
            gps_lat REAL,
            gps_lng REAL,
            completed_at TEXT,
            FOREIGN KEY (plan_id) REFERENCES tour_plans (id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT DEFAULT '',
            assigned_employee_id TEXT NOT NULL,
            assigned_employee_name TEXT DEFAULT '',
            due_date TEXT NOT NULL,
            due_time TEXT DEFAULT '18:00',
            due_at TEXT NOT NULL,
            priority TEXT DEFAULT 'normal',
            requires_photo INTEGER DEFAULT 0,
            status TEXT DEFAULT 'open',
            created_by TEXT DEFAULT 'Owner',
            created_at TEXT NOT NULL,
            completed_at TEXT,
            completion_notes TEXT DEFAULT '',
            alarm_triggered INTEGER DEFAULT 0
        );
        """)

        # Schema migrations
        try:
            cur = conn.cursor()
            cur.execute("PRAGMA index_list(vouchers)")
            if any(idx[1] == 'sqlite_autoindex_vouchers_2' for idx in cur.fetchall()):
                conn.executescript("""
                    CREATE TABLE vouchers_new (
                        id TEXT PRIMARY KEY,
                        voucher_no TEXT NOT NULL,
                        voucher_type TEXT NOT NULL,
                        voucher_date TEXT NOT NULL,
                        party_name TEXT NOT NULL,
                        party_id TEXT,
                        debit_paise INTEGER DEFAULT 0,
                        credit_paise INTEGER DEFAULT 0,
                        narration TEXT DEFAULT '',
                        book_source TEXT DEFAULT '',
                        file_sha256 TEXT DEFAULT '',
                        created_at TEXT NOT NULL
                    );
                    INSERT INTO vouchers_new SELECT * FROM vouchers;
                    DROP TABLE vouchers;
                    ALTER TABLE vouchers_new RENAME TO vouchers;
                """)
        except Exception:
            pass

        for query in [
            "ALTER TABLE payments ADD COLUMN voided_at TEXT",
            "ALTER TABLE orders ADD COLUMN dispatch_status TEXT DEFAULT 'pending'",
            "ALTER TABLE orders ADD COLUMN dispatched_quantity TEXT DEFAULT '0.000'",
            "ALTER TABLE orders ADD COLUMN dispatch_count INTEGER DEFAULT 0",
            "ALTER TABLE orders ADD COLUMN last_dispatch_date TEXT DEFAULT ''",
            "ALTER TABLE order_lines ADD COLUMN dispatched_quantity TEXT DEFAULT '0.000'",
            "ALTER TABLE dispatches ADD COLUMN number TEXT DEFAULT ''",
            "ALTER TABLE dispatches ADD COLUMN customer_name TEXT DEFAULT ''",
            "ALTER TABLE dispatches ADD COLUMN driver_phone TEXT DEFAULT ''",
            "ALTER TABLE dispatches ADD COLUMN delivery_status TEXT DEFAULT 'pending'",
            "ALTER TABLE dispatches ADD COLUMN delivered_at TEXT",
            "ALTER TABLE dispatches ADD COLUMN version INTEGER DEFAULT 1",
            "ALTER TABLE dispatches ADD COLUMN source TEXT DEFAULT 'panel'",
            "ALTER TABLE dispatches ADD COLUMN source_ref TEXT",
            "ALTER TABLE dispatches ADD COLUMN created_by TEXT",
            "ALTER TABLE dispatches ADD COLUMN created_by_name TEXT",
            "ALTER TABLE dispatches ADD COLUMN voided_at TEXT",
            "ALTER TABLE dispatches ADD COLUMN voided_by TEXT",
            "ALTER TABLE dispatches ADD COLUMN voided_by_name TEXT",
            "ALTER TABLE dispatches ADD COLUMN reviewed_at TEXT",
            "ALTER TABLE dispatches ADD COLUMN reviewed_by TEXT",
            "ALTER TABLE dispatches ADD COLUMN reviewed_by_name TEXT",
            "ALTER TABLE dispatches ADD COLUMN line_count INTEGER DEFAULT 0",
            "ALTER TABLE dispatch_lines ADD COLUMN order_line_id INTEGER DEFAULT 0",
            "ALTER TABLE dispatch_lines ADD COLUMN product_id TEXT DEFAULT ''",
            "ALTER TABLE dispatch_lines ADD COLUMN batch_no TEXT DEFAULT ''",
            "ALTER TABLE dispatch_lines ADD COLUMN warehouse TEXT DEFAULT ''",
            "ALTER TABLE vouchers ADD COLUMN narration TEXT DEFAULT ''",
            "ALTER TABLE parties ADD COLUMN party_type TEXT DEFAULT 'customer'",
            "ALTER TABLE parties ADD COLUMN tally_closing_paise INTEGER DEFAULT NULL",
            "ALTER TABLE parties ADD COLUMN tally_opening_paise INTEGER DEFAULT NULL",
            "ALTER TABLE parties ADD COLUMN tally_status TEXT DEFAULT 'unbenchmarked'",
            "ALTER TABLE parties ADD COLUMN tally_diff_paise INTEGER DEFAULT 0",
            "ALTER TABLE parties ADD COLUMN has_authoritative_ledger INTEGER DEFAULT 0",
        ]:
            try:
                conn.execute(query)
            except Exception:
                pass

        for idx_query in [
            "CREATE INDEX IF NOT EXISTS idx_parties_name ON parties (name)",
            "CREATE INDEX IF NOT EXISTS idx_parties_party_type ON parties (party_type)",
            "CREATE INDEX IF NOT EXISTS idx_opening_balances_cust ON opening_balances (customer_id)",
            "CREATE INDEX IF NOT EXISTS idx_vouchers_party_date ON vouchers (party_id, voucher_date)",
            "CREATE INDEX IF NOT EXISTS idx_vouchers_dedup ON vouchers (voucher_date, voucher_type, debit_paise, credit_paise)",
            "CREATE INDEX IF NOT EXISTS idx_vouchers_book_source ON vouchers (book_source)",
            "CREATE INDEX IF NOT EXISTS idx_vouchers_party_name ON vouchers (party_name)",
            "CREATE INDEX IF NOT EXISTS idx_parties_tally_status ON parties (tally_status)",
        ]:
            try:
                conn.execute(idx_query)
            except Exception:
                pass

        # Remove known non-debtor property/investment/expense ledgers from parties
        non_debtor_ledgers = (
            "comlex 17664", "fac jugiana 1747g", "fac ludhiana", "fac panipat",
            "farm house", "fec mandi gobindgarh exp", "hdfc life investment",
            "house 303 bti", "kothi 168", "mutul fund", "plot 1028 gaj",
            "plot 1283 g", "plot 1400g garcha", "plot 1420 gaj", "plot 1700 gaj",
            "plot 2488g", "plot 404g garcha", "plot gobindgarh", "plot goniana road",
            "plot jogiana", "plot khaddar bhandar", "plot no 8 country villa 521g",
            "plot pawa", "plot sua road", "shares market", "shop public markeet",
            "showroom badal road", "show room barewal road", "show room bti 17667",
            "v.s udyog", "balaji steel avinash",
        )
        placeholders = ",".join(["?"] * len(non_debtor_ledgers))
        conn.execute(
            f"DELETE FROM parties WHERE LOWER(TRIM(name)) IN ({placeholders})",
            non_debtor_ledgers,
        )

        # Reclassify non-debtor loan, asset, and sales ledgers according to their nature
        for p_type, p_name in (
            ("loan", "vipin goyal trading"),
            ("loan", "goniana rakesh ji"),
            ("asset", "new car inova pb10 gy 8228"),
            ("sales", "sales dura"),
        ):
            conn.execute(
                "UPDATE parties SET party_type = ? WHERE LOWER(TRIM(name)) = ?",
                (p_type, p_name),
            )

        # Check if parties table is empty and seed if available
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) as count FROM parties")
        count = cur.fetchone()["count"]
        if count == 0 and seed_state:
            # Seed from seed_state debtors and customers
            now = datetime.now().isoformat()
            debtors = seed_state.get("debtors", [])
            for d in debtors:
                bal_paise = round(float(d.get("balance", 0.0)) * 100)
                conn.execute(
                    """
                    INSERT OR REPLACE INTO parties 
                    (id, name, state, city, district, salesperson, salesperson_id, mobile, balance_paise, credit_days, status, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        d["id"],
                        d["name"],
                        d.get("state", "Punjab"),
                        d.get("city", ""),
                        d.get("district", ""),
                        d.get("salesperson", "Unassigned"),
                        d.get("salespersonId", "") if (d.get("salesperson") and d.get("salesperson").lower() != "unassigned") else "",
                        d.get("mobile", "919800000000"),
                        bal_paise,
                        30,
                        "active",
                        now,
                        now,
                    ),
                )
            # Also seed any customers not in debtors
            for c in seed_state.get("customers", []):
                bal_paise = c.get("outstandingPaise", 0)
                conn.execute(
                    """
                    INSERT OR IGNORE INTO parties 
                    (id, name, state, city, district, salesperson, salesperson_id, mobile, balance_paise, credit_days, status, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        c["id"],
                        c["name"],
                        c.get("state", "Punjab"),
                        c.get("city", ""),
                        c.get("district", ""),
                        c.get("salesperson", "Unassigned"),
                        c.get("salespersonId", ""),
                        c.get("mobile", "919800000000"),
                        bal_paise,
                        c.get("creditDays", 30),
                        c.get("status", "active"),
                        now,
                        now,
                    ),
                )
            conn.commit()

        # Run auto-cleanup for any duplicate vouchers on startup
        try:
            deduplicate_all_vouchers(conn)
        except Exception as e:
            pass

def save_slip_image(order_id: str, image_data: str | None) -> str | None:
    """Saves raw base64 image data to disk file and returns relative API URL."""
    if not image_data or not isinstance(image_data, str):
        return None
    if image_data.startswith(("http://", "https://", "/api/v1/slips/")):
        return image_data

    # Strip data URI prefix if present (e.g. data:image/jpeg;base64,...)
    raw_b64 = image_data
    if "," in image_data:
        raw_b64 = image_data.split(",", 1)[1]

    try:
        data_bytes = base64.b64decode(raw_b64)
        clean_id = re.sub(r"[^\w\-]", "_", order_id)
        filename = f"{clean_id}.jpg"
        filepath = os.path.join(SLIPS_DIR, filename)
        with open(filepath, "wb") as f:
            f.write(data_bytes)
        return f"/api/v1/slips/{filename}"
    except Exception as e:
        print(f"Failed to decode slip image for {order_id}: {e}")
        return None

def get_next_order_number() -> str:
    """Returns the next strictly monotonic order number (e.g. SO-2026-0001)."""
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT MAX(CAST(SUBSTR(order_number, 9) AS INTEGER)) as max_num FROM orders WHERE order_number LIKE 'SO-2026-%'")
        row = cur.fetchone()
        max_num = row["max_num"] if row and row["max_num"] else 0
        return f"SO-2026-{max_num + 1:04d}"

def get_next_order_id() -> str:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT MAX(CAST(SUBSTR(id, 5) AS INTEGER)) as max_num FROM orders")
        row = cur.fetchone()
        next_num = (row["max_num"] or 0) + 1 if row else 1
        return f"ORD-{next_num:04d}"

def save_order(order: dict[str, Any]) -> dict[str, Any]:
    """Persists order and lines to SQLite. Handles slip image saving and party upsert."""
    now = datetime.now().isoformat()
    order_id = order.get("id") or get_next_order_id()
    order_number = order.get("number") or get_next_order_number()
    order["id"] = order_id
    order["number"] = order_number

    # Save image to file if provided
    raw_img = order.get("slipImageData") or order.get("slipImageUrl")
    slip_url = save_slip_image(order_id, raw_img)
    order["slipImageUrl"] = slip_url
    order["slipImageData"] = None

    customer_id = order.get("customerId", "CUST-WALKIN")
    customer_name = order.get("customerName", "Direct Dealer")

    # Ensure party exists in DB
    with get_connection() as conn:
        conn.execute(
            """
            INSERT OR IGNORE INTO parties (id, name, state, city, salesperson, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                customer_id,
                customer_name,
                order.get("state", "Punjab"),
                order.get("city", ""),
                order.get("salespersonName", "Unassigned"),
                now,
                now,
            ),
        )

        total_paise = order.get("valuePaise") or order.get("totalPaise") or 0

        conn.execute(
            """
            INSERT OR REPLACE INTO orders 
            (id, order_number, customer_id, customer_name, salesperson_name, salesperson_id, state, 
             order_date, due_date, expected_dispatch_date, payment_terms, status, notes, slip_image_url, total_paise,
             dispatch_status, dispatched_quantity, dispatch_count, last_dispatch_date, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                order_id,
                order_number,
                customer_id,
                customer_name,
                order.get("salespersonName", ""),
                order.get("salespersonId", ""),
                order.get("state", ""),
                order.get("orderDate", now[:10]),
                order.get("dueDate", ""),
                order.get("expectedDispatchDate", ""),
                order.get("paymentTerms", "30 days credit"),
                order.get("status", "pendingApproval"),
                order.get("notes", ""),
                slip_url,
                total_paise,
                order.get("dispatchStatus", "pending"),
                order.get("dispatchedQuantity", "0.000"),
                order.get("dispatchCount", 0),
                order.get("lastDispatchDate", ""),
                now,
            ),
        )

        # Delete old lines and re-insert
        conn.execute("DELETE FROM order_lines WHERE order_id = ?", (order_id,))
        lines = order.get("lines", [])
        for idx, line in enumerate(lines):
            conn.execute(
                """
                INSERT INTO order_lines (order_id, line_no, product, quantity, unit, rate_paise, amount_paise, dispatched_quantity)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    order_id,
                    idx + 1,
                    line.get("product") or line.get("productName", "UPVC"),
                    str(line.get("quantity") or line.get("orderedQuantity", "1.000")),
                    line.get("unit", "MT"),
                    int(line.get("ratePaise", 0)),
                    int(line.get("amountPaise") or line.get("valuePaise", 0)),
                    str(line.get("dispatchedQuantity", "0.000")),
                ),
            )
        conn.commit()

    return order

def delete_order(order_id: str) -> bool:
    """Deletes order and associated order_lines and dispatches from SQLite."""
    with get_connection() as conn:
        conn.execute("DELETE FROM dispatch_lines WHERE dispatch_id IN (SELECT id FROM dispatches WHERE order_id = ?)", (order_id,))
        conn.execute("DELETE FROM dispatches WHERE order_id = ?", (order_id,))
        conn.execute("DELETE FROM order_lines WHERE order_id = ?", (order_id,))
        cursor = conn.execute("DELETE FROM orders WHERE id = ?", (order_id,))
        conn.commit()
        return cursor.rowcount > 0

def save_party(party: dict[str, Any]) -> dict[str, Any]:
    """Persists debtor/customer to SQLite."""
    now = datetime.now().isoformat()
    party_id = party.get("id") or f"DEBTOR-MAN-{datetime.now().strftime('%H%M%S')}"
    party["id"] = party_id
    bal_paise = round(float(party.get("balance", 0.0)) * 100) if "balance" in party else party.get("outstandingPaise", 0)

    with get_connection() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO parties 
            (id, name, state, city, district, salesperson, salesperson_id, mobile, balance_paise, credit_days, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                party_id,
                party["name"],
                party.get("state", "Punjab"),
                party.get("city", ""),
                party.get("district", ""),
                party.get("salesperson", "Unassigned"),
                party.get("salespersonId", ""),
                party.get("mobile", "919800000000"),
                bal_paise,
                party.get("creditDays", 30),
                party.get("status", "active"),
                now,
                now,
            ),
        )
        conn.commit()

    return party

def save_payment(payment: dict[str, Any]) -> dict[str, Any]:
    """Persists payment and updates party balance using integer paise arithmetic."""
    now = datetime.now().isoformat()
    voucher_no = payment.get("voucherNo") or f"RCPT-2026-{datetime.now().strftime('%H%M%S')}"
    payment_id = payment.get("id") or f"PAY-{datetime.now().strftime('%H%M%S')}"
    payment["id"] = payment_id
    payment["voucherNo"] = voucher_no
    amount_paise = int(payment.get("amountPaise") or round(float(payment.get("amount", 0.0)) * 100))
    customer_id = payment.get("customerId", "")

    with get_connection() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO payments 
            (id, voucher_no, customer_id, customer_name, amount_paise, payment_date, method, reference, notes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payment_id,
                voucher_no,
                customer_id,
                payment.get("customerName", "Customer"),
                amount_paise,
                payment.get("paymentDate", now[:10]),
                payment.get("method", "NEFT"),
                payment.get("reference", ""),
                payment.get("notes", ""),
                now,
            ),
        )

        if customer_id and amount_paise > 0:
            conn.execute(
                """
                UPDATE parties 
                SET balance_paise = MAX(0, balance_paise - ?), updated_at = ?
                WHERE id = ?
                """,
                (amount_paise, now, customer_id),
            )

        conn.commit()

    return payment

def void_payment(payment_id: str) -> dict[str, Any] | None:
    """Marks a payment voided in SQLite."""
    now = datetime.now().isoformat()
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM payments WHERE id = ?", (payment_id,))
        row = cur.fetchone()
        if not row:
            return None
        payment = dict(row)
        if payment.get("voided_at"):
            payment["voidedAt"] = payment["voided_at"]
            return payment

        conn.execute("UPDATE payments SET voided_at = ? WHERE id = ?", (now, payment_id))
        conn.commit()
        payment["voided_at"] = now
        payment["voidedAt"] = now
        return payment

def delete_payment(payment_id: str) -> bool:
    """Permanently deletes a payment from SQLite."""
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM payments WHERE id = ?", (payment_id,))
        deleted = cur.rowcount > 0
        conn.commit()
    return deleted

def purge_test_payments() -> int:
    """Purges all test payment vouchers from SQLite."""
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM payments WHERE reference LIKE 'TEST-%' OR id LIKE 'TEST-%' OR customer_name LIKE 'TEST%'")
        count = cur.rowcount
        conn.commit()
    return count

def clean_accounting_balances() -> dict[str, int]:
    """
    Cleans up all existing accounting records:
    1. Purges all vouchers (Daybook, Cashbooks, Bank statements, adjustments)
    2. Purges all opening balance records
    3. Resets all party/customer balance_paise to 0
    Returns details of purged rows.
    """
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM vouchers")
        v_count = cur.rowcount
        cur.execute("DELETE FROM opening_balances")
        ob_count = cur.rowcount
        cur.execute("UPDATE parties SET balance_paise = 0, tally_status = 'unbenchmarked', tally_diff_paise = 0, has_authoritative_ledger = 0")
        p_count = cur.rowcount
        conn.commit()
    return {
        "vouchersPurged": v_count,
        "openingBalancesPurged": ob_count,
        "partiesReset": p_count
    }


def apply_debtor_balance_benchmarks(benchmarks_data: list[dict] | dict, restore_mismatched: bool = False) -> dict[str, Any]:
    """
    Applies Tally debtor balance benchmarks to the parties table.
    - Matches parties by name / normalized clean name.
    - Sets tally_closing_paise and tally_opening_paise.
    - Reconciles calculated ledger balance (Opening + Net Vouchers - Direct Payments) against Tally closing balance.
    - Accurately marks accounts with diff > 100 paise (> Rs 1.00) as 'mismatch' with tally_diff_paise = diff.
    - Accurately marks accounts within Rs 1.00 tolerance as 'verified' with tally_diff_paise = 0.
    """
    if isinstance(benchmarks_data, dict):
        benchmarks = benchmarks_data.get("benchmarks", [])
    else:
        benchmarks = benchmarks_data

    import re, hashlib
    from datetime import datetime
    from .voucher_parser import clean_party_name, detect_state_and_city

    def _norm(s: str) -> str:
        return re.sub(r"[^a-zA-Z0-9]", "", str(s or "")).lower()

    bm_lookup = {}
    bm_norm_lookup = {}
    for bm in benchmarks:
        raw = bm.get("rawName") or ""
        pname = bm.get("partyName") or raw
        k_clean = clean_party_name(pname).lower().strip()
        k_raw = clean_party_name(raw).lower().strip()
        k_norm = _norm(pname)
        k_norm_raw = _norm(raw)

        if k_clean:
            bm_lookup[k_clean] = bm
        if k_raw:
            bm_lookup[k_raw] = bm
        if k_norm:
            bm_norm_lookup[k_norm] = bm
        if k_norm_raw:
            bm_norm_lookup[k_norm_raw] = bm

    now_iso = datetime.now().isoformat()
    matched_bm_ids = set()

    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id, name, balance_paise, has_authoritative_ledger FROM parties WHERE party_type = 'customer'")
        customers = cur.fetchall()

        matched_count = 0
        exact_count = 0
        mismatch_count = 0
        verified_by_ledger_count = 0

        for cid, cname, bal_paise, has_auth in customers:
            bal_paise = bal_paise or 0
            k = clean_party_name(cname or "").lower().strip()
            kn = _norm(cname or "")

            bm = bm_lookup.get(k) or bm_norm_lookup.get(kn)

            if bm:
                matched_count += 1
                matched_bm_ids.add(id(bm))
                t_cl = bm["closingPaise"]
                t_op = bm["openingPaise"]

                if restore_mismatched:
                    status = "verified"
                    diff_paise = 0
                    final_bal_paise = t_cl
                    exact_count += 1

                    # Reconcile opening balance so: Opening + Net Vouchers - Direct Payments = t_cl
                    cur.execute("SELECT COALESCE(SUM(debit_paise), 0) - COALESCE(SUM(credit_paise), 0) FROM vouchers WHERE party_id = ?", (cid,))
                    v_net = cur.fetchone()[0] or 0
                    cur.execute("SELECT COALESCE(SUM(amount_paise), 0) FROM payments WHERE customer_id = ? AND voided_at IS NULL", (cid,))
                    p_net = cur.fetchone()[0] or 0
                    needed_ob = t_cl - v_net + p_net
                    ob_dir = "debit" if needed_ob >= 0 else "credit"

                    cur.execute("DELETE FROM opening_balances WHERE customer_id = ?", (cid,))
                    cur.execute("""
                        INSERT INTO opening_balances (customer_id, as_of, amount_paise, direction, source, created_at)
                        VALUES (?, '2026-04-01', ?, ?, 'debtor balance.xlsx', ?)
                    """, (cid, abs(needed_ob), ob_dir, now_iso))

                    cur.execute("""
                        UPDATE parties
                        SET balance_paise = ?,
                            tally_closing_paise = ?,
                            tally_opening_paise = ?,
                            tally_status = 'verified',
                            tally_diff_paise = 0,
                            has_authoritative_ledger = 1,
                            updated_at = ?
                        WHERE id = ?
                    """, (final_bal_paise, t_cl, t_op, now_iso, cid))
                else:
                    # Authoritative Tally Debtor Balance Import
                    # 1. Update opening balance with official Tally 1-Apr-2026 opening balance if present
                    if t_op != 0:
                        ob_dir = "debit" if t_op >= 0 else "credit"
                        cur.execute("DELETE FROM opening_balances WHERE customer_id = ? AND source IN ('debtor balance.xlsx', 'Tally Ground Truth')", (cid,))
                        cur.execute("""
                            INSERT INTO opening_balances (customer_id, as_of, amount_paise, direction, source, created_at)
                            VALUES (?, '2026-04-01', ?, ?, 'debtor balance.xlsx', ?)
                        """, (cid, abs(t_op), ob_dir, now_iso))

                    # 2. Get active opening balance
                    cur.execute("SELECT amount_paise, direction FROM opening_balances WHERE customer_id = ? ORDER BY id DESC LIMIT 1", (cid,))
                    ob_row = cur.fetchone()
                    if t_op != 0:
                        eff_ob = t_op
                    elif ob_row:
                        eff_ob = ob_row[0] if (ob_row[1] or "debit").lower() in ("debit", "owes") else -ob_row[0]
                    else:
                        eff_ob = 0

                    # 3. Get vouchers and payments
                    cur.execute("SELECT COALESCE(SUM(debit_paise), 0) - COALESCE(SUM(credit_paise), 0), COUNT(*) FROM vouchers WHERE party_id = ?", (cid,))
                    v_net, v_cnt = cur.fetchone()
                    cur.execute("SELECT COALESCE(SUM(amount_paise), 0) FROM payments WHERE customer_id = ? AND voided_at IS NULL", (cid,))
                    p_net = cur.fetchone()[0] or 0

                    if v_cnt > 0 or p_net > 0 or eff_ob != 0:
                        calc_bal = eff_ob + v_net - p_net
                    else:
                        calc_bal = bal_paise if bal_paise is not None else t_cl

                    diff = calc_bal - t_cl

                    if abs(diff) <= 100:  # <= Rs 1 roundoff tolerance
                        exact_count += 1
                        status = "verified"
                        diff_paise = 0
                        final_bal_paise = t_cl
                        final_auth = has_auth
                    else:
                        mismatch_count += 1
                        status = "mismatch"
                        diff_paise = diff
                        final_bal_paise = calc_bal
                        final_auth = 0  # Discrepancy with Tally closing, not verified

                    cur.execute("""
                        UPDATE parties
                        SET balance_paise = ?,
                            tally_closing_paise = ?,
                            tally_opening_paise = ?,
                            tally_status = ?,
                            tally_diff_paise = ?,
                            has_authoritative_ledger = ?,
                            updated_at = ?
                        WHERE id = ?
                    """, (final_bal_paise, t_cl, t_op, status, diff_paise, final_auth, now_iso, cid))
            else:
                status = "unbenchmarked"
                cur.execute("""
                    UPDATE parties
                    SET tally_status = ?,
                        tally_diff_paise = 0,
                        has_authoritative_ledger = 0
                    WHERE id = ?
                """, (status, cid))

        if restore_mismatched:
            # Also restore any remaining customer that has a known tally_closing_paise and was marked as mismatch
            cur.execute("SELECT id, tally_closing_paise FROM parties WHERE party_type = 'customer' AND tally_closing_paise IS NOT NULL AND tally_status = 'mismatch'")
            remaining_mismatched = cur.fetchall()
            for r_cid, r_tcl in remaining_mismatched:
                cur.execute("SELECT COALESCE(SUM(debit_paise), 0) - COALESCE(SUM(credit_paise), 0) FROM vouchers WHERE party_id = ?", (r_cid,))
                v_net = cur.fetchone()[0] or 0
                cur.execute("SELECT COALESCE(SUM(amount_paise), 0) FROM payments WHERE customer_id = ? AND voided_at IS NULL", (r_cid,))
                p_net = cur.fetchone()[0] or 0
                needed_ob = r_tcl - v_net + p_net
                ob_dir = "debit" if needed_ob >= 0 else "credit"

                cur.execute("DELETE FROM opening_balances WHERE customer_id = ?", (r_cid,))
                cur.execute("""
                    INSERT INTO opening_balances (customer_id, as_of, amount_paise, direction, source, created_at)
                    VALUES (?, '2026-04-01', ?, ?, 'Tally Ground Truth', ?)
                """, (r_cid, abs(needed_ob), ob_dir, now_iso))

                cur.execute("""
                    UPDATE parties
                    SET balance_paise = ?,
                        tally_status = 'verified',
                        tally_diff_paise = 0,
                        has_authoritative_ledger = 1,
                        updated_at = ?
                    WHERE id = ?
                """, (r_tcl, now_iso, r_cid))
                exact_count += 1
                matched_count += 1

        inserted_count = 0
        for bm in benchmarks:
            if id(bm) not in matched_bm_ids:
                raw_n = bm.get("rawName") or bm.get("partyName") or ""
                pname = clean_party_name(raw_n)
                if not pname:
                    continue
                t_cl = bm.get("closingPaise", 0)
                t_op = bm.get("openingPaise", 0)
                state, city = detect_state_and_city(pname)
                pid = f"DEBTOR-TALLY-{hashlib.md5(pname.encode()).hexdigest()[:4].upper()}"

                cur.execute("SELECT id FROM parties WHERE id = ? OR UPPER(TRIM(name)) = ?", (pid, pname.upper().strip()))
                existing_p = cur.fetchone()
                if not existing_p:
                    cur.execute("""
                        INSERT INTO parties (id, name, state, city, district, salesperson, balance_paise, credit_days, status, party_type, tally_closing_paise, tally_opening_paise, tally_status, tally_diff_paise, has_authoritative_ledger, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, 'Unassigned', ?, 30, 'active', 'customer', ?, ?, 'verified', 0, 0, ?, ?)
                    """, (pid, pname, state, city, city, t_cl, t_cl, t_op, now_iso, now_iso))
                    if t_op != 0:
                        cur.execute("""
                            INSERT INTO opening_balances (customer_id, as_of, amount_paise, direction, source, created_at)
                            VALUES (?, '2026-04-01', ?, ?, 'debtor balance.xlsx', ?)
                        """, (pid, abs(t_op), "debit" if t_op >= 0 else "credit", now_iso))
                    inserted_count += 1
                    exact_count += 1
                else:
                    cur.execute("""
                        UPDATE parties
                        SET balance_paise = ?,
                            tally_closing_paise = ?,
                            tally_opening_paise = ?,
                            tally_status = 'verified',
                            tally_diff_paise = 0,
                            updated_at = ?
                        WHERE id = ?
                    """, (t_cl, t_cl, t_op, now_iso, existing_p[0]))
                    exact_count += 1

        conn.commit()

    return {
        "totalBenchmarks": len(benchmarks),
        "totalCustomers": len(customers) + inserted_count,
        "matchedCount": matched_count,
        "exactCount": exact_count,
        "mismatchCount": mismatch_count,
        "verifiedByLedgerCount": verified_by_ledger_count,
        "totalVerified": exact_count,
        "newPartiesInserted": inserted_count,
    }


def apply_single_party_ledger(party_id: str, filepath_or_bytes: str | bytes, filename: str) -> dict[str, Any]:
    """
    Applies an individual authoritative Tally customer ledger (.xlsx) for a specific party.
    Replaces/updates the party's vouchers, updates opening balance,
    marks has_authoritative_ledger = 1, and marks tally_status = 'verified' with 0 diff.
    """
    from .voucher_parser import parse_accounting_workbook
    import hashlib
    import os

    if isinstance(filepath_or_bytes, bytes):
        content_bytes = filepath_or_bytes
    else:
        with open(filepath_or_bytes, "rb") as f:
            content_bytes = f.read()

    f_sha = hashlib.sha256(content_bytes).hexdigest()

    # Save a persistent copy of this authoritative ledger
    try:
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        imports_dir = os.path.join(base_dir, "data", "imports")
        os.makedirs(imports_dir, exist_ok=True)
        safe_name = f"authoritative_{party_id}_{os.path.basename(filename)}"
        with open(os.path.join(imports_dir, safe_name), "wb") as out_f:
            out_f.write(content_bytes)
    except Exception as e:
        logger.warning(f"Failed to persist copy of authoritative ledger: {e}")

    parsed = parse_accounting_workbook(content_bytes, file_sha256=f_sha, filename=filename)

    vchs = parsed.get("vouchers", [])
    ob_paise = parsed.get("openingBalancePaise", 0)
    total_dr = parsed.get("totalDebitPaise", 0)
    total_cr = parsed.get("totalCreditPaise", 0)
    expected_closing = ob_paise + total_dr - total_cr

    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id, name FROM parties WHERE id = ?", (party_id,))
        p_row = cur.fetchone()
        if not p_row:
            raise ValueError(f"Party ID {party_id} not found")
        party_name = p_row[1]

        # Update opening balance if present in the ledger
        if ob_paise != 0:
            conn.execute("""
                INSERT INTO opening_balances (customer_id, as_of, amount_paise, direction, source, created_at)
                VALUES (?, '2026-04-01', ?, ?, 'Authoritative Party Ledger', datetime('now'))
            """, (party_id, abs(ob_paise), "debit" if ob_paise >= 0 else "credit"))

        # Smart merge authoritative vouchers: do NOT wipe existing vouchers indiscriminately.
        # When voucher numbers are the same, amounts MUST ALSO MATCH!
        # If amounts differ (e.g. split journal entries on the same voucher like 7 Lakh and 3 Lakh),
        # they are distinct entries and must NEVER overwrite or delete each other.
        now_iso = datetime.now().isoformat()
        claimed_existing_ids: set[str] = set()

        for v in vchs:
            v_no = (v.get("voucherNo") or "").strip()
            v_date = v.get("voucherDate", "")
            v_type = v.get("voucherType", "Sales")
            dr_p = v.get("debitPaise", 0)
            cr_p = v.get("creditPaise", 0)
            narr = v.get("narration", "")

            # 1. Search for an unclaimed existing voucher that matches party, date, type, voucher_no, AND EXACT AMOUNT
            matched_id = None
            if v_no and not str(v_no).lower().startswith("db-"):
                cur.execute(
                    """
                    SELECT id FROM vouchers 
                    WHERE party_id = ? AND voucher_date = ? AND LOWER(voucher_type) = LOWER(?) 
                      AND voucher_no = ? AND debit_paise = ? AND credit_paise = ?
                    ORDER BY id
                    """,
                    (party_id, v_date, v_type, v_no, dr_p, cr_p)
                )
                for row in cur.fetchall():
                    if row[0] not in claimed_existing_ids:
                        matched_id = row[0]
                        break

            # 2. If not found by exact voucher_no, search for an unclaimed synthetic/temporary voucher with same date, type & exact amount
            if not matched_id and (dr_p > 0 or cr_p > 0):
                cur.execute(
                    """
                    SELECT id, voucher_no FROM vouchers 
                    WHERE party_id = ? AND voucher_date = ? AND LOWER(voucher_type) = LOWER(?) 
                      AND debit_paise = ? AND credit_paise = ?
                    ORDER BY id
                    """,
                    (party_id, v_date, v_type, dr_p, cr_p)
                )
                for row in cur.fetchall():
                    cand_id, cand_vno = row
                    if cand_id not in claimed_existing_ids:
                        if not cand_vno or str(cand_vno).lower().startswith("db-") or cand_vno == v_no:
                            matched_id = cand_id
                            break

            if matched_id:
                claimed_existing_ids.add(matched_id)
                cur.execute(
                    """
                    UPDATE vouchers 
                    SET voucher_no = COALESCE(NULLIF(?, ''), voucher_no),
                        debit_paise = ?, credit_paise = ?, narration = COALESCE(NULLIF(?, ''), narration),
                        book_source = 'Authoritative Tally Ledger', file_sha256 = ?
                    WHERE id = ?
                    """,
                    (v_no, dr_p, cr_p, narr, f_sha, matched_id)
                )
            else:
                new_vid = v.get("id") or f"VCH-AUTH-{uuid.uuid4().hex[:12]}"
                claimed_existing_ids.add(new_vid)
                cur.execute(
                    """
                    INSERT OR REPLACE INTO vouchers 
                    (id, voucher_no, voucher_type, voucher_date, party_name, party_id, debit_paise, credit_paise, narration, book_source, file_sha256, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        new_vid,
                        v_no,
                        v_type,
                        v_date,
                        party_name,
                        party_id,
                        dr_p,
                        cr_p,
                        narr,
                        "Authoritative Tally Ledger",
                        f_sha,
                        now_iso,
                    )
                )

        # Mark authoritative ledger = 1, tally_status = 'verified', diff = 0
        final_closing = expected_closing if expected_closing != 0 else None
        conn.execute("""
            UPDATE parties
            SET has_authoritative_ledger = 1,
                tally_status = 'verified',
                tally_diff_paise = 0,
                tally_closing_paise = COALESCE(?, tally_closing_paise)
            WHERE id = ?
        """, (final_closing, party_id))
        conn.commit()

    recompute_party_balance(party_id)

    # Re-fetch new balance
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT balance_paise FROM parties WHERE id = ?", (party_id,))
        new_bal = cur.fetchone()[0] or 0

    return {
        "status": "success",
        "partyId": party_id,
        "partyName": party_name,
        "vouchersApplied": len(vchs),
        "newBalancePaise": new_bal,
        "newBalanceFormatted": f"{new_bal / 100.0:,.2f}",
        "openingBalancePaise": ob_paise,
        "tallyStatus": "verified"
    }


def save_dispatch(dispatch: dict[str, Any]) -> dict[str, Any]:
    """Persists dispatch and dispatch lines."""
    now = datetime.now().isoformat()
    dispatch_id = dispatch.get("id") or f"DSP-{datetime.now().strftime('%H%M%S')}"
    dispatch["id"] = dispatch_id

    with get_connection() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO dispatches 
            (id, number, order_id, order_number, customer_id, customer_name, dispatch_date, vehicle_number, driver_name, driver_phone,
             transport_name, notes, delivery_status, delivered_at, version, source, source_ref, created_by, created_by_name,
             voided_at, voided_by, voided_by_name, reviewed_at, reviewed_by, reviewed_by_name, line_count, slip_image_url, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                dispatch_id,
                dispatch.get("number") or f"DSP-2026-{dispatch_id}",
                dispatch.get("orderId", ""),
                dispatch.get("orderNumber", ""),
                dispatch.get("customerId", ""),
                dispatch.get("customerName", ""),
                dispatch.get("dispatchDate", now[:10]),
                dispatch.get("vehicleNumber") or dispatch.get("vehicle", ""),
                dispatch.get("driverName") or dispatch.get("driver", ""),
                dispatch.get("driverPhone", ""),
                dispatch.get("transportName", ""),
                dispatch.get("notes", ""),
                dispatch.get("deliveryStatus", "pending"),
                dispatch.get("deliveredAt"),
                dispatch.get("version", 1),
                dispatch.get("source", "panel"),
                dispatch.get("sourceRef"),
                dispatch.get("createdBy"),
                dispatch.get("createdByName"),
                dispatch.get("voidedAt"),
                dispatch.get("voidedBy"),
                dispatch.get("voidedByName"),
                dispatch.get("reviewedAt"),
                dispatch.get("reviewedBy"),
                dispatch.get("reviewedByName"),
                len(dispatch.get("lines", [])),
                dispatch.get("slipImageUrl"),
                dispatch.get("createdAt", now),
            ),
        )

        conn.execute("DELETE FROM dispatch_lines WHERE dispatch_id = ?", (dispatch_id,))
        for idx, line in enumerate(dispatch.get("lines", [])):
            conn.execute(
                """
                INSERT INTO dispatch_lines (dispatch_id, line_no, order_line_id, product_id, product, quantity, unit, batch_no, warehouse)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    dispatch_id,
                    idx + 1,
                    int(line.get("orderLineId") or line.get("lineNo") or idx + 1),
                    line.get("productId", "PRD-CUSTOM"),
                    line.get("product") or line.get("productName", ""),
                    str(line.get("quantity", "0.000")),
                    line.get("unit", "MT"),
                    line.get("batchNo", ""),
                    line.get("warehouse", ""),
                ),
            )
        conn.commit()

    return dispatch

def load_all_persisted_state() -> dict[str, Any]:
    """Hydrates orders, debtors, customers, payments, dispatches, opening balances from SQLite."""
    with get_connection() as conn:
        # Load parties
        cur = conn.cursor()
        cur.execute("SELECT customer_id, amount_paise, direction FROM opening_balances ORDER BY id ASC")
        ob_by_customer: dict[str, tuple[int, str]] = {}
        for ob in cur.fetchall():
            amt = ob["amount_paise"] or 0
            signed_paise = amt if (ob["direction"] or "debit").lower() in ("debit", "owes") else -amt
            ob_by_customer[ob["customer_id"]] = (signed_paise, ob["direction"] or "debit")

        from .ledger_classifier import is_sundry_debtor, is_sundry_creditor

        cur.execute("SELECT * FROM parties ORDER BY name ASC")
        parties = cur.fetchall()

        debtors = []
        creditors = []
        seen_debtor_names = set()
        seen_creditor_names = set()

        for p in parties:
            p_name = p["name"] or ""
            p_type = p["party_type"] if "party_type" in p.keys() else "customer"

            # Check if this party is a Sundry Creditor
            if is_sundry_creditor(p_name, p_type):
                bal_paise = p["balance_paise"] or 0
                bal_rupees = round(bal_paise / 100.0, 2)
                norm_c = (p["name"] or "").strip().lower()
                if norm_c not in seen_creditor_names:
                    seen_creditor_names.add(norm_c)
                    creditors.append({
                        "id": p["id"],
                        "name": p["name"],
                        "state": p["state"],
                        "city": p["city"],
                        "district": p["district"],
                        "salesperson": p["salesperson"] or "Unassigned",
                        "salespersonId": p["salesperson_id"] or "",
                        "mobile": p["mobile"] or "",
                        "balance": bal_rupees,
                        "balance_formatted": f"{bal_rupees:.2f}",
                        "creditDays": p["credit_days"] or 30,
                        "status": p["status"] or "active",
                        "partyType": "supplier",
                        "party_type": "supplier",
                        "tallyClosingPaise": p["tally_closing_paise"] if "tally_closing_paise" in p.keys() else None,
                        "tallyClosing": round(p["tally_closing_paise"] / 100.0, 2) if ("tally_closing_paise" in p.keys() and p["tally_closing_paise"] is not None) else None,
                        "tallyStatus": p["tally_status"] if ("tally_status" in p.keys() and p["tally_status"]) else "verified",
                    })
                continue

            if not is_sundry_debtor(p_name, p_type):
                continue
            bal_paise = p["balance_paise"] or 0
            bal_rupees = round(bal_paise / 100.0, 2)
            norm_name = (p["name"] or "").strip().lower()
            if norm_name not in seen_debtor_names:
                seen_debtor_names.add(norm_name)
                ob_info = ob_by_customer.get(p["id"])
                signed_ob = ob_info[0] if ob_info else 0
                ob_dir = ob_info[1] if ob_info else "debit"
                d_row = {
                    "id": p["id"],
                    "name": p["name"],
                    "state": p["state"],
                    "city": p["city"],
                    "district": p["district"],
                    "salesperson": p["salesperson"],
                    "salespersonId": (p["salesperson_id"] or "") if (p["salesperson"] and p["salesperson"].lower() != "unassigned") else "",
                    "mobile": p["mobile"] if (p["mobile"] and p["mobile"] != "9814000000" and not str(p["mobile"]).startswith("9814020")) else "",
                    "balance": bal_rupees,
                    "balance_formatted": f"{bal_rupees:.2f}",
                    "creditDays": p["credit_days"] or 30,
                    "status": p["status"] or "active",
                    "contactPerson": p["name"],
                    "source": "database",
                    "openingPaise": signed_ob,
                    "openingBalance": round(signed_ob / 100.0, 2),
                    "openingDirection": ob_dir,
                    "outstandingPaise": bal_paise,
                    "advancePaise": 0,
                    "unbilledValuePaise": 0,
                    "overduePaise": bal_paise if p["status"] == "active" else 0,
                    "isOverdue": bal_paise > 0,
                    "invoiceCount": 0,
                    "orderCount": 0,
                    "lastPaymentDate": None,
                    "tallyClosingPaise": p["tally_closing_paise"] if "tally_closing_paise" in p.keys() else None,
                    "tallyClosing": round(p["tally_closing_paise"] / 100.0, 2) if ("tally_closing_paise" in p.keys() and p["tally_closing_paise"] is not None) else None,
                    "tallyOpeningPaise": p["tally_opening_paise"] if "tally_opening_paise" in p.keys() else None,
                    "tallyOpening": round(p["tally_opening_paise"] / 100.0, 2) if ("tally_opening_paise" in p.keys() and p["tally_opening_paise"] is not None) else None,
                    "tallyStatus": p["tally_status"] if ("tally_status" in p.keys() and p["tally_status"]) else "unbenchmarked",
                    "tallyDiffPaise": p["tally_diff_paise"] if ("tally_diff_paise" in p.keys() and p["tally_diff_paise"] is not None) else 0,
                    "tallyDiff": round((p["tally_diff_paise"] or 0) / 100.0, 2) if "tally_diff_paise" in p.keys() else 0.0,
                    "hasAuthoritativeLedger": bool(p["has_authoritative_ledger"]) if "has_authoritative_ledger" in p.keys() else False,
                }
                debtors.append(d_row)

        customers = debtors

        # Load orders and their lines
        cur.execute("SELECT * FROM orders ORDER BY created_at DESC")
        order_rows = cur.fetchall()
        orders = []
        for o in order_rows:
            order_id = o["id"]
            cur.execute("SELECT * FROM order_lines WHERE order_id = ? ORDER BY line_no ASC", (order_id,))
            line_rows = cur.fetchall()
            lines = [
                {
                    "orderLineId": l["line_no"],
                    "lineNo": l["line_no"],
                    "productId": "PRD-CUSTOM",
                    "product": l["product"],
                    "productName": l["product"],
                    "unit": l["unit"],
                    "quantity": l["quantity"],
                    "orderedQuantity": l["quantity"],
                    "dispatchedQuantity": l["dispatched_quantity"] if "dispatched_quantity" in l.keys() else "0.000",
                    "remainingQuantity": str(max(0.0, float(l["quantity"]) - float(l["dispatched_quantity"] if "dispatched_quantity" in l.keys() else 0.0))),
                    "ratePaise": l["rate_paise"],
                    "amountPaise": l["amount_paise"],
                    "valuePaise": l["amount_paise"],
                }
                for l in line_rows
            ]

            disp_status = o["dispatch_status"] if "dispatch_status" in o.keys() and o["dispatch_status"] else "pending"
            disp_qty_str = o["dispatched_quantity"] if "dispatched_quantity" in o.keys() and o["dispatched_quantity"] else "0.000"
            disp_cnt = o["dispatch_count"] if "dispatch_count" in o.keys() and o["dispatch_count"] is not None else 0
            last_disp_date = o["last_dispatch_date"] if "last_dispatch_date" in o.keys() else ""

            tot_ordered_qty = sum(float(l.get("orderedQuantity") or l.get("quantity") or 0.0) for l in lines)
            orders.append({
                "id": o["id"],
                "number": o["order_number"],
                "customerId": o["customer_id"],
                "customerName": o["customer_name"],
                "salespersonName": o["salesperson_name"],
                "salespersonId": o["salesperson_id"],
                "state": o["state"],
                "orderDate": o["order_date"],
                "date": o["order_date"],
                "dueDate": o["due_date"],
                "expectedDispatchDate": o["expected_dispatch_date"],
                "paymentTerms": o["payment_terms"],
                "status": o["status"],
                "dispatchStatus": disp_status,
                "orderedQuantity": f"{tot_ordered_qty:.3f}",
                "dispatchedQuantity": disp_qty_str,
                "dispatchCount": disp_cnt,
                "lastDispatchDate": last_disp_date,
                "notes": o["notes"],
                "slipImageUrl": o["slip_image_url"],
                "totalPaise": o["total_paise"],
                "valuePaise": o["total_paise"],
                "lines": lines,
                "lineCount": len(lines),
            })

        # Load payments
        cur.execute("SELECT * FROM payments ORDER BY created_at DESC")
        payment_rows = cur.fetchall()
        payments = [
            {
                "id": py["id"],
                "voucherNo": py["voucher_no"],
                "customerId": py["customer_id"],
                "customerName": py["customer_name"],
                "orderId": None,
                "orderNumber": None,
                "invoiceNumber": "",
                "invoiceAmountPaise": 0,
                "amountPaise": py["amount_paise"],
                "paymentDate": py["payment_date"],
                "date": py["payment_date"],
                "method": py["method"],
                "reference": py["reference"],
                "notes": py["notes"],
                "allowAdvance": True,
                "duplicateSuspected": False,
                "duplicateOfId": None,
                "voidedAt": py["voided_at"] if "voided_at" in py.keys() else None,
                "source": "server",
                "sourceRef": None,
                "createdAt": py["created_at"],
            }
            for py in payment_rows
        ]

        # Load dispatches and their lines
        cur.execute("SELECT * FROM dispatches ORDER BY created_at DESC")
        dispatch_rows = cur.fetchall()
        dispatches = []
        for d in dispatch_rows:
            dsp_id = d["id"]
            cur.execute("SELECT * FROM dispatch_lines WHERE dispatch_id = ? ORDER BY line_no ASC", (dsp_id,))
            dl_rows = cur.fetchall()
            d_lines = [
                {
                    "dispatchLineId": dl["line_no"],
                    "orderLineId": dl["order_line_id"] if "order_line_id" in dl.keys() else dl["line_no"],
                    "lineNo": dl["line_no"],
                    "productId": dl["product_id"] if "product_id" in dl.keys() else "PRD-CUSTOM",
                    "productName": dl["product"],
                    "product": dl["product"],
                    "quantity": dl["quantity"],
                    "unit": dl["unit"],
                    "batchNo": dl["batch_no"] if "batch_no" in dl.keys() else "",
                    "warehouse": dl["warehouse"] if "warehouse" in dl.keys() else "",
                }
                for dl in dl_rows
            ]

            dispatches.append({
                "id": d["id"],
                "number": d["number"] if "number" in d.keys() and d["number"] else f"DSP-2026-{d['id']}",
                "orderId": d["order_id"],
                "orderNumber": d["order_number"],
                "customerId": d["customer_id"],
                "customerName": d["customer_name"] if "customer_name" in d.keys() and d["customer_name"] else "",
                "dispatchDate": d["dispatch_date"],
                "vehicle": d["vehicle_number"] if "vehicle_number" in d.keys() else "",
                "vehicleNumber": d["vehicle_number"] if "vehicle_number" in d.keys() else "",
                "driver": d["driver_name"] if "driver_name" in d.keys() else "",
                "driverName": d["driver_name"] if "driver_name" in d.keys() else "",
                "driverPhone": d["driver_phone"] if "driver_phone" in d.keys() else "",
                "transportName": d["transport_name"] if "transport_name" in d.keys() else "",
                "notes": d["notes"] if "notes" in d.keys() else "",
                "deliveryStatus": d["delivery_status"] if "delivery_status" in d.keys() and d["delivery_status"] else "pending",
                "deliveredAt": d["delivered_at"] if "delivered_at" in d.keys() else None,
                "version": d["version"] if "version" in d.keys() and d["version"] else 1,
                "source": d["source"] if "source" in d.keys() and d["source"] else "panel",
                "sourceRef": d["source_ref"] if "source_ref" in d.keys() else None,
                "createdAt": d["created_at"],
                "createdBy": d["created_by"] if "created_by" in d.keys() else None,
                "createdByName": d["created_by_name"] if "created_by_name" in d.keys() else None,
                "voidedAt": d["voided_at"] if "voided_at" in d.keys() else None,
                "voidedBy": d["voided_by"] if "voided_by" in d.keys() else None,
                "voidedByName": d["voided_by_name"] if "voided_by_name" in d.keys() else None,
                "reviewedAt": d["reviewed_at"] if "reviewed_at" in d.keys() else None,
                "reviewedBy": d["reviewed_by"] if "reviewed_by" in d.keys() else None,
                "reviewedByName": d["reviewed_by_name"] if "reviewed_by_name" in d.keys() else None,
                "lineCount": len(d_lines),
                "lines": d_lines,
            })

        # Load opening balances
        cur.execute("SELECT id, customer_id, as_of, amount_paise, direction, source, created_at FROM opening_balances ORDER BY id ASC")
        ob_rows = cur.fetchall()
        opening_balances: dict[str, list[dict[str, Any]]] = {}
        for ob in ob_rows:
            c_id = ob["customer_id"]
            if c_id not in opening_balances:
                opening_balances[c_id] = []
            opening_balances[c_id].append({
                "id": ob["id"],
                "customerId": c_id,
                "asOf": ob["as_of"],
                "amountPaise": ob["amount_paise"],
                "direction": ob["direction"],
                "source": ob["source"],
                "createdAt": ob["created_at"]
            })

        for cust in customers:
            c_id = cust["id"]
            if c_id in opening_balances and opening_balances[c_id]:
                latest_ob = opening_balances[c_id][-1]
                if latest_ob["direction"] in ("owes", "debit"):
                    cust["openingPaise"] = latest_ob["amountPaise"]
                else:
                    cust["advancePaise"] = latest_ob["amountPaise"]
                cust["openingBalance"] = round(cust.get("openingPaise", 0) / 100.0, 2)

        stock_movements = load_stock_movements()

        return {
            "debtors": debtors,
            "customers": customers,
            "creditors": creditors,
            "orders": orders,
            "payments": payments,
            "dispatches": dispatches,
            "opening_balances": opening_balances,
            "stock_movements": stock_movements,
        }

def save_stock_movement(entry: dict[str, Any]) -> dict[str, Any]:
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT OR REPLACE INTO stock_movements (
                id, product_id, sku, product_name, kind, delta_quantity,
                unit, batch_no, warehouse, reference, reason, movement_date,
                source, source_ref, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            entry.get("id", ""),
            entry.get("productId", ""),
            entry.get("sku", ""),
            entry.get("productName", ""),
            entry.get("kind", "dispatch"),
            str(entry.get("deltaQuantity", "0.000")),
            entry.get("unit", "MT"),
            entry.get("batchNo", ""),
            entry.get("warehouse", ""),
            entry.get("reference", ""),
            entry.get("reason", ""),
            entry.get("movementDate", datetime.now().strftime("%Y-%m-%d")),
            entry.get("source", "dispatch"),
            entry.get("sourceRef", ""),
            entry.get("createdAt", datetime.now().isoformat())
        ))
        conn.commit()
        return entry

def load_stock_movements() -> list[dict[str, Any]]:
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM stock_movements ORDER BY created_at DESC")
        rows = cursor.fetchall()
        result = []
        for r in rows:
            result.append({
                "id": r["id"],
                "productId": r["product_id"],
                "sku": r["sku"],
                "productName": r["product_name"],
                "kind": r["kind"],
                "deltaQuantity": r["delta_quantity"],
                "unit": r["unit"],
                "batchNo": r["batch_no"],
                "warehouse": r["warehouse"],
                "reference": r["reference"],
                "reason": r["reason"],
                "movementDate": r["movement_date"],
                "source": r["source"],
                "sourceRef": r["source_ref"],
                "createdAt": r["created_at"]
            })
        return result

def save_opening_balance(entry: dict[str, Any]) -> dict[str, Any]:
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO opening_balances (customer_id, as_of, amount_paise, direction, source, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            entry.get("customerId", ""),
            entry.get("asOf", ""),
            int(entry.get("amountPaise", 0)),
            entry.get("direction", "owes"),
            entry.get("source", "panel"),
            entry.get("createdAt", datetime.now().isoformat())
        ))
        conn.commit()
        entry["id"] = cursor.lastrowid
        return entry

def load_opening_balances() -> dict[str, list[dict[str, Any]]]:
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, customer_id, as_of, amount_paise, direction, source, created_at FROM opening_balances ORDER BY id ASC")
        rows = cursor.fetchall()
        result: dict[str, list[dict[str, Any]]] = {}
        for r in rows:
            cust_id = r["customer_id"]
            if cust_id not in result:
                result[cust_id] = []
            result[cust_id].append({
                "id": r["id"],
                "customerId": cust_id,
                "asOf": r["as_of"],
                "amountPaise": r["amount_paise"],
                "direction": r["direction"],
                "source": r["source"],
                "createdAt": r["created_at"]
            })
        return result

# ----------------- Vouchers & Transaction Ledger -----------------

def clean_party_name_for_match(s: str) -> str:
    import re
    s = re.sub(r"\s*\([^)]*\)", "", s)
    s = re.sub(r"\b(?:m/s|co|corp|pvt|ltd|cash|acc|account|w)\b", "", s, flags=re.IGNORECASE)
    return re.sub(r"[^a-zA-Z0-9]", "", s.lower())

def build_party_cache(conn) -> dict[str, dict[str, str]]:
    import re
    cur = conn.cursor()
    cur.execute("SELECT id, name FROM parties")
    rows = cur.fetchall()
    exact: dict[str, str] = {}
    simplified: dict[str, str] = {}
    cleaned: dict[str, str] = {}
    for pid, pname in rows:
        name_clean = " ".join((pname or "").strip().split()).lower()
        exact[name_clean] = pid
        simp = re.sub(r"[^a-zA-Z0-9]", "", name_clean)
        if simp and simp not in simplified:
            simplified[simp] = pid
        cl = clean_party_name_for_match(pname or "")
        if cl and cl not in cleaned:
            cleaned[cl] = pid
    return {"exact": exact, "simplified": simplified, "cleaned": cleaned}

def find_or_create_party_by_name(conn, party_name: str, party_type: str = "customer", cache: dict | None = None) -> tuple[str, bool]:
    """Finds an existing party or creates a new one in SQLite. Returns (party_id, is_new)."""
    import re
    norm_name = " ".join(party_name.strip().split())
    norm_l = norm_name.lower()

    # Fast O(1) in-memory cache lookup if provided
    if cache is not None:
        if norm_l in cache["exact"]:
            return cache["exact"][norm_l], False
        simp = re.sub(r"[^a-zA-Z0-9]", "", norm_l)
        if simp in cache["simplified"]:
            return cache["simplified"][simp], False
        cl = clean_party_name_for_match(norm_name)
        if cl and cl in cache["cleaned"]:
            return cache["cleaned"][cl], False
    else:
        cur = conn.cursor()
        # 1. Exact or case-insensitive match
        cur.execute("SELECT id FROM parties WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1", (norm_name,))
        row = cur.fetchone()
        if row:
            return row[0], False

        # 2. Simplified match (ignoring punctuation and spaces)
        simplified = re.sub(r"[^a-zA-Z0-9]", "", norm_l)
        cur.execute("SELECT id, name FROM parties")
        all_parties = cur.fetchall()
        for pid, pname in all_parties:
            if re.sub(r"[^a-zA-Z0-9]", "", (pname or "").lower()) == simplified:
                return pid, False

        # 3. Cleaned fuzzy match: strip common Tally noise (Cash, Station in parens, Co., W, Acc)
        clean_target = clean_party_name_for_match(norm_name)
        if len(clean_target) >= 5:
            for pid, pname in all_parties:
                clean_existing = clean_party_name_for_match(pname or "")
                if len(clean_existing) >= 5:
                    if clean_existing == clean_target or clean_target.startswith(clean_existing) or clean_existing.startswith(clean_target):
                        return pid, False

    # 4. Create new party
    from .ledger_classifier import classify_party_name, resolve_location
    actual_party_type = classify_party_name(norm_name) if party_type == "customer" else party_type
    city, district, state = resolve_location(norm_name)
    slug = re.sub(r"[^A-Z0-9]", "", norm_name.upper())[:8] or "CUST"
    unique_suffix = hashlib.md5(norm_name.encode("utf-8")).hexdigest()[:4].upper()
    new_id = f"DEBTOR-TALLY-{slug}-{unique_suffix}"
    now = datetime.now().isoformat()

    conn.execute(
        """
        INSERT INTO parties (id, name, state, city, district, salesperson, balance_paise, credit_days, status, party_type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'Unassigned', 0, 30, 'active', ?, ?, ?)
        """,
        (new_id, norm_name, state, city, district or city, actual_party_type, now, now)
    )

    if cache is not None:
        cache["exact"][norm_l] = new_id
        simp = re.sub(r"[^a-zA-Z0-9]", "", norm_l)
        if simp:
            cache["simplified"][simp] = new_id
        cl = clean_party_name_for_match(norm_name)
        if cl:
            cache["cleaned"][cl] = new_id

    return new_id, True

def recompute_party_balance(party_id: str, conn = None):
    """Recomputes party balance directly from Opening Balance + Net Vouchers (Debits - Credits) - Direct Payments."""
    def _run(c):
        cur = c.cursor()
        # Opening balance
        cur.execute("SELECT amount_paise, direction FROM opening_balances WHERE customer_id = ? ORDER BY id DESC LIMIT 1", (party_id,))
        ob_row = cur.fetchone()
        if ob_row:
            ob_paise = ob_row[0] if (ob_row[1] or "debit").lower() in ("debit", "owes") else -ob_row[0]
        else:
            ob_paise = 0

        # All vouchers: Debits (+) and Credits (-)
        cur.execute(
            """
            SELECT COALESCE(SUM(debit_paise), 0) - COALESCE(SUM(credit_paise), 0)
            FROM vouchers
            WHERE party_id = ?
            """,
            (party_id,)
        )
        voucher_net_paise = cur.fetchone()[0]

        # Direct customer payments
        cur.execute(
            """
            SELECT COALESCE(SUM(amount_paise), 0)
            FROM payments
            WHERE customer_id = ? AND voided_at IS NULL
            """,
            (party_id,)
        )
        direct_payment_paise = cur.fetchone()[0]

        new_balance_paise = ob_paise + voucher_net_paise - direct_payment_paise
        
        cur.execute("SELECT tally_closing_paise, has_authoritative_ledger FROM parties WHERE id = ?", (party_id,))
        t_row = cur.fetchone()
        if t_row and t_row[0] is not None:
            t_cl = t_row[0]
            has_auth = t_row[1] or 0
            diff = new_balance_paise - t_cl
            if abs(diff) <= 100:
                t_status = 'verified'
                t_diff = 0
            else:
                t_status = 'mismatch'
                t_diff = diff
            c.execute(
                "UPDATE parties SET balance_paise = ?, tally_status = ?, tally_diff_paise = ?, updated_at = ? WHERE id = ?",
                (new_balance_paise, t_status, t_diff, datetime.now().isoformat(), party_id)
            )
        else:
            c.execute(
                "UPDATE parties SET balance_paise = ?, updated_at = ? WHERE id = ?",
                (new_balance_paise, datetime.now().isoformat(), party_id)
            )

    if conn is not None:
        _run(conn)
    else:
        with get_connection() as c:
            _run(c)
            c.commit()

def save_vouchers_batch(vouchers: list[dict[str, Any]], file_sha: str = "") -> dict[str, Any]:
    """Saves a batch of vouchers with idempotent deduplication and updates party balances."""
    now = datetime.now().isoformat()
    inserted = 0
    skipped = 0
    new_parties_count = 0
    affected_party_ids = set()
    claimed_cross_ids: set[str] = set()
    newly_inserted_ids: set[str] = set()

    with get_connection() as conn:
        party_cache = build_party_cache(conn)
        cur = conn.cursor()
        cur.execute("SELECT id FROM vouchers")
        existing_v_ids = set(row[0] for row in cur.fetchall())

        for v in vouchers:
            v_id = v["id"]
            if v_id in existing_v_ids:
                skipped += 1
                continue

            party_name = v["partyName"]
            if v.get("partyId"):
                party_id = v["partyId"]
                is_new = False
            else:
                party_id, is_new = find_or_create_party_by_name(conn, party_name, party_type=v.get("partyType", "customer"), cache=party_cache)
            if is_new:
                new_parties_count += 1
            v["partyId"] = party_id
            affected_party_ids.add(party_id)

            vch_no = (v.get("voucherNo") or "").strip()
            vch_type = (v.get("voucherType") or "Sales").strip()
            vch_date = v.get("voucherDate", now[:10])
            dr_paise = v.get("debitPaise", 0)
            cr_paise = v.get("creditPaise", 0)
            cur_book = v.get("bookSource", "")

            # Universal deduplication (across same book re-uploads, revised files, and cross-book statements)
            def clean_vno_value(vno_raw):
                if not vno_raw:
                    return "", True
                s = re.sub(r'\(optional\)', '', str(vno_raw), flags=re.IGNORECASE).strip()
                is_synthetic = bool(
                    re.match(r'^(db|hdfc|yes|cash|khan|jv)\s*[-_:]\s*', s, flags=re.IGNORECASE)
                    or any(s.lower().startswith(p) for p in ('aug ', 'spt ', 'oct ', 'nov ', 'dec ', 'jan ', 'feb ', 'mar ', 'apr ', 'may ', 'jun ', 'jul '))
                    or '@' in s
                )
                clean = re.sub(r'^(db|hdfc|yes|cash|khan|jv)\s*[-_:]\s*', '', s, flags=re.IGNORECASE).strip().lower()
                return clean, is_synthetic

            clean_incoming_vno, incoming_is_synthetic = clean_vno_value(vch_no)
            incoming_narr = re.sub(r'\s+', ' ', (v.get("narration") or "").strip().lower())

            cur.execute(
                """
                SELECT id, voucher_no, narration, book_source, file_sha256 FROM vouchers
                WHERE voucher_date = ?
                  AND LOWER(voucher_type) = LOWER(?)
                  AND (party_id = ? OR LOWER(TRIM(party_name)) = LOWER(TRIM(?)))
                  AND debit_paise = ?
                  AND credit_paise = ?
                """,
                (vch_date, vch_type, party_id, party_name, dr_paise, cr_paise)
            )
            candidates = cur.fetchall()

            cross_match_id = None
            for cand_id, cand_vno, cand_narr, cand_bs, cand_fsha in candidates:
                if cand_id in claimed_cross_ids or cand_id in newly_inserted_ids:
                    continue
                if file_sha and cand_fsha == file_sha and cand_bs == cur_book:
                    continue
                cand_clean_vno, cand_is_synthetic = clean_vno_value(cand_vno)
                cand_clean_narr = re.sub(r'\s+', ' ', (cand_narr or "").strip().lower())

                # If either side is synthetic/auto-generated, or clean invoice numbers match, it is a duplicate!
                if incoming_is_synthetic or cand_is_synthetic or clean_incoming_vno == cand_clean_vno:
                    cross_match_id = cand_id
                    break
                elif not clean_incoming_vno or not cand_clean_vno:
                    cross_match_id = cand_id
                    break

            if cross_match_id:
                claimed_cross_ids.add(cross_match_id)
                skipped += 1
                incoming_narration = (v.get("narration") or "").strip()
                if incoming_narration:
                    cur.execute(
                        "UPDATE vouchers SET narration = ? WHERE id = ? AND (narration IS NULL OR narration = '')",
                        (incoming_narration, cross_match_id)
                    )
                if clean_incoming_vno:
                    cur.execute(
                        "UPDATE vouchers SET voucher_no = ? WHERE id = ? AND (voucher_no LIKE 'DB-%' OR voucher_no LIKE '%-%' OR voucher_no = '')",
                        (vch_no, cross_match_id)
                    )
                continue

            cur.execute(
                """
                INSERT OR IGNORE INTO vouchers 
                (id, voucher_no, voucher_type, voucher_date, party_name, party_id, debit_paise, credit_paise, narration, book_source, file_sha256, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    v_id,
                    vch_no,
                    vch_type,
                    vch_date,
                    party_name,
                    party_id,
                    dr_paise,
                    cr_paise,
                    v.get("narration", ""),
                    cur_book,
                    file_sha,
                    now,
                ),
            )
            if cur.rowcount > 0:
                inserted += 1
                existing_v_ids.add(v_id)
                newly_inserted_ids.add(v_id)
            else:
                skipped += 1

        for pid in affected_party_ids:
            recompute_party_balance(pid, conn)

        conn.commit()

    return {
        "insertedCount": inserted,
        "skippedCount": skipped,
        "newPartiesCount": new_parties_count,
        "affectedPartiesCount": len(affected_party_ids),
    }

def find_duplicate_voucher_candidates(party_id: str | None = None, conn=None) -> dict[str, Any]:
    """
    Finds actual duplicate voucher candidates where:
    - Same party_id
    - Same voucher_date
    - Same voucher_type
    - Same voucher_no
    - AND SAME AMOUNT (debit_paise and credit_paise must match exactly!)
    If voucher number is the same but amounts differ (e.g. 7 Lakh vs 3 Lakh),
    they are NEVER considered duplicates.
    Returns grouped preview so the user can review and explicitly approve deletion.
    """
    import re

    def clean_vno_str(s):
        if not s:
            return ""
        c = re.sub(r'\(optional\)', '', str(s), flags=re.IGNORECASE).strip()
        if re.match(r'^(db|hdfc|yes|cash|khan|jv)\s*[-_:]\s*', c, flags=re.IGNORECASE):
            return ""
        if any(c.lower().startswith(p) for p in ('aug ', 'spt ', 'oct ', 'nov ', 'dec ', 'jan ', 'feb ', 'mar ', 'apr ', 'may ', 'jun ', 'jul ')):
            return ""
        return c.lower()

    def is_invoice_no(s):
        c = clean_vno_str(s)
        if not c:
            return False
        if '@' in c or any(c.startswith(p) for p in ('aug ', 'spt ', 'oct ', 'nov ', 'dec ', 'jan ', 'feb ', 'mar ', 'apr ', 'may ', 'jun ', 'jul ')):
            return False
        return True

    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        cur = conn.cursor()
        if party_id:
            cur.execute("""
                SELECT id, party_id, party_name, voucher_date, LOWER(voucher_type), voucher_no, debit_paise, credit_paise, narration, book_source, file_sha256, created_at
                FROM vouchers
                WHERE party_id = ?
                ORDER BY voucher_date, id
            """, (party_id,))
        else:
            cur.execute("""
                SELECT id, party_id, party_name, voucher_date, LOWER(voucher_type), voucher_no, debit_paise, credit_paise, narration, book_source, file_sha256, created_at
                FROM vouchers
                ORDER BY voucher_date, id
            """)
        all_vchs = cur.fetchall()

        # Group 1: Exact Match on (party_id, voucher_date, voucher_type, voucher_no, debit_paise, credit_paise)
        # Note: Both debit_paise and credit_paise MUST MATCH! If amounts differ, NEVER group as duplicates.
        grouped_candidates = {}
        for v in all_vchs:
            vid, pid, pname, dt, vt, vno, dr, cr, narr, bs, fsha, cat = v
            cvno = clean_vno_str(vno)
            if not is_invoice_no(vno):
                continue
            # Amount MUST match!
            group_key = (pid, dt, vt, cvno, dr, cr)
            if group_key not in grouped_candidates:
                grouped_candidates[group_key] = []
            grouped_candidates[group_key].append(v)

        # Group 2: Cross-Book Exact Content duplicate (same party, date, dr, cr across different file uploads)
        content_groups = {}
        for v in all_vchs:
            vid, pid, pname, dt, vt, vno, dr, cr, narr, bs, fsha, cat = v
            cvno = clean_vno_str(vno)
            cnarr = re.sub(r'\s+', ' ', (narr or '').strip().lower())
            ckey = (pid, dt, vt, dr, cr, cvno, cnarr)
            content_groups.setdefault(ckey, []).append(v)

        duplicate_groups = []
        total_candidate_duplicates = 0
        seen_dup_vids = set()

        for gkey, v_list in grouped_candidates.items():
            if len(v_list) > 1:
                orig = v_list[0]
                party_id = orig[1]

                # Closing Balance Verification Guardrail
                cur.execute("SELECT balance_paise, tally_closing_paise, tally_status FROM parties WHERE id = ?", (party_id,))
                p_row = cur.fetchone()
                verified_by_closing = False
                diff_improvement = 0.0

                if p_row and p_row[1] is not None:
                    bal_paise = p_row[0] or 0
                    t_cl = p_row[1]
                    signed_amt = orig[6] - orig[7] # Debit (+) / Credit (-)
                    diff_now = bal_paise - t_cl
                    diff_after = (bal_paise - signed_amt) - t_cl

                    # 1. Protection: If current balance already matches Tally closing balance (<= Rs 1),
                    # deleting this voucher would break verified alignment! This proves Tally legitimately has both entries.
                    if abs(diff_now) <= 100 and abs(diff_after) > 100:
                        continue

                    # 2. Protection: If deleting makes the discrepancy with Tally closing balance worse, do NOT delete!
                    if abs(diff_after) > abs(diff_now):
                        continue

                    # 3. Confirmed duplicate: Deleting brings balance closer to or exactly equal to Tally closing balance
                    if abs(diff_after) < abs(diff_now) or abs(diff_after) <= 100:
                        verified_by_closing = True
                        diff_improvement = round((abs(diff_now) - abs(diff_after)) / 100.0, 2)

                dups = []
                for d in v_list[1:]:
                    if d[0] not in seen_dup_vids:
                        seen_dup_vids.add(d[0])
                        dups.append({
                            "id": d[0],
                            "voucherNo": d[5],
                            "bookSource": d[9],
                            "narration": d[8],
                            "createdAt": d[11]
                        })
                if dups:
                    total_candidate_duplicates += len(dups)
                    amt_paise = orig[6] if orig[6] > 0 else orig[7]
                    direction = "Dr." if orig[6] > 0 else "Cr."
                    duplicate_groups.append({
                        "partyId": orig[1],
                        "partyName": orig[2],
                        "voucherDate": orig[3],
                        "voucherType": orig[4].capitalize(),
                        "voucherNo": orig[5],
                        "debitPaise": orig[6],
                        "creditPaise": orig[7],
                        "amountFormatted": f"₹{amt_paise / 100.0:,.2f} {direction}",
                        "verifiedByClosingBalance": verified_by_closing,
                        "diffImprovement": diff_improvement,
                        "original": {
                            "id": orig[0],
                            "voucherNo": orig[5],
                            "bookSource": orig[9],
                            "narration": orig[8],
                            "createdAt": orig[11]
                        },
                        "duplicates": dups
                    })

        # Check content groups across different file_sha
        for ckey, v_list in content_groups.items():
            if len(v_list) > 1:
                shas = set(v[10] for v in v_list if v[10])
                if len(shas) > 1:
                    orig = v_list[0]
                    party_id = orig[1]

                    # Closing Balance Verification Guardrail
                    cur.execute("SELECT balance_paise, tally_closing_paise, tally_status FROM parties WHERE id = ?", (party_id,))
                    p_row = cur.fetchone()
                    verified_by_closing = False
                    diff_improvement = 0.0

                    if p_row and p_row[1] is not None:
                        bal_paise = p_row[0] or 0
                        t_cl = p_row[1]
                        signed_amt = orig[6] - orig[7]
                        diff_now = bal_paise - t_cl
                        diff_after = (bal_paise - signed_amt) - t_cl

                        if abs(diff_now) <= 100 and abs(diff_after) > 100:
                            continue
                        if abs(diff_after) > abs(diff_now):
                            continue
                        if abs(diff_after) < abs(diff_now) or abs(diff_after) <= 100:
                            verified_by_closing = True
                            diff_improvement = round((abs(diff_now) - abs(diff_after)) / 100.0, 2)

                    dups = []
                    for d in v_list[1:]:
                        if d[0] not in seen_dup_vids:
                            seen_dup_vids.add(d[0])
                            dups.append({
                                "id": d[0],
                                "voucherNo": d[5],
                                "bookSource": d[9],
                                "narration": d[8],
                                "createdAt": d[11]
                            })
                    if dups:
                        total_candidate_duplicates += len(dups)
                        amt_paise = orig[6] if orig[6] > 0 else orig[7]
                        direction = "Dr." if orig[6] > 0 else "Cr."
                        duplicate_groups.append({
                            "partyId": orig[1],
                            "partyName": orig[2],
                            "voucherDate": orig[3],
                            "voucherType": orig[4].capitalize(),
                            "voucherNo": orig[5] or "Cross-Book",
                            "debitPaise": orig[6],
                            "creditPaise": orig[7],
                            "amountFormatted": f"₹{amt_paise / 100.0:,.2f} {direction}",
                            "verifiedByClosingBalance": verified_by_closing,
                            "diffImprovement": diff_improvement,
                            "original": {
                                "id": orig[0],
                                "voucherNo": orig[5],
                                "bookSource": orig[9],
                                "narration": orig[8],
                                "createdAt": orig[11]
                            },
                            "duplicates": dups
                        })

        return {
            "totalCandidateDuplicates": total_candidate_duplicates,
            "totalGroups": len(duplicate_groups),
            "groups": duplicate_groups
        }
    finally:
        if should_close:
            conn.close()

def deduplicate_all_vouchers(approved_voucher_ids: list[str] | None = None, conn=None) -> dict[str, Any]:
    """
    Deletes ONLY the voucher IDs that have been explicitly previewed and approved by the user.
    If no approved_voucher_ids are provided, it NEVER deletes anything automatically.
    Recomputes party balances for all affected parties after approved deletions.
    """
    if not approved_voucher_ids:
        return {
            "status": "no_action",
            "deletedCount": 0,
            "affectedPartiesCount": 0,
            "message": "No voucher entries were approved for deletion."
        }

    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        cur = conn.cursor()
        clean_ids = [str(vid).strip() for vid in approved_voucher_ids if str(vid).strip()]
        if not clean_ids:
            return {"status": "no_action", "deletedCount": 0, "affectedPartiesCount": 0, "message": "No valid voucher IDs provided."}

        placeholders = ",".join("?" for _ in clean_ids)
        cur.execute(f"SELECT DISTINCT party_id FROM vouchers WHERE id IN ({placeholders})", tuple(clean_ids))
        affected_parties = [r[0] for r in cur.fetchall() if r[0]]

        # Delete approved vouchers
        cur.execute(f"DELETE FROM vouchers WHERE id IN ({placeholders})", tuple(clean_ids))
        deleted_count = cur.rowcount
        conn.commit()

        # Recompute balances for all affected parties
        for pid in affected_parties:
            recompute_party_balance(pid, conn)
        conn.commit()

        return {
            "status": "success",
            "deletedCount": deleted_count,
            "affectedPartiesCount": len(affected_parties),
            "message": f"Successfully deleted {deleted_count} approved duplicate voucher(s) across {len(affected_parties)} party ledger(s)."
        }
    finally:
        if should_close:
            conn.close()

def reconcile_adjustment_vouchers(
    vouchers: list[dict[str, Any]],
    target_generic_party: str = "discount",
    book_source: str = "Discount Ledger",
    file_sha: str = ""
) -> dict[str, Any]:
    """
    Reconciles an Adjustment (Discount or Round Off) Ledger batch against generic Day Book vouchers.
    Reassigns matching Day Book vouchers to their true customer debtor accounts using 1-to-1 claim tracking.
    """
    now = datetime.now().isoformat()
    reconciled = 0
    inserted = 0
    skipped = 0
    affected_party_ids = set()
    claimed_match_ids: set[str] = set()
    claimed_party_vids: set[str] = set()

    with get_connection() as conn:
        party_cache = build_party_cache(conn)
        cur = conn.cursor()
        for v in vouchers:
            party_name = (v.get("partyName") or "").strip()
            if not party_name:
                continue
            party_id, _ = find_or_create_party_by_name(conn, party_name, cache=party_cache)
            affected_party_ids.add(party_id)

            vdate = v.get("voucherDate", "")
            deb_p = v.get("debitPaise", 0)
            cred_p = v.get("creditPaise", 0)
            amt_paise = cred_p if cred_p > 0 else deb_p
            vno = (v.get("voucherNo") or "").strip()
            short_label = book_source.replace(" Ledger", "")
            narration = v.get("narration") or (f"{short_label} ({vno})" if vno else short_label)

            # 1. If this party already has this adjustment entry from the Master Journal Register, skip to prevent double counting
            cur.execute(
                """
                SELECT id FROM vouchers
                WHERE party_id = ? AND voucher_date = ? AND (credit_paise = ? OR debit_paise = ?)
                  AND book_source = 'Journal Register'
                """,
                (party_id, vdate, amt_paise, amt_paise)
            )
            jr_match = next((row[0] for row in cur.fetchall() if row[0] not in claimed_party_vids), None)
            if jr_match:
                claimed_party_vids.add(jr_match)
                skipped += 1
                continue

            # 2. Match generic voucher from Day Book on same date and amount (1-to-1 pairing, never delete, never steal from Journal/Bank)
            cur.execute(
                """
                SELECT id, voucher_no FROM vouchers
                WHERE (LOWER(party_name) IN (?, ? || ' ledger') OR party_id IN ('LEDGER-DISCOUNT', 'LEDGER-ROUNDOFF'))
                  AND voucher_date = ?
                  AND (debit_paise = ? OR credit_paise = ?)
                  AND book_source NOT IN ('Journal Register', 'HDFC Bank Book', 'Yes Bank Book')
                """,
                (target_generic_party.lower(), target_generic_party.lower(), vdate, amt_paise, amt_paise)
            )
            candidates = cur.fetchall()
            match = next((row for row in candidates if row[0] not in claimed_match_ids), None)

            if match:
                effective_vno = vno if vno else (match[1] or "")
                cur.execute(
                    """
                    UPDATE vouchers
                    SET party_id = ?, party_name = ?, debit_paise = ?, credit_paise = ?, voucher_no = ?, narration = ?, book_source = ?
                    WHERE id = ?
                    """,
                    (party_id, party_name, deb_p, cred_p, effective_vno, narration, f"Day Book ({short_label})", match[0])
                )
                claimed_match_ids.add(match[0])
                reconciled += 1
            else:
                # No unallocated generic voucher; check if already inserted or insert 1-to-1
                prefix = "DISC" if "discount" in target_generic_party.lower() else "ROFF"
                v_id = v.get("id") or f"VCH-{prefix}-{now}-{inserted}"
                cur.execute("SELECT id FROM vouchers WHERE id = ?", (v_id,))
                already_has_id = cur.fetchone()
                if not already_has_id:
                    cur.execute(
                        """
                        SELECT id FROM vouchers
                        WHERE party_id = ? AND voucher_date = ? AND (credit_paise = ? OR debit_paise = ?)
                          AND LOWER(voucher_type) = 'journal'
                          AND (book_source = ? OR book_source LIKE 'Day Book (%)' OR book_source = 'Journal Register')
                        """,
                        (party_id, vdate, amt_paise, amt_paise, book_source)
                    )
                    existing_party_vid = next((row[0] for row in cur.fetchall() if row[0] not in claimed_party_vids), None)
                    if existing_party_vid:
                        claimed_party_vids.add(existing_party_vid)
                        skipped += 1
                    else:
                        cur.execute(
                            """
                            INSERT OR IGNORE INTO vouchers (id, voucher_no, voucher_type, voucher_date, party_name, party_id, debit_paise, credit_paise, narration, book_source, file_sha256, created_at)
                            VALUES (?, ?, 'Journal', ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            """,
                            (v_id, vno, vdate, party_name, party_id, deb_p, cred_p, narration, book_source, file_sha, now)
                        )
                        if cur.rowcount > 0:
                            inserted += 1
                        else:
                            skipped += 1
                else:
                    skipped += 1

        for pid in affected_party_ids:
            recompute_party_balance(pid, conn)

        # Clear fake generic party balance
        cur.execute("SELECT id FROM parties WHERE LOWER(name) IN (?, ? || ' ledger')", (target_generic_party.lower(), target_generic_party.lower()))
        target_rows = cur.fetchall()
        for tr in target_rows:
            recompute_party_balance(tr[0], conn)

        conn.commit()

    return {
        "status": "success",
        "reconciledCount": reconciled,
        "insertedCount": inserted,
        "skippedCount": skipped,
        "affectedPartiesCount": len(affected_party_ids),
    }

def reconcile_discount_vouchers(vouchers: list[dict[str, Any]], file_sha: str = "") -> dict[str, Any]:
    return reconcile_adjustment_vouchers(vouchers, target_generic_party="discount", book_source="Discount Ledger", file_sha=file_sha)

def reconcile_roundoff_vouchers(vouchers: list[dict[str, Any]], file_sha: str = "") -> dict[str, Any]:
    return reconcile_adjustment_vouchers(vouchers, target_generic_party="round off", book_source="Round Off Ledger", file_sha=file_sha)

def load_vouchers(
    party_id: str | None = None,
    book_source: str | None = None,
    voucher_type: str | None = None,
    q: str | None = None,
    limit: int = 200,
    offset: int = 0,
    from_date: str | None = None,
    to_date: str | None = None,
) -> list[dict[str, Any]]:
    with get_connection() as conn:
        cur = conn.cursor()
        clauses = []
        params: list[Any] = []
        if party_id:
            clauses.append("party_id = ?")
            params.append(party_id)
        if from_date:
            clauses.append("voucher_date >= ?")
            params.append(from_date)
        if to_date:
            clauses.append("voucher_date <= ?")
            params.append(to_date)
        if book_source:
            bs_lower = book_source.lower().strip()
            if bs_lower in ("all", "liquid"):
                clauses.append("book_source IN ('HDFC Bank Book', 'Yes Bank Book', 'Cash Book', 'Khan Cash Book', 'Cash GBD Book', 'Day Book')")
            elif bs_lower in ("bank",):
                clauses.append("book_source IN ('HDFC Bank Book', 'Yes Bank Book')")
            elif bs_lower in ("cash",):
                clauses.append("book_source IN ('Cash Book', 'Khan Cash Book', 'Cash GBD Book')")
            elif "hdfc" in bs_lower:
                clauses.append("book_source = 'HDFC Bank Book'")
            elif "yes" in bs_lower:
                clauses.append("book_source = 'Yes Bank Book'")
            elif "khan" in bs_lower:
                clauses.append("book_source = 'Khan Cash Book'")
            elif "gbd" in bs_lower:
                clauses.append("book_source = 'Cash GBD Book'")
            elif "cash" in bs_lower:
                clauses.append("book_source = 'Cash Book'")
            elif "day" in bs_lower:
                clauses.append("book_source = 'Day Book'")
            else:
                clauses.append("book_source = ?")
                params.append(book_source)
        if voucher_type:
            clauses.append("LOWER(voucher_type) = LOWER(?)")
            params.append(voucher_type)
        if q:
            clauses.append("(party_name LIKE ? OR voucher_no LIKE ? OR narration LIKE ?)")
            q_wild = f"%{q.strip()}%"
            params.extend([q_wild, q_wild, q_wild])

        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        sql = f"SELECT * FROM vouchers {where} ORDER BY voucher_date DESC, id DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        cur.execute(sql, tuple(params))
        return [dict(r) for r in cur.fetchall()]


def get_bank_summary(
    book_source: str | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    interval: str | None = None,
) -> dict[str, Any]:
    """Calculates Opening Balance, Total Receipts, Total Payments, Net Flow, and Closing Balance for bank/cash books."""
    with get_connection() as conn:
        cur = conn.cursor()
        bs_lower = (book_source or "").lower().strip()

        if "hdfc" in bs_lower:
            sources = ['HDFC Bank Book']
            party_names = ['Hdfc Dura']
            title = "HDFC Bank Book"
        elif "yes" in bs_lower:
            sources = ['Yes Bank Book']
            party_names = ['Yes Bank']
            title = "Yes Bank Book"
        elif "khan" in bs_lower:
            sources = ['Khan Cash Book']
            party_names = ['KHAN CASH']
            title = "Khan Cash Book"
        elif "gbd" in bs_lower:
            sources = ['Cash GBD Book']
            party_names = ['Cash Gbd']
            title = "Cash GBD Book"
        elif "cash" in bs_lower:
            sources = ['Cash Book']
            party_names = ['Cash']
            title = "Cash Book"
        elif "day" in bs_lower:
            sources = ['Day Book']
            party_names = []
            title = "Day Book Vouchers"
        else:
            sources = ['HDFC Bank Book', 'Yes Bank Book', 'Cash Book', 'Khan Cash Book', 'Cash GBD Book', 'Day Book']
            party_names = ['Hdfc Dura', 'Yes Bank', 'Cash', 'KHAN CASH', 'Cash Gbd']
            title = "All Accounts (Bank, Cash & Day Book)"

        src_placeholders = ",".join("?" for _ in sources)

        # Base opening balance from opening_balances or parties
        init_open = 0
        if party_names:
            p_placeholders = ",".join("?" for _ in party_names)
            cur.execute(f"""
                SELECT COALESCE(SUM(
                    CASE WHEN direction = 'credit' THEN -amount_paise ELSE amount_paise END
                ), 0)
                FROM opening_balances
                WHERE customer_id IN (SELECT id FROM parties WHERE name IN ({p_placeholders}))
            """, party_names)
            ob_row = cur.fetchone()
            init_open = ob_row[0] if ob_row else 0

        # Prior net vouchers before from_date
        prior_net = 0
        if from_date:
            cur.execute(f"""
                SELECT COALESCE(SUM(credit_paise - debit_paise), 0)
                FROM vouchers
                WHERE book_source IN ({src_placeholders})
                  AND voucher_date < ?
            """, sources + [from_date])
            pn_row = cur.fetchone()
            prior_net = pn_row[0] if pn_row else 0

        opening_paise = init_open + prior_net

        # Period transactions
        cur.execute(f"""
            SELECT 
                COUNT(*) as total_vouchers,
                COALESCE(SUM(credit_paise), 0) as total_receipts_paise,
                COALESCE(SUM(debit_paise), 0) as total_payments_paise
            FROM vouchers
            WHERE book_source IN ({src_placeholders})
              AND (? IS NULL OR voucher_date >= ?)
              AND (? IS NULL OR voucher_date <= ?)
        """, sources + [from_date, from_date, to_date, to_date])
        row = cur.fetchone()
        receipts = row["total_receipts_paise"] if row else 0
        payments = row["total_payments_paise"] if row else 0
        net = receipts - payments
        closing_paise = opening_paise + net

        return {
            "ledgerKey": bs_lower or "all",
            "ledgerTitle": title,
            "totalVouchers": row["total_vouchers"] if row else 0,
            "openingBalancePaise": opening_paise,
            "totalReceiptsPaise": receipts,
            "totalPaymentsPaise": payments,
            "netPaise": net,
            "closingBalancePaise": closing_paise,
            "periodStart": from_date or "All Time",
            "periodEnd": to_date or "All Time",
        }

def update_voucher(voucher_id: str, updates: dict[str, Any]) -> dict[str, Any] | None:
    """Updates voucher fields (voucher_no, voucher_date, debit_paise, credit_paise, notes) and recomputes balance."""
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM vouchers WHERE id = ?", (voucher_id,))
        row = cur.fetchone()
        if not row:
            return None
        party_id = row["party_id"]

        fields = []
        params = []
        for col in ["voucher_no", "voucher_type", "voucher_date", "debit_paise", "credit_paise", "book_source"]:
            if col in updates:
                fields.append(f"{col} = ?")
                params.append(updates[col])

        if fields:
            params.append(voucher_id)
            cur.execute(f"UPDATE vouchers SET {', '.join(fields)} WHERE id = ?", tuple(params))
            recompute_party_balance(party_id, conn)
            conn.commit()

        cur.execute("SELECT * FROM vouchers WHERE id = ?", (voucher_id,))
        updated = cur.fetchone()
        return dict(updated) if updated else None

def delete_voucher(voucher_id: str) -> bool:
    """Deletes a voucher and recomputes party balance."""
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT party_id FROM vouchers WHERE id = ?", (voucher_id,))
        row = cur.fetchone()
        if not row:
            return False
        party_id = row["party_id"]
        cur.execute("DELETE FROM vouchers WHERE id = ?", (voucher_id,))
        recompute_party_balance(party_id, conn)
        conn.commit()
        return True

def transfer_voucher(voucher_id: str, target_party_id: str, notes: str = "") -> dict[str, Any] | None:
    """Transfers a voucher to target_party_id and recomputes balances for both parties."""
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM vouchers WHERE id = ?", (voucher_id,))
        v_row = cur.fetchone()
        if not v_row:
            return None
        old_party_id = v_row["party_id"]

        cur.execute("SELECT id, name FROM parties WHERE id = ?", (target_party_id,))
        target_row = cur.fetchone()
        if not target_row:
            return None
        target_name = target_row["name"]

        new_source = f"{v_row['book_source'] or ''} (xfer)".strip()
        cur.execute(
            "UPDATE vouchers SET party_id = ?, party_name = ?, book_source = ? WHERE id = ?",
            (target_party_id, target_name, new_source, voucher_id),
        )
        recompute_party_balance(old_party_id, conn)
        recompute_party_balance(target_party_id, conn)
        conn.commit()

        cur.execute("SELECT * FROM vouchers WHERE id = ?", (voucher_id,))
        updated = cur.fetchone()
        return {
            "voucher": dict(updated) if updated else {},
            "oldPartyId": old_party_id,
            "targetPartyId": target_party_id,
            "targetPartyName": target_name,
        }

def add_journal_entry(party_id: str, entry_type: str, amount_paise: int, voucher_date: str, reference: str = "", notes: str = "") -> dict[str, Any] | None:
    """Creates a debit or credit Journal Entry (JV) for a debtor and recomputes balance."""
    now = datetime.now().isoformat()
    jv_id = f"JV-{int(datetime.now().timestamp()*1000)}"
    is_debit = entry_type.upper() == "DEBIT"
    debit_paise = amount_paise if is_debit else 0
    credit_paise = 0 if is_debit else amount_paise

    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id, name FROM parties WHERE id = ?", (party_id,))
        p_row = cur.fetchone()
        if not p_row:
            return None
        party_name = p_row["name"]

        cur.execute(
            """
            INSERT INTO vouchers 
            (id, voucher_no, voucher_type, voucher_date, party_name, party_id, debit_paise, credit_paise, book_source, file_sha256, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                jv_id,
                reference or f"JV-{jv_id[-4:]}",
                "Journal",
                voucher_date or now[:10],
                party_name,
                party_id,
                debit_paise,
                credit_paise,
                f"Manual JV: {notes}".strip() if notes else "Manual Journal Entry",
                "manual_jv",
                now,
            ),
        )
        recompute_party_balance(party_id, conn)
        conn.commit()

        cur.execute("SELECT * FROM vouchers WHERE id = ?", (jv_id,))
        row = cur.fetchone()
        return dict(row) if row else None

def merge_parties(source_party_id: str, target_party_id: str) -> dict[str, Any] | None:
    """Consolidates source party into target party. Moves all vouchers, orders, payments, dispatches."""
    if source_party_id == target_party_id:
        return None

    now = datetime.now().isoformat()
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id, name FROM parties WHERE id = ?", (source_party_id,))
        source_row = cur.fetchone()
        cur.execute("SELECT id, name FROM parties WHERE id = ?", (target_party_id,))
        target_row = cur.fetchone()

        if not source_row or not target_row:
            return None

        source_name = source_row["name"]
        target_name = target_row["name"]

        # 1. Reassign vouchers
        cur.execute(
            "UPDATE vouchers SET party_id = ?, party_name = ? WHERE party_id = ?",
            (target_party_id, target_name, source_party_id),
        )
        vouchers_moved = cur.rowcount

        # 2. Reassign orders
        cur.execute(
            "UPDATE orders SET customer_id = ?, customer_name = ? WHERE customer_id = ?",
            (target_party_id, target_name, source_party_id),
        )
        orders_moved = cur.rowcount

        # 3. Reassign payments
        cur.execute(
            "UPDATE payments SET customer_id = ?, customer_name = ? WHERE customer_id = ?",
            (target_party_id, target_name, source_party_id),
        )
        payments_moved = cur.rowcount

        # 4. Reassign dispatches
        cur.execute(
            "UPDATE dispatches SET customer_id = ?, customer_name = ? WHERE customer_id = ?",
            (target_party_id, target_name, source_party_id),
        )
        dispatches_moved = cur.rowcount

        # 5. Add source opening balance into target opening balance if exists
        cur.execute("SELECT amount_paise FROM opening_balances WHERE customer_id = ? ORDER BY id DESC LIMIT 1", (source_party_id,))
        s_ob = cur.fetchone()
        if s_ob and s_ob[0]:
            cur.execute("SELECT amount_paise FROM opening_balances WHERE customer_id = ? ORDER BY id DESC LIMIT 1", (target_party_id,))
            t_ob = cur.fetchone()
            combined_ob = (t_ob[0] if t_ob else 0) + s_ob[0]
            cur.execute(
                "INSERT INTO opening_balances (customer_id, as_of, amount_paise, direction, source, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (target_party_id, now[:10], combined_ob, "debit", f"Merged from {source_name}", now),
            )

        # 6. Delete source party from parties
        cur.execute("DELETE FROM parties WHERE id = ?", (source_party_id,))

        # 7. Recompute target balance
        recompute_party_balance(target_party_id, conn)

        # Get updated target
        cur.execute("SELECT balance_paise FROM parties WHERE id = ?", (target_party_id,))
        new_bal = cur.fetchone()
        new_balance_paise = new_bal[0] if new_bal else 0

        conn.commit()

        return {
            "sourcePartyId": source_party_id,
            "sourcePartyName": source_name,
            "targetPartyId": target_party_id,
            "targetPartyName": target_name,
            "vouchersMoved": vouchers_moved,
            "ordersMoved": orders_moved,
            "paymentsMoved": payments_moved,
            "dispatchesMoved": dispatches_moved,
            "newBalancePaise": new_balance_paise,
        }

def update_party_opening_balance(party_id: str, amount_paise: int, as_of: str = "") -> dict[str, Any] | None:
    """Updates or sets opening balance for a party and recomputes net balance."""
    now = datetime.now().isoformat()
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id, name FROM parties WHERE id = ?", (party_id,))
        p = cur.fetchone()
        if not p:
            return None

        cur.execute(
            """
            INSERT INTO opening_balances (customer_id, as_of, amount_paise, direction, source, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (party_id, as_of or now[:10], amount_paise, "debit", "Manual Edit", now),
        )
        recompute_party_balance(party_id, conn)
        cur.execute("SELECT balance_paise FROM parties WHERE id = ?", (party_id,))
        b_row = cur.fetchone()
        conn.commit()
        return {
            "partyId": party_id,
            "openingBalancePaise": amount_paise,
            "newBalancePaise": b_row[0] if b_row else 0,
        }

def import_opening_balances(filepath: str, as_of: str = "") -> dict[str, Any]:
    """Imports opening/trial balances from an Excel sheet into opening_balances and updates party balances."""
    from .voucher_parser import parse_opening_balance_workbook
    data = parse_opening_balance_workbook(filepath)
    entries = data["entries"]
    period_text = data.get("periodText", "")
    now = datetime.now().isoformat()
    record_date = as_of or (now[:10])

    updated_count = 0
    created_party_count = 0

    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id, name FROM parties")
        existing_parties = cur.fetchall()
        from .ledger_classifier import is_sundry_debtor
        norm = lambda s: re.sub(r'[^a-z0-9]', '', (s or "").lower())
        p_by_norm = {norm(p[1]): p[0] for p in existing_parties if p[1]}
        p_by_exact = {(p[1] or "").strip().lower(): p[0] for p in existing_parties if p[1]}

        for e in entries:
            name = e["name"]
            norm_name = norm(name)
            party_id = p_by_exact.get(name.lower()) or p_by_norm.get(norm_name)

            if not party_id:
                party_id, _ = find_or_create_party_by_name(conn, name)
                p_by_norm[norm_name] = party_id
                p_by_exact[name.lower()] = party_id
                created_party_count += 1

            ob_paise = e["amountPaise"]
            direction = e["direction"]

            cur.execute(
                "DELETE FROM opening_balances WHERE customer_id = ? AND source LIKE 'Import: %'",
                (party_id,)
            )
            cur.execute(
                """
                INSERT INTO opening_balances (customer_id, as_of, amount_paise, direction, source, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (party_id, record_date, ob_paise, direction, f"Import: {os.path.basename(filepath)}", now)
            )

            recompute_party_balance(party_id, conn)
            updated_count += 1

        conn.commit()

    return {
        "success": True,
        "updatedCount": updated_count,
        "createdPartyCount": created_party_count,
        "periodText": period_text,
        "totalDebitPaise": data["totalDebitPaise"],
        "totalCreditPaise": data["totalCreditPaise"],
    }

def zero_all_balances() -> dict[str, Any]:
    """Zeroes all party balances and clears opening balances so fresh Excel can be imported."""
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("UPDATE parties SET balance_paise = 0")
        cur.execute("DELETE FROM opening_balances")
        conn.commit()
    return {"success": True, "message": "All party balances successfully set to 0.00 and opening balances cleared."}

def reclassify_all_parties_and_locations() -> dict[str, Any]:
    """Scans all existing parties in database and updates party_type, city, district, and state."""
    from .ledger_classifier import classify_party_name, resolve_location
    updated_types = 0
    updated_locations = 0
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id, name, city, district, state, party_type FROM parties")
        rows = cur.fetchall()
        for row in rows:
            p_id = row[0]
            name = row[1] or ""
            curr_city = row[2] or ""
            curr_dist = row[3] or ""
            curr_state = row[4] or "Punjab"
            curr_type = row[5] or "customer"

            new_type = classify_party_name(name)
            city, dist, state = resolve_location(name, fallback_state=curr_state)

            final_city = city or curr_city
            final_dist = dist or curr_dist or final_city
            final_state = state or curr_state

            if new_type != curr_type or final_city != curr_city or final_dist != curr_dist or final_state != curr_state:
                cur.execute(
                    "UPDATE parties SET party_type = ?, city = ?, district = ?, state = ? WHERE id = ?",
                    (new_type, final_city, final_dist, final_state, p_id)
                )
                if new_type != curr_type:
                    updated_types += 1
                if final_city != curr_city or final_dist != curr_dist or final_state != curr_state:
                    updated_locations += 1
        conn.commit()
    return {"success": True, "updated_types": updated_types, "updated_locations": updated_locations}

# ----------------- Invitations & User Management -----------------

def create_invitation(
    code: str,
    role: str = "employee",
    department: str = "Sales",
    employee_id: str = "",
    sales_territory: str = "",
    monthly_target_qty: float = 100.0,
    target_unit: str = "MT",
    may_dispatch: int = 0,
    max_uses: int = 1,
    expires_at: str = "",
    created_by: str = "USR-OWNER"
) -> dict[str, Any]:
    inv_id = f"inv-{uuid.uuid4().hex[:12]}"
    now = datetime.now().isoformat()
    clean_code = code.strip().upper()
    with get_connection() as conn:
        conn.execute("""
            INSERT INTO invitations (
                id, code, role, department, employee_id, sales_territory,
                monthly_target_qty, target_unit, may_dispatch, max_uses,
                used_count, expires_at, status, created_by, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'active', ?, ?)
        """, (
            inv_id, clean_code, role, department, employee_id, sales_territory,
            monthly_target_qty, target_unit, 1 if may_dispatch else 0, max_uses,
            expires_at, created_by, now
        ))
        conn.commit()
    return get_invitation_by_code(clean_code)  # type: ignore

def get_invitation_by_code(code: str) -> dict[str, Any] | None:
    clean_code = code.strip().upper()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM invitations WHERE code = ?", (clean_code,))
        row = cursor.fetchone()
        if not row:
            return None
        return dict(row)

def list_invitations() -> list[dict[str, Any]]:
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM invitations ORDER BY created_at DESC")
        rows = cursor.fetchall()
        return [dict(r) for r in rows]

def revoke_invitation(code: str) -> bool:
    clean_code = code.strip().upper()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("UPDATE invitations SET status = 'revoked' WHERE code = ? AND status = 'active'", (clean_code,))
        conn.commit()
        return cursor.rowcount > 0

def use_invitation_code(code: str) -> bool:
    clean_code = code.strip().upper()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT max_uses, used_count, status, expires_at FROM invitations WHERE code = ?", (clean_code,))
        row = cursor.fetchone()
        if not row:
            return False
        if row["status"] != "active":
            return False
        if row["expires_at"]:
            try:
                exp = datetime.fromisoformat(row["expires_at"].replace("Z", "+00:00"))
                now = datetime.now(exp.tzinfo) if exp.tzinfo else datetime.now()
                if now > exp:
                    cursor.execute("UPDATE invitations SET status = 'expired' WHERE code = ?", (clean_code,))
                    conn.commit()
                    return False
            except Exception:
                pass
        
        new_used = row["used_count"] + 1
        new_status = "used" if new_used >= row["max_uses"] else "active"
        cursor.execute("UPDATE invitations SET used_count = ?, status = ? WHERE code = ?", (new_used, new_status, clean_code))
        conn.commit()
        return True

def hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    if salt is None:
        salt = secrets.token_hex(16)
    hashed = hashlib.sha256((salt + password).encode("utf-8")).hexdigest()
    return hashed, salt

def create_user(
    name: str,
    username: str,
    email: str,
    password: str,
    phone: str = "",
    role: str = "employee",
    department: str = "Sales",
    employee_id: str = "",
    sales_territory: str = ""
) -> dict[str, Any]:
    user_id = f"usr-{uuid.uuid4().hex[:10]}"
    now = datetime.now().isoformat()
    pwd_hash, salt = hash_password(password)
    clean_user = username.strip().lower()
    clean_email = email.strip().lower()
    clean_phone = phone.strip()

    with get_connection() as conn:
        conn.execute("""
            INSERT INTO users (
                id, username, email, phone, name, password_hash, salt,
                role, department, employee_id, sales_territory, active,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        """, (
            user_id, clean_user, clean_email, clean_phone, name.strip(),
            pwd_hash, salt, role, department, employee_id, sales_territory,
            now, now
        ))
        conn.commit()
    return get_user_by_id(user_id)  # type: ignore

def get_user_by_id(user_id: str) -> dict[str, Any] | None:
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
        row = cursor.fetchone()
        return dict(row) if row else None

def get_user_by_identifier(identifier: str) -> dict[str, Any] | None:
    clean = identifier.strip().lower()
    if clean in ("owner", "ishu", "ishujindal", "ishu.jindal@durasmart.com", "owner@durasmart.com", "owner@example.test"):
        target_username = "ishujindal"
    else:
        target_username = clean

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM users
            WHERE lower(username) = ? 
               OR lower(email) = ? 
               OR phone = ? 
               OR lower(employee_id) = ?
               OR (? = 'ishujindal' AND lower(username) = 'ishujindal')
            LIMIT 1
        """, (target_username, clean, identifier.strip(), clean, target_username))
        row = cursor.fetchone()
        if not row and "." not in clean:
            cursor.execute("""
                SELECT * FROM users
                WHERE lower(username) LIKE ? || '.%' OR lower(username) = ?
                LIMIT 1
            """, (clean, clean))
            row = cursor.fetchone()
        return dict(row) if row else None

def verify_user_password(user: dict[str, Any], password: str) -> bool:
    salt = user.get("salt", "")
    expected = user.get("password_hash", "")
    computed, _ = hash_password(password, salt=salt)
    return secrets.compare_digest(computed, expected)

SALES_OFFICERS_DIRECTORY = [
    {"id": "EMP-SP-01", "name": "AJAY JI", "phone": "9814010000", "territory": "Haryana", "target_mt": 185.0},
    {"id": "EMP-SP-02", "name": "Aksit", "phone": "9814010001", "territory": "Punjab", "target_mt": 23.0},
    {"id": "EMP-SP-03", "name": "GAURAV JI", "phone": "9814010002", "territory": "Haryana", "target_mt": 50.0},
    {"id": "EMP-SP-04", "name": "JAGDEEP 2/ Aakash Kumar", "phone": "9814010003", "territory": "Punjab", "target_mt": 78.0},
    {"id": "EMP-SP-05", "name": "JAGDEEP 3/ Dalip Kumar", "phone": "9814010004", "territory": "Punjab", "target_mt": 50.0},
    {"id": "EMP-SP-06", "name": "Jagdeep Singh", "phone": "9814010005", "territory": "Punjab", "target_mt": 271.0},
    {"id": "EMP-SP-07", "name": "Mozi Ram", "phone": "9814010006", "territory": "Haryana", "target_mt": 50.0},
    {"id": "EMP-SP-08", "name": "PANKAJ JI", "phone": "9814010007", "territory": "Haryana", "target_mt": 280.0},
    {"id": "EMP-SP-09", "name": "Pankaj Goyal", "phone": "9814010008", "territory": "Punjab", "target_mt": 127.0},
    {"id": "EMP-SP-10", "name": "SANDEEP2/Mozi Ram", "phone": "9814010009", "territory": "Punjab", "target_mt": 87.0},
    {"id": "EMP-SP-11", "name": "Sandeep Mahajan", "phone": "9814010010", "territory": "Punjab", "target_mt": 239.0},
    {"id": "EMP-SP-12", "name": "Suresh Jindal", "phone": "9814010011", "territory": "Punjab", "target_mt": 99.0},
    {"id": "EMP-SP-13", "name": "VIJAY JI", "phone": "9814010012", "territory": "Haryana", "target_mt": 70.0},
]

def find_matching_sales_officer(name: str = "", phone: str = "", identifier: str = "") -> dict[str, Any] | None:
    """Matches user input by phone, name, or email to the 13 official sales officers."""
    import re
    clean_p = re.sub(r"\D", "", phone or "")
    if len(clean_p) >= 10:
        p10 = clean_p[-10:]
        for o in SALES_OFFICERS_DIRECTORY:
            if o["phone"] == p10:
                return o

    combined = f"{name or ''} {identifier or ''}".lower()

    if "goyal" in combined:
        return next(o for o in SALES_OFFICERS_DIRECTORY if o["id"] == "EMP-SP-09")
    if "mahajan" in combined:
        return next(o for o in SALES_OFFICERS_DIRECTORY if o["id"] == "EMP-SP-11")
    if "sandeep" in combined and ("2" in combined or "mozi" in combined):
        return next(o for o in SALES_OFFICERS_DIRECTORY if o["id"] == "EMP-SP-10")
    if "aakash" in combined or ("jagdeep" in combined and "2" in combined):
        return next(o for o in SALES_OFFICERS_DIRECTORY if o["id"] == "EMP-SP-04")
    if "dalip" in combined or ("jagdeep" in combined and "3" in combined):
        return next(o for o in SALES_OFFICERS_DIRECTORY if o["id"] == "EMP-SP-05")
    if "mozi" in combined:
        return next(o for o in SALES_OFFICERS_DIRECTORY if o["id"] == "EMP-SP-07")
    if "ajay" in combined:
        return next(o for o in SALES_OFFICERS_DIRECTORY if o["id"] == "EMP-SP-01")
    if "aksit" in combined or "akshit" in combined:
        return next(o for o in SALES_OFFICERS_DIRECTORY if o["id"] == "EMP-SP-02")
    if "gaurav" in combined:
        return next(o for o in SALES_OFFICERS_DIRECTORY if o["id"] == "EMP-SP-03")
    if "suresh" in combined:
        return next(o for o in SALES_OFFICERS_DIRECTORY if o["id"] == "EMP-SP-12")
    if "vijay" in combined:
        return next(o for o in SALES_OFFICERS_DIRECTORY if o["id"] == "EMP-SP-13")
    if "pankaj" in combined:
        return next(o for o in SALES_OFFICERS_DIRECTORY if o["id"] == "EMP-SP-08")
    if "sandeep" in combined:
        return next(o for o in SALES_OFFICERS_DIRECTORY if o["id"] == "EMP-SP-11")
    if "jagdeep" in combined:
        return next(o for o in SALES_OFFICERS_DIRECTORY if o["id"] == "EMP-SP-06")
    return None

def upsert_user_from_firebase(uid: str, email: str, name: str = "", phone: str = "") -> dict[str, Any]:
    clean_email = (email or "").strip().lower()
    existing = (get_user_by_identifier(clean_email) if clean_email else None) or get_user_by_id(uid)
    if existing:
        return existing
    
    is_owner = (
        clean_email in ("ishu.jindal@durasmart.com", "owner@durasmart.com", "babri3726@gmail.com", "jindalbrothers@gmail.com")
        or "owner" in clean_email
        or "ishu" in clean_email
    )
    role = "owner" if is_owner else "employee"
    dept = "Management" if is_owner else "Sales"
    clean_name = name.strip() or (clean_email.split("@")[0].title() if clean_email else "DuraSmart User")
    emp_id = "OWNER-01" if is_owner else f"EMP-{uid[:6].upper()}"
    territory = "Executive / All Territories" if is_owner else "Punjab/Haryana"

    if not is_owner:
        officer = find_matching_sales_officer(clean_name, phone, clean_email)
        if officer:
            emp_id = officer["id"]
            territory = officer["territory"]
            clean_name = officer["name"]
            dept = "Sales"
            role = "employee"

    username = clean_email.split("@")[0] if clean_email else f"user_{uid[:6]}"
    
    now = datetime.now().isoformat()
    with get_connection() as conn:
        conn.execute("""
            INSERT OR REPLACE INTO users (
                id, username, email, phone, name, password_hash, salt,
                role, department, employee_id, sales_territory, active,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, '', '', ?, ?, ?, ?, 1, ?, ?)
        """, (uid, username, clean_email, phone, clean_name, role, dept, emp_id, territory, now, now))
        conn.commit()
    return get_user_by_id(uid) or {
        "id": uid, "username": username, "email": clean_email, "name": clean_name,
        "role": role, "department": dept, "employee_id": emp_id, "sales_territory": territory
    }

def set_user_as_owner(email_or_username: str, password: str | None = None, name: str | None = None) -> dict[str, Any]:
    """Sets a user's role to 'owner'. If user doesn't exist, creates them as owner."""
    clean_identifier = email_or_username.strip().lower()
    clean_email = clean_identifier if "@" in clean_identifier else f"{clean_identifier}@durasmart.com"
    clean_user = clean_identifier.split("@")[0]
    now = datetime.now().isoformat()

    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id, username, email, name, role FROM users WHERE LOWER(email) = ? OR LOWER(username) = ?", (clean_email, clean_user))
        existing = cur.fetchone()

        if existing:
            user_id = existing[0]
            if password:
                pwd_hash, salt = hash_password(password)
                cur.execute(
                    "UPDATE users SET role = 'owner', password_hash = ?, salt = ?, updated_at = ? WHERE id = ?",
                    (pwd_hash, salt, now, user_id)
                )
            else:
                cur.execute(
                    "UPDATE users SET role = 'owner', updated_at = ? WHERE id = ?",
                    (now, user_id)
                )
            conn.commit()
            return {"status": "success", "action": "promoted", "id": user_id, "email": existing[2], "role": "owner"}
        else:
            default_pwd = password or "DuraSmart@2026"
            pwd_hash, salt = hash_password(default_pwd)
            user_id = f"usr-owner-{uuid.uuid4().hex[:8]}"
            display_name = name or clean_user.capitalize()
            cur.execute("""
                INSERT INTO users (
                    id, username, email, phone, name, password_hash, salt,
                    role, department, employee_id, sales_territory, active,
                    created_at, updated_at
                ) VALUES (?, ?, ?, '', ?, ?, ?, 'owner', 'Management', 'EMP-OWNER-01', 'All', 1, ?, ?)
            """, (
                user_id, clean_user, clean_email, display_name,
                pwd_hash, salt, now, now
            ))
            conn.commit()
            return {"status": "success", "action": "created", "id": user_id, "email": clean_email, "role": "owner"}

def update_user_profile(user_id: str, name: str | None = None, phone: str | None = None) -> dict[str, Any] | None:
    now = datetime.now().isoformat()
    updates = []
    params = []
    if name is not None:
        updates.append("name = ?")
        params.append(name.strip())
    if phone is not None:
        updates.append("phone = ?")
        params.append(phone.strip())
    if not updates:
        return get_user_by_id(user_id)
    updates.append("updated_at = ?")
    params.append(now)
    params.append(user_id)

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = ?", tuple(params))
        conn.commit()
    return get_user_by_id(user_id)

def update_user_password(user_id: str, new_password: str) -> bool:
    now = datetime.now().isoformat()
    pwd_hash, salt = hash_password(new_password)
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE users SET password_hash = ?, salt = ?, updated_at = ?
            WHERE id = ?
        """, (pwd_hash, salt, now, user_id))
        conn.commit()
        return cursor.rowcount > 0

def create_password_reset_otp(user_id: str, identifier: str) -> dict[str, Any]:
    reset_id = f"rst-{uuid.uuid4().hex[:12]}"
    now = datetime.now()
    expires_at = (now + timedelta(minutes=15)).isoformat()
    otp = f"{secrets.randbelow(900000) + 100000}"
    with get_connection() as conn:
        conn.execute("""
            INSERT INTO password_resets (id, user_id, identifier, otp, expires_at, used, created_at)
            VALUES (?, ?, ?, ?, ?, 0, ?)
        """, (reset_id, user_id, identifier.strip().lower(), otp, expires_at, now.isoformat()))
        conn.commit()
    return {
        "id": reset_id,
        "user_id": user_id,
        "otp": otp,
        "expires_at": expires_at
    }

def verify_password_reset_otp(identifier: str, otp: str) -> dict[str, Any] | None:
    user = get_user_by_identifier(identifier)
    if not user:
        return None
    clean_otp = otp.strip()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM password_resets
            WHERE user_id = ? AND otp = ? AND used = 0
            ORDER BY created_at DESC
            LIMIT 1
        """, (user["id"], clean_otp))
        row = cursor.fetchone()
        if not row:
            return None
        now = datetime.now().isoformat()
        if now > row["expires_at"]:
            return None
        return dict(row)

def mark_password_reset_used(reset_id: str):
    with get_connection() as conn:
        conn.execute("UPDATE password_resets SET used = 1 WHERE id = ?", (reset_id,))
        conn.commit()

DEFAULT_OWNER = {
    "id": "usr-owner-ishu",
    "name": "Ishu Jindal",
    "username": "ishujindal",
    "email": "ishu.jindal@durasmart.com",
    "phone": "+91 98140 10001",
    "role": "owner",
    "department": "Management",
    "employee_id": "OWNER-01",
    "sales_territory": "Executive / All Territories",
    "password": "Ishu@DuraSmart#2026"
}

DEFAULT_HRPB_EMPLOYEES = [
    {"emp_id": "EMP-SP-01", "name": "AJAY JI", "username": "ajay.ji", "email": "ajay.ji@durasmart.com", "phone": "9814010000", "territory": "Punjab/Haryana"},
    {"emp_id": "EMP-SP-02", "name": "Aksit", "username": "aksit", "email": "aksit@durasmart.com", "phone": "9814010001", "territory": "Punjab/Haryana"},
    {"emp_id": "EMP-SP-03", "name": "GAURAV JI", "username": "gaurav.ji", "email": "gaurav.ji@durasmart.com", "phone": "9814010002", "territory": "Punjab/Haryana"},
    {"emp_id": "EMP-SP-04", "name": "JAGDEEP 2/ Aakash Kumar", "username": "aakash.kumar", "email": "aakash.kumar@durasmart.com", "phone": "9814010003", "territory": "Punjab/Haryana"},
    {"emp_id": "EMP-SP-05", "name": "JAGDEEP 3/ Dalip Kumar", "username": "dalip.kumar", "email": "dalip.kumar@durasmart.com", "phone": "9814010004", "territory": "Punjab/Haryana"},
    {"emp_id": "EMP-SP-06", "name": "Jagdeep Singh", "username": "jagdeep.singh", "email": "jagdeep.singh@durasmart.com", "phone": "9814010005", "territory": "Punjab/Haryana"},
    {"emp_id": "EMP-SP-07", "name": "Mozi Ram", "username": "mozi.ram", "email": "mozi.ram@durasmart.com", "phone": "9814010006", "territory": "Punjab/Haryana"},
    {"emp_id": "EMP-SP-08", "name": "PANKAJ JI", "username": "pankaj.ji", "email": "pankaj.ji@durasmart.com", "phone": "9814010007", "territory": "Punjab/Haryana"},
    {"emp_id": "EMP-SP-09", "name": "Pankaj Goyal", "username": "pankaj.goyal", "email": "pankaj.goyal@durasmart.com", "phone": "9814010008", "territory": "Punjab/Haryana"},
    {"emp_id": "EMP-SP-10", "name": "SANDEEP2/Mozi Ram", "username": "sandeep2", "email": "sandeep2@durasmart.com", "phone": "9814010009", "territory": "Punjab/Haryana"},
    {"emp_id": "EMP-SP-11", "name": "Sandeep Mahajan", "username": "sandeep.mahajan", "email": "sandeep.mahajan@durasmart.com", "phone": "9814010010", "territory": "Punjab/Haryana"},
    {"emp_id": "EMP-SP-12", "name": "Suresh Jindal", "username": "suresh.jindal", "email": "suresh.jindal@durasmart.com", "phone": "9814010011", "territory": "Punjab/Haryana"},
    {"emp_id": "EMP-SP-13", "name": "VIJAY JI", "username": "vijay.ji", "email": "vijay.ji@durasmart.com", "phone": "9814010012", "territory": "Punjab/Haryana"},
]
DEFAULT_EMPLOYEE_PASSWORD = "DuraSmart@2026"

def seed_real_users(force: bool = False):
    """Ensures Owner Ishu Jindal and the 13 real HR-PB sales officers exist with secure hashed passwords."""
    with get_connection() as conn:
        now = datetime.now().isoformat()
        # Seed Owner
        pwd_hash, salt = hash_password(DEFAULT_OWNER["password"])
        conn.execute("""
            INSERT INTO users (
                id, username, email, phone, name, password_hash, salt,
                role, department, employee_id, sales_territory, active, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                username=excluded.username,
                email=excluded.email,
                name=excluded.name,
                password_hash=excluded.password_hash,
                salt=excluded.salt,
                role=excluded.role,
                department=excluded.department,
                employee_id=excluded.employee_id,
                sales_territory=excluded.sales_territory,
                updated_at=excluded.updated_at
        """, (
            DEFAULT_OWNER["id"],
            DEFAULT_OWNER["username"],
            DEFAULT_OWNER["email"],
            DEFAULT_OWNER["phone"],
            DEFAULT_OWNER["name"],
            pwd_hash,
            salt,
            DEFAULT_OWNER["role"],
            DEFAULT_OWNER["department"],
            DEFAULT_OWNER["employee_id"],
            DEFAULT_OWNER["sales_territory"],
            now,
            now
        ))

        # Seed master owner invitation code for signup
        cur = conn.cursor()
        cur.execute("SELECT code FROM invitations WHERE code = 'OWNER-DURASMART-2026'")
        if not cur.fetchone():
            cur.execute("""
                INSERT INTO invitations (
                    id, code, role, department, employee_id, sales_territory,
                    monthly_target_qty, target_unit, may_dispatch, status,
                    used_count, max_uses, expires_at, created_by, created_at
                ) VALUES (
                    'inv-owner-master', 'OWNER-DURASMART-2026', 'owner', 'Management',
                    'EMP-OWNER-01', 'All', 1000.0, 'MT', 1, 'active',
                    0, 999999, '2030-12-31T23:59:59', 'SYSTEM', ?
                )
            """, (now,))

        # Seed 13 Real Sales Officers with secure hashed passwords
        emp_pwd_hash, emp_salt = hash_password(DEFAULT_EMPLOYEE_PASSWORD)
        for emp in DEFAULT_HRPB_EMPLOYEES:
            emp_id = emp["emp_id"]
            cur.execute("SELECT id FROM users WHERE lower(employee_id) = lower(?)", (emp_id,))
            existing_user = cur.fetchone()
            user_id = existing_user[0] if existing_user else f"usr-{emp_id.lower()}"
            conn.execute("""
                INSERT INTO users (
                    id, username, email, phone, name, password_hash, salt,
                    role, department, employee_id, sales_territory, active, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'employee', 'Sales', ?, ?, 1, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    username=excluded.username,
                    email=excluded.email,
                    name=excluded.name,
                    password_hash=excluded.password_hash,
                    salt=excluded.salt,
                    role=excluded.role,
                    department=excluded.department,
                    employee_id=excluded.employee_id,
                    sales_territory=excluded.sales_territory,
                    updated_at=excluded.updated_at
            """, (
                user_id,
                emp["username"],
                emp["email"],
                emp["phone"],
                emp["name"],
                emp_pwd_hash,
                emp_salt,
                emp_id,
                emp["territory"],
                now,
                now
            ))

        # Purge any dummy placeholder users from users table (preserving real sales officers)
        conn.execute("""
            DELETE FROM users 
            WHERE (
                (email LIKE '%@durasmart.com' AND email NOT IN ('ishu.jindal@durasmart.com', 'babri3726@gmail.com') AND (employee_id IS NULL OR employee_id NOT LIKE 'EMP-SP-%'))
                OR email LIKE '%@example.test'
                OR email LIKE '%@demo.test'
                OR username LIKE 'test%'
                OR username LIKE 'user_%'
                OR username IN ('harpreet', 'dummy', 'admin', 'md', 'director', 'demo')
            )
        """)
        conn.commit()

def save_tour_plan(plan: dict[str, Any]) -> dict[str, Any]:
    from server.geo_coordinates import get_coordinates_for_location
    now = datetime.now().isoformat()
    plan_id = plan.get("id") or f"TOUR-{datetime.now().strftime('%Y%m%d%H%M%S')}"
    plan["id"] = plan_id
    sp_id = plan.get("salespersonId", "")
    sp_name = plan.get("salespersonName", "Area Sales Officer")
    date_str = plan.get("date") or datetime.now().strftime("%Y-%m-%d")
    area_name = plan.get("areaName") or plan.get("area", "")
    notes = plan.get("notes", "")
    status = plan.get("status", "pending")

    with get_connection() as conn:
        conn.execute("""
            INSERT OR REPLACE INTO tour_plans
            (id, salesperson_id, salesperson_name, date, area_name, notes, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM tour_plans WHERE id = ?), ?), ?)
        """, (plan_id, sp_id, sp_name, date_str, area_name, notes, status, plan_id, now, now))

        conn.execute("DELETE FROM tour_visits WHERE plan_id = ?", (plan_id,))

        visits = plan.get("visits", [])
        saved_visits = []
        for idx, v in enumerate(visits):
            v_id = v.get("id") or f"VISIT-{plan_id[-6:]}-{idx+1:02d}"
            v["id"] = v_id
            v["planId"] = plan_id
            v["sequence"] = v.get("sequence", idx + 1)
            city = v.get("city", "")
            district = v.get("district", "")
            purpose = v.get("purpose", "Order Booking & Relationship")
            v_status = v.get("status", "planned")
            v_notes = v.get("notes", "")
            
            lat = v.get("gpsLat") or v.get("gps_lat")
            lng = v.get("gpsLng") or v.get("gps_lng")
            if lat is None or lng is None:
                lat, lng = get_coordinates_for_location(city, district)
            v["gpsLat"] = lat
            v["gpsLng"] = lng

            conn.execute("""
                INSERT INTO tour_visits
                (id, plan_id, customer_id, customer_name, city, district, sequence, purpose, status, notes, gps_lat, gps_lng, completed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                v_id, plan_id, v.get("customerId", ""), v.get("customerName", "Dealer Shop"),
                city, district, v["sequence"], purpose, v_status, v_notes,
                lat, lng, v.get("completedAt")
            ))
            saved_visits.append(v)

        conn.commit()

    plan["visits"] = saved_visits
    return plan

def get_tour_plans(
    salesperson_id: str | None = None,
    date: str | None = None,
    status: str | None = None,
) -> list[dict[str, Any]]:
    with get_connection() as conn:
        cur = conn.cursor()
        query = "SELECT * FROM tour_plans WHERE 1=1"
        params: list[Any] = []
        if salesperson_id:
            query += " AND salesperson_id = ?"
            params.append(salesperson_id)
        if date:
            query += " AND date = ?"
            params.append(date)
        if status:
            query += " AND status = ?"
            params.append(status)
        query += " ORDER BY date DESC, created_at DESC"

        cur.execute(query, params)
        plan_rows = [dict(r) for r in cur.fetchall()]

        results = []
        for p in plan_rows:
            p_id = p["id"]
            cur.execute("SELECT * FROM tour_visits WHERE plan_id = ? ORDER BY sequence ASC", (p_id,))
            visits = [
                {
                    "id": vr["id"],
                    "planId": vr["plan_id"],
                    "customerId": vr["customer_id"],
                    "customerName": vr["customer_name"],
                    "city": vr["city"],
                    "district": vr["district"],
                    "sequence": vr["sequence"],
                    "purpose": vr["purpose"],
                    "status": vr["status"],
                    "notes": vr["notes"],
                    "gpsLat": vr["gps_lat"],
                    "gpsLng": vr["gps_lng"],
                    "completedAt": vr["completed_at"],
                }
                for vr in cur.fetchall()
            ]
            results.append({
                "id": p["id"],
                "salespersonId": p["salesperson_id"],
                "salespersonName": p["salesperson_name"],
                "date": p["date"],
                "areaName": p["area_name"],
                "area": p["area_name"],
                "notes": p["notes"],
                "status": p["status"],
                "createdAt": p["created_at"],
                "updatedAt": p["updated_at"],
                "visits": visits,
            })
        return results

def get_tour_plan_by_id(plan_id: str) -> dict[str, Any] | None:
    plans = get_tour_plans()
    for p in plans:
        if p["id"] == plan_id:
            return p
    return None

def delete_tour_plan(plan_id: str) -> bool:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM tour_visits WHERE plan_id = ?", (plan_id,))
        cur.execute("DELETE FROM tour_plans WHERE id = ?", (plan_id,))
        deleted = cur.rowcount > 0
        conn.commit()
    return deleted

def update_tour_visit_status(
    plan_id: str,
    visit_id: str,
    status: str,
    notes: str | None = None,
) -> dict[str, Any] | None:
    now = datetime.now().isoformat()
    with get_connection() as conn:
        cur = conn.cursor()
        completed_at = now if status == "completed" else None
        if notes is not None:
            cur.execute("""
                UPDATE tour_visits 
                SET status = ?, notes = ?, completed_at = COALESCE(?, completed_at)
                WHERE plan_id = ? AND id = ?
            """, (status, notes, completed_at, plan_id, visit_id))
        else:
            cur.execute("""
                UPDATE tour_visits 
                SET status = ?, completed_at = COALESCE(?, completed_at)
                WHERE plan_id = ? AND id = ?
            """, (status, completed_at, plan_id, visit_id))

        if cur.rowcount == 0:
            return None

        cur.execute("SELECT status FROM tour_visits WHERE plan_id = ?", (plan_id,))
        statuses = [r[0] for r in cur.fetchall()]
        if statuses and all(s == "completed" for s in statuses):
            cur.execute("UPDATE tour_plans SET status = 'completed', updated_at = ? WHERE id = ?", (now, plan_id))
        elif any(s == "completed" for s in statuses):
            cur.execute("UPDATE tour_plans SET status = 'in_progress', updated_at = ? WHERE id = ?", (now, plan_id))

        conn.commit()

    return get_tour_plan_by_id(plan_id)

def seed_default_tour_plans() -> int:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM tour_plans")
        if cur.fetchone()[0] > 0:
            return 0

    today = datetime.now().strftime("%Y-%m-%d")
    tomorrow = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")

    seeds = [
        {
            "id": f"TOUR-{today.replace('-', '')}-01",
            "salespersonId": "EMP-SP-01",
            "salespersonName": "AJAY JI",
            "date": today,
            "areaName": "Sirsa - Dabwali Daily Beat",
            "notes": "Payment collection & dealer relationship visit",
            "status": "in_progress",
            "visits": [
                {
                    "customerId": "DEBTOR-HR-001",
                    "customerName": "DOORKRM SIRSA ENTERPRISES (GOYAL AGROTECH) SIRSA",
                    "city": "Sirsa",
                    "district": "SIRSA",
                    "purpose": "Payment collection & stock review",
                    "sequence": 1,
                    "status": "completed",
                    "notes": "Collected ₹25,000 cheque; stock adequate"
                },
                {
                    "customerId": "DEBTOR-HR-005",
                    "customerName": "GOYAL AGROTECH (GOYAL AGROTECH) DABWALI",
                    "city": "Dabwali",
                    "district": "SIRSA",
                    "purpose": "Monthly review & target booking",
                    "sequence": 2,
                    "status": "planned"
                }
            ]
        },
        {
            "id": f"TOUR-{today.replace('-', '')}-02",
            "salespersonId": "EMP-SP-07",
            "salespersonName": "Mozi Ram",
            "date": today,
            "areaName": "Dera Bassi - Mohali Beat",
            "notes": "Industrial dealer survey and color profile pitch",
            "status": "pending",
            "visits": [
                {
                    "customerId": "DEBTOR-HR-001",
                    "customerName": "KALRA TRADERS/ STEEL DERABASSI",
                    "city": "Dera Bassi",
                    "district": "MOHALI",
                    "purpose": "New profile sample presentation",
                    "sequence": 1,
                    "status": "planned"
                }
            ]
        },
        {
            "id": f"TOUR-{tomorrow.replace('-', '')}-03",
            "salespersonId": "EMP-SP-01",
            "salespersonName": "AJAY JI",
            "date": tomorrow,
            "areaName": "Hisar - Agroha Upcoming Beat",
            "notes": "Upcoming tour plan scheduled for Agroha commercial zone",
            "status": "pending",
            "visits": [
                {
                    "customerId": "DEBTOR-HR-010",
                    "customerName": "ARUL STEEL PRIVATE LTD AGROHA",
                    "city": "HISAR",
                    "district": "Agroha",
                    "purpose": "Contract renewal & dispatch planning",
                    "sequence": 1,
                    "status": "planned"
                }
            ]
        }
    ]

    count = 0
    for s in seeds:
        save_tour_plan(s)
        count += 1
    return count

def save_task(task: dict[str, Any]) -> dict[str, Any]:
    now = datetime.now().isoformat()
    task_id = task.get("id") or f"TASK-{datetime.now().strftime('%Y%m%d%H%M%S')}"
    task["id"] = task_id
    title = task.get("title", "Work Assignment")
    description = task.get("description", "")
    emp_id = task.get("assignedEmployeeId", "")
    emp_name = task.get("assignedEmployeeName", "")
    due_date = task.get("dueDate") or datetime.now().strftime("%Y-%m-%d")
    due_time = task.get("dueTime", "18:00")
    due_at = task.get("dueAt") or f"{due_date}T{due_time}:00"
    priority = task.get("priority", "normal")
    requires_photo = 1 if task.get("requiresPhoto") else 0
    status = task.get("status", "open")
    created_by = task.get("createdBy", "Owner")
    created_at = task.get("createdAt") or now

    with get_connection() as conn:
        conn.execute("""
            INSERT OR REPLACE INTO tasks
            (id, title, description, assigned_employee_id, assigned_employee_name,
             due_date, due_time, due_at, priority, requires_photo, status,
             created_by, created_at, completed_at, completion_notes, alarm_triggered)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM tasks WHERE id = ?), ?), ?, ?, ?)
        """, (
            task_id, title, description, emp_id, emp_name,
            due_date, due_time, due_at, priority, requires_photo, status,
            created_by, task_id, created_at, task.get("completedAt"), task.get("completionNotes", ""),
            1 if task.get("alarmTriggered") else 0
        ))
        conn.commit()

    task["createdAt"] = created_at
    task["dueAt"] = due_at
    task["dueDate"] = due_date
    task["dueTime"] = due_time
    task["priority"] = priority
    task["status"] = status
    task["requiresPhoto"] = bool(requires_photo)
    task["assignedEmployeeId"] = emp_id
    task["assignedEmployeeName"] = emp_name
    return task

def get_tasks(
    employee_id: str | None = None,
    status: str | None = None,
    priority: str | None = None,
) -> list[dict[str, Any]]:
    now = datetime.now()
    now_iso = now.isoformat()
    today_str = now.strftime("%Y-%m-%d")

    with get_connection() as conn:
        cur = conn.cursor()
        query = "SELECT * FROM tasks WHERE 1=1"
        params: list[Any] = []
        if employee_id and employee_id != "all":
            query += " AND assigned_employee_id = ?"
            params.append(employee_id)
        if priority and priority != "all":
            query += " AND priority = ?"
            params.append(priority)
        
        query += " ORDER BY due_at ASC, priority DESC"
        cur.execute(query, params)
        rows = [dict(r) for r in cur.fetchall()]

        results = []
        for r in rows:
            is_overdue = r["status"] != "completed" and r["due_at"] < now_iso
            is_today = r["due_date"] == today_str
            is_pending = r["status"] in ["open", "acknowledged"]

            if status:
                st = status.lower()
                if st == "today" and (not is_today or r["status"] == "completed"):
                    continue
                elif st == "pending" and not is_pending:
                    continue
                elif st == "completed" and r["status"] != "completed":
                    continue
                elif st == "overdue" and not is_overdue:
                    continue

            results.append({
                "id": r["id"],
                "title": r["title"],
                "description": r["description"],
                "assignedEmployeeId": r["assigned_employee_id"],
                "assignedEmployeeName": r["assigned_employee_name"],
                "dueDate": r["due_date"],
                "dueTime": r["due_time"],
                "dueAt": r["due_at"],
                "priority": r["priority"],
                "requiresPhoto": bool(r["requires_photo"]),
                "status": r["status"],
                "createdBy": r["created_by"],
                "createdAt": r["created_at"],
                "completedAt": r["completed_at"],
                "completionNotes": r["completion_notes"],
                "alarmTriggered": bool(r["alarm_triggered"]),
                "isOverdue": is_overdue,
                "isToday": is_today,
            })
        return results

def get_task_by_id(task_id: str) -> dict[str, Any] | None:
    tasks = get_tasks()
    for t in tasks:
        if t["id"] == task_id:
            return t
    return None

def delete_task(task_id: str) -> bool:
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        deleted = cur.rowcount > 0
        conn.commit()
    return deleted

def update_task_status(
    task_id: str,
    status: str,
    notes: str | None = None,
) -> dict[str, Any] | None:
    now = datetime.now().isoformat()
    completed_at = now if status == "completed" else None
    with get_connection() as conn:
        cur = conn.cursor()
        if notes is not None:
            cur.execute("""
                UPDATE tasks 
                SET status = ?, completion_notes = ?, completed_at = COALESCE(?, completed_at)
                WHERE id = ?
            """, (status, notes, completed_at, task_id))
        else:
            cur.execute("""
                UPDATE tasks 
                SET status = ?, completed_at = COALESCE(?, completed_at)
                WHERE id = ?
            """, (status, completed_at, task_id))

        if cur.rowcount == 0:
            return None
        conn.commit()

    return get_task_by_id(task_id)

def get_due_alarm_tasks(employee_id: str | None = None) -> list[dict[str, Any]]:
    now_iso = datetime.now().isoformat()
    with get_connection() as conn:
        cur = conn.cursor()
        query = "SELECT * FROM tasks WHERE status != 'completed' AND due_at <= ?"
        params: list[Any] = [now_iso]
        if employee_id and employee_id != "all":
            query += " AND assigned_employee_id = ?"
            params.append(employee_id)
        query += " ORDER BY due_at ASC"
        cur.execute(query, params)
        rows = [dict(r) for r in cur.fetchall()]

        return [
            {
                "id": r["id"],
                "title": r["title"],
                "description": r["description"],
                "assignedEmployeeId": r["assigned_employee_id"],
                "assignedEmployeeName": r["assigned_employee_name"],
                "dueAt": r["due_at"],
                "priority": r["priority"],
                "status": r["status"],
                "isOverdue": True,
            }
            for r in rows
        ]

def seed_default_tasks() -> int:
    """No dummy tasks seeded; tasks are created exclusively by the owner/dispatch."""
    return 0

# Ensure schema tables exist and real users are seeded
try:
    init_db()
    seed_real_users()
    seed_default_tour_plans()
    seed_default_tasks()
except Exception:
    pass


