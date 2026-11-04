import pytest
from fastapi.testclient import TestClient
from server.main import app
import server.db as db

client = TestClient(app)

def test_owner_forgot_password_and_reset_flow():
    # 1. Request OTP for Owner
    req_resp = client.post("/api/v1/auth/forgot-password", json={"identifier": "ishujindal"})
    assert req_resp.status_code == 200, f"Expected 200, got {req_resp.status_code}: {req_resp.text}"
    data = req_resp.json()
    assert data["status"] == "ok"
    assert "devOtp" in data
    otp = data["devOtp"]
    assert len(otp) == 6

    # 2. Reset password using invalid OTP (should fail)
    bad_reset = client.post("/api/v1/auth/reset-password", json={
        "identifier": "ishujindal",
        "otp": "000000",
        "newPassword": "NewOwnerPass#2026",
        "confirmPassword": "NewOwnerPass#2026"
    })
    assert bad_reset.status_code == 400

    # 3. Reset password using valid OTP
    good_reset = client.post("/api/v1/auth/reset-password", json={
        "identifier": "ishujindal",
        "otp": otp,
        "newPassword": "NewOwnerPass#2026",
        "confirmPassword": "NewOwnerPass#2026"
    })
    assert good_reset.status_code == 200
    assert good_reset.json()["status"] == "ok"

    # 4. Old password should now fail
    old_login = client.post("/api/v1/auth/login", json={"username": "ishujindal", "password": "Ishu@DuraSmart#2026"})
    assert old_login.status_code == 401

    # 5. New password should now succeed
    new_login = client.post("/api/v1/auth/login", json={"username": "ishujindal", "password": "NewOwnerPass#2026"})
    assert new_login.status_code == 200
    assert new_login.json()["user"]["name"] == "Ishu Jindal"

    # Restore owner password for subsequent test compatibility
    client.post("/api/v1/auth/reset-password", json={
        "identifier": "ishujindal",
        "otp": client.post("/api/v1/auth/forgot-password", json={"identifier": "ishujindal"}).json()["devOtp"],
        "newPassword": "Ishu@DuraSmart#2026",
        "confirmPassword": "Ishu@DuraSmart#2026"
    })

def test_employee_forgot_password_flow():
    # 1. Request OTP using employee ID
    emp_resp = client.post("/api/v1/auth/forgot-password", json={"identifier": "EMP-SP-01"})
    assert emp_resp.status_code == 200
    data = emp_resp.json()
    assert data["user"]["name"] == "AJAY JI"
    otp = data["devOtp"]

    # 2. Reset password for employee
    reset_resp = client.post("/api/v1/auth/reset-password", json={
        "identifier": "EMP-SP-01",
        "otp": otp,
        "newPassword": "AjayNewPassword@2026",
        "confirmPassword": "AjayNewPassword@2026"
    })
    assert reset_resp.status_code == 200

    # 3. Verify login with new password
    login_resp = client.post("/api/v1/auth/login", json={"username": "EMP-SP-01", "password": "AjayNewPassword@2026"})
    assert login_resp.status_code == 200
    assert login_resp.json()["user"]["name"] == "AJAY JI"

    # Restore employee initial password
    client.post("/api/v1/auth/reset-password", json={
        "identifier": "EMP-SP-01",
        "otp": client.post("/api/v1/auth/forgot-password", json={"identifier": "EMP-SP-01"}).json()["devOtp"],
        "newPassword": "DuraSmart@2026",
        "confirmPassword": "DuraSmart@2026"
    })

def test_unknown_identifier_rejected():
    resp = client.post("/api/v1/auth/forgot-password", json={"identifier": "nonexistent_user_999"})
    assert resp.status_code == 404
