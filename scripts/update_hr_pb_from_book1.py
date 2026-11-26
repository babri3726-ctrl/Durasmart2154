import openpyxl
import os
import re
import shutil
from server.voucher_parser import clean_party_name, detect_state_and_city

wb_book1 = openpyxl.load_workbook('Book1.xlsx', data_only=True)
ws1 = wb_book1.active

wb_old = openpyxl.load_workbook('data/HR-PB.xlsx', data_only=True)
known_meta = {}
for r in range(5, wb_old['Sheet1'].max_row + 1):
    p = wb_old['Sheet1'].cell(r, 4).value
    st = wb_old['Sheet1'].cell(r, 5).value
    dist = wb_old['Sheet1'].cell(r, 6).value
    officer = wb_old['Sheet1'].cell(r, 7).value
    if p:
        known_meta[clean_party_name(p).lower().strip()] = ('Haryana', st or '', dist or '', officer or '')

for r in range(5, wb_old['Sheet2'].max_row + 1):
    p = wb_old['Sheet2'].cell(r, 3).value
    st = wb_old['Sheet2'].cell(r, 4).value
    dist = wb_old['Sheet2'].cell(r, 5).value
    officer = wb_old['Sheet2'].cell(r, 6).value
    if p:
        known_meta[clean_party_name(p).lower().strip()] = ('Punjab', st or '', dist or '', officer or '')

hr_keywords = [
    'haryana', 'karnal', 'ambala', 'panchkula', 'kurukshetra', 'yamunanagar', 'hisar', 'sirsa',
    'rohtak', 'sonipat', 'panipat', 'jhajjar', 'gurugram', 'faridabad', 'narnaul', 'rewari',
    'bhiwani', 'fatehabad', 'kaithal', 'palwal', 'charkhi', 'ladwa', 'taraori', 'barwala',
    'pehowa', 'shahabad', 'sahabad', 'naraingarh', 'cheeka', 'assandh', 'gharaunda', 'samalkha',
    'gohana', 'ganaur', 'bahadurgarh', 'hansi', 'ratia', 'tohana', 'kalanwali', 'kundli',
    'murthal', 'bilaspur', 'radaur', 'sadhaura', 'jagadhri', 'safidon', 'narwana', 'pundri'
]

hr_rows = []
pb_rows = []

for r in range(3, ws1.max_row + 1):
    sn = ws1.cell(r, 1).value
    p = ws1.cell(r, 2).value
    sp = ws1.cell(r, 3).value
    trgt = ws1.cell(r, 4).value or 0
    ldh = ws1.cell(r, 5).value or 0
    tot = ws1.cell(r, 6).value or 0
    pend = ws1.cell(r, 7).value or 0
    cat = ws1.cell(r, 8).value
    if not p:
        continue
    k = clean_party_name(p).lower().strip()
    
    meta = known_meta.get(k)
    if meta:
        state, station, dist, officer = meta
    else:
        p_low = p.lower()
        if any(kw in p_low for kw in hr_keywords):
            state = 'Haryana'
            _, city = detect_state_and_city(p)
            station = city
            dist = city
        else:
            state, city = detect_state_and_city(p)
            if any(kw in city.lower() for kw in hr_keywords):
                state = 'Haryana'
            station = city
            dist = city
        officer = sp or ''

    # Clean display name
    clean_p = re.sub(r'\s+', ' ', str(p)).strip()
    item = (sn, clean_p, station, dist, sp or officer or 'Unassigned', trgt, tot, pend, cat)
    if state == 'Haryana':
        hr_rows.append(item)
    else:
        pb_rows.append(item)

# Build new workbook
new_wb = openpyxl.Workbook()
ws_hr = new_wb.active
ws_hr.title = 'Sheet1'

ws_hr.cell(3, 3, 'Haryana Dealear Target Slit Coil 2026')
headers_hr = [None, None, 'S.NO', "Dealer's Name", 'STATION', 'Distt.', 'Area Officer', 'Target (MT)', 'Mtrl Dispatch', 'Pending (MT)', 'Category']
for col_idx, h in enumerate(headers_hr, 1):
    if h:
        ws_hr.cell(4, col_idx, h)

for idx, r in enumerate(hr_rows, 5):
    ws_hr.cell(idx, 3, r[0])
    ws_hr.cell(idx, 4, r[1])
    ws_hr.cell(idx, 5, r[2])
    ws_hr.cell(idx, 6, r[3])
    ws_hr.cell(idx, 7, r[4])
    ws_hr.cell(idx, 8, r[5])
    ws_hr.cell(idx, 9, r[6])
    ws_hr.cell(idx, 10, r[7])
    if r[8]:
        ws_hr.cell(idx, 11, r[8])

ws_pb = new_wb.create_sheet('Sheet2')
ws_pb.cell(3, 2, 'Punjab SLIT Target 2026')
headers_pb = [None, 'S.NO', 'Party Name', 'STATION', 'Distt.', 'Sales Person', 'Target (MT)', 'Mtrl Dispatch', 'Pending (MT)', 'Category']
for col_idx, h in enumerate(headers_pb, 1):
    if h:
        ws_pb.cell(4, col_idx, h)

for idx, r in enumerate(pb_rows, 5):
    ws_pb.cell(idx, 2, r[0])
    ws_pb.cell(idx, 3, r[1])
    ws_pb.cell(idx, 4, r[2])
    ws_pb.cell(idx, 5, r[3])
    ws_pb.cell(idx, 6, r[4])
    ws_pb.cell(idx, 7, r[5])
    ws_pb.cell(idx, 8, r[6])
    ws_pb.cell(idx, 9, r[7])
    if r[8]:
        ws_pb.cell(idx, 10, r[8])

new_wb.save('data/HR-PB.xlsx')
os.makedirs('data/imports', exist_ok=True)
shutil.copyfile('data/HR-PB.xlsx', 'data/imports/HR-PB.xlsx')
print(f'Successfully updated data/HR-PB.xlsx: {len(hr_rows)} Haryana dealers, {len(pb_rows)} Punjab dealers. Total: {len(hr_rows) + len(pb_rows)}')
