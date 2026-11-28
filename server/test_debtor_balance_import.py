import os
import pytest
from fastapi.testclient import TestClient
from server.main import app
from server.voucher_parser import is_debtor_balance_workbook, parse_debtor_balance_workbook
from server import db

@pytest.fixture
def client():
    return TestClient(app)

def test_debtor_balance_detection():
    assert is_debtor_balance_workbook("debtor balance.xlsx") is True
    assert is_debtor_balance_workbook("data/debtor balance.xlsx") is True

def test_debtor_balance_preview(client):
    with open("debtor balance.xlsx", "rb") as f:
        content = f.read()
    res = client.post("/api/v1/debtors/imports/preview?fileName=debtor%20balance.xlsx&section=debtors", content=content)
    assert res.status_code == 200
    data = res.json()
    assert data["source"] == "tally-benchmarks"
    assert data["totalRowCount"] == 605
    assert data["applyAvailable"] is True
    assert len(data["rows"]) == 605

def test_debtor_balance_apply(client):
    with open("debtor balance.xlsx", "rb") as f:
        content = f.read()
    res = client.post("/api/v1/debtors/imports/apply?fileName=debtor%20balance.xlsx&section=debtors", content=content)
    assert res.status_code == 200
    data = res.json()
    assert data["source"] == "tally-benchmarks"
    assert data["snapshotRowCount"] == 605
    assert data["databaseRowsWritten"] is True

def test_debtor_benchmarks_upload(client):
    with open("debtor balance.xlsx", "rb") as f:
        files = {"file": ("debtor balance.xlsx", f, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        res = client.post("/api/v1/debtors/benchmarks/upload", files=files)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "success"
    assert data["details"]["totalBenchmarks"] == 605
    assert data["details"]["mismatchCount"] > 0
    assert data["details"]["totalVerified"] > 0

    # Query mismatch filter
    m_res = client.get("/api/v1/debtors?statusFilter=mismatch")
    assert m_res.status_code == 200
    m_data = m_res.json()
    assert m_data["summary"]["mismatchCount"] > 0
    assert len(m_data["items"]) > 0
    for item in m_data["items"]:
        assert item["tallyStatus"] == "mismatch"
        assert item["tallyDiff"] != 0

    # Query verified filter
    v_res = client.get("/api/v1/debtors?statusFilter=verified")
    assert v_res.status_code == 200
    v_data = v_res.json()
    assert v_data["summary"]["verifiedCount"] > 0
    assert len(v_data["items"]) > 0
    for item in v_data["items"]:
        assert item["tallyStatus"] == "verified"

def test_excel_upload_debtor_balance(client):
    with open("debtor balance.xlsx", "rb") as f:
        files = {"file": ("debtor balance.xlsx", f, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        res = client.post("/api/v1/imports/excel/upload", files=files)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "success"
    assert data["result"]["type"] == "debtor_balance"
    assert data["result"]["benchmarks_synced"] == 605
