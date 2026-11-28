import pytest
from server import db

def test_duplicate_closing_balance_guardrail():
    """
    Verifies that:
    1. If an entry is legitimate in Tally (party matches Tally closing balance with both entries),
       it is PROTECTED and NOT flagged as duplicate.
    2. If an entry is a true duplicate (deleting it reduces or fixes the discrepancy with Tally),
       it IS flagged as duplicate with verifiedByClosingBalance=True.
    """
    with db.get_connection() as conn:
        cur = conn.cursor()
        
        # Setup Test Party 1: Verified Party with 2 legitimate identical discount entries in Tally
        # Opening: 0, 2 entries of 5000 Credit -> Current balance: -10000. Tally closing: -10000.
        cur.execute("DELETE FROM parties WHERE id LIKE 'TEST-DUPE-%'")
        cur.execute("DELETE FROM vouchers WHERE party_id LIKE 'TEST-DUPE-%'")
        
        cur.execute("""
            INSERT INTO parties (id, name, state, city, balance_paise, tally_closing_paise, tally_status, party_type)
            VALUES ('TEST-DUPE-LEGIT', 'TEST LEGIT MULTI ENTRY', 'Punjab', 'Ludhiana', -1000000, -1000000, 'verified', 'customer')
        """)
        cur.execute("""
            INSERT INTO vouchers (id, party_id, party_name, voucher_date, voucher_type, voucher_no, debit_paise, credit_paise, book_source, created_at)
            VALUES 
            ('VCH-LEGIT-1', 'TEST-DUPE-LEGIT', 'TEST LEGIT MULTI ENTRY', '2026-09-30', 'Journal', 'QD/101', 0, 500000, 'Daybook', '2026-09-30T10:00:00'),
            ('VCH-LEGIT-2', 'TEST-DUPE-LEGIT', 'TEST LEGIT MULTI ENTRY', '2026-09-30', 'Journal', 'QD/101', 0, 500000, 'Daybook', '2026-09-30T10:00:00')
        """)

        # Setup Test Party 2: Accidental duplicate in panel (1 time in Tally, 2 times in panel)
        # Tally closing: -5000. Panel has 2 entries of 5000 Credit -> Current balance: -10000 (Mismatch).
        # Deleting 1 entry will bring panel balance to -5000 (exact match with Tally).
        cur.execute("""
            INSERT INTO parties (id, name, state, city, balance_paise, tally_closing_paise, tally_status, party_type)
            VALUES ('TEST-DUPE-ACCIDENTAL', 'TEST ACCIDENTAL DUPLICATE', 'Punjab', 'Ludhiana', -1000000, -500000, 'mismatch', 'customer')
        """)
        cur.execute("""
            INSERT INTO vouchers (id, party_id, party_name, voucher_date, voucher_type, voucher_no, debit_paise, credit_paise, book_source, created_at)
            VALUES 
            ('VCH-ACC-1', 'TEST-DUPE-ACCIDENTAL', 'TEST ACCIDENTAL DUPLICATE', '2026-09-30', 'Journal', 'QD/202', 0, 500000, 'Daybook', '2026-09-30T10:00:00'),
            ('VCH-ACC-2', 'TEST-DUPE-ACCIDENTAL', 'TEST ACCIDENTAL DUPLICATE', '2026-09-30', 'Journal', 'QD/202', 0, 500000, 'Daybook', '2026-09-30T10:00:00')
        """)
        conn.commit()

        # Run duplicate candidate finder for Party 1 (Legitimate Multi-Entry)
        res_legit = db.find_duplicate_voucher_candidates(party_id='TEST-DUPE-LEGIT', conn=conn)
        # MUST BE PROTECTED: 0 duplicates found because deleting would break verified Tally balance!
        assert res_legit['totalCandidateDuplicates'] == 0
        assert len(res_legit['groups']) == 0

        # Run duplicate candidate finder for Party 2 (Accidental Duplicate)
        res_acc = db.find_duplicate_voucher_candidates(party_id='TEST-DUPE-ACCIDENTAL', conn=conn)
        # MUST BE FLAGGED: 1 duplicate found because deleting it brings balance into exact match with Tally!
        assert res_acc['totalCandidateDuplicates'] == 1
        assert len(res_acc['groups']) == 1
        assert res_acc['groups'][0]['verifiedByClosingBalance'] is True

        # Clean up test rows
        cur.execute("DELETE FROM parties WHERE id LIKE 'TEST-DUPE-%'")
        cur.execute("DELETE FROM vouchers WHERE party_id LIKE 'TEST-DUPE-%'")
        conn.commit()
