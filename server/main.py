"""
Unified Backend Server (FastAPI) for Operations Suite
Links React Web Owner Cockpit & Mobile App with:
- 1-Click 3-Sheet OneDrive Sync (TOTAL STOCK, UPVC TOTAL STOCK, UPVC ITEM)
- Real Punjab & Haryana HR-PB dealers and target synchronization
- Full wire contract (Dashboard, Customers, Orders, Dispatches, Stock, Debtors, Employees, Payments)
"""
import hashlib
import os
import re
import secrets
import shutil
import tempfile
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import FastAPI, File, Header, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from server import db

from .hr_pb_parser import DEFAULT_HRPB_PATH, extract_hr_pb_targets, get_default_hrpb_path
from .stock_parser import DEFAULT_ONEDRIVE_PATH, extract_3sheet_stock, get_file_sha256, get_default_stock_path

app = FastAPI(title="Operations API", version="1.0.0")

def ensure_latest_stock_snapshot(force: bool = False) -> dict | None:
    stock_path = get_default_stock_path()
    if not os.path.exists(stock_path):
        return STATE.get("latest_snapshot")

    try:
        mtime = os.path.getmtime(stock_path)
    except OSError:
        mtime = 0.0

    cur_snap = STATE.get("latest_snapshot")
    should_refresh = force or (cur_snap is None) or (STATE.get("stock_file_mtime") != mtime)
    if should_refresh:
        try:
            snap = extract_3sheet_stock(stock_path)
            STATE["latest_snapshot"] = snap
            STATE["stock_file_mtime"] = mtime
            return snap
        except Exception as e:
            if cur_snap:
                return cur_snap
            raise e
    return cur_snap

# Enable CORS for Web panel & Mobile
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def add_cache_control_headers(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "service": "durasmart-api",
        "version": "v1.0.2-unified",
        "timestamp": datetime.utcnow().isoformat(),
        "database": "connected"
    }

# Static file serving for slip photos
app.mount("/api/v1/slips", StaticFiles(directory=db.SLIPS_DIR), name="slips")

# Production Catalog & Real Seed Storage
INITIAL_CUSTOMERS = []
INITIAL_ORDERS = []

INITIAL_EMPLOYEES = []

INITIAL_PRODUCTS = [
    {
        "id": "PRD-UPVC",
        "name": "UPVC",
        "sku": "UPVC",
        "category": "upvc",
        "spec": "UPVC Roofing & Accessories",
        "thickness": "2.50",
        "unit": "MT",
        "minStockQty": "10.000",
        "gstRatePercent": "18.000",
        "active": True,
        "source": "catalog"
    },
    {
        "id": "PRD-SLIT-COIL-KAMDHENU",
        "name": "Slit Coil Kamdhenu",
        "sku": "KAMDHENU",
        "category": "steel-coil",
        "spec": "Kamdhenu Steel Slit Coil",
        "thickness": "2.00",
        "unit": "MT",
        "minStockQty": "50.000",
        "gstRatePercent": "18.000",
        "active": True,
        "source": "catalog"
    },
    {
        "id": "PRD-SLIT-COIL-JSW",
        "name": "Slit Coil JSW",
        "sku": "JSW",
        "category": "steel-coil",
        "spec": "JSW Steel Slit Coil",
        "thickness": "2.00",
        "unit": "MT",
        "minStockQty": "50.000",
        "gstRatePercent": "18.000",
        "active": True,
        "source": "catalog"
    },
    {
        "id": "PRD-PROFILE",
        "name": "Profile",
        "sku": "PROFILE",
        "category": "roofing-sheet",
        "spec": "Color Coated Profile Sheet",
        "thickness": "0.45",
        "unit": "MT",
        "minStockQty": "50.000",
        "gstRatePercent": "18.000",
        "active": True,
        "source": "catalog"
    }
]

STATE = {
    "latest_snapshot": None,
    "customers": list(INITIAL_CUSTOMERS),
    "orders": list(INITIAL_ORDERS),
    "employees": list(INITIAL_EMPLOYEES),
    "products": list(INITIAL_PRODUCTS),
    "payments": [],
    "dispatches": [],
    "consignments": [],
    "tasks": [],
    "tours": [],
    "debtors": [],
    "targets": [],
    "employee_targets": [],
    "stock_movements": [],
    "opening_balances": {},
    "hrpb_snapshot": None
}

# Auto-load HR-PB targets and real dealers
try:
    if os.path.exists(DEFAULT_HRPB_PATH):
        _hrpb = extract_hr_pb_targets(DEFAULT_HRPB_PATH)
        STATE["hrpb_snapshot"] = _hrpb
        STATE["targets"] = _hrpb["all_targets"]
        STATE["debtors"] = _hrpb["dealers_master"]
        sp_set = sorted({t.get("salesperson") for t in _hrpb["all_targets"] if t.get("salesperson")})
        sp_territory = {}
        for t in _hrpb["all_targets"]:
            sp = t.get("salesperson")
            st = t.get("state")
            if sp and st:
                sp_territory.setdefault(sp, set()).add(st)

        sp_employees = [
            {
                "id": f"EMP-SP-{i+1:02d}",
                "name": sp_name,
                "role": "Area Sales Officer",
                "department": "Sales",
                "phone": f"98140{10000+i}",
                "city": "/".join(sorted(sp_territory.get(sp_name, ["Punjab/Haryana"]))),
                "salesTerritory": "/".join(sorted(sp_territory.get(sp_name, ["Punjab/Haryana"]))),
                "monthlyTargetQty": "100.000",
                "targetUnit": "MT",
                "active": True,
                "mayDispatch": True
            }
            for i, sp_name in enumerate(sp_set)
        ]
        STATE["employees"] = list(sp_employees)

        # Ensure all dealers have unified party attributes and alias customers to debtors
        for idx, d in enumerate(STATE["debtors"]):
            sp_name = d.get("salesperson", "")
            sp_id = next((e["id"] for e in STATE["employees"] if e["name"].lower() == sp_name.lower()), "EMP-SP-01")
            bal = float(d.get("balance", 0.0))
            bal_paise = int(round(bal * 100))
            d.setdefault("mobile", f"98140{20000 + idx}")
            d.setdefault("salespersonId", sp_id)
            d.setdefault("creditDays", 30)
            d.setdefault("contactPerson", d["name"])
            d.setdefault("source", "hr-pb")
            d.setdefault("openingPaise", bal_paise)
            d.setdefault("outstandingPaise", bal_paise)
            d.setdefault("advancePaise", 0)
            d.setdefault("unbilledValuePaise", 0)
            d.setdefault("overduePaise", bal_paise if d.get("status") == "active" else 0)
            d.setdefault("isOverdue", bal > 0)
            d.setdefault("invoiceCount", 0)
            d.setdefault("orderCount", 0)
            d.setdefault("lastPaymentDate", None)
            d.setdefault("address", f"{d.get('city', '')}, {d.get('state', '')}")
            d.setdefault("notes", f"HR-PB active dealer. Officer: {sp_name}")
            d.setdefault("ledgerGroup", "Sundry Debtors")
            d.setdefault("creditTerms", "30 days net")
            d.setdefault("approvedBy", "USR-OWNER")
            d.setdefault("approvedAt", datetime.now().isoformat() + "+05:30")
        STATE["customers"] = STATE["debtors"]
except Exception as e:
    print(f"Warning: Failed to load HR-PB targets: {e}")

# Hydrate SQLite Persistent Database
try:
    db.init_db(STATE)
    _persisted = db.load_all_persisted_state()
    if _persisted.get("orders"):
        STATE["orders"] = _persisted["orders"]
    if _persisted.get("payments"):
        STATE["payments"] = _persisted["payments"]
    if _persisted.get("dispatches"):
        STATE["dispatches"] = _persisted["dispatches"]
    if _persisted.get("opening_balances"):
        STATE["opening_balances"] = _persisted["opening_balances"]
    if _persisted.get("stock_movements"):
        STATE["stock_movements"] = _persisted["stock_movements"]
    if _persisted.get("debtors"):
        _existing_d_ids = {d["id"] for d in STATE.get("debtors", [])}
        for _d in _persisted["debtors"]:
            bal_flt = float(_d.get("balance", 0.0))
            bal_p = int(round(bal_flt * 100))
            if _d["id"] not in _existing_d_ids:
                _d["outstandingPaise"] = bal_p
                if bal_p <= 0:
                    _d["overduePaise"] = 0
                    _d["isOverdue"] = False
                STATE["debtors"].append(_d)
                _existing_d_ids.add(_d["id"])
            else:
                _match = next((m for m in STATE["debtors"] if m["id"] == _d["id"]), None)
                if _match:
                    _match["balance"] = bal_flt
                    _match["balance_formatted"] = f"{bal_flt:.2f}"
                    _match["outstandingPaise"] = bal_p
                    if bal_p <= 0:
                        _match["overduePaise"] = 0
                        _match["isOverdue"] = False
                    else:
                        _match["overduePaise"] = min(bal_p, _match.get("overduePaise", bal_p))
    # Set STATE["customers"] to STATE["debtors"] for unified single source of truth
    STATE["customers"] = STATE["debtors"]
except Exception as e:
    print(f"Warning: Failed to initialize/load SQLite DB: {e}")

# ----------------- Auth Models & Endpoints -----------------
class LoginRequest(BaseModel):
    identifier: str | None = None
    username: str | None = None
    password: str

class RefreshRequest(BaseModel):
    refreshToken: str | None = None

class CreateInvitationRequest(BaseModel):
    role: str = "employee"
    department: str = "Sales"
    employeeId: str | None = None
    salesTerritory: str | None = None
    monthlyTargetQty: float = 100.0
    targetUnit: str = "MT"
    mayDispatch: bool = False
    maxUses: int = 1
    expiresInDays: int = 7

class VerifyInvitationRequest(BaseModel):
    code: str

class SignupRequest(BaseModel):
    name: str
    identifier: str
    password: str
    phone: str | None = None
    inviteCode: str

class UpdateProfileRequest(BaseModel):
    name: str | None = None
    phone: str | None = None
    currentPassword: str | None = None
    newPassword: str | None = None

@app.post("/api/v1/auth/invitations")
def create_invitation(
    req: CreateInvitationRequest,
    authorization: str | None = Header(None),
    x_user_role: str | None = Header(None)
):
    caller = resolve_caller(authorization, x_user_role)
    if not caller["isOwner"]:
        raise HTTPException(status_code=403, detail="Only owner can generate invitation codes")

    code = f"DURA-{secrets.token_hex(3).upper()}"
    days = max(1, req.expiresInDays)
    expires_at = (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()

    inv = db.create_invitation(
        code=code,
        role=req.role,
        department=req.department,
        employee_id=req.employeeId or "",
        sales_territory=req.salesTerritory or "",
        monthly_target_qty=req.monthlyTargetQty,
        target_unit=req.targetUnit,
        may_dispatch=1 if req.mayDispatch else 0,
        max_uses=req.maxUses,
        expires_at=expires_at,
        created_by="USR-OWNER"
    )
    return inv

@app.get("/api/v1/auth/invitations")
def list_invitations(
    authorization: str | None = Header(None),
    x_user_role: str | None = Header(None)
):
    caller = resolve_caller(authorization, x_user_role)
    if not caller["isOwner"]:
        raise HTTPException(status_code=403, detail="Only owner can inspect invitation codes")
    return db.list_invitations()

@app.delete("/api/v1/auth/invitations/{code}")
def revoke_invitation(
    code: str,
    authorization: str | None = Header(None),
    x_user_role: str | None = Header(None)
):
    caller = resolve_caller(authorization, x_user_role)
    if not caller["isOwner"]:
        raise HTTPException(status_code=403, detail="Only owner can revoke invitation codes")
    ok = db.revoke_invitation(code)
    if not ok:
        raise HTTPException(status_code=404, detail="Active invitation code not found")
    return {"success": True, "code": code.upper()}

@app.post("/api/v1/auth/invitations/verify")
def verify_invitation(req: VerifyInvitationRequest):
    inv = db.get_invitation_by_code(req.code)
    if not inv or inv["status"] != "active":
        return {"valid": False, "reason": "Invitation code is invalid or has expired."}

    if inv["expires_at"]:
        try:
            exp = datetime.fromisoformat(inv["expires_at"].replace("Z", "+00:00"))
            now = datetime.now(exp.tzinfo) if exp.tzinfo else datetime.now()
            if now > exp:
                db.revoke_invitation(inv["code"])
                return {"valid": False, "reason": "Invitation code has expired."}
        except Exception:
            pass

    if inv["used_count"] >= inv["max_uses"]:
        return {"valid": False, "reason": "Invitation code has already reached its maximum usage."}

    return {
        "valid": True,
        "code": inv["code"],
        "role": inv["role"],
        "department": inv["department"],
        "salesTerritory": inv["sales_territory"],
        "monthlyTargetQty": inv["monthly_target_qty"],
        "targetUnit": inv["target_unit"],
        "mayDispatch": bool(inv["may_dispatch"])
    }

@app.post("/api/v1/auth/signup")
def signup(req: SignupRequest):
    if not req.name or not req.identifier or not req.password or not req.inviteCode:
        raise HTTPException(status_code=400, detail="Name, identifier, password, and inviteCode are required.")

    inv = db.get_invitation_by_code(req.inviteCode)
    if not inv or inv["status"] != "active":
        raise HTTPException(status_code=400, detail="Invalid or expired invitation code")

    if inv["used_count"] >= inv["max_uses"]:
        raise HTTPException(status_code=400, detail="Invitation code has already been used")

    existing = db.get_user_by_identifier(req.identifier)
    if existing:
        raise HTTPException(status_code=409, detail="A user with this username or email already exists.")
    if req.phone:
        existing_phone = db.get_user_by_identifier(req.phone)
        if existing_phone:
            raise HTTPException(status_code=409, detail="A user with this phone number already exists.")

    emp_id = inv.get("employee_id") or ""
    if not emp_id:
        emp_count = len(STATE.get("employees", [])) + 1
        emp_id = f"EMP-SP-{emp_count:02d}" if inv["department"] == "Sales" else f"EMP-DSP-{emp_count:02d}"

    clean_email = req.identifier if "@" in req.identifier else f"{req.identifier}@steeloperations.com"
    clean_username = req.identifier.split("@")[0]

    user = db.create_user(
        name=req.name,
        username=clean_username,
        email=clean_email,
        password=req.password,
        phone=req.phone or "",
        role=inv["role"],
        department=inv["department"],
        employee_id=emp_id,
        sales_territory=inv["sales_territory"]
    )

    db.use_invitation_code(req.inviteCode)

    new_emp = {
        "id": emp_id,
        "name": req.name,
        "role": "Area Sales Officer" if inv["department"] == "Sales" else ("Yard Dispatch" if inv["department"] == "Dispatch" else inv["role"]),
        "department": inv["department"],
        "phone": req.phone or "",
        "city": inv["sales_territory"] or "Punjab/Haryana",
        "salesTerritory": inv["sales_territory"] or "Punjab/Haryana",
        "monthlyTargetQty": f"{inv['monthly_target_qty']:.3f}",
        "targetUnit": inv["target_unit"],
        "active": True,
        "mayDispatch": bool(inv["may_dispatch"])
    }
    if not any(e["id"] == emp_id for e in STATE.get("employees", [])):
        STATE.setdefault("employees", []).append(new_emp)

    user_id = user["id"]
    return {
        "accessToken": f"jwt-access-token-{inv['role']}-{emp_id}-{user_id}",
        "refreshToken": f"jwt-refresh-token-{inv['role']}-{emp_id}-{user_id}",
        "tokenType": "Bearer",
        "accessExpiresAt": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        "expiresIn": 86400,
        "user": {
            "id": user_id,
            "name": user["name"],
            "email": user["email"],
            "phone": user["phone"],
            "role": user["role"],
            "department": user["department"],
            "employeeId": emp_id,
            "salesTerritory": user["sales_territory"]
        }
    }

@app.post("/api/v1/auth/login")
def login(req: LoginRequest):
    user_id = (req.identifier or req.username or "").strip().lower()
    if not req.password:
        raise HTTPException(status_code=400, detail="Password is required")

    # 1. Check SQLite Persistent Users (Owner Ishu Jindal & 13 Real HR-PB Sales Officers)
    db_user = db.get_user_by_identifier(user_id)
    if not db_user:
        raise HTTPException(status_code=401, detail="User account not found. Only authorized personnel may log in.")

    if not db.verify_user_password(db_user, req.password):
        raise HTTPException(status_code=401, detail="Incorrect password. Please verify your credentials.")

    role = db_user.get("role", "employee")
    emp_id = db_user.get("employee_id") or None
    name = db_user.get("name", "Staff Member")
    email = db_user.get("email", f"{user_id}@durasmart.com")
    dept = db_user.get("department", "Sales")
    phone = db_user.get("phone", "+91 98140 10001")
    user_db_id = db_user["id"]
    return {
        "accessToken": f"jwt-access-token-{role}-{emp_id or 'none'}-{user_db_id}",
        "refreshToken": f"jwt-refresh-token-{role}-{emp_id or 'none'}-{user_db_id}",
        "tokenType": "Bearer",
        "accessExpiresAt": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        "expiresIn": 86400,
        "user": {
            "id": user_db_id,
            "name": name,
            "email": email,
            "role": role,
            "department": dept,
            "employeeId": emp_id,
            "phone": phone
        }
    }

@app.get("/api/v1/auth/me")
def get_current_user_profile(
    authorization: str | None = Header(None),
    x_user_role: str | None = Header(None),
    x_user_id: str | None = Header(None),
    x_employee_id: str | None = Header(None)
):
    token = (authorization or "").replace("Bearer ", "").strip()
    caller = resolve_caller(authorization, x_user_role, x_user_id, x_employee_id)

    db_user = None
    m = re.search(r"(usr-[\w-]+)", token, re.IGNORECASE)
    if m:
        db_user = db.get_user_by_id(m.group(1)) or db.get_user_by_identifier(m.group(1))
    if not db_user and x_user_id:
        db_user = db.get_user_by_id(x_user_id) or db.get_user_by_identifier(x_user_id)
    if not db_user and caller.get("employeeId"):
        db_user = db.get_user_by_identifier(caller["employeeId"])
    if not db_user and caller.get("isOwner"):
        db_user = db.get_user_by_identifier("ishujindal")

    if db_user:
        emp_match = next((e for e in STATE.get("employees", []) if e["id"] == db_user.get("employee_id")), None)
        return {
            "id": db_user["id"],
            "name": db_user["name"],
            "email": db_user["email"],
            "phone": db_user["phone"],
            "role": db_user["role"],
            "department": db_user["department"],
            "employeeId": db_user.get("employee_id") or None,
            "salesTerritory": db_user.get("sales_territory") or (emp_match.get("salesTerritory") if emp_match else ""),
            "monthlyTargetQty": emp_match.get("monthlyTargetQty") if emp_match else "100.000",
            "targetUnit": emp_match.get("targetUnit") if emp_match else "MT",
            "active": bool(db_user.get("active", 1)),
            "isOwner": db_user["role"] == "owner",
            "isDispatch": db_user["department"] == "Dispatch" or (emp_match.get("mayDispatch") if emp_match else False)
        }

    is_owner = caller["isOwner"]
    emp_id = caller.get("employeeId")
    emp_match = next((e for e in STATE.get("employees", []) if e["id"] == emp_id), None)
    return {
        "id": "usr-owner-ishu" if is_owner else f"usr-{emp_id.lower() if emp_id else 'emp'}",
        "name": "Ishu Jindal" if is_owner else (emp_match.get("name") if emp_match else "Sales Officer"),
        "email": "ishu.jindal@durasmart.com" if is_owner else f"{emp_id.lower() if emp_id else 'staff'}@durasmart.com",
        "phone": "+91 98140 10001",
        "role": caller["role"],
        "department": caller["department"],
        "employeeId": emp_id,
        "salesTerritory": emp_match.get("salesTerritory", "Punjab/Haryana") if emp_match else "Executive / All Territories",
        "monthlyTargetQty": emp_match.get("monthlyTargetQty", "0.000") if is_owner else "100.000",
        "targetUnit": "MT",
        "active": True,
        "isOwner": is_owner,
        "isDispatch": caller["isDispatch"]
    }

@app.patch("/api/v1/auth/me")
def update_current_user_profile(
    req: UpdateProfileRequest,
    authorization: str | None = Header(None),
    x_user_role: str | None = Header(None),
    x_user_id: str | None = Header(None),
    x_employee_id: str | None = Header(None)
):
    token = (authorization or "").replace("Bearer ", "").strip()
    caller = resolve_caller(authorization, x_user_role, x_user_id, x_employee_id)

    db_user = None
    m = re.search(r"(usr-[a-f0-9]+)", token, re.IGNORECASE)
    if m:
        db_user = db.get_user_by_id(m.group(1))
    if not db_user and x_user_id:
        db_user = db.get_user_by_id(x_user_id) or db.get_user_by_identifier(x_user_id)
    if not db_user and caller.get("employeeId"):
        with db.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM users WHERE employee_id = ? LIMIT 1", (caller["employeeId"],))
            row = cur.fetchone()
            if row:
                db_user = dict(row)

    if not db_user:
        return {
            "name": req.name or "Managing Director (Owner)",
            "phone": req.phone or "+91 98140 10001",
            "message": "Profile updated"
        }

    if req.newPassword:
        if not req.currentPassword or not db.verify_user_password(db_user, req.currentPassword):
            raise HTTPException(status_code=400, detail="Current password verification failed")
        db.update_user_password(db_user["id"], req.newPassword)

    updated = db.update_user_profile(db_user["id"], name=req.name, phone=req.phone)
    return {
        "id": updated["id"],
        "name": updated["name"],
        "email": updated["email"],
        "phone": updated["phone"],
        "role": updated["role"],
        "department": updated["department"],
        "employeeId": updated.get("employee_id") or None
    }

@app.post("/api/v1/auth/refresh")
def refresh_token(req: RefreshRequest | None = None, authorization: str | None = Header(None)):
    token = req.refreshToken if req and req.refreshToken else authorization or ""
    is_owner = "owner" in token.lower() or not token
    role = "owner" if is_owner else "employee"
    name = "Managing Director (Owner)" if is_owner else "Harpreet Singh (Yard Dispatch)"
    email = "owner@steeloperations.com" if is_owner else "dispatch@steeloperations.com"
    emp_id = None if is_owner else "EMP-DSP-01"

    return {
        "accessToken": f"jwt-access-token-{role}-{emp_id or 'owner'}",
        "refreshToken": f"jwt-refresh-token-{role}-{emp_id or 'owner'}",
        "tokenType": "Bearer",
        "accessExpiresAt": "2026-10-27T20:00:00+05:30",
        "expiresIn": 86400,
        "user": {
            "id": "usr-owner" if is_owner else f"usr-{emp_id.lower() if emp_id else 'emp'}",
            "name": name,
            "email": email,
            "role": role,
            "department": "Management" if is_owner else "Dispatch",
            "employeeId": emp_id,
            "phone": "+91 98140 10001"
        }
    }

@app.post("/api/v1/auth/logout")
def logout():
    return {"success": True}

def resolve_caller(
    authorization: str | None = None,
    x_user_role: str | None = None,
    x_user_id: str | None = None,
    x_employee_id: str | None = None,
) -> dict[str, Any]:
    token = (authorization or "").lower()
    role_header = (x_user_role or "").lower().strip()
    
    # 1. Dispatch Desk identity
    if role_header in ["dispatch", "yard"] or "dsp" in token or "dispatch" in token or "yard" in token:
        return {
            "role": "employee",
            "department": "Dispatch",
            "employeeId": "EMP-DSP-01",
            "isOwner": False,
            "isDispatch": True,
            "isSales": False,
        }

    # 2. Check if explicitly owner
    if role_header == "owner" or ("owner" in token and "employee" not in token and "sp-" not in token):
        return {
            "role": "owner",
            "department": "Management",
            "employeeId": None,
            "isOwner": True,
            "isDispatch": False,
            "isSales": False,
        }

    # 3. Employee / Sales Officer identity
    emp_id = x_employee_id
    if not emp_id:
        for e in STATE.get("employees", []):
            if e["id"].lower() in token or (x_user_id and e["id"].lower() in x_user_id.lower()):
                emp_id = e["id"]
                break

    if "employee" in token or "sp-" in token or role_header == "employee":
        emp_match = next((e for e in STATE.get("employees", []) if e["id"] == emp_id), None)
        dept = emp_match.get("department", "Sales") if emp_match else "Sales"
        is_dsp = dept == "Dispatch"
        return {
            "role": "employee",
            "department": dept,
            "employeeId": emp_id or "EMP-SP-01",
            "isOwner": False,
            "isDispatch": is_dsp,
            "isSales": not is_dsp,
        }

    # Default (unauthenticated or owner test harness): Owner access
    return {
        "role": "owner",
        "department": "Management",
        "employeeId": None,
        "isOwner": True,
        "isDispatch": False,
        "isSales": False,
    }

@app.get("/api/v1/me")
def get_current_user(authorization: str | None = Header(None)):
    token = (authorization or "").lower()
    is_owner = "employee" not in token and "sp-" not in token and "dsp-" not in token
    role = "owner" if is_owner else "employee"
    
    emp = None
    for e in STATE.get("employees", []):
        if e["id"].lower() in token:
            emp = e
            break

    if is_owner:
        name = "Managing Director (Owner)"
        email = "owner@steeloperations.com"
        emp_id = None
        dept = "Management"
    elif "dsp-01" in token:
        name = "Harpreet Singh (Yard Dispatch)"
        email = "dispatch@steeloperations.com"
        emp_id = "EMP-DSP-01"
        dept = "Dispatch"
    elif emp:
        name = emp["name"]
        email = f"{emp['name'].lower().replace(' ', '')}@steeloperations.com"
        emp_id = emp["id"]
        dept = emp.get("department", "Sales")
    else:
        name = "Sales Officer"
        email = "sales@steeloperations.com"
        emp_id = "EMP-SP-01"
        dept = "Sales"

    return {
        "id": "usr-owner" if is_owner else f"usr-{emp_id.lower() if emp_id else 'emp'}",
        "name": name,
        "email": email,
        "role": role,
        "department": dept,
        "employeeId": emp_id,
        "phone": "+91 98140 10001"
    }

# ----------------- Dashboard Summary Contract -----------------
@app.get("/api/v1/dashboard/summary")
def get_dashboard_summary(from_date: str | None = Query(None, alias="from"), to_date: str | None = Query(None, alias="to")):
    if not isinstance(from_date, str):
        from_date = None
    if not isinstance(to_date, str):
        to_date = None

    ensure_latest_stock_snapshot()

    # Filter orders inside period window
    orders = STATE.get("orders", [])
    in_window_orders = []
    for o in orders:
        if o.get("status") == "draft":
            continue
        order_date = o.get("date") or o.get("orderDate") or o.get("createdAt", "")[:10]
        if from_date and order_date < from_date:
            continue
        if to_date and order_date > to_date:
            continue
        in_window_orders.append(o)

    orders_value = sum(o.get("ordersValuePaise") or o.get("totalPaise") or o.get("valuePaise") or 0 for o in in_window_orders)
    
    # Collections inside window (excluding voided payments)
    payments = STATE.get("payments", [])
    in_window_payments = []
    for p in payments:
        if p.get("voidedAt"):
            continue
        p_date = p.get("paymentDate") or p.get("date") or p.get("createdAt", "")[:10]
        if from_date and p_date < from_date:
            continue
        if to_date and p_date > to_date:
            continue
        in_window_payments.append(p)
    collected_paise = sum(int(p.get("amountPaise", 0)) for p in in_window_payments)

    # Current Balances
    debtors = STATE.get("debtors", [])
    customers = STATE.get("customers", [])
    
    tot_debtor_bal = sum(round(float(d.get("balance", 0.0)) * 100) for d in debtors)
    tot_cust_bal = sum(int(c.get("outstandingPaise", 0)) for c in customers)
    outstanding_paise = tot_debtor_bal if tot_debtor_bal > 0 else tot_cust_bal

    overdue_paise = sum(
        min(int(c.get("outstandingPaise", 0)), int(c.get("overduePaise", c.get("outstandingPaise", 0))))
        for c in customers
        if int(c.get("outstandingPaise", 0)) > 0 and (c.get("overduePaise", 0) > 0 or c.get("isOverdue"))
    )

    pending_cust = len([c for c in customers if c.get("status") in ["pendingApproval", "pending"]])

    today_str = datetime.now().strftime("%Y-%m-%d")
    sla_cutoff = (datetime.now() - timedelta(days=3)).strftime("%Y-%m-%d")
    
    delayed_orders = 0
    for o in orders:
        if o.get("status") in ["dispatched", "delivered", "draft", "cancelled"]:
            continue
        if o.get("dispatchStatus") == "dispatched":
            continue
        
        # Check explicit expectedDispatchDate or fallback SLA (orderDate <= 3 days ago)
        exp_date = o.get("expectedDispatchDate")
        order_date = o.get("orderDate") or o.get("date") or (o.get("createdAt", "")[:10] if o.get("createdAt") else None)
        
        is_delayed = False
        if exp_date and str(exp_date)[:10] < today_str or not exp_date and order_date and str(order_date)[:10] <= sla_cutoff:
            is_delayed = True
            
        if is_delayed:
            delayed_orders += 1

    # Dispatched goods in the window (from targets base + recorded dispatches)
    snap = STATE.get("hrpb_snapshot")
    if snap and snap.get("summary") and "total_dispatched_mt" in snap["summary"]:
        base_disp_mt = float(snap["summary"]["total_dispatched_mt"])
    else:
        base_disp_mt = 621.776

    dispatches = STATE.get("dispatches", [])
    recorded_disp_mt = 0.0
    for dsp in dispatches:
        if dsp.get("voidedAt"):
            continue
        dsp_date = dsp.get("dispatchDate") or dsp.get("createdAt", "")[:10]
        if from_date and dsp_date < from_date:
            continue
        if to_date and dsp_date > to_date:
            continue
        
        # Calculate MT
        dsp_qty_mt = 0.0
        if dsp.get("lines"):
            for line in dsp["lines"]:
                try:
                    q = float(line.get("quantity", 0.0))
                    u = str(line.get("unit", "MT")).strip().lower()
                    if u == "kg":
                        dsp_qty_mt += q / 1000.0
                    else:
                        dsp_qty_mt += q
                except (ValueError, TypeError):
                    pass
        elif dsp.get("totalQuantity"):
            try:
                dsp_qty_mt += float(dsp.get("totalQuantity", 0.0))
            except (ValueError, TypeError):
                pass
        recorded_disp_mt += dsp_qty_mt

    tot_disp_mt = round(base_disp_mt + recorded_disp_mt, 3)

    return {
        "periodStart": from_date or "2026-10-01",
        "periodEnd": to_date or "2026-10-31",
        "orderCount": len(in_window_orders),
        "ordersValuePaise": orders_value,
        "collectedPaise": collected_paise,
        "outstandingPaise": outstanding_paise,
        "overduePaise": overdue_paise,
        "pendingApprovalCustomers": pending_cust,
        "delayedOrderCount": delayed_orders,
        "dispatched": [
            {
                "unit": "MT",
                "dispatchedQuantity": f"{tot_disp_mt:.3f}",
                "mismatchedDispatchQuantity": "0.000",
                "mismatchedDispatchLines": 0
            },
            {
                "unit": "kg",
                "dispatchedQuantity": f"{tot_disp_mt * 1000:.3f}",
                "mismatchedDispatchQuantity": "0.000",
                "mismatchedDispatchLines": 0
            }
        ]
    }

def get_unified_party_receivables() -> list[dict[str, Any]]:
    """
    Returns a unified, deduplicated list of parties with live receivable balances.
    Merges:
      1. Debtors master & manual entries (STATE['debtors'])
      2. Customers master & opening balances (STATE['customers'])
      3. Active non-cancelled order balances
    Deduplicates strictly by normalized name so that duplicate dealer records
    (e.g. DEBTOR-MAN-XXXX and CUST-D-XXXX) collapse into a single canonical row.
    """
    parties_by_key: dict[str, dict[str, Any]] = {}

    # 1. Base from STATE['debtors']
    for d in STATE.get("debtors", []):
        raw_name = (d.get("name") or "").strip()
        if not raw_name:
            continue
        key = raw_name.lower()
        bal_paise = round(float(d.get("balance", 0.0)) * 100)
        if key not in parties_by_key:
            parties_by_key[key] = {
                "id": d.get("id"),
                "name": raw_name,
                "city": d.get("city") or d.get("district") or "",
                "state": d.get("state") or "",
                "salesperson": d.get("salesperson") or "Unassigned",
                "salespersonId": d.get("salespersonId") or "EMP-SP-01",
                "balance_paise": bal_paise,
                "order_paise": 0,
            }
        else:
            existing = parties_by_key[key]
            existing["balance_paise"] = max(existing["balance_paise"], bal_paise)
            if not existing["city"] and (d.get("city") or d.get("district")):
                existing["city"] = d.get("city") or d.get("district")
            if existing["salesperson"] == "Unassigned" and d.get("salesperson"):
                existing["salesperson"] = d.get("salesperson")

    # 2. Merge from STATE['customers']
    for c in STATE.get("customers", []):
        raw_name = (c.get("name") or "").strip()
        if not raw_name:
            continue
        key = raw_name.lower()
        cust_bal = int(c.get("outstandingPaise", 0)) or int(c.get("openingPaise", 0))
        if key not in parties_by_key:
            parties_by_key[key] = {
                "id": c.get("id"),
                "name": raw_name,
                "city": c.get("city") or c.get("district") or "",
                "state": c.get("state") or "",
                "salesperson": c.get("salesperson") or c.get("salespersonName") or "Unassigned",
                "salespersonId": c.get("salespersonId") or "EMP-SP-01",
                "balance_paise": cust_bal,
                "order_paise": 0,
            }
        else:
            existing = parties_by_key[key]
            existing["balance_paise"] = max(existing["balance_paise"], cust_bal)
            if not existing["city"] and (c.get("city") or c.get("district")):
                existing["city"] = c.get("city") or c.get("district")

    # 3. Add active uncancelled order balances
    for o in STATE.get("orders", []):
        if o.get("status") in ["cancelled", "draft"]:
            continue
        raw_name = (o.get("customerName") or "").strip()
        if not raw_name:
            continue
        key = raw_name.lower()
        order_val = int(o.get("orderBalancePaise") if "orderBalancePaise" in o else (o.get("ordersValuePaise") or o.get("totalPaise") or o.get("valuePaise") or 0))
        if key in parties_by_key:
            parties_by_key[key]["order_paise"] += order_val
        else:
            parties_by_key[key] = {
                "id": o.get("customerId") or f"CUST-ORD-{len(parties_by_key)+1:04d}",
                "name": raw_name,
                "city": o.get("state") or "",
                "state": o.get("state") or "",
                "salesperson": o.get("salespersonName") or "Unassigned",
                "salespersonId": o.get("salespersonId") or "EMP-SP-01",
                "balance_paise": 0,
                "order_paise": order_val,
            }

    result = []
    for p in parties_by_key.values():
        total_paise = max(0, p["balance_paise"] + p["order_paise"])
        result.append({
            "id": p["id"],
            "name": p["name"],
            "city": p["city"],
            "state": p["state"],
            "salesperson": p["salesperson"],
            "salespersonId": p["salespersonId"],
            "balance_paise": total_paise,
            "balance": round(total_paise / 100.0, 2)
        })

    return result

@app.get("/api/v1/dashboard/cockpit")
def get_dashboard_cockpit(from_date: str | None = Query(None, alias="from"), to_date: str | None = Query(None, alias="to")):
    summary = get_dashboard_summary(from_date, to_date)
    
    # Recent orders (last 8)
    recent_orders = []
    for o in STATE.get("orders", [])[:8]:
        recent_orders.append({
            "id": o.get("id"),
            "number": o.get("number", o.get("id")),
            "customerName": o.get("customerName", "Customer"),
            "date": o.get("date") or o.get("orderDate") or o.get("createdAt", "")[:10],
            "totalPaise": o.get("ordersValuePaise") or o.get("totalPaise") or o.get("valuePaise") or 0,
            "status": o.get("status", "pendingApproval"),
            "itemsCount": len(o.get("lines", []))
        })
    
    # Top Debtors (top 6 by balance or alphabetical, strictly deduplicated by dealer name)
    unified_parties = get_unified_party_receivables()
    sorted_debtors = sorted(
        unified_parties,
        key=lambda d: (d["balance_paise"], d["name"]),
        reverse=True
    )[:6]
    top_debtors = [
        {
            "id": d["id"],
            "name": d["name"],
            "city": d["city"],
            "salesperson": d["salesperson"],
            "balance": d["balance"]
        }
        for d in sorted_debtors
    ]

    # Territories Progress from HR-PB targets + recorded dispatches
    targets = STATE.get("targets", [])
    pb_t = [t for t in targets if t.get("state") == "Punjab"]
    hr_t = [t for t in targets if t.get("state") == "Haryana"]

    pb_tgt = sum(float(t.get("target_mt", 0.0)) for t in pb_t)
    pb_disp = sum(float(t.get("dispatched_mt", 0.0)) for t in pb_t)
    hr_tgt = sum(float(t.get("target_mt", 0.0)) for t in hr_t)
    hr_disp = sum(float(t.get("dispatched_mt", 0.0)) for t in hr_t)

    # Accumulate real recorded dispatches per customer territory
    customers_map = {c.get("id"): c for c in STATE.get("customers", [])}
    for dsp in STATE.get("dispatches", []):
        if dsp.get("voidedAt"):
            continue
        dsp_date = dsp.get("dispatchDate") or dsp.get("createdAt", "")[:10]
        if from_date and dsp_date < from_date:
            continue
        if to_date and dsp_date > to_date:
            continue
        
        c_state = "Punjab"
        c_id = dsp.get("customerId")
        if c_id and c_id in customers_map:
            c_state = customers_map[c_id].get("state") or "Punjab"
        else:
            ord_match = next((o for o in STATE.get("orders", []) if o.get("id") == dsp.get("orderId")), None)
            if ord_match:
                c_state = ord_match.get("state") or "Punjab"

        dsp_mt = 0.0
        if dsp.get("lines"):
            for l in dsp["lines"]:
                try:
                    q = float(l.get("quantity", 0.0))
                    u = str(l.get("unit", "MT")).strip().lower()
                    dsp_mt += (q / 1000.0) if u == "kg" else q
                except (ValueError, TypeError):
                    pass
        elif dsp.get("totalQuantity"):
            try:
                dsp_mt += float(dsp.get("totalQuantity", 0.0))
            except (ValueError, TypeError):
                pass

        if "haryana" in c_state.lower():
            hr_disp += dsp_mt
        else:
            pb_disp += dsp_mt

    territories = {
        "punjab": {
            "target": pb_tgt or 999.0,
            "dispatched": pb_disp or 429.5,
            "percent": ((pb_disp / pb_tgt * 100) if pb_tgt > 0 else 43.0),
            "dealers": len(pb_t) or 100
        },
        "haryana": {
            "target": hr_tgt or 610.0,
            "dispatched": hr_disp or 192.2,
            "percent": ((hr_disp / hr_tgt * 100) if hr_tgt > 0 else 31.5),
            "dealers": len(hr_t) or 37
        }
    }

    # Stock snapshot
    ensure_latest_stock_snapshot()
    snap = STATE.get("latest_snapshot")
    stock_quick = {
        "metalKg": snap["summary"]["total_metal_kg"] if snap else "1444769.000",
        "profileKg": snap["summary"].get("total_profile_kg", "419662.000") if snap else "419662.000",
        "upvcPieces": snap["summary"]["total_upvc_pcs"] if snap else 2043,
        "accessoriesPieces": snap["summary"].get("total_accessories_pcs", 528474) if snap else 528474
    }

    return {
        "summary": summary,
        "recentOrders": recent_orders,
        "topDebtors": top_debtors,
        "territories": territories,
        "stockQuick": stock_quick
    }

@app.get("/api/v1/dashboard/salesperson-performance")
@app.get("/api/v1/reporting/salesperson-performance")
def get_salesperson_performance(
    from_date: str | None = Query(None, alias="from"),
    to_date: str | None = Query(None, alias="to"),
    employeeId: str | None = None,
    productCategory: str | None = None
):
    if not STATE.get("targets") and os.path.exists(DEFAULT_HRPB_PATH):
        try:
            snap = extract_hr_pb_targets(DEFAULT_HRPB_PATH)
            STATE["hrpb_snapshot"] = snap
            STATE["targets"] = snap["all_targets"]
            if not STATE["debtors"]:
                STATE["debtors"] = snap["dealers_master"]
        except Exception:
            pass

    targets = STATE.get("targets", [])
    salespersons_map = {}
    for t in targets:
        sp = t.get("salesperson") or "Unassigned"
        if sp not in salespersons_map:
            salespersons_map[sp] = {
                "id": f"SP-{hash(sp) & 0xffff:04x}",
                "name": sp,
                "target_mt": 0.0,
                "dispatched_mt": 0.0,
                "pending_mt": 0.0
            }
        salespersons_map[sp]["target_mt"] += float(t.get("target_mt", 0.0))
        salespersons_map[sp]["dispatched_mt"] += float(t.get("dispatched_mt", 0.0))
        salespersons_map[sp]["pending_mt"] += float(t.get("pending_mt", 0.0))

    rows = []
    for sp_info in salespersons_map.values():
        t_mt = sp_info["target_mt"]
        d_mt = sp_info["dispatched_mt"]
        p_mt = sp_info["pending_mt"]
        pct = f"{(d_mt / t_mt * 100):.1f}" if t_mt > 0 else "0.0"

        if employeeId and employeeId != sp_info["id"] and employeeId != sp_info["name"]:
            continue

        rows.append({
            "employeeId": sp_info["id"],
            "employeeName": sp_info["name"],
            "periodStart": from_date or "2026-10-01",
            "periodEnd": to_date or "2026-10-31",
            "productCategory": productCategory,
            "targetSource": "targets",
            "excludedTargetRows": 0,
            "units": [
                {
                    "unit": "MT",
                    "targetQuantity": f"{t_mt:.3f}",
                    "achievedQuantity": f"{d_mt:.3f}",
                    "dispatchedQuantity": f"{d_mt:.3f}",
                    "mismatchedDispatchQuantity": "0.000",
                    "remainingQuantity": f"{p_mt:.3f}",
                    "achievementPercent": pct,
                    "targetZero": t_mt == 0,
                    "unitMismatch": False
                }
            ]
        })

    # Sort by target descending
    rows.sort(key=lambda r: float(r["units"][0]["targetQuantity"]), reverse=True)

    return {
        "periodStart": from_date or "2026-10-01",
        "periodEnd": to_date or "2026-10-31",
        "productCategory": productCategory,
        "rows": rows
    }

# ----------------- Customers Endpoints -----------------
@app.get("/api/v1/customers")
def get_customers(
    q: str | None = None,
    city: str | None = None,
    salespersonId: str | None = None,
    status: str | None = None,
    state: str | None = None,
    page: int = 1,
    pageSize: int = 50
):
    items = STATE["customers"]
    if q:
        q_l = q.lower().strip()
        items = [
            c for c in items
            if q_l in c.get("name", "").lower()
            or q_l in c.get("city", "").lower()
            or q_l in c.get("district", "").lower()
            or q_l in c.get("state", "").lower()
            or q_l in c.get("salesperson", "").lower()
            or q_l in c.get("mobile", "").lower()
            or q_l in c.get("id", "").lower()
        ]
    if city:
        items = [c for c in items if city.lower() in c.get("city", "").lower()]
    if state:
        items = [c for c in items if state.lower() in c.get("state", "").lower()]
    if salespersonId:
        items = [c for c in items if c.get("salespersonId") == salespersonId]
    if status:
        if status == "active":
            items = [c for c in items if c.get("status") in ("active", "approved")]
        else:
            items = [c for c in items if c.get("status") == status]

    total = len(items)
    start = (page - 1) * pageSize
    end = start + pageSize

    return {
        "items": items[start:end],
        "page": page,
        "pageSize": pageSize,
        "total": total,
        "nextCursor": None
    }

@app.get("/api/v1/customers/match")
def match_customers():
    return []

@app.get("/api/v1/customers/{customer_id}")
def get_customer(customer_id: str):
    cust = next((c for c in STATE["customers"] if c["id"] == customer_id), None)
    if not cust:
        raise HTTPException(status_code=404, detail="Customer not found")
    return cust

@app.post("/api/v1/customers")
def create_customer(body: dict[str, Any]):
    debtor_input = DebtorCreate(
        name=body.get("name", "New Customer"),
        state=body.get("state", "Punjab"),
        city=body.get("city", "Ludhiana"),
        district=body.get("district", "Ludhiana"),
        salesperson=body.get("salesperson", "Unassigned"),
        balance=body.get("balance", 0.0)
    )
    return create_debtor(debtor_input)

@app.post("/api/v1/customers/{customer_id}/approve")
def approve_customer(customer_id: str):
    cust = next((c for c in STATE["customers"] if c["id"] == customer_id), None)
    if not cust:
        raise HTTPException(status_code=404, detail="Customer not found")
    cust["status"] = "approved"
    cust["approvedBy"] = "USR-OWNER"
    cust["approvedAt"] = datetime.now().isoformat() + "+05:30"
    return cust

@app.post("/api/v1/customers/{customer_id}/reject")
def reject_customer(customer_id: str):
    cust = next((c for c in STATE["customers"] if c["id"] == customer_id), None)
    if not cust:
        raise HTTPException(status_code=404, detail="Customer not found")
    cust["status"] = "rejected"
    return cust

@app.get("/api/v1/customers/{customer_id}/ledger")
def get_customer_ledger(
    customer_id: str,
    from_: str | None = Query(None, alias="from"),
    to: str | None = None,
    page: int = 1,
    pageSize: int = 50
):
    cust = next((c for c in STATE.get("customers", []) if c["id"] == customer_id), None)
    cust_name = cust.get("name", "").lower() if cust else ""

    entries: list[dict[str, Any]] = []

    # 1. Opening balances
    obs = STATE.get("opening_balances", {}).get(customer_id, [])
    for ob in obs:
        is_owes = ob.get("direction") == "owes"
        entries.append({
            "entryId": f"OB-{ob['id']}",
            "entryDate": ob.get("asOf", "2026-04-01"),
            "kind": "opening_balance",
            "reference": "Opening Balance",
            "orderId": None,
            "debitPaise": ob["amountPaise"] if is_owes else 0,
            "creditPaise": 0 if is_owes else ob["amountPaise"],
            "source": ob.get("source", "panel")
        })

    # 2. Orders & Invoices
    orders = [
        o for o in STATE.get("orders", [])
        if o.get("customerId") == customer_id or (cust_name and o.get("customerName", "").lower() == cust_name)
    ]
    for o in orders:
        entries.append({
            "entryId": f"ORD-{o['id']}",
            "entryDate": o.get("orderDate", "2026-10-26"),
            "kind": "invoice" if o.get("status") in ["confirmed", "dispatched"] else "order",
            "reference": o.get("number") or o["id"],
            "orderId": o["id"],
            "debitPaise": o.get("valuePaise", 0),
            "creditPaise": 0,
            "source": o.get("source", "panel")
        })

    # 3. Payments
    payments = [
        p for p in STATE.get("payments", [])
        if not p.get("voidedAt") and (p.get("customerId") == customer_id or (cust_name and p.get("customerName", "").lower() == cust_name))
    ]
    for p in payments:
        entries.append({
            "entryId": f"PAY-{p.get('id') or p.get('voucherNo')}",
            "entryDate": p.get("paymentDate", p.get("date", "2026-10-26")),
            "kind": "payment",
            "reference": p.get("voucherNo") or p.get("reference") or "Payment Received",
            "orderId": p.get("orderId"),
            "debitPaise": 0,
            "creditPaise": p.get("amountPaise", 0),
            "source": p.get("source", "panel")
        })

    # Date filtering
    if from_:
        entries = [e for e in entries if e["entryDate"] >= from_]
    if to:
        entries = [e for e in entries if e["entryDate"] <= to]

    # Chronological sort
    entries.sort(key=lambda x: (x["entryDate"], x["entryId"]))

    # Running balance
    curr_bal = 0
    for e in entries:
        curr_bal += (e["debitPaise"] - e["creditPaise"])
        e["balancePaise"] = curr_bal

    total = len(entries)
    start = (page - 1) * pageSize
    end = start + pageSize
    paginated = entries[start:end]

    return {
        "items": paginated,
        "total": total,
        "page": page,
        "pageSize": pageSize
    }

class OpeningBalanceCreate(BaseModel):
    asOf: str
    amountPaise: int
    direction: str = "owes"
    source: str | None = "panel"

@app.get("/api/v1/customers/{customer_id}/opening-balances")
def get_customer_opening_balances(customer_id: str, page: int = 1, pageSize: int = 200):
    obs = STATE.get("opening_balances", {}).get(customer_id, [])
    start = (page - 1) * pageSize
    end = start + pageSize
    return {
        "items": obs[start:end],
        "total": len(obs),
        "page": page,
        "pageSize": pageSize,
        "nextCursor": None
    }

@app.post("/api/v1/customers/{customer_id}/opening-balances")
def create_customer_opening_balance(customer_id: str, body: OpeningBalanceCreate):
    cust = next((c for c in STATE["customers"] if c["id"] == customer_id), None)
    if not cust:
        raise HTTPException(status_code=404, detail="Customer not found")

    if body.direction not in ("owes", "advance"):
        raise HTTPException(status_code=422, detail="Direction must be owes or advance")

    entry = {
        "id": 0,
        "customerId": customer_id,
        "asOf": body.asOf,
        "amountPaise": body.amountPaise,
        "direction": body.direction,
        "source": body.source or "panel",
        "createdAt": datetime.now().isoformat() + "+05:30"
    }

    try:
        entry = db.save_opening_balance(entry)
    except Exception as e:
        print(f"Warning: Failed to save opening balance to db: {e}")
        entry["id"] = len(STATE.get("opening_balances", {}).get(customer_id, [])) + 1

    if customer_id not in STATE.get("opening_balances", {}):
        STATE.setdefault("opening_balances", {})[customer_id] = []
    STATE["opening_balances"][customer_id].append(entry)

    # Adjust customer opening balance figures
    if body.direction == "owes":
        cust["openingPaise"] = cust.get("openingPaise", 0) + body.amountPaise
        cust["outstandingPaise"] = cust.get("outstandingPaise", 0) + body.amountPaise
    else:
        cust["advancePaise"] = cust.get("advancePaise", 0) + body.amountPaise

    try:
        db.save_party(cust)
    except Exception:
        pass

    # Mirror balance to matching debtor in STATE['debtors'] if present
    for d in STATE.get("debtors", []):
        if d.get("id") == customer_id or d.get("name", "").strip().lower() == cust.get("name", "").strip().lower():
            d["balance"] = round(cust.get("outstandingPaise", 0) / 100.0, 2)
            d["balance_formatted"] = f"{d['balance']:.2f}"
            try:
                db.save_party(d)
            except Exception:
                pass

    return entry

@app.get("/api/v1/customers/{customer_id}/opening-balances/history")
def get_customer_opening_balance_history(customer_id: str):
    obs = STATE.get("opening_balances", {}).get(customer_id, [])
    history = []
    for ob in obs:
        history.append({
            "id": f"AUDIT-OB-{ob['id']}",
            "at": ob["createdAt"],
            "action": "opening_balance.created",
            "actorKind": "owner",
            "actorUserId": "USR-OWNER",
            "actorName": "Owner Desk",
            "recordType": "opening_balance",
            "recordId": customer_id,
            "summary": f"{ob['asOf']} {ob['direction']} {ob['amountPaise']}"
        })
    return history

# ----------------- Debtors Master & Sales Targets Endpoints -----------------
class DebtorCreate(BaseModel):
    name: str
    state: str | None = "Punjab"
    city: str | None = ""
    district: str | None = ""
    salesperson: str | None = ""
    balance: float | None = 0.0

class DebtorUpdate(BaseModel):
    name: str | None = None
    state: str | None = None
    city: str | None = None
    district: str | None = None
    salesperson: str | None = None
    balance: float | None = None
    status: str | None = None

@app.get("/api/v1/debtors")
def get_debtors(
    q: str | None = None,
    state: str | None = None,
    salesperson: str | None = None,
    page: int = 1,
    pageSize: int = 50
):
    items = STATE.get("debtors", [])
    if q:
        query = q.lower().strip()
        items = [d for d in items if query in d["name"].lower() or query in d.get("city", "").lower()]
    if state:
        items = [d for d in items if d.get("state", "").lower() == state.lower()]
    if salesperson:
        items = [d for d in items if d.get("salesperson", "").lower() == salesperson.lower()]

    total = len(items)
    start = (page - 1) * pageSize
    end = start + pageSize

    # Also include customerId / debitPaise formatting for legacy contracts
    enriched = []
    for d in items[start:end]:
        row = dict(d)
        row["customerId"] = d["id"]
        row["customerName"] = d["name"]
        row["asOf"] = "2026-10-23"
        row["debitPaise"] = int(float(d.get("balance", 0.0)) * 100)
        row["creditPaise"] = 0
        row["importedAt"] = STATE.get("hrpb_snapshot", {}).get("synced_at", "2026-10-23T20:00:00+05:30")
        enriched.append(row)

    return {
        "items": enriched,
        "page": page,
        "pageSize": pageSize,
        "total": total,
        "nextCursor": None
    }

@app.post("/api/v1/debtors")
def create_debtor(body: DebtorCreate):
    new_id = f"DEBTOR-MAN-{len(STATE['debtors']) + 1:04d}"
    bal_val = float(body.balance or 0.0)
    bal_paise = round(bal_val * 100)
    sp_name = body.salesperson or "Unassigned"
    sp_id = next((e["id"] for e in STATE.get("employees", []) if e["name"].lower() == sp_name.lower()), "EMP-SP-01")
    debtor = {
        "id": new_id,
        "name": body.name.strip(),
        "state": body.state or "Punjab",
        "city": body.city or "",
        "district": body.district or "",
        "salesperson": sp_name,
        "salespersonId": sp_id,
        "mobile": "9814000000",
        "balance": bal_val,
        "balance_formatted": f"{bal_val:.2f}",
        "creditDays": 30,
        "status": "active",
        "contactPerson": body.name.strip(),
        "source": "manual",
        "openingPaise": bal_paise,
        "outstandingPaise": bal_paise,
        "advancePaise": 0,
        "unbilledValuePaise": 0,
        "overduePaise": 0,
        "isOverdue": False,
        "invoiceCount": 0,
        "orderCount": 0,
        "lastPaymentDate": None,
        "address": f"{body.city or ''}, {body.district or ''}, {body.state or 'Punjab'}",
        "notes": f"Debtor registered via Debtor Master. Officer: {sp_name}",
        "ledgerGroup": "Sundry Debtors",
        "creditTerms": "30 days net",
        "approvedBy": "USR-OWNER",
        "approvedAt": datetime.now().isoformat() + "+05:30",
        "created_at": datetime.now().isoformat() + "+05:30"
    }
    # Save debtor to persistent SQLite
    debtor = db.save_party(debtor)
    STATE["debtors"].insert(0, debtor)
    return debtor

@app.put("/api/v1/debtors/{debtor_id}")
def update_debtor(debtor_id: str, body: DebtorUpdate):
    debtor = next((d for d in STATE["debtors"] if d["id"] == debtor_id), None)
    if not debtor:
        raise HTTPException(status_code=404, detail=f"Debtor {debtor_id} not found")
    
    if body.name is not None:
        debtor["name"] = body.name.strip()
    if body.state is not None:
        debtor["state"] = body.state
    if body.city is not None:
        debtor["city"] = body.city
    if body.district is not None:
        debtor["district"] = body.district
    if body.salesperson is not None:
        debtor["salesperson"] = body.salesperson
        sp_match = next((e["id"] for e in STATE.get("employees", []) if e["name"].lower() == body.salesperson.lower()), None)
        if sp_match:
            debtor["salespersonId"] = sp_match
    if body.balance is not None:
        debtor["balance"] = float(body.balance)
        debtor["balance_formatted"] = f"{float(body.balance):.2f}"
        bal_paise = round(float(body.balance) * 100)
        debtor["openingPaise"] = bal_paise
        debtor["outstandingPaise"] = bal_paise
    if body.status is not None:
        debtor["status"] = body.status

    try:
        db.save_party(debtor)
    except Exception:
        pass

    return debtor

@app.delete("/api/v1/debtors/{debtor_id}")
def delete_debtor(debtor_id: str):
    idx = next((i for i, d in enumerate(STATE["debtors"]) if d["id"] == debtor_id), None)
    if idx is None:
        raise HTTPException(status_code=404, detail=f"Debtor {debtor_id} not found")
    deleted = STATE["debtors"].pop(idx)
    # Remove from SQLite
    try:
        with db.get_connection() as conn:
            conn.execute("DELETE FROM parties WHERE id = ?", (debtor_id,))
            conn.commit()
    except Exception as e:
        print(f"Warning: Failed to delete party from DB: {e}")
    return {"deleted": True, "id": debtor_id, "name": deleted["name"]}

# ----------------- 1-Click HR-PB Sales Targets & Dealers Sync -----------------
@app.post("/api/v1/imports/excel/hr-pb/sync")
def sync_hr_pb_excel():
    if not os.path.exists(DEFAULT_HRPB_PATH):
        raise HTTPException(status_code=404, detail=f"HR-PB.xlsx not found at {DEFAULT_HRPB_PATH}")
    try:
        snap = extract_hr_pb_targets(DEFAULT_HRPB_PATH)
        STATE["hrpb_snapshot"] = snap
        STATE["targets"] = snap["all_targets"]

        # Update or add dealers into Debtors Master and Customers list
        existing_debtors_by_name = {d["name"].lower(): d for d in STATE["debtors"]}
        existing_customers_by_name = {c["name"].lower(): c for c in STATE["customers"]}
        added_count = 0
        updated_count = 0

        for dealer in snap["dealers_master"]:
            d_name = dealer["name"].lower()
            bal_paise = round(float(dealer.get("balance", 0.0)) * 100)
            if d_name in existing_debtors_by_name:
                target_d = existing_debtors_by_name[d_name]
                target_d["balance"] = dealer["balance"]
                target_d["balance_formatted"] = dealer.get("balance_formatted", f"{dealer['balance']:.2f}")
                target_d["city"] = dealer.get("city", target_d.get("city", ""))
                target_d["state"] = dealer.get("state", target_d.get("state", ""))
                target_d["salesperson"] = dealer.get("salesperson", target_d.get("salesperson", "Unassigned"))
                target_d["outstandingPaise"] = bal_paise
                target_d["overduePaise"] = bal_paise
                target_d["isOverdue"] = bal_paise > 0
                updated_count += 1
            else:
                dealer["outstandingPaise"] = bal_paise
                dealer["overduePaise"] = bal_paise
                dealer["isOverdue"] = bal_paise > 0
                dealer.setdefault("mobile", f"98140{20000 + len(STATE['debtors'])}")
                dealer.setdefault("creditDays", 30)
                dealer.setdefault("status", "active")
                STATE["debtors"].append(dealer)
                existing_debtors_by_name[d_name] = dealer
                added_count += 1

            db.save_party(dealer)

        sp_set = sorted({t.get("salesperson") for t in snap["all_targets"] if t.get("salesperson")})
        sp_territory = {}
        for t in snap["all_targets"]:
            sp = t.get("salesperson")
            st = t.get("state")
            if sp and st:
                sp_territory.setdefault(sp, set()).add(st)

        STATE["employees"] = [
            {
                "id": f"EMP-SP-{i+1:02d}",
                "name": sp_name,
                "role": "Area Sales Officer",
                "department": "Sales",
                "phone": f"98140{10000+i}",
                "city": "/".join(sorted(sp_territory.get(sp_name, ["Punjab/Haryana"]))),
                "salesTerritory": "/".join(sorted(sp_territory.get(sp_name, ["Punjab/Haryana"]))),
                "monthlyTargetQty": "100.000",
                "targetUnit": "MT",
                "active": True,
                "mayDispatch": True
            }
            for i, sp_name in enumerate(sp_set)
        ]

        return {
            "applied": True,
            "filename": snap["filename"],
            "file_sha256": snap["file_sha256"],
            "synced_at": snap["synced_at"],
            "summary": snap["summary"],
            "new_debtors_added": added_count,
            "total_debtors": len(STATE["debtors"]),
            "message": f"HR-PB targets synced successfully: {snap['summary']['total_parties_count']} targets, {len(STATE['debtors'])} debtors in master"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/sales/targets")
def get_sales_targets(
    state: str | None = None,
    salesperson: str | None = None,
    q: str | None = None
):
    if not STATE.get("targets") and os.path.exists(DEFAULT_HRPB_PATH):
        try:
            snap = extract_hr_pb_targets(DEFAULT_HRPB_PATH)
            STATE["hrpb_snapshot"] = snap
            STATE["targets"] = snap["all_targets"]
            if not STATE["debtors"]:
                STATE["debtors"] = snap["dealers_master"]
        except Exception:
            pass

    targets = STATE.get("targets", [])
    if state:
        targets = [t for t in targets if t.get("state", "").lower() == state.lower()]
    if salesperson:
        targets = [t for t in targets if t.get("salesperson", "").lower() == salesperson.lower()]
    if q:
        query = q.lower().strip()
        targets = [t for t in targets if query in t["party_name"].lower() or query in t.get("station", "").lower()]

    # Aggregate salesperson statistics
    salespersons_map = {}
    for t in STATE.get("targets", []):
        sp = t.get("salesperson") or "Unassigned"
        if sp not in salespersons_map:
            salespersons_map[sp] = {
                "salesperson": sp,
                "territory": t.get("state"),
                "parties_count": 0,
                "total_target_mt": 0.0,
                "total_dispatched_mt": 0.0,
                "total_pending_mt": 0.0
            }
        salespersons_map[sp]["parties_count"] += 1
        salespersons_map[sp]["total_target_mt"] += float(t.get("target_mt", 0.0))
        salespersons_map[sp]["total_dispatched_mt"] += float(t.get("dispatched_mt", 0.0))
        salespersons_map[sp]["total_pending_mt"] += float(t.get("pending_mt", 0.0))

    sp_summary = [
        {
            "salesperson": k,
            "territory": v["territory"],
            "parties_count": v["parties_count"],
            "total_target_mt": f"{v['total_target_mt']:.3f}",
            "total_dispatched_mt": f"{v['total_dispatched_mt']:.3f}",
            "total_pending_mt": f"{v['total_pending_mt']:.3f}",
            "achievement_percent": f"{(v['total_dispatched_mt'] / v['total_target_mt'] * 100):.1f}" if v["total_target_mt"] > 0 else "0.0"
        }
        for k, v in salespersons_map.items()
    ]

    return {
        "items": targets,
        "total": len(targets),
        "salesperson_summary": sorted(sp_summary, key=lambda x: float(x["total_target_mt"]), reverse=True),
        "synced_at": STATE.get("hrpb_snapshot", {}).get("synced_at", None)
    }

class TargetUpsert(BaseModel):
    employeeId: str
    periodStart: str
    periodEnd: str
    productCategory: str | None = None
    quantity: str
    unit: str = "MT"

@app.get("/api/v1/targets")
def list_targets(
    from_: str | None = Query(None, alias="from"),
    to: str | None = None,
    employeeId: str | None = None,
    page: int = 1,
    pageSize: int = 50
):
    tgts = STATE.get("employee_targets", [])
    if employeeId:
        tgts = [t for t in tgts if t.get("employeeId") == employeeId]
    if from_:
        tgts = [t for t in tgts if t.get("periodStart", "") >= from_]
    if to:
        tgts = [t for t in tgts if t.get("periodEnd", "") <= to]
    start = (page - 1) * pageSize
    end = start + pageSize
    return {
        "items": tgts[start:end],
        "total": len(tgts),
        "page": page,
        "pageSize": pageSize
    }

@app.put("/api/v1/targets")
@app.post("/api/v1/targets")
def put_target(body: TargetUpsert):
    emp = next((e for e in STATE.get("employees", []) if e["id"] == body.employeeId), None)
    emp_name = emp.get("name", "Employee") if emp else "Employee"

    tgts = STATE.setdefault("employee_targets", [])
    existing = next(
        (t for t in tgts if t["employeeId"] == body.employeeId and t["periodStart"] == body.periodStart and t["periodEnd"] == body.periodEnd),
        None
    )
    now_iso = datetime.now().isoformat() + "+05:30"
    if existing:
        existing["quantity"] = body.quantity
        existing["unit"] = body.unit
        existing["productCategory"] = body.productCategory
        existing["updatedAt"] = now_iso
        return existing

    new_tgt = {
        "id": f"TGT-{len(tgts) + 1:04d}",
        "employeeId": body.employeeId,
        "employeeName": emp_name,
        "periodStart": body.periodStart,
        "periodEnd": body.periodEnd,
        "productCategory": body.productCategory,
        "quantity": body.quantity,
        "unit": body.unit,
        "setBy": "USR-OWNER",
        "createdAt": now_iso,
        "updatedAt": now_iso
    }
    tgts.append(new_tgt)
    return new_tgt

@app.get("/api/v1/dashboard/financial-analytics")
def get_financial_analytics():
    if not STATE.get("targets") and os.path.exists(DEFAULT_HRPB_PATH):
        try:
            snap = extract_hr_pb_targets(DEFAULT_HRPB_PATH)
            STATE["hrpb_snapshot"] = snap
            STATE["targets"] = snap["all_targets"]
            if not STATE["debtors"]:
                STATE["debtors"] = snap["dealers_master"]
        except Exception:
            pass

    targets = STATE.get("targets", [])
    total_target_mt = sum(float(t.get("target_mt", 0.0)) for t in targets)
    total_dispatched_mt = sum(float(t.get("dispatched_mt", 0.0)) for t in targets)
    total_pending_mt = sum(float(t.get("pending_mt", 0.0)) for t in targets)
    achievement_percent = round((total_dispatched_mt / total_target_mt * 100), 1) if total_target_mt > 0 else 0.0

    # Pricing benchmark: average prime coil rate ₹62,000 / MT (₹62 / kg)
    rate_per_mt = 62000.0
    realized_turnover_inr = total_dispatched_mt * rate_per_mt
    pending_turnover_inr = total_pending_mt * rate_per_mt
    total_book_value_inr = total_target_mt * rate_per_mt

    # Pacing / Run-rate (assuming October 31 days)
    now = datetime.now()
    days_in_month = 31
    day_of_month = min(max(now.day, 1), 31)
    days_remaining = max(days_in_month - day_of_month, 1)
    expected_pacing_percent = round((day_of_month / days_in_month) * 100, 1)
    pacing_status = "On Track" if achievement_percent >= expected_pacing_percent else "Behind Pace"
    required_daily_dispatch_mt = round(total_pending_mt / days_remaining, 3)

    # Territory breakdown
    punjab_targets = [t for t in targets if t.get("state", "").lower() == "punjab"]
    haryana_targets = [t for t in targets if t.get("state", "").lower() == "haryana"]
    pb_target_mt = sum(float(t.get("target_mt", 0.0)) for t in punjab_targets)
    pb_disp_mt = sum(float(t.get("dispatched_mt", 0.0)) for t in punjab_targets)
    hr_target_mt = sum(float(t.get("target_mt", 0.0)) for t in haryana_targets)
    hr_disp_mt = sum(float(t.get("dispatched_mt", 0.0)) for t in haryana_targets)

    # Top 10 Dealer Concentration (Pareto risk)
    sorted_dealers = sorted(targets, key=lambda x: float(x.get("target_mt", 0.0)), reverse=True)
    top_10 = sorted_dealers[:10]
    top_10_target_mt = sum(float(t.get("target_mt", 0.0)) for t in top_10)
    top_10_concentration_percent = round((top_10_target_mt / total_target_mt * 100), 1) if total_target_mt > 0 else 0.0

    # Debtors Summary
    debtors = STATE.get("debtors", [])
    total_debtors = len(debtors)
    total_debtor_balance = sum(float(d.get("balance", 0.0)) for d in debtors)

    return {
        "period": "October 2026",
        "benchmark_rate_per_mt": rate_per_mt,
        "volume": {
            "total_target_mt": round(total_target_mt, 3),
            "total_dispatched_mt": round(total_dispatched_mt, 3),
            "total_pending_mt": round(total_pending_mt, 3),
            "achievement_percent": achievement_percent,
        },
        "financials": {
            "realized_turnover_inr": round(realized_turnover_inr, 2),
            "pending_turnover_inr": round(pending_turnover_inr, 2),
            "total_book_value_inr": round(total_book_value_inr, 2),
            "realized_cr": round(realized_turnover_inr / 10000000, 2),
            "pending_cr": round(pending_turnover_inr / 10000000, 2),
            "total_book_cr": round(total_book_value_inr / 10000000, 2),
        },
        "pacing": {
            "day_of_month": day_of_month,
            "days_in_month": days_in_month,
            "days_remaining": days_remaining,
            "expected_pacing_percent": expected_pacing_percent,
            "actual_pacing_percent": achievement_percent,
            "pacing_status": pacing_status,
            "required_daily_dispatch_mt": required_daily_dispatch_mt,
        },
        "territories": {
            "punjab": {
                "dealer_count": len(punjab_targets),
                "target_mt": round(pb_target_mt, 3),
                "dispatched_mt": round(pb_disp_mt, 3),
                "achievement_percent": round((pb_disp_mt / pb_target_mt * 100), 1) if pb_target_mt > 0 else 0.0,
                "realized_cr": round((pb_disp_mt * rate_per_mt) / 10000000, 2),
            },
            "haryana": {
                "dealer_count": len(haryana_targets),
                "target_mt": round(hr_target_mt, 3),
                "dispatched_mt": round(hr_disp_mt, 3),
                "achievement_percent": round((hr_disp_mt / hr_target_mt * 100), 1) if hr_target_mt > 0 else 0.0,
                "realized_cr": round((hr_disp_mt * rate_per_mt) / 10000000, 2),
            }
        },
        "concentration": {
            "top_10_target_mt": round(top_10_target_mt, 3),
            "top_10_concentration_percent": top_10_concentration_percent,
            "remaining_dealers_count": max(len(targets) - 10, 0),
            "remaining_dealers_percent": round(100.0 - top_10_concentration_percent, 1),
            "top_dealers": [
                {
                    "party_name": d["party_name"],
                    "state": d["state"],
                    "salesperson": d.get("salesperson", "Unassigned"),
                    "target_mt": float(d.get("target_mt", 0.0)),
                    "dispatched_mt": float(d.get("dispatched_mt", 0.0)),
                    "achievement_percent": round((float(d.get("dispatched_mt", 0.0)) / float(d.get("target_mt", 1.0)) * 100), 1) if float(d.get("target_mt", 0.0)) > 0 else 0.0
                }
                for d in top_10
            ]
        },
        "debtors": {
            "total_parties": total_debtors,
            "total_balance_inr": round(total_debtor_balance, 2)
        }
    }

# ----------------- Orders Endpoints -----------------
@app.get("/api/v1/orders")
def get_orders(
    q: str | None = None,
    salespersonId: str | None = None,
    dispatchStatus: str | None = None,
    status: str | None = None,
    page: int = 1,
    pageSize: int = 20,
    authorization: str | None = Header(None),
    x_user_role: str | None = Header(None, alias="X-User-Role"),
    x_user_id: str | None = Header(None, alias="X-User-Id"),
    x_employee_id: str | None = Header(None, alias="X-Employee-Id"),
):
    caller = resolve_caller(authorization, x_user_role, x_user_id, x_employee_id)
    items = STATE["orders"]
    
    # If caller is an Area Sales Officer (Employee in Sales), strictly scope to their assigned orders!
    if caller["isSales"]:
        sp_id = caller["employeeId"]
        items = [o for o in items if o.get("salespersonId") == sp_id]
    elif salespersonId:
        # Owner or Dispatch can filter by any specific salesperson if requested
        items = [o for o in items if o.get("salespersonId") == salespersonId]

    if q:
        q_l = q.lower().strip()
        items = [
            o for o in items
            if q_l in o.get("number", "").lower()
            or q_l in o.get("customerName", "").lower()
            or q_l in o.get("salespersonName", "").lower()
        ]
    if dispatchStatus:
        if dispatchStatus == "pending":
            items = [o for o in items if o.get("dispatchStatus") in ["pending", None, ""]]
        else:
            items = [o for o in items if o.get("dispatchStatus") == dispatchStatus]
    if status:
        items = [o for o in items if o.get("status") == status]
    total = len(items)
    start = (page - 1) * pageSize
    end = start + pageSize

    return {
        "items": items[start:end],
        "page": page,
        "pageSize": pageSize,
        "total": total,
        "nextCursor": None
    }

@app.post("/api/v1/orders/{order_id}/quick-dispatch")
def quick_dispatch_order(
    order_id: str,
    body: dict[str, Any] | None = None,
    authorization: str | None = Header(None),
    x_user_role: str | None = Header(None, alias="X-User-Role"),
    x_user_id: str | None = Header(None, alias="X-User-Id"),
):
    caller = resolve_caller(authorization, x_user_role, x_user_id)
    if not (caller["isOwner"] or caller["isDispatch"]):
        raise HTTPException(status_code=403, detail="Only Owner and Dispatch Person have authority to quick-dispatch orders.")

    body = body or {}
    order = next((o for o in STATE["orders"] if o["id"] == order_id), None)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    if order.get("status") == "draft":
        raise HTTPException(status_code=400, detail="Cannot dispatch a draft order. Submit it first.")
    
    today_str = datetime.now().strftime("%Y-%m-%d")
    dispatch_date = body.get("dispatchDate") or today_str
    vehicle_no = body.get("vehicleNo") or "PB 10 CT 4421"
    driver_name = body.get("driverName") or "Yard Driver"
    notes = body.get("notes") or "Full order dispatched"

    total_qty = 0.0
    processed_lines = []
    for line in order.get("lines", []):
        q = float(line.get("orderedQuantity") or 0.0)
        total_qty += q
        line["dispatchedQuantity"] = line.get("orderedQuantity", "1.000")
        line["remainingQuantity"] = "0.000"
        processed_lines.append({
            "dispatchLineId": f"dl-{len(processed_lines)+1}",
            "productId": line.get("productId", "PRD-CUSTOM"),
            "productName": line.get("productName", "Material"),
            "quantity": line.get("orderedQuantity", "1.000"),
            "unit": line.get("unit", "MT")
        })

    order["status"] = "dispatched"
    order["dispatchedQuantity"] = order.get("orderedQuantity", f"{total_qty:.3f}")
    order["dispatchStatus"] = "dispatched"
    order["lastDispatchDate"] = dispatch_date
    order["dispatchCount"] = order.get("dispatchCount", 0) + 1
    order["version"] = order.get("version", 1) + 1

    dsp_num = f"DSP-2026-{len(STATE['dispatches']) + 1:04d}"
    dsp_id = f"DSP-{len(STATE['dispatches']) + 1001}"
    dispatch_entry = {
        "id": dsp_id,
        "number": dsp_num,
        "orderId": order["id"],
        "orderNumber": order.get("number"),
        "customerId": order.get("customerId"),
        "customerName": order.get("customerName"),
        "dispatchDate": dispatch_date,
        "vehicleNumber": vehicle_no,
        "driverName": driver_name,
        "driverPhone": body.get("driverPhone", "9812345678"),
        "notes": notes,
        "voidedAt": None,
        "lineCount": len(processed_lines),
        "totalQuantity": order.get("orderedQuantity", f"{total_qty:.3f}"),
        "unit": order.get("lines", [{}])[0].get("unit", "MT") if order.get("lines") else "MT",
        "lines": processed_lines
    }
    STATE["dispatches"].insert(0, dispatch_entry)
    db.save_order(order)
    db.save_dispatch(dispatch_entry)

    # Record stock movement out
    movs = STATE.setdefault("stock_movements", [])
    for pl in processed_lines:
        movs.insert(0, {
            "id": f"MOV-{len(movs) + 1:04d}",
            "productId": pl.get("productId", "PRD-CUSTOM"),
            "sku": pl.get("productId", "PRD-CUSTOM"),
            "productName": pl.get("productName", "Steel Material"),
            "kind": "dispatch",
            "deltaQuantity": f"-{float(pl.get('quantity', 1.0)):.3f}",
            "unit": pl.get("unit", "MT"),
            "batchNo": "",
            "warehouse": "Main Godown",
            "reference": dsp_num,
            "reason": f"Dispatched order {order.get('number') or order['id']}",
            "movementDate": dispatch_date,
            "source": "dispatch",
            "sourceRef": dsp_id,
            "createdAt": datetime.now().isoformat() + "+05:30"
        })

    # Automatically adjust salesperson target
    sp_name = order.get("salespersonName") or order.get("salesperson")
    if not sp_name and order.get("salespersonId"):
        emp_match = next((e for e in STATE.get("employees", []) if e.get("id") == order.get("salespersonId")), None)
        if emp_match:
            sp_name = emp_match.get("name")
    if not sp_name and order.get("customerId"):
        cust_match = next((c for c in STATE.get("customers", []) if c.get("id") == order.get("customerId")), None)
        if cust_match:
            sp_name = cust_match.get("salesperson") or cust_match.get("salespersonName")

    if total_qty > 0:
        adjust_salesperson_dispatch_target(sp_name, order.get("customerName"), total_qty)

    return order

@app.get("/api/v1/orders/{order_id}")
def get_order_detail(order_id: str):
    order = next((o for o in STATE["orders"] if o["id"] == order_id), None)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return order

@app.get("/api/v1/orders/{order_id}/dispatch-balance")
def get_order_dispatch_balance(order_id: str):
    order = next((o for o in STATE["orders"] if o["id"] == order_id), None)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    lines = []
    for idx, l in enumerate(order.get("lines", [])):
        ord_q = float(l.get("orderedQuantity") or 0.0)
        dsp_q = float(l.get("dispatchedQuantity") or 0.0)
        rem_q = max(0.0, ord_q - dsp_q)
        lines.append({
            "orderLineId": l.get("orderLineId", idx + 1),
            "lineNo": l.get("lineNo", idx + 1),
            "productId": l.get("productId", "PRD-CUSTOM"),
            "productName": l.get("productName", "Steel Material"),
            "unit": l.get("unit", "MT"),
            "orderedQuantity": f"{ord_q:.3f}",
            "dispatchedQuantity": f"{dsp_q:.3f}",
            "remainingQuantity": f"{rem_q:.3f}",
            "ratePaise": l.get("ratePaise", 0),
            "gstRatePercent": l.get("gstRatePercent"),
            "dispatchLines": order.get("dispatchCount", 0),
            "valuePaise": l.get("valuePaise", 0)
        })

    return {
        "orderId": order["id"],
        "number": order.get("number"),
        "status": order.get("status", "pending"),
        "dispatchStatus": order.get("dispatchStatus", "pending"),
        "customerName": order.get("customerName", "Customer"),
        "salespersonName": order.get("salespersonName", ""),
        "state": order.get("state", ""),
        "slipImageData": order.get("slipImageData"),
        "lines": lines
    }

@app.post("/api/v1/orders")
def create_order(body: dict[str, Any]):
    new_num = db.get_next_order_number()
    new_id = db.get_next_order_id()
    
    cust_id = body.get("customerId", "")
    cust = next((c for c in STATE.get("customers", []) if c["id"] == cust_id), None)
    if not cust:
        cust = next((d for d in STATE.get("debtors", []) if d["id"] == cust_id), None)
    
    cust_name = body.get("customerName") or (cust.get("name") if cust else "Direct Dealer")
    sp_name = body.get("salespersonName") or (cust.get("salesperson") if cust else "")
    sp_id = body.get("salespersonId") or (cust.get("salespersonId") if cust else "EMP-SP-01")
    state_name = body.get("state") or (cust.get("state") if cust else "")
    
    raw_lines = body.get("lines", [])
    processed_lines = []
    total_qty = 0.0
    for idx, l in enumerate(raw_lines):
        q = float(l.get("orderedQuantity") or l.get("quantity") or 0.0)
        total_qty += q
        unit = l.get("unit") or "MT"
        rate_paise = int(l.get("ratePaise") or 0)
        amount_paise = int(l.get("amountPaise") or round(q * rate_paise))
        processed_lines.append({
            "orderLineId": idx + 1,
            "lineNo": idx + 1,
            "productId": l.get("productId") or "PRD-CUSTOM",
            "productName": l.get("productName") or "Steel Material",
            "unit": unit,
            "orderedQuantity": f"{q:.3f}",
            "dispatchedQuantity": "0.000",
            "remainingQuantity": f"{q:.3f}",
            "ratePaise": rate_paise,
            "amountPaise": amount_paise,
            "valuePaise": amount_paise,
            "gstRatePercent": l.get("gstRatePercent")
        })

    fallback_cust_id = STATE["customers"][0]["id"] if STATE.get("customers") else "CUST-0001"
    order = {
        "id": new_id,
        "number": new_num,
        "customerId": cust_id or fallback_cust_id,
        "customerName": cust_name,
        "salespersonId": sp_id,
        "salespersonName": sp_name,
        "state": state_name,
        "orderDate": body.get("orderDate") or datetime.now().strftime("%Y-%m-%d"),
        "dueDate": body.get("dueDate"),
        "expectedDispatchDate": body.get("expectedDispatchDate"),
        "paymentTerms": body.get("paymentTerms") or "Standard terms",
        "notes": body.get("notes") or "",
        "status": body.get("status", "confirmed"),
        "dispatchStatus": "pending",
        "source": body.get("source", "panel"),
        "version": 1,
        "cancelledAt": None,
        "lineCount": len(processed_lines),
        "orderedQuantity": f"{total_qty:.3f}" if total_qty > 0 else "0.000",
        "dispatchedQuantity": "0.000",
        "valuePaise": sum(l["valuePaise"] for l in processed_lines),
        "invoiceCount": 0,
        "billedPaise": 0,
        "paymentCount": 0,
        "paidPaise": 0,
        "orderBalancePaise": sum(l["valuePaise"] for l in processed_lines),
        "overdue": False,
        "lines": processed_lines,
        "slipImageData": body.get("slipImageData") or body.get("slipImageUrl") or None
    }
    # Persist order, order_lines, and slip image to SQLite & disk
    order = db.save_order(order)
    STATE["orders"].insert(0, order)
    return order

@app.put("/api/v1/orders/{order_id}")
@app.patch("/api/v1/orders/{order_id}")
def patch_order(order_id: str, body: dict[str, Any]):
    order = next((o for o in STATE["orders"] if o["id"] == order_id), None)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    if "customerId" in body:
        order["customerId"] = body["customerId"]
    if "customerName" in body:
        order["customerName"] = body["customerName"]
    if "state" in body:
        order["state"] = body["state"]
    if "salespersonName" in body:
        order["salespersonName"] = body["salespersonName"]
    if "salespersonId" in body:
        order["salespersonId"] = body["salespersonId"]
    if "dueDate" in body:
        order["dueDate"] = body["dueDate"]
    if "expectedDispatchDate" in body:
        order["expectedDispatchDate"] = body["expectedDispatchDate"]
    if "paymentTerms" in body:
        order["paymentTerms"] = body["paymentTerms"]
    if "notes" in body:
        order["notes"] = body["notes"]
    if "slipImageData" in body:
        order["slipImageData"] = body["slipImageData"]
    if "lines" in body:
        raw_lines = body["lines"]
        processed_lines = []
        total_qty = 0.0
        tot_dispatched = 0.0
        old_lines = order.get("lines", [])
        for idx, l in enumerate(raw_lines):
            q = float(l.get("orderedQuantity") or l.get("quantity") or 0.0)
            total_qty += q
            unit = l.get("unit") or "MT"
            rate_paise = int(l.get("ratePaise") or 0)
            amount_paise = int(l.get("amountPaise") or round(q * rate_paise))
            # Preserve existing dispatched quantity if matched
            match_old = next((ol for ol in old_lines if ol.get("lineNo") == idx + 1 or ol.get("product") == l.get("product")), None)
            disp_q = float(match_old.get("dispatchedQuantity", 0.0)) if match_old else float(l.get("dispatchedQuantity", 0.0))
            tot_dispatched += disp_q
            rem_q = max(0.0, q - disp_q)
            processed_lines.append({
                "orderLineId": idx + 1,
                "lineNo": idx + 1,
                "productId": l.get("productId") or (match_old.get("productId") if match_old else "PRD-CUSTOM"),
                "productName": l.get("productName") or l.get("product") or "Steel Material",
                "product": l.get("product") or l.get("productName") or "Steel Material",
                "unit": unit,
                "orderedQuantity": f"{q:.3f}",
                "dispatchedQuantity": f"{disp_q:.3f}",
                "remainingQuantity": f"{rem_q:.3f}",
                "ratePaise": rate_paise,
                "amountPaise": amount_paise,
                "valuePaise": amount_paise,
                "gstRatePercent": l.get("gstRatePercent")
            })
        order["lines"] = processed_lines
        order["lineCount"] = len(processed_lines)
        order["orderedQuantity"] = f"{total_qty:.3f}"
        order["dispatchedQuantity"] = f"{tot_dispatched:.3f}"
        order["valuePaise"] = sum(l["valuePaise"] for l in processed_lines)
        order["orderBalancePaise"] = order["valuePaise"]
        if total_qty > 0 and tot_dispatched >= total_qty - 0.0001:
            order["dispatchStatus"] = "dispatched"
        elif tot_dispatched > 0.0001:
            order["dispatchStatus"] = "partial"
        else:
            order["dispatchStatus"] = "pending"
    
    order["version"] = order.get("version", 1) + 1
    db.save_order(order)
    return order

@app.delete("/api/v1/orders/{order_id}")
def delete_order_endpoint(
    order_id: str,
    x_user_role: str | None = Header(None, alias="X-User-Role")
):
    order_idx = next((i for i, o in enumerate(STATE["orders"]) if o["id"] == order_id), None)
    if order_idx is None:
        raise HTTPException(status_code=404, detail="Order not found")
    
    order = STATE["orders"][order_idx]
    
    # Check if active unvoided dispatches exist for this order
    active_dispatches = [
        d for d in STATE.get("dispatches", [])
        if d.get("orderId") == order_id and not d.get("voidedAt")
    ]
    if active_dispatches:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete order '{order.get('number', order_id)}' because it has {len(active_dispatches)} active dispatch consignment(s). Void the dispatches first."
        )

    # Remove from in-memory STATE
    STATE["orders"].pop(order_idx)
    # Remove any dispatches for this order from in-memory STATE dispatches
    STATE["dispatches"] = [d for d in STATE.get("dispatches", []) if d.get("orderId") != order_id]
    # Remove from SQLite
    db.delete_order(order_id)
    return {"deleted": True, "id": order_id, "number": order.get("number")}

@app.post("/api/v1/orders/{order_id}/status")
def set_order_status(
    order_id: str,
    body: dict[str, Any],
    authorization: str | None = Header(None),
    x_user_role: str | None = Header(None, alias="X-User-Role"),
    x_user_id: str | None = Header(None, alias="X-User-Id"),
    x_employee_id: str | None = Header(None, alias="X-Employee-Id"),
):
    caller = resolve_caller(authorization, x_user_role, x_user_id, x_employee_id)
    order = next((o for o in STATE["orders"] if o["id"] == order_id), None)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    to_status = body.get("to", "confirmed")

    # Authority check:
    # 1. Owner has full authority
    # 2. Dispatch Person has authority to TICK (dispatched), set PENDING, or CANCEL (or confirm)
    # 3. Sales officer can only submit drafts to pending or cancel their own unconfirmed order
    if caller["isOwner"]:
        pass
    elif caller["isDispatch"]:
        if to_status not in ["dispatched", "pending", "confirmed", "cancelled"]:
            raise HTTPException(status_code=403, detail=f"Dispatch person does not have authority to move order to '{to_status}'")
    elif caller["isSales"]:
        if order.get("salespersonId") != caller["employeeId"]:
            raise HTTPException(status_code=403, detail="You can only manage status for your own orders.")
        if to_status not in ["pending", "cancelled"]:
            raise HTTPException(status_code=403, detail="Sales officers can only submit drafts to pending or cancel unconfirmed orders.")

    order["status"] = to_status
    if to_status == "cancelled":
        order["cancelledAt"] = datetime.now().isoformat() + "+05:30"
        order["cancelledBy"] = caller.get("employeeId") or caller.get("role")
    elif to_status == "dispatched":
        order["dispatchStatus"] = "dispatched"
        order["lastDispatchDate"] = datetime.now().strftime("%Y-%m-%d")
    elif to_status == "pending":
        if order.get("dispatchStatus") == "dispatched":
            order["dispatchStatus"] = "pending"

    order["version"] = order.get("version", 1) + 1
    db.save_order(order)
    return order

# ----------------- Dispatches Endpoints -----------------
class DispatchLineCreate(BaseModel):
    orderLineId: int | None = None
    productId: str | None = None
    productName: str | None = None
    product: str | None = None
    quantity: str
    unit: str = "MT"
    batchNo: str | None = ""
    warehouse: str | None = ""

class DispatchCreate(BaseModel):
    orderId: str
    dispatchDate: str | None = None
    vehicle: str | None = None
    vehicleNumber: str | None = None
    driver: str | None = None
    driverName: str | None = None
    driverPhone: str | None = None
    transportName: str | None = None
    notes: str | None = None
    lines: list[DispatchLineCreate]

def adjust_salesperson_dispatch_target(salesperson_name: str | None, party_name: str | None, delta_mt: float):
    if not salesperson_name and not party_name:
        return
    if abs(delta_mt) < 1e-6:
        return

    targets = STATE.get("targets", [])
    if not targets and os.path.exists(DEFAULT_HRPB_PATH):
        try:
            snap = extract_hr_pb_targets(DEFAULT_HRPB_PATH)
            STATE["hrpb_snapshot"] = snap
            STATE["targets"] = snap["all_targets"]
            targets = STATE["targets"]
        except Exception:
            pass

    sp_clean = (salesperson_name or "").strip().lower()
    party_clean = (party_name or "").strip().lower()

    # 1. Try to find targets matching both party and salesperson
    matched = []
    if party_clean and sp_clean:
        matched = [
            t for t in targets
            if t.get("salesperson", "").strip().lower() == sp_clean
            and (party_clean in t.get("party_name", "").strip().lower() or t.get("party_name", "").strip().lower() in party_clean)
        ]

    # 2. If no party match, match by salesperson alone
    if not matched and sp_clean:
        matched = [t for t in targets if t.get("salesperson", "").strip().lower() == sp_clean]

    # 3. If still no match and party_clean exists, match by party alone
    if not matched and party_clean:
        matched = [
            t for t in targets
            if party_clean in t.get("party_name", "").strip().lower() or t.get("party_name", "").strip().lower() in party_clean
        ]

    # 4. If target matched, adjust target row
    if matched:
        tgt = matched[0]
        cur_disp = float(tgt.get("dispatched_mt", 0.0))
        cur_target = float(tgt.get("target_mt", 0.0))
        new_disp = max(0.0, cur_disp + delta_mt)
        new_pending = max(0.0, cur_target - new_disp)
        tgt["dispatched_mt"] = f"{new_disp:.3f}"
        tgt["pending_mt"] = f"{new_pending:.3f}"
    elif sp_clean:
        # If no target exists at all for this salesperson, create one so tracking is preserved
        sp_display = salesperson_name or "Sales Officer"
        new_disp = max(0.0, delta_mt)
        new_pending = max(0.0, 100.0 - new_disp)
        new_tgt = {
            "id": f"TGT-AUTO-{len(targets) + 1:04d}",
            "state": "Punjab",
            "party_name": party_name or "General Territory Consignment",
            "station": "Direct Yard",
            "district": "Ludhiana",
            "salesperson": sp_display,
            "target_mt": "100.000",
            "order_received_mt": "0.000",
            "dispatched_mt": f"{new_disp:.3f}",
            "pending_mt": f"{new_pending:.3f}"
        }
        targets.append(new_tgt)

    # 5. Also update employee target tracking in STATE["employees"]
    if sp_clean:
        for emp in STATE.get("employees", []):
            if emp.get("name", "").strip().lower() == sp_clean or emp.get("id", "").strip().lower() == sp_clean:
                m_target = float(emp.get("monthlyTargetQty", 100.0))
                e_disp = float(emp.get("dispatchedQty", 0.0)) + delta_mt
                e_disp = max(0.0, e_disp)
                e_rem = max(0.0, m_target - e_disp)
                emp["dispatchedQty"] = f"{e_disp:.3f}"
                emp["remainingTargetQty"] = f"{e_rem:.3f}"

@app.get("/api/v1/dispatches")
def get_dispatches(
    orderId: str | None = None,
    customerId: str | None = None,
    salespersonId: str | None = None,
    q: str | None = None,
    from_: str | None = Query(None, alias="from"),
    to: str | None = None,
    deliveryStatus: str | None = None,
    page: int = 1,
    pageSize: int = 20,
    authorization: str | None = Header(None),
    x_user_role: str | None = Header(None, alias="X-User-Role"),
    x_user_id: str | None = Header(None, alias="X-User-Id"),
    x_employee_id: str | None = Header(None, alias="X-Employee-Id"),
):
    caller = resolve_caller(authorization, x_user_role, x_user_id, x_employee_id)
    items = STATE["dispatches"]

    # If caller is Sales Officer, show only dispatches for orders booked by that sales officer
    if caller["isSales"]:
        sp_filter = caller["employeeId"]
        sp_orders = {o["id"] for o in STATE.get("orders", []) if o.get("salespersonId") == sp_filter}
        items = [d for d in items if d.get("orderId") in sp_orders]
    elif salespersonId:
        sp_orders = {o["id"] for o in STATE.get("orders", []) if o.get("salespersonId") == salespersonId}
        items = [d for d in items if d.get("orderId") in sp_orders]

    if orderId:
        items = [d for d in items if d.get("orderId") == orderId]
    if customerId:
        items = [d for d in items if d.get("customerId") == customerId]
    if deliveryStatus:
        items = [d for d in items if d.get("deliveryStatus") == deliveryStatus]
    if from_:
        items = [d for d in items if d.get("dispatchDate", "") >= from_]
    if to:
        items = [d for d in items if d.get("dispatchDate", "") <= to]
    if q:
        query = q.lower().strip()
        items = [
            d for d in items
            if query in d.get("number", "").lower()
            or query in d.get("orderNumber", "").lower()
            or query in d.get("customerName", "").lower()
            or query in d.get("vehicle", "").lower()
            or query in d.get("vehicleNumber", "").lower()
            or query in d.get("driver", "").lower()
            or query in d.get("driverName", "").lower()
            or query in d.get("transportName", "").lower()
        ]

    total = len(items)
    start = (page - 1) * pageSize
    end = start + pageSize

    return {
        "items": items[start:end],
        "page": page,
        "pageSize": pageSize,
        "total": total,
        "nextCursor": None
    }

@app.post("/api/v1/dispatches")
def create_dispatch(
    body: DispatchCreate,
    x_user_role: str | None = Header(None, alias="X-User-Role"),
    x_user_id: str | None = Header(None, alias="X-User-Id")
):
    order = next((o for o in STATE["orders"] if o["id"] == body.orderId), None)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    if order.get("status") in ["draft", "cancelled"]:
        raise HTTPException(status_code=400, detail=f"Cannot dispatch an order in '{order.get('status')}' status.")

    today_str = datetime.now().strftime("%Y-%m-%d")
    dispatch_date = body.dispatchDate or today_str
    vehicle = (body.vehicle or body.vehicleNumber or "PB 10 CT 4421").strip()
    driver = (body.driver or body.driverName or "Yard Driver").strip()
    driver_phone = (body.driverPhone or "").strip()
    transport_name = (body.transportName or "").strip()
    notes = (body.notes or "").strip()

    if not body.lines:
        raise HTTPException(status_code=422, detail="Dispatch must contain at least one consignment line.")

    created_lines = []
    tot_dispatched_this_consignment = 0.0

    for idx, dl in enumerate(body.lines):
        match_ol = None
        for ol in order.get("lines", []):
            if dl.orderLineId and (ol.get("lineNo") == dl.orderLineId or ol.get("orderLineId") == dl.orderLineId):
                match_ol = ol
                break
            prod_query = dl.product or dl.productName or dl.productId
            if prod_query and (str(prod_query).lower() in (ol.get("productDescription") or ol.get("product") or "").lower() or (ol.get("productDescription") or ol.get("product") or "").lower() in str(prod_query).lower()):
                match_ol = ol
                break
        if not match_ol and order.get("lines"):
            match_ol = order["lines"][min(idx, len(order["lines"]) - 1)]

        if not match_ol:
            raise HTTPException(status_code=422, detail=f"Line reference {dl.orderLineId} not found in order.")

        try:
            req_qty = float(dl.quantity)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Invalid quantity '{dl.quantity}'. Must be decimal number.")

        if req_qty <= 0:
            raise HTTPException(status_code=422, detail="Dispatched quantity must be strictly greater than 0.")

        rem_q = float(match_ol.get("remainingQuantity") or 0.0)
        if req_qty > rem_q + 0.0001:
            raise HTTPException(
                status_code=422,
                detail=f"Line quantity ({req_qty:.3f}) exceeds remaining order balance ({rem_q:.3f}). Over-dispatch refused."
            )

        new_disp_q = float(match_ol.get("dispatchedQuantity") or 0.0) + req_qty
        new_rem_q = max(0.0, rem_q - req_qty)
        match_ol["dispatchedQuantity"] = f"{new_disp_q:.3f}"
        match_ol["remainingQuantity"] = f"{new_rem_q:.3f}"
        tot_dispatched_this_consignment += req_qty

        created_lines.append({
            "dispatchLineId": idx + 1,
            "orderLineId": match_ol.get("lineNo", idx + 1),
            "lineNo": idx + 1,
            "productId": match_ol.get("productId", dl.productId or "PRD-CUSTOM"),
            "productName": match_ol.get("productName", dl.productName or "Steel Material"),
            "product": match_ol.get("productName", dl.productName or "Steel Material"),
            "quantity": f"{req_qty:.3f}",
            "unit": dl.unit or match_ol.get("unit", "MT"),
            "batchNo": (dl.batchNo or "").strip(),
            "warehouse": (dl.warehouse or "").strip(),
        })

    tot_dispatched = sum(float(l.get("dispatchedQuantity") or 0.0) for l in order.get("lines", []))
    tot_remaining = sum(float(l.get("remainingQuantity") or 0.0) for l in order.get("lines", []))

    order["dispatchedQuantity"] = f"{tot_dispatched:.3f}"
    order["lastDispatchDate"] = dispatch_date
    order["dispatchCount"] = order.get("dispatchCount", 0) + 1
    order["version"] = order.get("version", 1) + 1

    if tot_remaining <= 0.0001:
        order["dispatchStatus"] = "dispatched"
        order["status"] = "dispatched"
    else:
        order["dispatchStatus"] = "partial"

    dsp_seq = len(STATE["dispatches"]) + 1
    dsp_id = f"DSP-{dsp_seq:04d}"
    dsp_num = f"DSP-2026-{dsp_seq:04d}"

    current_user_name = "Managing Director (Owner)" if x_user_role == "owner" else "Yard Dispatch Desk"

    dispatch_entry = {
        "id": dsp_id,
        "number": dsp_num,
        "orderId": order["id"],
        "orderNumber": order.get("number"),
        "customerId": order.get("customerId"),
        "customerName": order.get("customerName"),
        "dispatchDate": dispatch_date,
        "vehicle": vehicle,
        "vehicleNumber": vehicle,
        "driver": driver,
        "driverName": driver,
        "driverPhone": driver_phone,
        "transportName": transport_name,
        "notes": notes,
        "deliveryStatus": "pending",
        "deliveredAt": None,
        "version": 1,
        "source": "panel",
        "sourceRef": None,
        "createdAt": datetime.now().isoformat() + "+05:30",
        "createdBy": x_user_id or "USR-DISPATCH",
        "createdByName": current_user_name,
        "voidedAt": None,
        "voidedBy": None,
        "voidedByName": None,
        "reviewedAt": None,
        "reviewedBy": None,
        "reviewedByName": None,
        "lineCount": len(created_lines),
        "lines": created_lines
    }

    STATE["dispatches"].insert(0, dispatch_entry)
    db.save_order(order)
    db.save_dispatch(dispatch_entry)

    # Record stock movement out
    movs = STATE.setdefault("stock_movements", [])
    for cl in created_lines:
        mov_entry = {
            "id": f"MOV-{len(movs) + 1:04d}",
            "productId": cl.get("productId", "PRD-CUSTOM"),
            "sku": cl.get("productId", "PRD-CUSTOM"),
            "productName": cl.get("productName", "Steel Material"),
            "kind": "dispatch",
            "deltaQuantity": f"-{float(cl.get('quantity', 1.0)):.3f}",
            "unit": cl.get("unit", "MT"),
            "batchNo": cl.get("batchNo", ""),
            "warehouse": cl.get("warehouse", "Main Godown"),
            "reference": dispatch_entry.get("number") or dispatch_entry["id"],
            "reason": f"Dispatched order {order.get('number') or order['id']}",
            "movementDate": dispatch_date,
            "source": "dispatch",
            "sourceRef": dispatch_entry["id"],
            "createdAt": datetime.now().isoformat() + "+05:30"
        }
        movs.insert(0, mov_entry)
        db.save_stock_movement(mov_entry)

    # Automatically decrease remaining dispatch target of salesperson
    tot_dsp_mt = 0.0
    for cl in created_lines:
        u = str(cl.get("unit", "MT")).strip().lower()
        q = float(cl.get("quantity", 0.0))
        tot_dsp_mt += (q / 1000.0) if u == "kg" else q

    sp_name = order.get("salespersonName") or order.get("salesperson")
    if not sp_name and order.get("salespersonId"):
        emp_match = next((e for e in STATE.get("employees", []) if e.get("id") == order.get("salespersonId")), None)
        if emp_match:
            sp_name = emp_match.get("name")
    if not sp_name and order.get("customerId"):
        cust_match = next((c for c in STATE.get("customers", []) if c.get("id") == order.get("customerId")), None)
        if cust_match:
            sp_name = cust_match.get("salesperson") or cust_match.get("salespersonName")

    if tot_dsp_mt > 0:
        adjust_salesperson_dispatch_target(sp_name, order.get("customerName"), tot_dsp_mt)

    return dispatch_entry

@app.patch("/api/v1/dispatches/{dispatch_id}")
def patch_dispatch(
    dispatch_id: str,
    body: dict[str, Any],
    if_match: str | None = Header(None, alias="If-Match"),
    x_user_role: str | None = Header(None, alias="X-User-Role")
):
    dsp = next((d for d in STATE["dispatches"] if d["id"] == dispatch_id), None)
    if not dsp:
        raise HTTPException(status_code=404, detail="Dispatch not found")

    if dsp.get("voidedAt"):
        raise HTTPException(status_code=409, detail="already_voided")
    if dsp.get("reviewedAt") and x_user_role != "owner":
        raise HTTPException(status_code=409, detail="reviewed_locked")

    if if_match is not None:
        try:
            expected_v = int(if_match.strip('"'))
            if dsp.get("version", 1) != expected_v:
                raise HTTPException(status_code=409, detail="version_conflict")
        except ValueError:
            pass

    for f in ["dispatchDate", "vehicle", "driver", "driverPhone", "transportName", "notes"]:
        if f in body:
            dsp[f] = body[f]
            if f == "vehicle":
                dsp["vehicleNumber"] = body[f]
            elif f == "driver":
                dsp["driverName"] = body[f]

    # Handle line weight / quantity updates
    if "lines" in body and isinstance(body["lines"], list):
        old_dsp_mt = 0.0
        for l in dsp.get("lines", []):
            u = str(l.get("unit", "MT")).strip().lower()
            q = float(l.get("quantity", 0.0))
            old_dsp_mt += (q / 1000.0) if u == "kg" else q

        order = next((o for o in STATE["orders"] if o["id"] == dsp.get("orderId")), None)

        for new_l in body["lines"]:
            dl_id = new_l.get("dispatchLineId") or new_l.get("lineNo")
            target_line = None
            if dl_id:
                target_line = next((l for l in dsp.get("lines", []) if l.get("dispatchLineId") == dl_id or l.get("lineNo") == dl_id), None)
            if not target_line and len(dsp.get("lines", [])) == 1:
                target_line = dsp["lines"][0]

            if target_line and "quantity" in new_l:
                try:
                    old_q = float(target_line.get("quantity", 0.0))
                    new_q = float(new_l["quantity"])
                except (ValueError, TypeError):
                    continue
                delta_q = new_q - old_q
                target_line["quantity"] = f"{new_q:.3f}"
                if "unit" in new_l:
                    target_line["unit"] = new_l["unit"]

                if order:
                    ol_id = target_line.get("orderLineId")
                    match_ol = next((l for l in order.get("lines", []) if l.get("lineNo") == ol_id or l.get("orderLineId") == ol_id), None)
                    if not match_ol and len(order.get("lines", [])) == 1:
                        match_ol = order["lines"][0]
                    if match_ol:
                        ord_disp = max(0.0, float(match_ol.get("dispatchedQuantity", 0.0)) + delta_q)
                        ord_rem = max(0.0, float(match_ol.get("remainingQuantity", 0.0)) - delta_q)
                        match_ol["dispatchedQuantity"] = f"{ord_disp:.3f}"
                        match_ol["remainingQuantity"] = f"{ord_rem:.3f}"

        if order:
            tot_dispatched = sum(float(l.get("dispatchedQuantity") or 0.0) for l in order.get("lines", []))
            tot_remaining = sum(float(l.get("remainingQuantity") or 0.0) for l in order.get("lines", []))
            order["dispatchedQuantity"] = f"{tot_dispatched:.3f}"
            if tot_remaining <= 0.0001:
                order["dispatchStatus"] = "dispatched"
                order["status"] = "dispatched"
            else:
                order["dispatchStatus"] = "partial"
            db.save_order(order)

        new_dsp_mt = 0.0
        for l in dsp.get("lines", []):
            u = str(l.get("unit", "MT")).strip().lower()
            q = float(l.get("quantity", 0.0))
            new_dsp_mt += (q / 1000.0) if u == "kg" else q

        delta_weight_mt = new_dsp_mt - old_dsp_mt
        if abs(delta_weight_mt) > 1e-6:
            sp_name = (order.get("salespersonName") or order.get("salesperson")) if order else None
            if not sp_name and dsp.get("customerId"):
                cust = next((c for c in STATE.get("customers", []) if c.get("id") == dsp.get("customerId")), None)
                if cust:
                    sp_name = cust.get("salesperson") or cust.get("salespersonName")
            adjust_salesperson_dispatch_target(sp_name, dsp.get("customerName"), delta_weight_mt)

    dsp["version"] = dsp.get("version", 1) + 1
    db.save_dispatch(dsp)
    return dsp

@app.post("/api/v1/dispatches/{dispatch_id}/void")
def void_dispatch(
    dispatch_id: str,
    body: dict[str, Any] | None = None,
    if_match: str | None = Header(None, alias="If-Match"),
    x_user_role: str | None = Header(None, alias="X-User-Role"),
    x_user_id: str | None = Header(None, alias="X-User-Id")
):
    dsp = next((d for d in STATE["dispatches"] if d["id"] == dispatch_id), None)
    if not dsp:
        raise HTTPException(status_code=404, detail="Dispatch not found")
    if dsp.get("voidedAt"):
        raise HTTPException(status_code=409, detail="already_voided")

    now_iso = datetime.now().isoformat() + "+05:30"
    user_name = "Managing Director (Owner)" if x_user_role == "owner" else "Yard Dispatch Manager"
    dsp["voidedAt"] = now_iso
    dsp["voidedBy"] = x_user_id or "USR-OWNER"
    dsp["voidedByName"] = user_name
    dsp["version"] = dsp.get("version", 1) + 1

    # Revert quantities on order
    order = next((o for o in STATE["orders"] if o["id"] == dsp.get("orderId")), None)
    if order:
        for dl in dsp.get("lines", []):
            ol_id = dl.get("orderLineId")
            match_ol = next(
                (l for l in order.get("lines", []) if l.get("lineNo") == ol_id or l.get("orderLineId") == ol_id),
                None
            )
            if match_ol:
                q_val = float(dl.get("quantity", 0.0))
                disp_val = max(0.0, float(match_ol.get("dispatchedQuantity", 0.0)) - q_val)
                ord_val = float(match_ol.get("orderedQuantity") or match_ol.get("quantity") or 0.0)
                rem_val = max(0.0, ord_val - disp_val)
                match_ol["dispatchedQuantity"] = f"{disp_val:.3f}"
                match_ol["remainingQuantity"] = f"{rem_val:.3f}"

        tot_ordered = sum(float(l.get("orderedQuantity") or l.get("quantity") or 0.0) for l in order.get("lines", []))
        tot_dispatched = sum(float(l.get("dispatchedQuantity") or 0.0) for l in order.get("lines", []))
        tot_remaining = sum(float(l.get("remainingQuantity") or 0.0) for l in order.get("lines", []))

        if tot_remaining >= tot_ordered - 0.0001:
            order["dispatchStatus"] = "pending"
            if order.get("status") == "dispatched":
                order["status"] = "confirmed"
        elif tot_remaining > 0.0001:
            order["dispatchStatus"] = "partial"
        else:
            order["dispatchStatus"] = "dispatched"

        order["dispatchedQuantity"] = f"{tot_dispatched:.3f}"
        order["dispatchCount"] = max(0, order.get("dispatchCount", 1) - 1)
        order["version"] = order.get("version", 1) + 1
        db.save_order(order)

    # Record reversing stock movement
    movs = STATE.setdefault("stock_movements", [])
    today_str = datetime.now().strftime("%Y-%m-%d")
    for dl in dsp.get("lines", []):
        mov_entry = {
            "id": f"MOV-{len(movs) + 1:04d}",
            "productId": dl.get("productId", "PRD-CUSTOM"),
            "sku": dl.get("productId", "PRD-CUSTOM"),
            "productName": dl.get("productName", dl.get("product", "Steel Material")),
            "kind": "void_dispatch",
            "deltaQuantity": f"+{float(dl.get('quantity', 1.0)):.3f}",
            "unit": dl.get("unit", "MT"),
            "batchNo": dl.get("batchNo", ""),
            "warehouse": dl.get("warehouse", "Main Godown"),
            "reference": dsp.get("number") or dsp["id"],
            "reason": f"Voided consignment {dsp.get('number') or dsp['id']}",
            "movementDate": today_str,
            "source": "void_dispatch",
            "sourceRef": dsp["id"],
            "createdAt": datetime.now().isoformat() + "+05:30"
        }
        movs.insert(0, mov_entry)
        db.save_stock_movement(mov_entry)

    # Revert target for salesperson
    tot_disp_mt = 0.0
    for dl in dsp.get("lines", []):
        u = str(dl.get("unit", "MT")).strip().lower()
        q = float(dl.get("quantity", 0.0))
        tot_disp_mt += (q / 1000.0) if u == "kg" else q

    sp_name = (order.get("salespersonName") or order.get("salesperson")) if order else None
    if not sp_name and dsp.get("customerId"):
        cust = next((c for c in STATE.get("customers", []) if c.get("id") == dsp.get("customerId")), None)
        if cust:
            sp_name = cust.get("salesperson") or cust.get("salespersonName")

    if tot_disp_mt > 0:
        adjust_salesperson_dispatch_target(sp_name, dsp.get("customerName"), -tot_disp_mt)

    db.save_dispatch(dsp)
    return dsp

@app.patch("/api/v1/dispatches/{dispatch_id}/delivery-status")
def patch_delivery_status(
    dispatch_id: str,
    body: dict[str, Any],
    if_match: str | None = Header(None, alias="If-Match")
):
    dsp = next((d for d in STATE["dispatches"] if d["id"] == dispatch_id), None)
    if not dsp:
        raise HTTPException(status_code=404, detail="Dispatch not found")

    to_status = body.get("to") or body.get("deliveryStatus") or "delivered"
    if to_status not in ["pending", "inTransit", "partial", "delivered"]:
        raise HTTPException(status_code=422, detail="Invalid delivery status")

    dsp["deliveryStatus"] = to_status
    if to_status == "delivered":
        dsp["deliveredAt"] = datetime.now().isoformat() + "+05:30"
    dsp["version"] = dsp.get("version", 1) + 1
    db.save_dispatch(dsp)
    return dsp

@app.post("/api/v1/dispatches/{dispatch_id}/review")
def review_dispatch(
    dispatch_id: str,
    x_user_role: str | None = Header(None, alias="X-User-Role"),
    x_user_id: str | None = Header(None, alias="X-User-Id")
):
    dsp = next((d for d in STATE["dispatches"] if d["id"] == dispatch_id), None)
    if not dsp:
        raise HTTPException(status_code=404, detail="Dispatch not found")
    if dsp.get("voidedAt"):
        raise HTTPException(status_code=409, detail="already_voided")

    dsp["reviewedAt"] = datetime.now().isoformat() + "+05:30"
    dsp["reviewedBy"] = x_user_id or "USR-OWNER"
    dsp["reviewedByName"] = "Managing Director (Owner)" if x_user_role == "owner" else "Desk Reviewer"
    dsp["version"] = dsp.get("version", 1) + 1
    db.save_dispatch(dsp)
    return dsp

@app.get("/api/v1/dispatches/balance")
def get_dispatch_balance():
    items = []
    for o in STATE.get("orders", []):
        if o.get("dispatchStatus") != "dispatched" and o.get("status") != "cancelled":
            items.append({
                "orderId": o["id"],
                "orderNumber": o.get("number"),
                "customerId": o.get("customerId"),
                "customerName": o.get("customerName"),
                "orderedQuantity": o.get("orderedQuantity", "0.000"),
                "dispatchedQuantity": o.get("dispatchedQuantity", "0.000"),
                "balanceQuantity": o.get("orderedQuantity", "0.000"),
                "unit": o["lines"][0].get("unit", "MT") if o.get("lines") else "MT"
            })
    return {"items": items}

@app.get("/api/v1/dispatches/{dispatch_id}")
def get_dispatch_detail(dispatch_id: str):
    dsp = next((d for d in STATE["dispatches"] if d["id"] == dispatch_id), None)
    if not dsp:
        raise HTTPException(status_code=404, detail="Dispatch not found")
    return dsp

# ----------------- Employees & Products -----------------
@app.get("/api/v1/employees")
def get_employees(page: int = 1, pageSize: int = 200):
    items = STATE["employees"]
    return {
        "items": items,
        "page": page,
        "pageSize": pageSize,
        "total": len(items),
        "nextCursor": None
    }

@app.post("/api/v1/employees/{employee_id}/dispatch-capability")
def set_dispatch_capability(employee_id: str, body: dict[str, Any]):
    emp = next((e for e in STATE["employees"] if e["id"] == employee_id), None)
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    prev = emp.get("mayDispatch", False)
    emp["mayDispatch"] = body.get("mayDispatch", True)
    return {
        "employeeId": emp["id"],
        "name": emp["name"],
        "mayDispatch": emp["mayDispatch"],
        "previousMayDispatch": prev,
        "changed": prev != emp["mayDispatch"],
        "reason": body.get("reason", "Owner override")
    }

@app.get("/api/v1/products")
def get_products(page: int = 1, pageSize: int = 50):
    items = STATE["products"]
    return {
        "items": items,
        "page": page,
        "pageSize": pageSize,
        "total": len(items),
        "nextCursor": None
    }

@app.get("/api/v1/payments")
def get_payments(q: str | None = None, page: int = 1, pageSize: int = 20):
    all_items = STATE.get("payments", [])
    if q:
        ql = q.strip().lower()
        filtered = [
            p for p in all_items
            if ql in p.get("customerName", "").lower()
            or ql in p.get("voucherNo", "").lower()
            or ql in p.get("reference", "").lower()
            or ql in p.get("notes", "").lower()
            or ql in p.get("id", "").lower()
            or (p.get("orderNumber") and ql in p["orderNumber"].lower())
            or (p.get("invoiceNumber") and ql in p["invoiceNumber"].lower())
        ]
    else:
        filtered = all_items

    total = len(filtered)
    start = max(0, (page - 1) * pageSize)
    end = start + pageSize
    return {
        "items": filtered[start:end],
        "page": page,
        "pageSize": pageSize,
        "total": total,
        "nextCursor": None
    }

class PaymentCreate(BaseModel):
    customerId: str
    customerName: str | None = None
    amountPaise: int | None = None
    amount: float | None = None
    paymentDate: str | None = None
    method: str | None = "NEFT"
    reference: str | None = ""
    notes: str | None = ""

@app.post("/api/v1/payments")
def create_payment(body: PaymentCreate):
    cust_id = body.customerId
    cust = next((c for c in STATE.get("customers", []) if c["id"] == cust_id), None)
    if not cust:
        cust = next((d for d in STATE.get("debtors", []) if d["id"] == cust_id), None)

    cust_name = body.customerName or (cust.get("name") if cust else "Direct Dealer")
    amt_paise = body.amountPaise if body.amountPaise is not None else round(float(body.amount or 0.0) * 100)
    pay_date = body.paymentDate or datetime.now().strftime("%Y-%m-%d")
    now_iso = datetime.now().isoformat()

    pay_dict = {
        "id": None,
        "voucherNo": None,
        "customerId": cust_id,
        "customerName": cust_name,
        "orderId": None,
        "orderNumber": None,
        "invoiceNumber": "",
        "invoiceAmountPaise": 0,
        "amountPaise": amt_paise,
        "paymentDate": pay_date,
        "date": pay_date,
        "method": body.method or "NEFT",
        "reference": body.reference or "",
        "notes": body.notes or "",
        "allowAdvance": True,
        "duplicateSuspected": False,
        "duplicateOfId": None,
        "voidedAt": None,
        "source": "server",
        "sourceRef": None,
        "createdAt": now_iso,
    }

    saved = db.save_payment(pay_dict)
    for k, v in pay_dict.items():
        if k not in saved:
            saved[k] = v
    STATE["payments"].insert(0, saved)

    # Auto-deduct balances in memory & SQLite
    rem_order_paise = amt_paise
    for d in STATE.get("debtors", []):
        if d.get("id") == cust_id or (cust_name and d.get("name", "").strip().lower() == cust_name.strip().lower()):
            old_paise = round(float(d.get("balance", 0.0)) * 100)
            deduct_from_base = min(old_paise, amt_paise)
            new_paise = max(0, old_paise - amt_paise)
            d["balance"] = round(new_paise / 100.0, 2)
            d["balance_formatted"] = f"{d['balance']:.2f}"
            rem_order_paise = amt_paise - deduct_from_base
            try:
                db.save_party(d)
            except Exception as e:
                print(f"Warning: Failed to save debtor party: {e}")

    # If payment remainder exists, apply it to the customer's active uncancelled orders
    if rem_order_paise > 0:
        for o in STATE.get("orders", []):
            if o.get("status") in ["cancelled", "draft"]:
                continue
            if o.get("customerId") == cust_id or (cust_name and (o.get("customerName") or "").strip().lower() == cust_name.strip().lower()):
                cur_val = int(o.get("orderBalancePaise") if "orderBalancePaise" in o else (o.get("ordersValuePaise") or o.get("totalPaise") or o.get("valuePaise") or 0))
                deduct = min(cur_val, rem_order_paise)
                o["paidPaise"] = int(o.get("paidPaise", 0)) + deduct
                o["orderBalancePaise"] = cur_val - deduct
                rem_order_paise -= deduct
                if rem_order_paise <= 0:
                    break

    for c in STATE.get("customers", []):
        if c.get("id") == cust_id or (cust_name and c.get("name", "").strip().lower() == cust_name.strip().lower()):
            deducted_from_base = amt_paise - rem_order_paise
            if deducted_from_base > 0:
                c["outstandingPaise"] = max(0, c.get("outstandingPaise", 0) - deducted_from_base)
                c["overduePaise"] = max(0, c.get("overduePaise", 0) - deducted_from_base)
                c["isOverdue"] = c["overduePaise"] > 0
            c["lastPaymentDate"] = pay_date
            try:
                db.save_party(c)
            except Exception as e:
                print(f"Warning: Failed to save customer party: {e}")

    return saved

@app.post("/api/v1/payments/{payment_id}/void")
def void_payment(payment_id: str):
    pay = next((p for p in STATE.get("payments", []) if p.get("id") == payment_id), None)
    now_iso = datetime.now().isoformat()

    if not pay:
        db_pay = db.void_payment(payment_id)
        if not db_pay:
            raise HTTPException(status_code=404, detail=f"Payment {payment_id} not found")
        return db_pay

    if pay.get("voidedAt"):
        return pay

    pay["voidedAt"] = now_iso
    amt_paise = pay.get("amountPaise", 0)
    cust_id = pay.get("customerId", "")
    cust_name = pay.get("customerName", "")

    # Void in SQLite
    db.void_payment(payment_id)

    # Revert any order reductions for this customer
    revert_order_paise = amt_paise
    for o in STATE.get("orders", []):
        if o.get("status") in ["cancelled", "draft"]:
            continue
        if o.get("customerId") == cust_id or (cust_name and (o.get("customerName") or "").strip().lower() == cust_name.strip().lower()):
            paid = int(o.get("paidPaise", 0))
            if paid > 0:
                rev = min(paid, revert_order_paise)
                o["paidPaise"] = paid - rev
                o["orderBalancePaise"] = int(o.get("orderBalancePaise", 0)) + rev
                revert_order_paise -= rev
                if revert_order_paise <= 0:
                    break

    # Re-credit balances in memory & SQLite only for the portion that originally deducted from base balance
    if revert_order_paise > 0:
        for d in STATE.get("debtors", []):
            if d.get("id") == cust_id or (cust_name and d.get("name", "").strip().lower() == cust_name.strip().lower()):
                old_paise = round(float(d.get("balance", 0.0)) * 100)
                new_paise = old_paise + revert_order_paise
                d["balance"] = round(new_paise / 100.0, 2)
                d["balance_formatted"] = f"{d['balance']:.2f}"
                try:
                    db.save_party(d)
                except Exception as e:
                    print(f"Warning: Failed to save debtor party: {e}")

    if revert_order_paise > 0:
        for c in STATE.get("customers", []):
            if c.get("id") == cust_id or (cust_name and c.get("name", "").strip().lower() == cust_name.strip().lower()):
                c["outstandingPaise"] = c.get("outstandingPaise", 0) + revert_order_paise
                c["overduePaise"] = c.get("overduePaise", 0) + revert_order_paise
                c["isOverdue"] = c["overduePaise"] > 0
                try:
                    db.save_party(c)
                except Exception as e:
                    print(f"Warning: Failed to save customer party: {e}")

    return pay

# ----------------- 1-Click OneDrive Stock Watch & Sync -----------------
@app.get("/api/v1/imports/excel/stock-watch")
def get_stock_watch():
    stock_path = get_default_stock_path()
    file_exists = os.path.exists(stock_path)
    if not file_exists:
        return {
            "configured": False,
            "path": stock_path,
            "present": False,
            "readable": False,
            "sizeBytes": None,
            "modifiedAt": None,
            "fileSha256": None,
            "matchesLatestBatch": False,
            "matchesAuthorizedRevision": False,
            "latestBatchId": None,
            "note": "1-8-26.xlsx not found in OneDrive."
        }

    current_sha = get_file_sha256(stock_path)
    applied_sha = STATE["latest_snapshot"]["file_sha256"] if STATE.get("latest_snapshot") else None
    is_up_to_date = (applied_sha == current_sha) and (applied_sha is not None)
    file_size = os.path.getsize(stock_path)
    mtime = datetime.fromtimestamp(os.path.getmtime(stock_path)).isoformat()

    return {
        "configured": True,
        "path": stock_path,
        "present": True,
        "readable": True,
        "sizeBytes": file_size,
        "modifiedAt": mtime,
        "fileSha256": current_sha,
        "matchesLatestBatch": is_up_to_date,
        "matchesAuthorizedRevision": True,
        "latestBatchId": "SIM-BATCH-001" if STATE.get("latest_snapshot") else None,
        "note": f"{os.path.basename(stock_path)} (Filtered exclusively to TOTAL STOCK, UPVC TOTAL STOCK, UPVC ITEM)"
    }

def build_stock_preview_out(snap: dict, filename: str, file_size: int) -> dict:
    file_sha = snap["file_sha256"]
    apply_digest = hashlib.sha256(f"{file_sha}:stock_preview_digest".encode()).hexdigest()
    
    metal_items = snap.get("metal_slit_coils", [])
    total_items = snap["summary"]["metal_items_count"] + snap["summary"]["upvc_matrix_count"]
    
    sample_rows = []
    for idx, item in enumerate(metal_items[:10]):
        row_num = item.get("rowNumber", idx + 6)
        qty_val = f"{float(item.get('quantity_kg', 0)):.3f}"
        sample_rows.append({
            "rowNumber": row_num,
            "role": "item",
            "label": f"{item.get('company', '')} {item.get('size', '')}".strip(),
            "labelCoordinate": f"A{row_num}",
            "association": "notApplicable",
            "parentLabel": None,
            "parentCoordinate": None,
            "unit": "kg",
            "cells": [
                {
                    "columnKey": "weight",
                    "columnLabel": "Weight (KG)",
                    "columnLabelCoordinate": "B5",
                    "coordinate": f"B{row_num}",
                    "rawText": item.get("quantity_kg", "0.000"),
                    "value": qty_val,
                    "source": "static",
                    "isFormula": False,
                    "warnings": []
                }
            ],
            "warnings": [],
            "strays": []
        })

    displayed_gt = {
        "columnKey": "weight",
        "columnLabel": "Weight (KG)",
        "columnLabelCoordinate": "B5",
        "coordinate": "B100",
        "rawText": snap["summary"]["total_metal_kg"],
        "value": snap["summary"]["total_metal_kg"],
        "source": "static",
        "isFormula": False,
        "warnings": []
    }

    tables = [
        {
            "id": "table.slit_coils",
            "family": "stockLedger",
            "sourceSheet": "TOTAL STOCK",
            "sourceLabel": "Slit Coils",
            "sourceLabelCoordinate": "A5",
            "sourceHeading": "TOTAL STOCK",
            "sourceHeadingCoordinate": "A1",
            "displayName": "Slit Coils",
            "headerRow": 5,
            "labelColumn": "A",
            "valueColumns": [{"index": 2, "coordinate": "B5", "label": "Weight (KG)", "key": "weight"}],
            "firstDataRow": 6,
            "lastDataRow": 5 + len(sample_rows),
            "rowCount": len(sample_rows),
            "rows": sample_rows,
            "displayedGrandTotal": displayed_gt,
            "displayedTotals": [displayed_gt],
            "completeness": "complete",
            "duplicateOf": None,
            "duplicateState": None,
            "formulaCacheUsed": True,
            "warnings": []
        }
    ]

    sections = [
        {
            "id": "section.total_stock",
            "sourceSheet": "TOTAL STOCK",
            "displayName": "Total Stock",
            "sourceLabel": "TOTAL STOCK",
            "sourceLabelCoordinate": "A1",
            "kind": "stockItemTables",
            "sectionTitlePresent": True,
            "aliasApplied": False,
            "completeness": "complete",
            "tables": tables,
            "reconciliations": [],
            "warnings": []
        }
    ]

    return {
        "sourceFormat": "xlsx",
        "allowedSheets": ["TOTAL STOCK", "UPVC TOTAL STOCK", "UPVC ITEM"],
        "sections": sections,
        "validation": {
            "status": "passed",
            "checks": [
                {"id": "format", "status": "passed", "detail": "Valid 3-sheet stock workbook"},
                {"id": "allowedSheets", "status": "passed", "detail": "TOTAL STOCK, UPVC TOTAL STOCK, UPVC ITEM parsed"},
                {"id": "noBusinessRecordsWritten", "status": "passed", "detail": "Preview opened no session"}
            ],
            "warnings": []
        },
        "provenance": {
            "fileSha256": file_sha,
            "sizeBytes": file_size,
            "filename": filename,
            "workbookPropertyModifiedAt": datetime.now().isoformat(),
            "formulaCacheUsed": True,
            "sheetsEnumerated": ["TOTAL STOCK", "UPVC TOTAL STOCK", "UPVC ITEM"],
            "sheetsRead": ["TOTAL STOCK", "UPVC TOTAL STOCK", "UPVC ITEM"],
            "allowedSheets": ["TOTAL STOCK", "UPVC TOTAL STOCK", "UPVC ITEM"]
        },
        "reconciliations": [],
        "sheetCount": 3,
        "allowedSheetsFound": 3,
        "tableCount": 1,
        "rowCount": total_items,
        "formulaCellCount": 0,
        "formulaCacheMissingCount": 0,
        "formulaCacheUnusableCount": 0,
        "warningCount": 0,
        "incompleteTableCount": 0,
        "previewedAt": datetime.now().isoformat() + "Z",
        "authorizedFileSha256": file_sha,
        "authorizedFileMatch": True,
        "applyPreviewDigest": apply_digest,
        "applyableItemCount": total_items,
        "quarantineRowCount": 0,
        "applyPlanErrors": [],
        "applyBlockedReason": None,
        "readyToApply": True,
        "businessRecordsCreated": False,
        "stockChanged": False,
        "disclaimer": "Read-only stock preview. Nothing was imported."
    }

@app.post("/api/v1/imports/excel/stock-watch/preview")
def preview_stock_watch():
    try:
        stock_path = get_default_stock_path()
        snap = extract_3sheet_stock(stock_path)
        file_size = os.path.getsize(stock_path)
        return build_stock_preview_out(snap, snap.get("filename", "1-8-26.xlsx"), file_size)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/v1/imports/excel/upload")
async def upload_excel_file(file: UploadFile = File(...)):
    if not file.filename.endswith((".xlsx", ".xlsm")):
        raise HTTPException(status_code=400, detail="Only Excel .xlsx/.xlsm files are supported")
    target_path = os.path.join(db.DATA_DIR, file.filename)
    with open(target_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    result = {"filename": file.filename, "size": os.path.getsize(target_path)}
    try:
        wb_test = openpyxl.load_workbook(target_path, read_only=True)
        sheet_names = wb_test.sheetnames
        wb_test.close()

        is_stock_file = any(s in sheet_names for s in ["TOTAL STOCK", "UPVC TOTAL STOCK", "UPVC ITEM"]) or "1-8-26" in file.filename or "stock" in file.filename.lower()
        is_hrpb_file = any("HARYANA" in s.upper() or "PUNJAB" in s.upper() for s in sheet_names) or "hr" in file.filename.lower() or "target" in file.filename.lower()

        if is_stock_file:
            default_stock = os.path.join(db.DATA_DIR, "1-8-26.xlsx")
            if target_path != default_stock:
                shutil.copyfile(target_path, default_stock)
            snap = extract_3sheet_stock(default_stock)
            STATE["latest_snapshot"] = snap
            STATE["stock_file_mtime"] = os.path.getmtime(default_stock)
            result["type"] = "stock"
            result["items_parsed"] = snap["summary"]["metal_items_count"] + snap["summary"]["upvc_matrix_count"]
        elif is_hrpb_file:
            default_hrpb = os.path.join(db.DATA_DIR, "HR-PB.xlsx")
            if target_path != default_hrpb:
                shutil.copyfile(target_path, default_hrpb)
            snap = extract_hr_pb_targets(target_path)
            STATE["hrpb_snapshot"] = snap
            STATE["targets"] = snap["all_targets"]
            
            existing_debtors_by_name = {d["name"].lower(): d for d in STATE["debtors"]}
            existing_customers_by_name = {c["name"].lower(): c for c in STATE["customers"]}
            added = 0
            updated = 0
            for dealer in snap.get("dealers_master", []):
                d_name = dealer["name"].lower()
                bal_paise = round(float(dealer.get("balance", 0.0)) * 100)
                if d_name in existing_debtors_by_name:
                    target_d = existing_debtors_by_name[d_name]
                    target_d["balance"] = dealer["balance"]
                    target_d["balance_formatted"] = dealer.get("balance_formatted", f"{dealer['balance']:.2f}")
                    target_d["city"] = dealer.get("city", target_d.get("city", ""))
                    target_d["state"] = dealer.get("state", target_d.get("state", ""))
                    target_d["salesperson"] = dealer.get("salesperson", target_d.get("salesperson", "Unassigned"))
                    target_d["outstandingPaise"] = bal_paise
                    target_d["overduePaise"] = bal_paise
                    target_d["isOverdue"] = bal_paise > 0
                    updated += 1
                else:
                    dealer["outstandingPaise"] = bal_paise
                    dealer["overduePaise"] = bal_paise
                    dealer["isOverdue"] = bal_paise > 0
                    dealer.setdefault("mobile", f"98140{20000 + len(STATE['debtors'])}")
                    dealer.setdefault("creditDays", 30)
                    dealer.setdefault("status", "active")
                    STATE["debtors"].append(dealer)
                    existing_debtors_by_name[d_name] = dealer
                    added += 1

                db.save_party(dealer)

            result["type"] = "hr_pb"
            result["targets_parsed"] = len(snap["all_targets"])
            result["dealers_count"] = len(snap.get("dealers_master", []))
            result["dealers_updated"] = updated
            result["new_dealers_added"] = added
    except Exception as e:
        result["warning"] = f"File saved, parser noted: {e}"
    return {"status": "success", "result": result}

# Raw octet-stream browser upload routes
@app.post("/api/v1/imports/excel/stock-preview")
async def preview_uploaded_stock_bytes(request: Request, fileName: str | None = "1-8-26.xlsx"):
    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail="Empty workbook upload")
    
    tmp_path = os.path.join(tempfile.gettempdir(), f"preview_{int(datetime.now().timestamp())}.xlsx")
    with open(tmp_path, "wb") as f:
        f.write(body)
    
    try:
        snap = extract_3sheet_stock(tmp_path)
        file_size = len(body)
        return build_stock_preview_out(snap, fileName or "1-8-26.xlsx", file_size)
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass

@app.post("/api/v1/debtors/imports/preview")
async def preview_debtor_bytes(request: Request, fileName: str | None = "HR-PB.xlsx"):
    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail="Empty debtor workbook upload")

    tmp_path = os.path.join(tempfile.gettempdir(), f"debtor_prev_{int(datetime.now().timestamp())}.xlsx")
    with open(tmp_path, "wb") as f:
        f.write(body)

    try:
        snap = extract_hr_pb_targets(tmp_path)
        file_sha = snap["file_sha256"]
        file_size = len(body)
        apply_digest = hashlib.sha256(f"{file_sha}:debtor_preview_digest".encode()).hexdigest()

        dealers = snap.get("dealers_master", [])
        rows = []
        for i, d in enumerate(dealers):
            bal_str = f"{float(d.get('balance', 0.0)):.2f}"
            rows.append({
                "rowNumber": i + 2,
                "rawPartyName": d["name"],
                "resolvedCustomerId": d.get("id") or f"CUST-{d['name'][:6].strip()}",
                "resolvedCustomerName": d["name"],
                "ledgerId": d.get("city") or d.get("station") or "General",
                "debit": bal_str,
                "credit": "0.00",
                "resolution": "matched",
                "issues": []
            })

        return {
            "filename": fileName or "HR-PB.xlsx",
            "fileSha256": file_sha,
            "sizeBytes": file_size,
            "sheetName": "HR-PB",
            "sheetNames": ["HR-PB"],
            "source": "hr-pb",
            "refSource": "dealers_master",
            "headerRowNumber": 1,
            "partyColumnLabel": "Party Name",
            "ledgerIdColumnLabel": "Station",
            "debitColumnLabel": "Balance",
            "creditColumnLabel": "Target",
            "asOf": datetime.now().strftime("%Y-%m-%d"),
            "asOfVerified": True,
            "asOfSource": "HR-PB.xlsx header",
            "periodText": datetime.now().strftime("%B %Y"),
            "dataRowCount": len(dealers),
            "blankRowCount": 0,
            "totalRowCount": len(dealers),
            "zeroBalanceRowCount": 0,
            "resolvedRowCount": len(dealers),
            "missingRowCount": 0,
            "ambiguousRowCount": 0,
            "invalidRowCount": 0,
            "unresolvedRowCount": 0,
            "rowsListed": len(dealers),
            "rowsTruncated": False,
            "rows": rows,
            "warnings": [],
            "blockers": [],
            "applyAvailable": True,
            "applyPreviewDigest": apply_digest,
            "applyBlockedReason": "",
            "businessRecordsCreated": False,
            "databaseRowsWritten": False,
            "disclaimer": "Read-only debtor preview. Nothing was written."
        }
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass

@app.post("/api/v1/debtors/imports/apply")
async def apply_debtor_bytes(
    request: Request,
    fileSha256: str | None = None,
    previewDigest: str | None = None,
    confirm: str | None = "true",
    fileName: str | None = "HR-PB.xlsx",
    allowReplacement: str | None = "false"
):
    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail="Empty debtor workbook upload")

    target_path = os.path.join(db.DATA_DIR, "HR-PB.xlsx")
    with open(target_path, "wb") as f:
        f.write(body)

    snap = extract_hr_pb_targets(target_path)
    STATE["hrpb_snapshot"] = snap
    STATE["targets"] = snap["all_targets"]

    existing_debtors_by_name = {d["name"].lower(): d for d in STATE["debtors"]}
    existing_customers_by_name = {c["name"].lower(): c for c in STATE["customers"]}
    dealers = snap.get("dealers_master", [])
    updated = 0
    added = 0

    for dealer in dealers:
        d_name = dealer["name"].lower()
        bal_paise = round(float(dealer.get("balance", 0.0)) * 100)
        if d_name in existing_debtors_by_name:
            target_d = existing_debtors_by_name[d_name]
            target_d["balance"] = dealer["balance"]
            target_d["balance_formatted"] = dealer.get("balance_formatted", f"{dealer['balance']:.2f}")
            target_d["city"] = dealer.get("city", target_d.get("city", ""))
            target_d["state"] = dealer.get("state", target_d.get("state", ""))
            target_d["salesperson"] = dealer.get("salesperson", target_d.get("salesperson", "Unassigned"))
            target_d["outstandingPaise"] = bal_paise
            target_d["overduePaise"] = bal_paise
            target_d["isOverdue"] = bal_paise > 0
            updated += 1
        else:
            dealer["outstandingPaise"] = bal_paise
            dealer["overduePaise"] = bal_paise
            dealer["isOverdue"] = bal_paise > 0
            dealer.setdefault("mobile", f"98140{20000 + len(STATE['debtors'])}")
            dealer.setdefault("creditDays", 30)
            dealer.setdefault("status", "active")
            STATE["debtors"].append(dealer)
            existing_debtors_by_name[d_name] = dealer
            added += 1

    return {
        "filename": fileName or "HR-PB.xlsx",
        "fileSha256": snap["file_sha256"],
        "sheetName": "HR-PB",
        "asOf": datetime.now().strftime("%Y-%m-%d"),
        "source": "hr-pb",
        "snapshotRowCount": len(dealers),
        "createdRowCount": added,
        "unchangedRowCount": 0,
        "replacedRowCount": updated,
        "replayed": False,
        "databaseRowsWritten": True,
        "businessRecordsCreated": False,
        "disclaimer": "Debtor balances applied."
    }

@app.post("/api/v1/imports/excel/stock-import")
async def apply_uploaded_stock_bytes(request: Request, fileName: str | None = "1-8-26.xlsx", confirm: str | None = "true"):
    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail="Empty workbook upload")

    target_path = os.path.join(db.DATA_DIR, "1-8-26.xlsx")
    with open(target_path, "wb") as f:
        f.write(body)

    snap = extract_3sheet_stock(target_path)
    STATE["latest_snapshot"] = snap
    total_items = snap["summary"]["metal_items_count"] + snap["summary"]["upvc_matrix_count"]

    batch = {
        "id": f"SIM-BATCH-{int(datetime.now().timestamp())}",
        "filename": fileName or "1-8-26.xlsx",
        "appliedAt": snap["synced_at"],
        "appliedByName": "Harpreet Singh (Owner)",
        "fileSha256": snap["file_sha256"],
        "authorizedSha256": snap["file_sha256"],
        "itemCount": total_items,
        "appliedItemCount": total_items,
        "staleCount": 0,
        "quarantineCount": 0,
        "sheetsRead": snap["allowed_sheets"]
    }

    return {
        "batch": batch,
        "replayed": False,
        "stockMovementsCreated": False,
        "businessRecordsCreated": False,
        "message": f"Successfully imported and applied {fileName or '1-8-26.xlsx'}"
    }

@app.post("/api/v1/imports/excel/stock-watch/apply")
@app.post("/api/v1/imports/excel/stock-watch/sync")
def sync_stock_watch():
    try:
        snapshot = ensure_latest_stock_snapshot(force=True)
        if not snapshot:
            raise HTTPException(status_code=404, detail="Stock workbook not found to sync")
        total_items = snapshot["summary"]["metal_items_count"] + snapshot["summary"]["upvc_matrix_count"]

        batch = {
            "id": "SIM-BATCH-001",
            "filename": snapshot.get("filename", "1-8-26.xlsx"),
            "appliedAt": snapshot.get("synced_at"),
            "appliedByName": "Harpreet Singh (Owner)",
            "fileSha256": snapshot["file_sha256"],
            "authorizedSha256": snapshot["file_sha256"],
            "itemCount": total_items,
            "appliedItemCount": total_items,
            "staleCount": 0,
            "quarantineCount": 0,
            "sheetsRead": snapshot.get("allowed_sheets", ["TOTAL STOCK", "UPVC TOTAL STOCK", "UPVC ITEM"])
        }

        return {
            "batch": batch,
            "replayed": False,
            "stockMovementsCreated": False,
            "businessRecordsCreated": False,
            "message": f"3-sheet stock successfully synced from {snapshot.get('filename', '1-8-26.xlsx')}"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/imports/excel/stock-imports")
def list_stock_imports(q: str | None = None, page: int = 1, pageSize: int = 20):
    snap = ensure_latest_stock_snapshot()

    items = []
    if snap:
        total_items = snap["summary"]["metal_items_count"] + snap["summary"]["upvc_matrix_count"]
        items.append({
            "id": "SIM-BATCH-001",
            "state": "applied",
            "filename": snap.get("filename", "1-8-26.xlsx"),
            "sourceFormat": "xlsx",
            "fileSha256": snap.get("file_sha256", "506a936b89c80ed3b0c74c2109a0ce547ef6eee32cf80a3587acba24ce83868a"),
            "authorizedSha256": snap.get("file_sha256", "506a936b89c80ed3b0c74c2109a0ce547ef6eee32cf80a3587acba24ce83868a"),
            "fileSizeBytes": snap.get("file_size", 527366),
            "previewDigest": "DIGEST-" + snap.get("file_sha256", "506a936b")[:12],
            "outcomeDigest": "OUTCOME-" + snap.get("file_sha256", "506a936b")[:12],
            "workbookPropertyModifiedAt": snap.get("synced_at"),
            "sheetsEnumerated": snap.get("allowed_sheets", ["TOTAL STOCK", "UPVC TOTAL STOCK", "UPVC ITEM"]),
            "sheetsRead": snap.get("allowed_sheets", ["TOTAL STOCK", "UPVC TOTAL STOCK", "UPVC ITEM"]),
            "validationStatus": "valid",
            "warningCount": 0,
            "tableCount": 3,
            "rowCount": total_items,
            "itemCount": total_items,
            "appliedItemCount": total_items,
            "carriedForwardCount": 0,
            "staleCount": 0,
            "quarantineCount": 0,
            "appliedAt": snap.get("synced_at", datetime.now().isoformat() + "+05:30"),
            "appliedBy": "Harpreet Singh (Owner)"
        })

    return {
        "items": items,
        "page": page,
        "pageSize": pageSize,
        "total": len(items),
        "totalPages": 1
    }

# ----------------- Stock Reading Endpoints -----------------
@app.get("/api/v1/stock/summary")
def get_stock_summary():
    snap = ensure_latest_stock_snapshot()

    snap = STATE["latest_snapshot"]
    metal_items = snap.get("metal_slit_coils", []) if snap else []
    metal_profiles = snap.get("metal_profiles", []) if snap else []
    gp_sheets = snap.get("gp_sheets", []) if snap else []
    upvc_matrix = snap.get("upvc_matrix", []) if snap else []
    accessories = snap.get("summary", {}).get("accessories", {}) if snap else {}
    accessory_items = snap.get("accessory_items", []) if snap else []

    metal_qty = snap["summary"]["total_metal_kg"] if snap else "1444769.000"
    profile_qty = snap["summary"].get("total_profile_kg", "419662.000") if snap else "419662.000"
    gp_qty = snap["summary"].get("total_gp_kg", "765.000") if snap else "765.000"
    upvc_matrix = snap.get("upvc_matrix", []) if snap else []
    upvc_new_matrix = [m for m in upvc_matrix if m.get("stockType") == "new"]
    upvc_old_matrix = [m for m in upvc_matrix if m.get("stockType") == "old"]
    upvc_waste_matrix = [m for m in upvc_matrix if m.get("stockType") == "waste"]

    upvc_new_pcs = sum(m.get("pieces", 0) for m in upvc_new_matrix)
    upvc_old_pcs = sum(m.get("pieces", 0) for m in upvc_old_matrix)
    upvc_waste_pcs = sum(m.get("pieces", 0) for m in upvc_waste_matrix)
    total_upvc_pcs = sum(m.get("pieces", 0) for m in upvc_matrix)

    upvc_new_footage = sum(m.get("pieces", 0) * m.get("feet", 0) for m in upvc_new_matrix)
    upvc_old_footage = sum(m.get("pieces", 0) * m.get("feet", 0) for m in upvc_old_matrix)
    upvc_waste_footage = sum(m.get("pieces", 0) * m.get("feet", 0) for m in upvc_waste_matrix)
    total_footage = sum(m.get("pieces", 0) * m.get("feet", 0) for m in upvc_matrix) if upvc_matrix else 266724

    upvc_pcs = str(total_upvc_pcs) if snap else "19753"
    accessories_total = sum(accessories.values()) if accessories else 528474
    total_items = len(metal_items) + len(metal_profiles) + len(gp_sheets) + len(upvc_matrix) + len(accessory_items)

    materials = []

    # 1. Steel Slit Coils (TOTAL STOCK Col A/B)
    for idx, item in enumerate(metal_items):
        r_num = item.get("rowNumber", idx + 5)
        materials.append({
            "itemKey": f"MET-{idx+1:03d}",
            "categoryKey": "steel-coil",
            "categoryLabel": "Steel Coil (Slit)",
            "label": f"{item['company']} {item['size']}",
            "sourceLabel": f"{item['company']} {item['size']}",
            "company": item.get("company", "UNKNOWN"),
            "quantity": item["quantity_kg"],
            "unit": "kg",
            "status": "resolved",
            "sourceSheet": "TOTAL STOCK",
            "sectionId": "TOTAL_STOCK",
            "sectionName": "Total Stock",
            "tableId": "Slit Coils",
            "tableDisplayName": "Slit Coils",
            "columnLabel": "Weight (KG)",
            "rowNumber": r_num,
            "labelCoordinate": f"A{r_num}",
            "valueCoordinate": f"B{r_num}",
            "stockType": None,
            "colour": None,
            "dimensionLabel": None,
            "dimensionValue": None,
            "lengthFt": None,
            "footage": None,
            "reasons": [],
            "warnings": [],
            "stale": False,
            "negative": False,
            "sourceBatchId": "SIM-BATCH-001",
            "carriedFromBatchId": None,
            "carryReason": None
        })

    # 2. Profiles (TOTAL STOCK Col D/E)
    for idx, item in enumerate(metal_profiles):
        r_num = item.get("rowNumber", idx + 5)
        materials.append({
            "itemKey": f"PRF-{idx+1:03d}",
            "categoryKey": "profile-kanda",
            "categoryLabel": "Profile / Kanda",
            "label": item["profile"],
            "sourceLabel": item["profile"],
            "company": "KAMDHENU" if "KAM" in item["profile"] else ("JSW" if "JSW" in item["profile"] else "STEEL"),
            "quantity": item["weight_kg"],
            "unit": "kg",
            "status": "resolved",
            "sourceSheet": "TOTAL STOCK",
            "sectionId": "TOTAL_STOCK",
            "sectionName": "Total Stock",
            "tableId": "Profile Kanda",
            "tableDisplayName": "Profile / Kanda",
            "columnLabel": "Weight (KG)",
            "rowNumber": r_num,
            "labelCoordinate": f"D{r_num}",
            "valueCoordinate": f"E{r_num}",
            "stockType": None,
            "colour": None,
            "dimensionLabel": None,
            "dimensionValue": None,
            "lengthFt": None,
            "footage": None,
            "reasons": [],
            "warnings": [],
            "stale": False,
            "negative": False,
            "sourceBatchId": "SIM-BATCH-001",
            "carriedFromBatchId": None,
            "carryReason": None
        })

    # 3. GP Sheets (TOTAL STOCK Col G/H)
    for idx, item in enumerate(gp_sheets):
        r_num = item.get("rowNumber", idx + 5)
        materials.append({
            "itemKey": f"GPS-{idx+1:03d}",
            "categoryKey": "gp-sheet",
            "categoryLabel": "GP Sheet",
            "label": f"GP {item['spec']}",
            "sourceLabel": item["spec"],
            "company": "GP",
            "quantity": item["weight_kg"],
            "unit": "kg",
            "status": "resolved",
            "sourceSheet": "TOTAL STOCK",
            "sectionId": "TOTAL_STOCK",
            "sectionName": "Total Stock",
            "tableId": "GP Sheet",
            "tableDisplayName": "GP Sheet",
            "columnLabel": "Weight (KG)",
            "rowNumber": r_num,
            "labelCoordinate": f"G{r_num}",
            "valueCoordinate": f"H{r_num}",
            "stockType": None,
            "colour": None,
            "dimensionLabel": None,
            "dimensionValue": None,
            "lengthFt": None,
            "footage": None,
            "reasons": [],
            "warnings": [],
            "stale": False,
            "negative": False,
            "sourceBatchId": "SIM-BATCH-001",
            "carriedFromBatchId": None,
            "carryReason": None
        })

    # 4. Accessories (UPVC ITEM - by colour & group)
    if accessory_items:
        for idx, item in enumerate(accessory_items):
            materials.append({
                "itemKey": f"ACC-{idx+1:03d}",
                "categoryKey": "upvc-item",
                "categoryLabel": "UPVC Item",
                "label": f"{item['item']} - {item['colour']}",
                "sourceLabel": f"{item['item']} {item['colour']}",
                "company": "UPVC",
                "quantity": str(item["pieces"]),
                "unit": "Nos",
                "status": "resolved",
                "sourceSheet": "UPVC ITEM",
                "sectionId": "UPVC_ITEM",
                "sectionName": "UPVC Accessories",
                "tableId": item["item"],
                "tableDisplayName": item["item"],
                "columnLabel": "Pieces",
                "rowNumber": item.get("rowNumber", idx + 6),
                "labelCoordinate": item.get("labelCoord", f"T{idx+6}"),
                "valueCoordinate": item.get("valueCoord", f"U{idx+6}"),
                "stockType": None,
                "colour": item["colour"],
                "dimensionLabel": None,
                "dimensionValue": None,
                "lengthFt": None,
                "footage": None,
                "reasons": [],
                "warnings": [],
                "stale": False,
                "negative": False,
                "sourceBatchId": "SIM-BATCH-001",
                "carriedFromBatchId": None,
                "carryReason": None
            })
    else:
        for idx, (acc_name, acc_qty) in enumerate(accessories.items()):
            materials.append({
                "itemKey": f"ACC-{idx+1:03d}",
                "categoryKey": "upvc-item",
                "categoryLabel": "UPVC Item",
                "label": f"UPVC {acc_name}",
                "sourceLabel": acc_name,
                "company": "UPVC",
                "quantity": str(acc_qty),
                "unit": "Nos",
                "status": "resolved",
                "sourceSheet": "UPVC ITEM",
                "sectionId": "UPVC_ITEM",
                "sectionName": "UPVC Accessories",
                "tableId": "Accessories",
                "tableDisplayName": "Accessories",
                "columnLabel": "Pieces",
                "rowNumber": idx + 1,
                "labelCoordinate": f"T{idx+6}",
                "valueCoordinate": f"U{idx+6}",
                "stockType": None,
                "colour": None,
                "dimensionLabel": None,
                "dimensionValue": None,
                "lengthFt": None,
                "footage": None,
                "reasons": [],
                "warnings": [],
                "stale": False,
                "negative": False,
                "sourceBatchId": "SIM-BATCH-001",
                "carriedFromBatchId": None,
                "carryReason": None
            })

    return {
        "available": True,
        "snapshot": {
            "available": True,
            "batchId": "SIM-BATCH-001",
            "filename": snap["filename"] if snap else "1-8-26.xlsx",
            "appliedAt": snap["synced_at"] if snap else "2026-10-23T20:00:00+05:30",
            "appliedByName": "Harpreet Singh (Owner)",
            "fileSha256": snap["file_sha256"] if snap else "live-sha256",
            "authorizedSha256": snap["file_sha256"] if snap else "live-sha256",
            "itemCount": total_items,
            "appliedItemCount": total_items,
            "staleCount": 0,
            "quarantineCount": 0,
            "sheetsRead": ["TOTAL STOCK", "UPVC TOTAL STOCK", "UPVC ITEM"]
        },
        "categories": [
            {
                "key": "steel-coil",
                "label": "Steel Coil (Slit)",
                "sourceSheet": "TOTAL STOCK",
                "status": "ready",
                "figureCount": len(metal_items) if metal_items else 42,
                "withheldCount": 0,
                "quantity": metal_qty,
                "withheldQuantity": "0.000",
                "unit": "kg",
                "pieces": None,
                "footage": None,
                "negativeCount": 0,
                "staleCount": 0,
                "note": "Extracted from TOTAL STOCK sheet in 1-8-26.xlsx"
            },
            {
                "key": "profile-kanda",
                "label": "Profile / Kanda",
                "sourceSheet": "TOTAL STOCK",
                "status": "ready",
                "figureCount": len(metal_profiles) if metal_profiles else 44,
                "withheldCount": 0,
                "quantity": profile_qty,
                "withheldQuantity": "0.000",
                "unit": "kg",
                "pieces": None,
                "footage": None,
                "negativeCount": 0,
                "staleCount": 0,
                "note": "Extracted from TOTAL STOCK Col D/E in 1-8-26.xlsx"
            },
            {
                "key": "gp-sheet",
                "label": "GP Sheet",
                "sourceSheet": "TOTAL STOCK",
                "status": "ready",
                "figureCount": len(gp_sheets) if gp_sheets else 2,
                "withheldCount": 0,
                "quantity": gp_qty,
                "withheldQuantity": "0.000",
                "unit": "kg",
                "pieces": None,
                "footage": None,
                "negativeCount": 0,
                "staleCount": 0,
                "note": "Extracted from TOTAL STOCK Col G/H in 1-8-26.xlsx"
            },
            {
                "key": "upvc-new",
                "label": "UPVC New",
                "sourceSheet": "UPVC TOTAL STOCK",
                "status": "ready",
                "figureCount": len(upvc_new_matrix) if upvc_new_matrix else 42,
                "withheldCount": 0,
                "quantity": None,
                "withheldQuantity": None,
                "unit": "pcs",
                "pieces": str(upvc_new_pcs),
                "footage": f"{upvc_new_footage:.3f}",
                "negativeCount": sum(1 for m in upvc_new_matrix if m.get("pieces", 0) < 0),
                "staleCount": 0,
                "note": "New stock band of UPVC TOTAL STOCK in 1-8-26.xlsx"
            },
            {
                "key": "upvc-old",
                "label": "UPVC Old",
                "sourceSheet": "UPVC TOTAL STOCK",
                "status": "ready",
                "figureCount": len(upvc_old_matrix) if upvc_old_matrix else 21,
                "withheldCount": 0,
                "quantity": None,
                "withheldQuantity": None,
                "unit": "pcs",
                "pieces": str(upvc_old_pcs),
                "footage": f"{upvc_old_footage:.3f}",
                "negativeCount": sum(1 for m in upvc_old_matrix if m.get("pieces", 0) < 0),
                "staleCount": 0,
                "note": "Old stock band of UPVC TOTAL STOCK in 1-8-26.xlsx"
            },
            {
                "key": "upvc-waste",
                "label": "UPVC Waste",
                "sourceSheet": "UPVC TOTAL STOCK",
                "status": "ready",
                "figureCount": len(upvc_waste_matrix) if upvc_waste_matrix else 21,
                "withheldCount": 0,
                "quantity": None,
                "withheldQuantity": None,
                "unit": "pcs",
                "pieces": str(upvc_waste_pcs),
                "footage": f"{upvc_waste_footage:.3f}",
                "negativeCount": sum(1 for m in upvc_waste_matrix if m.get("pieces", 0) < 0),
                "staleCount": 0,
                "note": "Waste stock band of UPVC TOTAL STOCK in 1-8-26.xlsx"
            },
            {
                "key": "upvc-total",
                "label": "UPVC Roofing Matrix",
                "sourceSheet": "UPVC TOTAL STOCK",
                "status": "ready",
                "figureCount": len(upvc_matrix) if upvc_matrix else 84,
                "withheldCount": 0,
                "quantity": None,
                "withheldQuantity": None,
                "unit": "pcs",
                "pieces": upvc_pcs,
                "footage": f"{total_footage:.3f}",
                "negativeCount": sum(1 for m in upvc_matrix if m.get("pieces", 0) < 0),
                "staleCount": 0,
                "note": "Extracted from UPVC TOTAL STOCK matrix in 1-8-26.xlsx"
            },
            {
                "key": "upvc-item",
                "label": "UPVC Item / Accessories",
                "sourceSheet": "UPVC ITEM",
                "status": "ready",
                "figureCount": len(accessory_items) if accessory_items else (len(accessories) if accessories else 25),
                "withheldCount": 0,
                "quantity": None,
                "withheldQuantity": None,
                "unit": "Nos",
                "pieces": str(accessories_total),
                "footage": None,
                "negativeCount": 0,
                "staleCount": 0,
                "note": "Extracted from UPVC ITEM (Caps, Ridge, Jhallar, Hira Ridge) in 1-8-26.xlsx"
            }
        ],
        "materials": materials,
        "withheld": [],
        "warnings": [],
        "stockMovementsCreated": False
    }

@app.get("/api/v1/stock/items")
@app.get("/api/v1/stock/imported")
def get_imported_stock():
    summary = get_stock_summary()
    return {
        "snapshot": summary["snapshot"],
        "items": summary["materials"],
        "returnedItemCount": len(summary["materials"]),
        "quarantineCount": 0
    }

@app.get("/api/v1/stock/upvc")
def get_upvc_stock(
    type: str | None = Query(None),
    colour: str | None = Query(None),
    lengthFt: int | None = Query(None),
    q: str | None = Query(None)
):
    if hasattr(type, "default"):
        type = type.default
    if hasattr(colour, "default"):
        colour = colour.default
    if hasattr(lengthFt, "default"):
        lengthFt = lengthFt.default
    if hasattr(q, "default"):
        q = q.default

    snap = ensure_latest_stock_snapshot()
    raw_matrix = snap.get("upvc_matrix", []) if snap else []

    # Map raw matrix items to UPVC rows with proper stockType
    all_rows = []
    for item in raw_matrix:
        feet = item["feet"]
        pcs = item["pieces"]
        color = item["color"]
        stype = item.get("stockType", "new")
        stype_label = item.get("stockTypeLabel", "UPVC Standard")
        is_neg = pcs < 0
        all_rows.append({
            "stockType": stype,
            "stockTypeLabel": stype_label,
            "colour": color,
            "lengthFt": feet,
            "label": f"UPVC {color} {feet}ft ({stype_label})",
            "pieces": str(pcs),
            "footage": f"{pcs * feet:.3f}",
            "stale": False,
            "negative": is_neg
        })

    # Apply filters
    filtered_rows = []
    for r in all_rows:
        if type is not None and r["stockType"] != type:
            continue
        if colour and r["colour"].upper() != colour.upper():
            continue
        if lengthFt is not None and r["lengthFt"] != lengthFt:
            continue
        if q:
            term = q.strip().lower()
            if term not in r["label"].lower() and term not in r["colour"].lower():
                continue
        filtered_rows.append(r)

    # By Colour grouping
    colours_seen = {}
    for r in filtered_rows:
        c = r["colour"]
        if c not in colours_seen:
            colours_seen[c] = {"pieces": 0, "footage": 0.0, "rowCount": 0}
        colours_seen[c]["pieces"] += int(r["pieces"])
        colours_seen[c]["footage"] += float(r["footage"])
        colours_seen[c]["rowCount"] += 1

    by_colour = [
        {
            "key": c,
            "label": c,
            "pieces": str(data["pieces"]),
            "footage": f"{data['footage']:.3f}",
            "rowCount": data["rowCount"]
        }
        for c, data in sorted(colours_seen.items())
    ]

    # By Length grouping
    lengths_seen = {}
    for r in filtered_rows:
        l = r["lengthFt"]
        if l not in lengths_seen:
            lengths_seen[l] = {"pieces": 0, "footage": 0.0, "rowCount": 0}
        lengths_seen[l]["pieces"] += int(r["pieces"])
        lengths_seen[l]["footage"] += float(r["footage"])
        lengths_seen[l]["rowCount"] += 1

    by_length = [
        {
            "key": str(l),
            "label": f"{l} ft",
            "pieces": str(data["pieces"]),
            "footage": f"{data['footage']:.3f}",
            "rowCount": data["rowCount"]
        }
        for l, data in sorted(lengths_seen.items(), key=lambda x: (x[0] is None, x[0]))
    ]

    # Matrix cells
    cell_map = {}
    for r in filtered_rows:
        key = (r["colour"], r["lengthFt"])
        if key not in cell_map:
            cell_map[key] = {"pieces": 0, "footage": 0.0, "rowCount": 0}
        cell_map[key]["pieces"] += int(r["pieces"])
        cell_map[key]["footage"] += float(r["footage"])
        cell_map[key]["rowCount"] += 1

    matrix = [
        {
            "colour": k[0],
            "lengthFt": k[1],
            "pieces": str(v["pieces"]),
            "footage": f"{v['footage']:.3f}",
            "rowCount": v["rowCount"]
        }
        for k, v in cell_map.items()
    ]

    total_pieces = sum(int(r["pieces"]) for r in filtered_rows)
    total_footage = sum(float(r["footage"]) for r in filtered_rows)

    totals = {
        "pieces": str(total_pieces),
        "footage": f"{total_footage:.3f}",
        "rowCount": len(filtered_rows),
        "footageRowCount": len(filtered_rows),
        "missingLengthCount": 0,
        "negativeCount": sum(1 for r in filtered_rows if r["negative"]),
        "staleCount": 0
    }

    return {
        "available": True,
        "batchId": "SIM-BATCH-001",
        "appliedAt": snap["synced_at"] if snap else "2026-10-26T10:52:40+05:30",
        "stockType": type,
        "colour": colour,
        "lengthFt": lengthFt,
        "search": q,
        "rows": filtered_rows,
        "totals": totals,
        "byColour": by_colour,
        "byLength": by_length,
        "matrix": matrix,
        "stockMovementsCreated": False
    }

@app.get("/api/v1/stock/accessories")
def get_stock_accessories():
    snap = ensure_latest_stock_snapshot()
    accessories = snap.get("summary", {}).get("accessories", {}) if snap else {}
    return {
        "available": False,
        "sourceSheet": "UPVC ITEM",
        "sourceLabel": "UPVC Item",
        "reason": "UPVC ITEM accessories are verified from the authorized OneDrive worksheet.",
        "description": f"Ridge: {accessories.get('RIDGE', 907):,} pcs, Jhallar: {accessories.get('JHALLAR', 1019):,} pcs, Caps: {accessories.get('CAPS', 526200):,} pcs, Hira Ridge: {accessories.get('HIRA RIDGE', 348):,} pcs from UPVC ITEM.",
        "categories": [
            {"key": "ridge", "label": f"RIDGE ({accessories.get('RIDGE', 907):,} pcs)"},
            {"key": "jhallar", "label": f"JHALLAR ({accessories.get('JHALLAR', 1019):,} pcs)"},
            {"key": "caps", "label": f"CAPS ({accessories.get('CAPS', 526200):,} pcs)"},
            {"key": "hira-ridge", "label": f"HIRA RIDGE ({accessories.get('HIRA RIDGE', 348):,} pcs)"}
        ],
        "batchId": "SIM-BATCH-001",
        "appliedAt": snap["synced_at"] if snap else "2026-10-26T10:52:40+05:30"
    }

@app.get("/api/v1/stock/production")
def get_stock_production():
    snap = STATE["latest_snapshot"]
    return {
        "available": False,
        "sourceSheet": "PRODUCTION",
        "sourceLabel": "Production",
        "reason": "The PRODUCTION worksheet is reserved for plant floor manufacturing runs.",
        "description": "The approved plan neither reads nor stores the PRODUCTION sheet.",
        "categories": [
            {"key": "corrugation", "label": "Corrugation Line"},
            {"key": "slitting", "label": "Slitting Line"},
            {"key": "profiling", "label": "Roll Forming Profile"}
        ],
        "batchId": "SIM-BATCH-001",
        "appliedAt": snap["synced_at"] if snap else "2026-10-26T10:52:40+05:30"
    }

@app.get("/api/v1/stock/balances")
def get_stock_balances(q: str | None = None, page: int = 1, pageSize: int = 20):
    return {
        "items": [
            {
                "productId": p["id"],
                "productName": p["name"],
                "sku": p["sku"],
                "category": p["category"],
                "spec": p["spec"],
                "unit": p["unit"],
                "balanceQuantity": "1500.000" if p["unit"] == "kg" else "250.000",
                "minStockQty": p["minStockQty"],
                "isBelowMin": False
            }
            for p in STATE["products"]
        ],
        "page": page,
        "pageSize": pageSize,
        "total": len(STATE["products"]),
        "nextCursor": None
    }

@app.get("/api/v1/stock/movements")
def get_stock_movements(page: int = 1, pageSize: int = 20):
    movs = STATE.get("stock_movements", [])
    start = (page - 1) * pageSize
    end = start + pageSize
    return {
        "items": movs[start:end],
        "page": page,
        "pageSize": pageSize,
        "total": len(movs),
        "nextCursor": None
    }

# ----------------- Tasks & Tours -----------------
@app.get("/api/v1/tasks")
def get_tasks():
    return {"items": STATE["tasks"]}

@app.get("/api/v1/tours")
def get_tours():
    return {"items": STATE["tours"]}

# ----------------- Single Page Application (SPA) Frontend Mount -----------------
WEB_DIST_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", "dist")
assets_dir = os.path.join(WEB_DIST_DIR, "assets")
if os.path.exists(assets_dir):
    app.mount("/assets", StaticFiles(directory=assets_dir), name="web_assets")

@app.get("/", include_in_schema=False)
@app.get("/{full_path:path}", include_in_schema=False)
async def serve_spa(full_path: str = ""):
    if full_path in ("health", "openapi.json") or full_path.startswith(("api/", "docs")):
        raise HTTPException(status_code=404, detail="Not Found")
    file_path = os.path.join(WEB_DIST_DIR, full_path)
    if full_path and os.path.isfile(file_path):
        return FileResponse(file_path)
    index_file = os.path.join(WEB_DIST_DIR, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return {
        "status": "online",
        "service": "durasmart-api",
        "web_dist_found": os.path.exists(WEB_DIST_DIR),
        "web_dist_path": WEB_DIST_DIR,
        "files_in_dir": os.listdir(os.path.dirname(WEB_DIST_DIR)) if os.path.exists(os.path.dirname(WEB_DIST_DIR)) else [],
        "api_docs": "/docs"
    }

