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


def test_upload_section_validation_accepts_cash_and_khan_cash():
    """cash.xlsx and khan cash.xlsx uploaded in Payment section should succeed."""
    cash_path = os.path.join(os.path.dirname(__file__), "..", "data", "cash.xlsx")
    if not os.path.exists(cash_path):
        pytest.skip("data/cash.xlsx not found")

    with open(cash_path, "rb") as f:
        data = f.read()

    resp = client.post(
        "/api/v1/payments/imports/preview?fileName=cash.xlsx",
        content=data,
        headers={"Content-Type": "application/octet-stream"}
    )
    assert resp.status_code == 200
    assert resp.json()["applyAvailable"] is True
    assert resp.json()["sheetName"] == "Cash Book"

    # Khan Cash
    khan_path = os.path.join(os.path.dirname(__file__), "..", "data", "khan cash.xlsx")
    with open(khan_path, "rb") as f:
        data_khan = f.read()

    resp_khan = client.post(
        "/api/v1/payments/imports/preview?fileName=khan cash.xlsx",
        content=data_khan,
        headers={"Content-Type": "application/octet-stream"}
    )
    assert resp_khan.status_code == 200
    assert resp_khan.json()["applyAvailable"] is True
    assert resp_khan.json()["sheetName"] == "Khan Cash Book"

    # Cash GBD
    gbd_path = os.path.join(os.path.dirname(__file__), "..", "data", "cash gbd.xlsx")
    with open(gbd_path, "rb") as f:
        data_gbd = f.read()

    resp_gbd = client.post(
        "/api/v1/payments/imports/preview?fileName=cash gbd.xlsx",
        content=data_gbd,
        headers={"Content-Type": "application/octet-stream"}
    )
    assert resp_gbd.status_code == 200
    assert resp_gbd.json()["applyAvailable"] is True
    assert resp_gbd.json()["sheetName"] == "Cash GBD Book"


def test_upload_section_validation_rejects_cash_file_in_debtor_section():
    """cash.xlsx and cash gbd.xlsx uploaded in Debtor section should be rejected with 400."""
    cash_path = os.path.join(os.path.dirname(__file__), "..", "data", "cash.xlsx")
    if not os.path.exists(cash_path):
        pytest.skip("data/cash.xlsx not found")

    with open(cash_path, "rb") as f:
        data = f.read()

    resp = client.post(
        "/api/v1/debtors/imports/preview?fileName=cash.xlsx&section=debtors",
        content=data,
        headers={"Content-Type": "application/octet-stream"}
    )
    assert resp.status_code == 400
    assert "Payment section" in resp.json()["detail"]

    # Cash GBD in debtor section
    gbd_path = os.path.join(os.path.dirname(__file__), "..", "data", "cash gbd.xlsx")
    with open(gbd_path, "rb") as f:
        data_gbd = f.read()

    resp_gbd = client.post(
        "/api/v1/debtors/imports/preview?fileName=cash gbd.xlsx&section=debtors",
        content=data_gbd,
        headers={"Content-Type": "application/octet-stream"}
    )
    assert resp_gbd.status_code == 400
    assert "Payment section" in resp_gbd.json()["detail"]


def test_bank_transactions_endpoint():
    """GET /api/v1/bank-transactions returns date-wise vouchers and summary."""
    resp = client.get("/api/v1/bank-transactions")
    assert resp.status_code == 200
    data = resp.json()
    assert "items" in data
    assert "summary" in data
    assert "totalReceiptsPaise" in data["summary"]
    assert "totalPaymentsPaise" in data["summary"]
