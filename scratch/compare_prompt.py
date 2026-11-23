import openpyxl, collections

wb_pr = openpyxl.load_workbook('PROMPT ENTERPRISES PRIVATE LIMITED BALLABGARH.xlsx', data_only=True)
ws_pr = wb_pr.active

wb_db = openpyxl.load_workbook('daybook.xlsx', data_only=True)
ws_db = wb_db.active

pr_vch = collections.defaultdict(list)
for r in range(8, ws_pr.max_row+1):
    dt = ws_pr.cell(r, 1).value
    dt_str = dt.strftime('%Y-%m-%d') if hasattr(dt, 'strftime') else str(dt)[:10]
    deb = float(ws_pr.cell(r, 6).value or 0)
    cred = float(ws_pr.cell(r, 7).value or 0)
    part = str(ws_pr.cell(r, 3).value or '')
    vtype = str(ws_pr.cell(r, 4).value or '')
    vno = str(ws_pr.cell(r, 5).value or '')
    pr_vch[dt_str].append({'r': r, 'deb': deb, 'cred': cred, 'part': part, 'vtype': vtype, 'vno': vno})

db_vch = collections.defaultdict(list)
for r in range(1, ws_db.max_row+1):
    pname = str(ws_db.cell(r, 2).value or '')
    if 'PROMPT' in pname.upper():
        dt = ws_db.cell(r, 1).value
        dt_str = dt.strftime('%Y-%m-%d') if hasattr(dt, 'strftime') else str(dt)[:10]
        deb = float(ws_db.cell(r, 5).value or 0)
        cred = float(ws_db.cell(r, 6).value or 0)
        vtype = str(ws_db.cell(r, 3).value or '')
        vno = str(ws_db.cell(r, 4).value or '')
        db_vch[dt_str].append({'r': r, 'deb': deb, 'cred': cred, 'vtype': vtype, 'vno': vno})

all_dates = sorted(set(list(pr_vch.keys()) + list(db_vch.keys())))

print('=== DATES WITH DISCREPANCIES ===')
for dt in all_dates:
    prs = pr_vch.get(dt, [])
    dbs = db_vch.get(dt, [])
    pr_d = sum(x['deb'] for x in prs)
    pr_c = sum(x['cred'] for x in prs)
    db_d = sum(x['deb'] for x in dbs)
    db_c = sum(x['cred'] for x in dbs)
    if pr_d != db_d or pr_c != db_c:
        print(f'Date: {dt} | Diff Deb: {pr_d - db_d:,.2f} | Diff Cred: {pr_c - db_c:,.2f}')
        print(f'  In PROMPT LEDGER (count={len(prs)}, deb={pr_d:,.2f}, cred={pr_c:,.2f}):')
        for x in prs:
            print(f"    row {x['r']}: vtype={x['vtype']}, part={x['part']}, vno={x['vno']}, deb={x['deb']:,.2f}, cred={x['cred']:,.2f}")
        print(f'  In DAYBOOK (count={len(dbs)}, deb={db_d:,.2f}, cred={db_c:,.2f}):')
        for x in dbs:
            print(f"    row {x['r']}: vtype={x['vtype']}, vno={x['vno']}, deb={x['deb']:,.2f}, cred={x['cred']:,.2f}")
