import sys
import os
import sqlite3

sys.path.insert(0, r'C:\NewProject_Frontend')
from server import db
from server import main

def test_dashboard_summary():
    summary = main.get_dashboard_summary(from_date="2026-11-01", to_date="2026-11-30")
    print("Dashboard Summary:")
    print(f"  outstandingPaise: {summary.get('outstandingPaise')} (₹{summary.get('outstandingPaise')/100:,.2f})")
    print(f"  collectedPaise: {summary.get('collectedPaise')} (₹{summary.get('collectedPaise')/100:,.2f})")
    print(f"  advancesPaise: {summary.get('advancesPaise')} (₹{summary.get('advancesPaise', 0)/100:,.2f})")
    print(f"  overduePaise: {summary.get('overduePaise')} (₹{summary.get('overduePaise')/100:,.2f})")
    print(f"  dealersCount: {summary.get('dealersCount')}")
    
    # Assert receivables is strictly positive and realistic (never negative)
    assert summary.get("outstandingPaise") > 0, "Receivables must be strictly positive"
    assert summary.get("dealersCount") > 500, "Should have >500 genuine trade debtors"
    assert summary.get("collectedPaise") >= 0, "Collections must be non-negative"
    print("✓ test_dashboard_summary passed!\n")

def test_bank_transactions_summary():
    # Test All Accounts
    res_all = main.get_bank_transactions(bank="all", from_date="2026-11-01", to_date="2026-11-30")
    s_all = res_all["summary"]
    print(f"All Accounts Summary: Vouchers={s_all['totalVouchers']}, Opening=₹{s_all['openingBalancePaise']/100:,.2f}, Receipts=₹{s_all['totalReceiptsPaise']/100:,.2f}, Payments=₹{s_all['totalPaymentsPaise']/100:,.2f}, Closing=₹{s_all['closingBalancePaise']/100:,.2f}")
    assert s_all["totalVouchers"] > 0
    assert "closingBalancePaise" in s_all
    assert "openingBalancePaise" in s_all

    # Test HDFC
    res_hdfc = main.get_bank_transactions(bank="hdfc", from_date="2026-11-01", to_date="2026-11-30")
    s_hdfc = res_hdfc["summary"]
    print(f"HDFC Bank Summary: Vouchers={s_hdfc['totalVouchers']}, Closing=₹{s_hdfc['closingBalancePaise']/100:,.2f}")
    assert s_hdfc["totalVouchers"] > 0
    assert s_hdfc["closingBalancePaise"] == s_hdfc["openingBalancePaise"] + s_hdfc["netPaise"]

    # Test Yes Bank
    res_yes = main.get_bank_transactions(bank="yes", from_date="2026-11-01", to_date="2026-11-30")
    s_yes = res_yes["summary"]
    print(f"Yes Bank Summary: Vouchers={s_yes['totalVouchers']}, Closing=₹{s_yes['closingBalancePaise']/100:,.2f}")
    assert s_yes["totalVouchers"] > 0
    assert s_yes["closingBalancePaise"] == s_yes["openingBalancePaise"] + s_yes["netPaise"]

    # Test Cash Book
    res_cash = main.get_bank_transactions(bank="cash", from_date="2026-11-01", to_date="2026-11-30")
    s_cash = res_cash["summary"]
    print(f"Cash Book Summary: Vouchers={s_cash['totalVouchers']}, Closing=₹{s_cash['closingBalancePaise']/100:,.2f}")
    assert s_cash["totalVouchers"] > 0

    print("✓ test_bank_transactions_summary passed!\n")

def test_salesperson_performance():
    res = main.get_salesperson_performance(from_date="2026-11-01", to_date="2026-11-30")
    print(f"Salesperson Performance: {len(res['rows'])} sales officers")
    for r in res["rows"][:3]:
        print(f"  {r['employeeName']}: Target={r['units'][0]['targetQuantity']} MT, Achieved={r['units'][0]['achievedQuantity']} MT, Receivables=₹{r['receivablesPaise']/100:,.2f}, Collected=₹{r['collectedPaise']/100:,.2f}, DSO={r['dsoDays']}d")
        assert "receivablesPaise" in r
        assert "collectedPaise" in r
        assert "dsoDays" in r
    
    assert "velocity" in res
    print(f"  Business Velocity: Growth={res['velocity']['salesGrowthMoM']}%, DSO={res['velocity']['turnaroundCycleDays']}d, Efficiency={res['velocity']['collectionEfficiency']}%")
    print("✓ test_salesperson_performance passed!\n")

def test_tour_coordinates():
    plans = db.get_tour_plans()
    assert len(plans) > 0
    for p in plans:
        for v in p["visits"]:
            lat = v.get("gpsLat") or v.get("gps_lat")
            lng = v.get("gpsLng") or v.get("gps_lng")
            assert lat is not None and lng is not None, f"Visit {v['id']} missing coordinates"
            assert 27.0 <= lat <= 33.0 and 73.0 <= lng <= 78.0, f"Coordinates out of bounds: {lat}, {lng}"
    print(f"✓ test_tour_coordinates passed! Verified all {sum(len(p['visits']) for p in plans)} visits have valid GPS coordinates.")

if __name__ == "__main__":
    test_dashboard_summary()
    test_bank_transactions_summary()
    test_salesperson_performance()
    test_tour_coordinates()
    print("\nALL VERIFICATION TESTS PASSED SUCCESSFULLY!")
