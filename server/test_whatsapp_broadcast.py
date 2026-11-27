import io
from unittest.mock import AsyncMock, patch
import pytest
import openpyxl
from whatsapp_broadcast import (
    normalize_phone_number,
    parse_excel_for_broadcast,
    format_broadcast_message,
    broadcast_whatsapp_messages
)

def test_normalize_phone_number():
    assert normalize_phone_number("9876543210") == "919876543210"
    assert normalize_phone_number("+91 98765-43210") == "919876543210"
    assert normalize_phone_number("09876543210") == "919876543210"
    assert normalize_phone_number(9876543210) == "919876543210"
    assert normalize_phone_number(9876543210.0) == "919876543210"
    assert normalize_phone_number("919876543210") == "919876543210"
    assert normalize_phone_number("12345") is None  # Invalid short number
    assert normalize_phone_number(None) is None
    assert normalize_phone_number("0000000000") is None

def test_format_broadcast_message():
    template = "Dear {name}, your balance is Rs. {balance}. Please pay by {due_date}."
    context = {"name": "Aarav Traders", "balance": "15,000", "due_date": "30-Nov"}
    msg = format_broadcast_message(template, context)
    assert msg == "Dear Aarav Traders, your balance is Rs. 15,000. Please pay by 30-Nov."

def test_parse_excel_for_broadcast():
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Debtors"
    
    # Metadata rows at top
    ws.append(["Monthly Report", None, None])
    ws.append([None, None, None])
    # Header row
    ws.append(["Party Name", "Mobile Number", "Outstanding Balance", "City"])
    # Data rows
    ws.append(["Aarav Bikes", "9876543210", 25000, "Ludhiana"])
    ws.append(["Shree Ram Impex", "+91 9123456780", 12500.50, "Barwala"])
    ws.append(["Invalid Client", "000000", 5000, "Delhi"])
    ws.append(["No Phone Client", None, 3000, "Amritsar"])
    
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    
    result = parse_excel_for_broadcast(
        buf,
        template="Hello {name}, your pending balance is Rs. {balance} ({city})."
    )
    
    assert result["summary"]["total_data_rows"] == 4
    assert result["summary"]["valid_count"] == 2
    assert result["summary"]["invalid_count"] == 2
    
    recipients = result["valid_recipients"]
    assert recipients[0]["phone"] == "919876543210"
    assert recipients[0]["name"] == "Aarav Bikes"
    assert "Rs. 25000" in recipients[0]["message"]
    assert "Ludhiana" in recipients[0]["message"]
    
    assert recipients[1]["phone"] == "919123456780"
    assert recipients[1]["name"] == "Shree Ram Impex"

@pytest.mark.anyio
async def test_broadcast_whatsapp_messages():
    recipients = [
        {"phone": "919876543210", "name": "Aarav Bikes", "message": "Test Message 1"},
        {"phone": "919123456780", "name": "Shree Ram", "message": "Test Message 2"}
    ]
    
    mock_response = AsyncMock()
    mock_response.status_code = 200
    mock_response.text = '{"success": true}'
    
    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_response
        result = await broadcast_whatsapp_messages(
            recipients,
            sender_api_url="http://test-server/api/send-message",
            min_delay=0.01,
            max_delay=0.02
        )
        
        assert result["total"] == 2
        assert result["sent_count"] == 2
        assert result["failed_count"] == 0
        assert mock_post.call_count == 2

def test_preview_and_send_endpoints():
    from fastapi.testclient import TestClient
    from server.main import app

    client = TestClient(app)

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Customer", "Contact Number", "Balance"])
    ws.append(["Ramesh Sharma", "9876543210", 4500])
    ws.append(["Pooja Verma", "+91 9811122233", 8200])

    buf = io.BytesIO()
    wb.save(buf)
    excel_bytes = buf.getvalue()

    # 1. Test Preview Endpoint
    preview_res = client.post(
        "/api/v1/whatsapp/broadcast-excel/preview",
        files={"file": ("test_debtors.xlsx", excel_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        data={"template": "Hi {name}, balance is Rs. {balance}."}
    )
    assert preview_res.status_code == 200
    preview_json = preview_res.json()
    assert preview_json["success"] is True
    assert preview_json["summary"]["valid_count"] == 2
    assert preview_json["valid_recipients"][0]["phone"] == "919876543210"

    # 2. Test Send (Queue) Endpoint
    with patch("server.main.broadcast_whatsapp_messages", new_callable=AsyncMock) as mock_broadcast:
        send_res = client.post(
            "/api/v1/whatsapp/broadcast-excel/send",
            files={"file": ("test_debtors.xlsx", excel_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            data={"template": "Hi {name}, balance is Rs. {balance}."}
        )
        assert send_res.status_code == 200
        send_json = send_res.json()
        assert send_json["success"] is True
        assert send_json["queued_count"] == 2
        assert mock_broadcast.called


