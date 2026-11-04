import base64
import hashlib
import os
import re
import secrets
import sqlite3
import uuid
from datetime import datetime
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
        """)

        # Schema migrations
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
        ]:
            try:
                conn.execute(query)
            except Exception:
                pass

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
                        d.get("salespersonId", "EMP-SP-01"),
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
        cur.execute("SELECT * FROM parties ORDER BY name ASC")
        parties = cur.fetchall()

        debtors = []
        seen_debtor_names = set()
        for p in parties:
            bal_paise = p["balance_paise"] or 0
            bal_rupees = round(bal_paise / 100.0, 2)
            norm_name = (p["name"] or "").strip().lower()
            if norm_name not in seen_debtor_names:
                seen_debtor_names.add(norm_name)
                d_row = {
                    "id": p["id"],
                    "name": p["name"],
                    "state": p["state"],
                    "city": p["city"],
                    "district": p["district"],
                    "salesperson": p["salesperson"],
                    "salespersonId": p["salesperson_id"] or "EMP-SP-01",
                    "mobile": p["mobile"] or "9814000000",
                    "balance": bal_rupees,
                    "balance_formatted": f"{bal_rupees:.2f}",
                    "creditDays": p["credit_days"] or 30,
                    "status": p["status"] or "active",
                    "contactPerson": p["name"],
                    "source": "database",
                    "openingPaise": 0,
                    "outstandingPaise": bal_paise,
                    "advancePaise": 0,
                    "unbilledValuePaise": 0,
                    "overduePaise": bal_paise if p["status"] == "active" else 0,
                    "isOverdue": bal_paise > 0,
                    "invoiceCount": 0,
                    "orderCount": 0,
                    "lastPaymentDate": None,
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
            if c_id in opening_balances:
                for ob in opening_balances[c_id]:
                    if ob["direction"] == "owes":
                        cust["openingPaise"] = cust.get("openingPaise", 0) + ob["amountPaise"]
                        cust["outstandingPaise"] = cust.get("outstandingPaise", 0) + ob["amountPaise"]
                    else:
                        cust["advancePaise"] = cust.get("advancePaise", 0) + ob["amountPaise"]

        stock_movements = load_stock_movements()

        return {
            "debtors": debtors,
            "customers": customers,
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

        # Seed 13 HR-PB Employees
        for emp in DEFAULT_HRPB_EMPLOYEES:
            e_id = f"usr-{emp['emp_id'].lower()}"
            e_pwd_hash, e_salt = hash_password(DEFAULT_EMPLOYEE_PASSWORD)
            conn.execute("""
                INSERT INTO users (
                    id, username, email, phone, name, password_hash, salt,
                    role, department, employee_id, sales_territory, active, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'employee', 'Sales', ?, ?, 1, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    username=excluded.username,
                    email=excluded.email,
                    name=excluded.name,
                    employee_id=excluded.employee_id,
                    sales_territory=excluded.sales_territory,
                    updated_at=excluded.updated_at
            """, (
                e_id,
                emp["username"],
                emp["email"],
                emp["phone"],
                emp["name"],
                e_pwd_hash,
                e_salt,
                emp["emp_id"],
                emp["territory"],
                now,
                now
            ))

        # Purge any dummy placeholder users
        conn.execute("""
            DELETE FROM users 
            WHERE username IN ('harpreet', 'dummy', 'admin', 'md', 'director', 'demo')
               OR email LIKE '%@example.test'
        """)
        conn.commit()

# Ensure schema tables exist and real users are seeded
try:
    init_db()
    seed_real_users()
except Exception:
    pass


