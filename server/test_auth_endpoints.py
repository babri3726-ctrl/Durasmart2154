import pytest
import uuid
from datetime import datetime, timedelta, timezone
from fastapi.testclient import TestClient
from server.main import app

client = TestClient(app)

def test_invitation_and_signup_flow():
    unique_suffix = uuid.uuid4().hex[:6]
    test_email = f"simranjit_{unique_suffix}@steeloperations.com"
    test_phone = f"9814{uuid.uuid4().int % 1000000:06d}"

    # 1. Owner generates an invitation code
    owner_token = "jwt-access-token-owner-owner"
    invite_resp = client.post(
        "/api/v1/auth/invitations",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={
            "role": "employee",
            "department": "Sales",
            "salesTerritory": "Punjab",
            "monthlyTargetQty": 150.0,
            "targetUnit": "MT",
            "mayDispatch": False,
            "maxUses": 1,
            "expiresInDays": 7
        }
    )
    assert invite_resp.status_code in [200, 201]
    invite_data = invite_resp.json()
    assert "code" in invite_data
    code = invite_data["code"]
    assert code.startswith("DURA-")

    # 2. Public verification of the invitation code
    verify_resp = client.post(
        "/api/v1/auth/invitations/verify",
        json={"code": code}
    )
    assert verify_resp.status_code == 200
    v_data = verify_resp.json()
    assert v_data["valid"] is True
    assert v_data["department"] == "Sales"
    assert v_data["salesTerritory"] == "Punjab"

    # 3. New staff registers with the code
    signup_resp = client.post(
        "/api/v1/auth/signup",
        json={
            "name": "Simranjit Singh",
            "identifier": test_email,
            "password": "Password9988",
            "phone": test_phone,
            "inviteCode": code
        }
    )
    assert signup_resp.status_code in [200, 201]
    s_data = signup_resp.json()
    assert "accessToken" in s_data
    assert s_data["user"]["name"] == "Simranjit Singh"
    assert s_data["user"]["department"] == "Sales"
    simran_token = s_data["accessToken"]

    # 4. Code cannot be reused since maxUses = 1
    signup_second = client.post(
        "/api/v1/auth/signup",
        json={
            "name": "Another User",
            "identifier": f"another_{unique_suffix}@steeloperations.com",
            "password": "Password9988",
            "phone": f"9814{uuid.uuid4().int % 1000000:06d}",
            "inviteCode": code
        }
    )
    assert signup_second.status_code == 400

    # 5. User signs in with newly created password
    login_resp = client.post(
        "/api/v1/auth/login",
        json={
            "identifier": test_email,
            "password": "Password9988"
        }
    )
    assert login_resp.status_code == 200
    assert login_resp.json()["user"]["name"] == "Simranjit Singh"

    # Wrong password fails
    bad_login = client.post(
        "/api/v1/auth/login",
        json={
            "identifier": test_email,
            "password": "WrongPassword"
        }
    )
    assert bad_login.status_code == 401

    # 6. User profile inspection: GET /api/v1/auth/me
    profile_resp = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {simran_token}"}
    )
    assert profile_resp.status_code == 200
    p_data = profile_resp.json()
    assert p_data["name"] == "Simranjit Singh"
    assert p_data["phone"] == test_phone
    assert p_data["department"] == "Sales"

    # 7. User profile update: PATCH /api/v1/auth/me
    new_phone = f"9815{uuid.uuid4().int % 1000000:06d}"
    update_resp = client.patch(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {simran_token}"},
        json={
            "phone": new_phone,
            "currentPassword": "Password9988",
            "newPassword": "BrandNewPassword123"
        }
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["phone"] == new_phone

    # Verify new password works
    new_login = client.post(
        "/api/v1/auth/login",
        json={
            "identifier": test_email,
            "password": "BrandNewPassword123"
        }
    )
    assert new_login.status_code == 200

    # 8. Owner lists invitations
    list_resp = client.get(
        "/api/v1/auth/invitations",
        headers={"Authorization": f"Bearer {owner_token}"}
    )
    assert list_resp.status_code == 200
    invites = list_resp.json()
    assert any(i["code"] == code for i in invites)
