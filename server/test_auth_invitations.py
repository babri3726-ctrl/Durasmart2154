import pytest
from datetime import datetime, timedelta, timezone
from server import db

def test_invitation_crud_and_status():
    code = "TEST-INVITE-001"
    expires = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
    inv = db.create_invitation(
        code=code,
        role="employee",
        department="Sales",
        employee_id="EMP-SP-99",
        sales_territory="Punjab",
        monthly_target_qty=120.0,
        target_unit="MT",
        may_dispatch=0,
        max_uses=1,
        expires_at=expires,
        created_by="USR-OWNER"
    )
    assert inv["code"] == code
    assert inv["role"] == "employee"
    assert inv["department"] == "Sales"
    assert inv["status"] == "active"
    assert inv["used_count"] == 0

    fetched = db.get_invitation_by_code(code)
    assert fetched is not None
    assert fetched["code"] == code

    # Verify usage increment
    used = db.use_invitation_code(code)
    assert used is True
    fetched_after = db.get_invitation_by_code(code)
    assert fetched_after["used_count"] == 1
    assert fetched_after["status"] == "used"

    # Second use should fail since max_uses = 1
    used_second = db.use_invitation_code(code)
    assert used_second is False

    # Revoke
    code2 = "TEST-INVITE-002"
    db.create_invitation(
        code=code2,
        role="dispatch",
        department="Dispatch",
        expires_at=expires,
        created_by="USR-OWNER"
    )
    revoked = db.revoke_invitation(code2)
    assert revoked is True
    fetched2 = db.get_invitation_by_code(code2)
    assert fetched2["status"] == "revoked"

def test_user_creation_and_salted_auth():
    username = "test_user_rajesh"
    email = "rajesh.test@durasmart.com"
    phone = "9876543210"
    password = "SecurePassword123"

    user = db.create_user(
        name="Rajesh Kumar",
        username=username,
        email=email,
        phone=phone,
        password=password,
        role="employee",
        department="Sales",
        employee_id="EMP-SP-10",
        sales_territory="Haryana"
    )
    assert user["id"].startswith("usr-")
    assert user["email"] == email
    assert user["name"] == "Rajesh Kumar"

    # Verify password
    auth_ok = db.verify_user_password(user, "SecurePassword123")
    assert auth_ok is True
    auth_bad = db.verify_user_password(user, "WrongPassword")
    assert auth_bad is False

    # Look up by email, phone, and username
    by_email = db.get_user_by_identifier(email)
    assert by_email is not None and by_email["id"] == user["id"]

    by_phone = db.get_user_by_identifier(phone)
    assert by_phone is not None and by_phone["id"] == user["id"]

    by_user = db.get_user_by_identifier(username)
    assert by_user is not None and by_user["id"] == user["id"]

    # Profile updates
    updated = db.update_user_profile(user["id"], phone="9999988888", name="Rajesh K. Sharma")
    assert updated is not None
    assert updated["phone"] == "9999988888"
    assert updated["name"] == "Rajesh K. Sharma"

    # Password update
    db.update_user_password(user["id"], "NewPassword456")
    refetched = db.get_user_by_identifier(username)
    assert db.verify_user_password(refetched, "NewPassword456") is True
    assert db.verify_user_password(refetched, "SecurePassword123") is False
