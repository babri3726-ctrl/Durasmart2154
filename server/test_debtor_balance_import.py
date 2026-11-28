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

def test_excel_upload_debtor_balance(client):
    with open("debtor balance.xlsx", "rb") as f:
        files = {"file": ("debtor balance.xlsx", f, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        res = client.post("/api/v1/imports/excel/upload", files=files)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "success"
    assert data["result"]["type"] == "debtor_balance"
    assert data["result"]["benchmarks_synced"] == 605
