import os
import pytest
from fastapi.testclient import TestClient
from server.main import app

client = TestClient(app)

def test_upload_section_validation_rejects_bank_file_in_debtor_section():
    """HDFC or Yes Bank files uploaded in Debtor section should be rejected with 400."""
    hdfc_path = os.path.join(os.path.dirname(__file__), "..", "data", "hdfc.xlsx")
    if not os.path.exists(hdfc_path):
        pytest.skip("data/hdfc.xlsx not found")
    
    with open(hdfc_path, "rb") as f:
        data = f.read()

    # Upload HDFC in Debtor section
    resp = client.post(
        "/api/v1/debtors/imports/preview?fileName=hdfc.xlsx&section=debtors",
        content=data,
        headers={"Content-Type": "application/octet-stream"}
    )
    assert resp.status_code == 400
    assert "Payment section" in resp.json()["detail"]


def test_upload_section_validation_accepts_sales_in_debtor_section():
    """Sales Register uploaded in Debtor section should succeed."""
    sales_path = os.path.join(os.path.dirname(__file__), "..", "data", "sales.xlsx")
    if not os.path.exists(sales_path):
        pytest.skip("data/sales.xlsx not found")
        
    with open(sales_path, "rb") as f:
        data = f.read()

    resp = client.post(
        "/api/v1/debtors/imports/preview?fileName=sales.xlsx&section=debtors",
        content=data,
        headers={"Content-Type": "application/octet-stream"}
    )
    assert resp.status_code == 200
    assert resp.json()["applyAvailable"] is True
    assert resp.json()["sheetName"] == "Sales Register"


def test_upload_section_validation_rejects_sales_file_in_payment_section():
    """Sales Register uploaded in Payment section should be rejected with 400."""
    sales_path = os.path.join(os.path.dirname(__file__), "..", "data", "sales.xlsx")
    if not os.path.exists(sales_path):
        pytest.skip("data/sales.xlsx not found")

    with open(sales_path, "rb") as f:
        data = f.read()

    resp = client.post(
        "/api/v1/payments/imports/preview?fileName=sales.xlsx",
        content=data,
        headers={"Content-Type": "application/octet-stream"}
    )
    assert resp.status_code == 400
    assert "Debtor section" in resp.json()["detail"]


def test_upload_section_validation_accepts_bank_file_in_payment_section():
    """HDFC or Yes Bank file uploaded in Payment section should succeed."""
    hdfc_path = os.path.join(os.path.dirname(__file__), "..", "data", "hdfc.xlsx")
    if not os.path.exists(hdfc_path):
        pytest.skip("data/hdfc.xlsx not found")

    with open(hdfc_path, "rb") as f:
        data = f.read()

    resp = client.post(
        "/api/v1/payments/imports/preview?fileName=hdfc.xlsx",
        content=data,
        headers={"Content-Type": "application/octet-stream"}
    )
    assert resp.status_code == 200
    assert resp.json()["applyAvailable"] is True
    assert "Bank Book" in resp.json()["sheetName"]


def test_bank_transactions_endpoint():
    """GET /api/v1/bank-transactions returns date-wise vouchers and summary."""
    resp = client.get("/api/v1/bank-transactions")
    assert resp.status_code == 200
    data = resp.json()
    assert "items" in data
    assert "summary" in data
    assert "totalReceiptsPaise" in data["summary"]
    assert "totalPaymentsPaise" in data["summary"]
