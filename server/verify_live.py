import json
import urllib.request


def test_api():
    base = 'http://127.0.0.1:8010/api/v1'
    
    # 1. Test Customer Search by Station / City
    print('Testing Customer Search by Station (Ludhiana)...')
    req = urllib.request.urlopen(f'{base}/customers?q=Ludhiana&pageSize=10')
    res = json.loads(req.read().decode())
    first = res['items'][0]
    print(f"  Found {res['total']} dealers in Ludhiana. First: {first['name']} ({first.get('city')}, {first.get('state')})")
    assert res['total'] > 0

    print('Testing Customer Search by Station (Rohtak)...')
    req = urllib.request.urlopen(f'{base}/customers?q=Rohtak&pageSize=10')
    res = json.loads(req.read().decode())
    first = res['items'][0]
    print(f"  Found {res['total']} dealers in Rohtak. First: {first['name']} ({first.get('city')}, {first.get('state')})")
    assert res['total'] > 0

    # 2. Test Customer Search by Salesperson name
    print('Testing Customer Search by Salesperson (Mozi Ram)...')
    req = urllib.request.urlopen(f'{base}/customers?q=Mozi&pageSize=10')
    res = json.loads(req.read().decode())
    print(f"  Found {res['total']} dealers under Mozi Ram.")
    assert res['total'] > 0

    # 3. Test Employees with Territory
    print('Testing Employees with Territory...')
    req = urllib.request.urlopen(f'{base}/employees?activeOnly=true&pageSize=20')
    res = json.loads(req.read().decode())
    for emp in res['items'][:5]:
        print(f"  {emp['id']}: {emp['name']} | Territory: {emp.get('salesTerritory')} | Role: {emp['role']}")
    assert any(emp.get('salesTerritory') for emp in res['items'])

    # 4. Test Order Creation with Handwritten Slip Photo alone
    print('Testing Order Creation with Photo Slip alone...')
    slip_sample = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP...'
    payload = {
        'customerId': 'DEBTOR-HR-001',
        'customerName': 'KALRA TRADERS/ STEEL DERABASSI',
        'state': 'Haryana',
        'salespersonId': 'EMP-SP-07',
        'salespersonName': 'Mozi Ram',
        'orderDate': '2026-10-24',
        'notes': 'Booked from diary chit',
        'status': 'pending',
        'lines': [
            {
                'productName': 'Material list as per attached slip',
                'quantity': '1.000',
                'unit': 'MT',
                'ratePaise': 0,
                'gstRatePercent': None
            }
        ],
        'slipImageData': slip_sample
    }
    data_bytes = json.dumps(payload).encode('utf-8')
    req_post = urllib.request.Request(f'{base}/orders', data=data_bytes, headers={'Content-Type': 'application/json', 'Idempotency-Key': 'key-photo-test-live-002'})
    res_post = json.loads(urllib.request.urlopen(req_post).read().decode())
    order_id = res_post['id']
    order_num = res_post['number']
    print(f"  Order created successfully! ID: {order_id}, Number: {order_num}, Slip attached: {bool(res_post.get('slipImageData'))}")
    assert res_post['slipImageData'] == slip_sample

    # 5. Test Fetching Order Detail
    print('Testing Fetching Order Detail...')
    req_get = urllib.request.urlopen(f'{base}/orders/{order_id}')
    res_get = json.loads(req_get.read().decode())
    print(f"  Fetched order: customer={res_get['customerName']}, officer={res_get.get('salespersonName')}, lines={len(res_get['lines'])}")
    assert res_get['slipImageData'] is not None

    print('\n>>> ALL 5 LIVE TESTS PASSED CLEANLY! <<<')

if __name__ == '__main__':
    test_api()
