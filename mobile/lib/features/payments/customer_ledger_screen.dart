import 'dart:io';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/formatters.dart';
import '../../core/statement_pdf_service.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import '../../data/mock_repository.dart';
import '../../data/models.dart';

/// Full account ledger for one customer: live vouchers from Tally Day Book,
/// Opening balance with Cr/Dr indicators, running totals, FIFO aging, and shareable WhatsApp summary.
class CustomerLedgerScreen extends StatefulWidget {
  const CustomerLedgerScreen({super.key, required this.customerId});
  final String customerId;

  @override
  State<CustomerLedgerScreen> createState() => _CustomerLedgerScreenState();
}

class _CustomerLedgerScreenState extends State<CustomerLedgerScreen> {
  String _voucherFilter = 'All'; // 'All', 'Sales', 'Receipts'
  String _viewMode = 'detailed'; // 'detailed' | 'monthly'
  bool _sortAscendingTally = true; // 1-Apr-26 First (Tally) by default
  String? _selectedMonthKey; // e.g. '2026-11' when drilling down from Monthly Summary
  bool _loadingVouchers = false;
  bool _cleaningDuplicates = false;

  @override
  void initState() {
    super.initState();
    if (!Platform.environment.containsKey('FLUTTER_TEST')) {
      _loadVouchers();
    }
  }

  Future<void> _loadVouchers() async {
    setState(() => _loadingVouchers = true);
    try {
      await context.read<MockRepository>().fetchVouchersFor(widget.customerId);
    } catch (_) {}
    if (mounted) {
      setState(() => _loadingVouchers = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final repo = context.watch<MockRepository>();
    final customer = repo.customerById(widget.customerId) ??
        repo.debtors.where((d) => d.id == widget.customerId).map((d) => Customer(
              id: d.id,
              name: d.name,
              city: d.city.isNotEmpty ? d.city : (d.district.isNotEmpty ? d.district : d.state),
              mobile: d.mobile.isNotEmpty ? d.mobile : '',
              salespersonId: 'EMP-SP-01',
              type: 'Dealer',
            )).firstOrNull;

    if (customer == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Customer Ledger')),
        body: const EmptyState(
          icon: Icons.person_off_rounded,
          title: 'Customer not found',
          subtitle:
              'Customer record could not be located in this session.',
        ),
      );
    }

    final now = DateTime.now();
    final vouchers = repo.vouchersFor(customer.id);
    final hasVouchers = vouchers.isNotEmpty;

    // Debtor master record for opening balance
    final debtor = repo.debtors.where(
      (d) =>
          d.id == customer.id ||
          d.name.toLowerCase().trim() == customer.name.toLowerCase().trim(),
    ).firstOrNull;
    final double openingBalance = debtor?.openingBalance ?? 0.0;
    final String effectiveMobile = (customer.mobile.isNotEmpty
            ? customer.mobile
            : (debtor?.mobile ?? ''))
        .trim();

    // Fallback orders & payments if no vouchers exist
    final orders = repo.ordersFor(customer.id);
    final payments = repo.paymentsFor(customer.id);

    // Sums (all debits and all credits matching backend recompute_party_balance)
    final voucherTotalDebits =
        vouchers.fold(0.0, (sum, v) => sum + v.debit);
    final voucherTotalCredits =
        vouchers.fold(0.0, (sum, v) => sum + v.credit);

    final billed = hasVouchers
        ? voucherTotalDebits
        : orders.fold(0.0, (sum, order) => sum + order.total);
    final collected = hasVouchers
        ? voucherTotalCredits
        : payments.fold(0.0, (sum, payment) => sum + payment.amount);
    final outstanding = debtor != null
        ? debtor.balance
        : (hasVouchers
            ? (openingBalance + voucherTotalDebits - voucherTotalCredits)
            : repo.customerOutstanding(customer.id));
    final overdue = repo.customerOverdue(customer.id);

    // FIFO Aging calculation
    double bucket0_30 = 0.0;
    double bucket31_60 = 0.0;
    double bucket61_90 = 0.0;
    double bucket90Plus = 0.0;

    if (hasVouchers) {
      double remainingCredits = voucherTotalCredits;
      if (openingBalance > 0) {
        if (remainingCredits >= openingBalance) {
          remainingCredits -= openingBalance;
        } else {
          bucket90Plus += (openingBalance - remainingCredits);
          remainingCredits = 0;
        }
      } else if (openingBalance < 0) {
        remainingCredits += openingBalance.abs();
      }

      final debitVouchers = vouchers
          .where((v) => v.isSales || (v.isJournal && v.debit > 0))
          .toList()
        ..sort((a, b) => a.voucherDate.compareTo(b.voucherDate));

      for (final v in debitVouchers) {
        final amount = v.debit;
        double unpaid = 0.0;
        if (remainingCredits >= amount) {
          remainingCredits -= amount;
        } else {
          unpaid = amount - remainingCredits;
          remainingCredits = 0;
        }

        if (unpaid > 0) {
          final vDate = DateTime.tryParse(v.voucherDate) ?? DateTime.now();
          final ageDays = DateTime.now().difference(vDate).inDays;
          if (ageDays <= 30) {
            bucket0_30 += unpaid;
          } else if (ageDays <= 60) {
            bucket31_60 += unpaid;
          } else if (ageDays <= 90) {
            bucket61_90 += unpaid;
          } else {
            bucket90Plus += unpaid;
          }
        }
      }
    }

    // Build chronological ascending list (1-Apr-2026 first) to compute Tally running balances
    final chronoVouchers = List<VoucherItem>.from(vouchers)
      ..sort((a, b) {
        final cmp = a.voucherDate.compareTo(b.voucherDate);
        if (cmp != 0) return cmp;
        return a.id.compareTo(b.id);
      });

    final runningBalanceById = <String, double>{};
    double runBal = openingBalance;
    for (final v in chronoVouchers) {
      runBal += v.debit - v.credit;
      runningBalanceById[v.id] = runBal;
    }

    // Build Tally Monthly Summary (Apr 2026 to Nov 2026 / latest)
    final fyMonths = <String>[
      '2026-04', '2026-05', '2026-06', '2026-07',
      '2026-08', '2026-09', '2026-10', '2026-11',
    ];
    for (final v in chronoVouchers) {
      if (v.voucherDate.length >= 7) {
        final mk = v.voucherDate.substring(0, 7);
        if (mk.compareTo('2026-04') >= 0 && !fyMonths.contains(mk)) {
          fyMonths.add(mk);
        }
      }
    }
    fyMonths.sort();

    final monthlyRows = <_MonthlySummaryRow>[];
    double mRunning = openingBalance;
    for (final mk in fyMonths) {
      final mOpen = mRunning;
      double mDr = 0.0;
      double mCr = 0.0;
      int mCount = 0;
      for (final v in chronoVouchers) {
        if (v.voucherDate.startsWith(mk)) {
          mDr += v.debit;
          mCr += v.credit;
          mCount++;
        }
      }
      mRunning = mOpen + mDr - mCr;
      monthlyRows.add(_MonthlySummaryRow(
        monthKey: mk,
        label: _formatMonthKey(mk),
        opening: mOpen,
        debit: mDr,
        credit: mCr,
        closing: mRunning,
        count: mCount,
      ));
    }

    final orderedVouchers = _sortAscendingTally
        ? chronoVouchers
        : chronoVouchers.reversed.toList();

    final filteredVouchers = orderedVouchers.where((v) {
      if (_selectedMonthKey != null && !v.voucherDate.startsWith(_selectedMonthKey!)) {
        return false;
      }
      if (_voucherFilter == 'Sales') return v.isSales;
      if (_voucherFilter == 'Receipts') {
        return v.isReceipt || v.isCreditNote || (v.isJournal && v.credit > 0);
      }
      return true;
    }).toList();

    final statementText = _buildStatementMessage(
      customer: customer,
      openingBalance: openingBalance,
      totalSales: billed,
      totalCredits: collected,
      outstanding: outstanding,
      bucket0_30: bucket0_30,
      bucket31_60: bucket31_60,
      bucket61_90: bucket61_90,
      bucket90Plus: bucket90Plus,
      vouchers: vouchers,
    );

    final pdfData = StatementPdfData(
      partyName: customer.name,
      partyId: customer.id,
      city: customer.city,
      state: debtor?.state ?? 'Punjab',
      mobile: effectiveMobile,
      openingBalance: openingBalance,
      totalDebits: billed,
      totalCredits: collected,
      closingBalance: outstanding,
      bucket0_30: bucket0_30,
      bucket31_60: bucket31_60,
      bucket61_90: bucket61_90,
      bucket90Plus: bucket90Plus,
      vouchers: chronoVouchers.map((v) => StatementVoucherRow(
        date: v.voucherDate,
        type: v.voucherType,
        vchNo: v.voucherNo,
        particulars: v.narration.isNotEmpty ? v.narration : (v.bookSource.isNotEmpty ? v.bookSource : 'Tally Entry'),
        debit: v.debit,
        credit: v.credit,
        balance: runningBalanceById[v.id] ?? 0.0,
      )).toList(),
    );

    return Scaffold(
      appBar: AppBar(
        title: const Text('Customer Ledger'),
        actions: [
          IconButton(
            icon: const Icon(Icons.picture_as_pdf_rounded),
            tooltip: 'Download Statement PDF',
            onPressed: () async {
              try {
                final file = await StatementPdfService.saveStatementPdfLocally(pdfData);
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text('Statement PDF downloaded: ${file.path.split(Platform.pathSeparator).last}'),
                      backgroundColor: AppColors.green,
                      action: SnackBarAction(
                        label: 'Share',
                        textColor: Colors.white,
                        onPressed: () => StatementPdfService.shareStatementPdf(pdfData),
                      ),
                    ),
                  );
                }
              } catch (e) {
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text('Error downloading PDF: $e'), backgroundColor: AppColors.red),
                  );
                }
              }
            },
          ),
          IconButton(
            icon: const Icon(Icons.print_rounded),
            tooltip: 'Print Statement',
            onPressed: () => StatementPdfService.printStatementPdf(pdfData),
          ),
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            tooltip: 'Reload Vouchers',
            onPressed: _loadVouchers,
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          await repo.syncWithBackend();
          await _loadVouchers();
        },
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: AppSpacing.page,
          children: [
            // ── Top Gradient Hero ──────────────────────────────────────────
            GradientHero(
              gradient: AppGradients.customer,
              height: 178,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      AvatarCircle(
                        name: customer.name,
                        size: 44,
                        gradient: const LinearGradient(
                          colors: [Colors.white24, Colors.white24],
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              customer.name,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.w900,
                                fontSize: 16,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              '${customer.city.isNotEmpty ? customer.city : 'Punjab'} • ${debtor?.salesperson ?? 'Unassigned'}',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: Colors.white70,
                                fontSize: 11.5,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  Row(
                    children: [
                      Expanded(
                        child: _HeroStat('Outstanding', rupeesDrCr(outstanding)),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: _HeroStat(
                          'Opening Bal',
                          rupeesDrCr(openingBalance),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: _HeroStat(
                          'Vouchers',
                          hasVouchers
                              ? '${vouchers.length} items'
                              : '${orders.length} orders',
                        ),
                      ),
                    ],
                  ),
                  Text(
                    'ID: ${customer.id} • ${customer.mobile.isNotEmpty ? customer.mobile : '9814000000'}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: Colors.white70, fontSize: 10.5),
                  ),
                ],
              ),
            ),
            if (debtor != null && debtor.isMismatch) ...[
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFFFEF3C7),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: const Color(0xFFFDE68A)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Icon(Icons.warning_amber_rounded, color: Color(0xFFD97706), size: 18),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            'Tally Ground Truth Mismatch',
                            style: const TextStyle(
                              fontSize: 12.5,
                              fontWeight: FontWeight.w900,
                              color: Color(0xFF92400E),
                            ),
                          ),
                        ),
                        TextButton.icon(
                          style: TextButton.styleFrom(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                            minimumSize: Size.zero,
                            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                            backgroundColor: const Color(0xFFD97706),
                            foregroundColor: Colors.white,
                          ),
                          onPressed: _cleaningDuplicates
                              ? null
                              : () async {
                                  final sm = ScaffoldMessenger.of(context);
                                  setState(() => _cleaningDuplicates = true);
                                  final res = await repo.cleanupDuplicateVouchers();
                                  await _loadVouchers();
                                  if (!mounted) return;
                                  setState(() => _cleaningDuplicates = false);
                                  sm.showSnackBar(
                                    SnackBar(
                                      content: Text(
                                        res != null
                                            ? 'Cleaned ${res['deletedCount'] ?? 0} duplicates'
                                            : 'Duplicate cleanup failed',
                                      ),
                                    ),
                                  );
                                },
                          icon: const Icon(Icons.cleaning_services_rounded, size: 13),
                          label: Text(
                            _cleaningDuplicates ? 'Cleaning...' : 'Clean Dupes',
                            style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w800),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Current: ${debtor.balanceFormatted} vs Tally: ${debtor.tallyClosingFormatted} (Diff: ${debtor.tallyDiffFormatted})',
                      style: const TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        color: Color(0xFFB45309),
                      ),
                    ),
                  ],
                ),
              ),
            ] else if (debtor != null && debtor.isVerified) ...[
              const SizedBox(height: 10),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: const Color(0xFFF0FDF4),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: const Color(0xFFBBF7D0)),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.check_circle_rounded, color: Color(0xFF16A34A), size: 16),
                    const SizedBox(width: 6),
                    Text(
                      debtor.hasAuthoritativeLedger
                          ? 'Verified with Authoritative Tally Party Ledger'
                          : 'Verified with Tally Closing Balance',
                      style: const TextStyle(
                        fontSize: 11.5,
                        fontWeight: FontWeight.w800,
                        color: Color(0xFF15803D),
                      ),
                    ),
                  ],
                ),
              ),
            ],
            const SizedBox(height: 14),

            // ── 4 Balance Metric Tiles ────────────────────────────────────
            Row(
              children: [
                Expanded(
                  child: MetricCard(
                    title: 'Opening balance',
                    value: rupeesDrCr(openingBalance),
                    caption: openingBalance < 0
                        ? 'Advance credit brought forward'
                        : 'As of 01-04-2026',
                    icon: Icons.account_balance_rounded,
                    gradient: openingBalance < 0
                        ? AppGradients.customer
                        : AppGradients.employee,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: MetricCard(
                    title: 'Total debits / billed',
                    value: rupees(billed),
                    caption: hasVouchers
                        ? '${vouchers.where((v) => v.debit > 0).length} debit voucher(s)'
                        : '${orders.length} order(s)',
                    icon: Icons.receipt_rounded,
                    gradient: AppGradients.order,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: MetricCard(
                    title: 'Total credits / receipts',
                    value: rupees(collected),
                    caption: hasVouchers
                        ? '${vouchers.where((v) => v.credit > 0).length} credit voucher(s)'
                        : '${payments.length} receipt(s)',
                    icon: Icons.payments_rounded,
                    gradient: AppGradients.success,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: MetricCard(
                    title: 'Current outstanding',
                    value: rupeesDrCr(outstanding),
                    caption: outstanding.abs() < 0.01
                        ? 'Account settled'
                        : (outstanding > 0 ? 'Receivable (Dr.)' : 'Advance / Payable (Cr.)'),
                    icon: Icons.account_balance_wallet_rounded,
                    gradient: AppGradients.payment,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),

            // ── FIFO Aging Breakdown ───────────────────────────────────────
            WhitePanel(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SectionHeading(
                    title: 'Bill Aging Analysis (FIFO)',
                    subtitle: 'Allocated against bank receipts and notes',
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(
                        child: _AgingBucketTile(
                          label: '0 - 30 Days',
                          amount: bucket0_30,
                          color: AppColors.ink,
                        ),
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: _AgingBucketTile(
                          label: '31 - 60 Days',
                          amount: bucket31_60,
                          color: bucket31_60 > 0 ? AppColors.orange : AppColors.ink,
                        ),
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: _AgingBucketTile(
                          label: '61 - 90 Days',
                          amount: bucket61_90,
                          color: bucket61_90 > 0 ? Colors.orange : AppColors.ink,
                        ),
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: _AgingBucketTile(
                          label: '90+ Days',
                          amount: bucket90Plus,
                          color: bucket90Plus > 0 ? AppColors.red : AppColors.ink,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),

            // ── Live Vouchers / Ledger Table & Tally Monthly Summary ──────
            WhitePanel(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SectionHeading(
                    title: hasVouchers ? 'Party Ledger Statement' : 'Invoice Ledger',
                    subtitle: hasVouchers
                        ? (_viewMode == 'monthly'
                            ? 'Tally-style monthly summary (Apr–Nov 2026)'
                            : '${filteredVouchers.length} vouchers recorded')
                        : '${orders.length} order invoice(s)',
                    trailing: hasVouchers && _viewMode == 'detailed'
                        ? Container(
                            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                            decoration: BoxDecoration(
                              color: AppColors.background,
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(color: AppColors.line),
                            ),
                            child: DropdownButtonHideUnderline(
                              child: DropdownButton<String>(
                                value: _voucherFilter,
                                isDense: true,
                                style: AppText.caption.copyWith(fontWeight: FontWeight.bold),
                                items: const [
                                  DropdownMenuItem(value: 'All', child: Text('All')),
                                  DropdownMenuItem(value: 'Sales', child: Text('Debits')),
                                  DropdownMenuItem(value: 'Receipts', child: Text('Credits')),
                                ],
                                onChanged: (v) {
                                  if (v != null) setState(() => _voucherFilter = v);
                                },
                              ),
                            ),
                          )
                        : null,
                  ),
                  if (hasVouchers) ...[
                    const SizedBox(height: 10),
                    // View Mode Switcher: Detailed Ledger vs Monthly Summary (Tally View)
                    Container(
                      padding: const EdgeInsets.all(3),
                      decoration: BoxDecoration(
                        color: const Color(0xFFF1F5F9),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Row(
                        children: [
                          Expanded(
                            child: GestureDetector(
                              onTap: () => setState(() => _viewMode = 'detailed'),
                              child: Container(
                                padding: const EdgeInsets.symmetric(vertical: 7),
                                decoration: BoxDecoration(
                                  color: _viewMode == 'detailed' ? Colors.white : Colors.transparent,
                                  borderRadius: BorderRadius.circular(8),
                                  boxShadow: _viewMode == 'detailed'
                                      ? const [BoxShadow(color: Color(0x12000000), blurRadius: 4, offset: Offset(0, 1))]
                                      : null,
                                ),
                                child: Center(
                                  child: Text(
                                    'Detailed Ledger',
                                    style: TextStyle(
                                      fontSize: 11.5,
                                      fontWeight: _viewMode == 'detailed' ? FontWeight.w800 : FontWeight.w600,
                                      color: _viewMode == 'detailed' ? const Color(0xFF0F172A) : const Color(0xFF64748B),
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ),
                          Expanded(
                            child: GestureDetector(
                              onTap: () => setState(() => _viewMode = 'monthly'),
                              child: Container(
                                padding: const EdgeInsets.symmetric(vertical: 7),
                                decoration: BoxDecoration(
                                  color: _viewMode == 'monthly' ? Colors.white : Colors.transparent,
                                  borderRadius: BorderRadius.circular(8),
                                  boxShadow: _viewMode == 'monthly'
                                      ? const [BoxShadow(color: Color(0x12000000), blurRadius: 4, offset: Offset(0, 1))]
                                      : null,
                                ),
                                child: Center(
                                  child: Text(
                                    'Monthly Summary (Tally)',
                                    style: TextStyle(
                                      fontSize: 11.5,
                                      fontWeight: _viewMode == 'monthly' ? FontWeight.w800 : FontWeight.w600,
                                      color: _viewMode == 'monthly' ? const Color(0xFF2563EB) : const Color(0xFF64748B),
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    if (_viewMode == 'detailed') ...[
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          InkWell(
                            borderRadius: BorderRadius.circular(8),
                            onTap: () => setState(() => _sortAscendingTally = !_sortAscendingTally),
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
                              decoration: BoxDecoration(
                                color: const Color(0xFFF8FAFC),
                                borderRadius: BorderRadius.circular(8),
                                border: Border.all(color: const Color(0xFFE2E8F0)),
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  const Icon(Icons.swap_vert_rounded, size: 14, color: Color(0xFF2563EB)),
                                  const SizedBox(width: 4),
                                  Text(
                                    _sortAscendingTally ? '1-Apr-26 First (Tally)' : 'Latest First',
                                    style: const TextStyle(
                                      fontSize: 10.5,
                                      fontWeight: FontWeight.w700,
                                      color: Color(0xFF334155),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                          if (_selectedMonthKey != null) ...[
                            const SizedBox(width: 8),
                            InkWell(
                              borderRadius: BorderRadius.circular(8),
                              onTap: () => setState(() => _selectedMonthKey = null),
                              child: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
                                decoration: BoxDecoration(
                                  color: const Color(0xFFEFF6FF),
                                  borderRadius: BorderRadius.circular(8),
                                  border: Border.all(color: const Color(0xFFBFDBFE)),
                                ),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Text(
                                      'Month: ${_formatMonthKey(_selectedMonthKey!)}',
                                      style: const TextStyle(
                                        fontSize: 10.5,
                                        fontWeight: FontWeight.w800,
                                        color: Color(0xFF1D4ED8),
                                      ),
                                    ),
                                    const SizedBox(width: 4),
                                    const Icon(Icons.close_rounded, size: 13, color: Color(0xFF1D4ED8)),
                                  ],
                                ),
                              ),
                            ),
                          ],
                        ],
                      ),
                    ],
                  ],
                  const SizedBox(height: 10),
                  if (_loadingVouchers)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 24),
                      child: Center(child: CircularProgressIndicator()),
                    )
                  else if (hasVouchers && _viewMode == 'monthly')
                    Column(
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 6),
                          decoration: BoxDecoration(
                            color: const Color(0xFFF1F5F9),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: const Row(
                            children: [
                              Expanded(flex: 3, child: Text('MONTH', style: TextStyle(fontSize: 9.5, fontWeight: FontWeight.w800, color: Color(0xFF475569)))),
                              Expanded(flex: 3, child: Text('DEBIT (+)', textAlign: TextAlign.right, style: TextStyle(fontSize: 9.5, fontWeight: FontWeight.w800, color: Color(0xFF475569)))),
                              Expanded(flex: 3, child: Text('CREDIT (-)', textAlign: TextAlign.right, style: TextStyle(fontSize: 9.5, fontWeight: FontWeight.w800, color: Color(0xFF475569)))),
                              Expanded(flex: 4, child: Text('CLOSING', textAlign: TextAlign.right, style: TextStyle(fontSize: 9.5, fontWeight: FontWeight.w800, color: Color(0xFF475569)))),
                            ],
                          ),
                        ),
                        const SizedBox(height: 4),
                        for (final m in monthlyRows)
                          InkWell(
                            onTap: () {
                              setState(() {
                                _selectedMonthKey = m.monthKey;
                                _viewMode = 'detailed';
                              });
                            },
                            child: Container(
                              padding: const EdgeInsets.symmetric(vertical: 9, horizontal: 6),
                              decoration: const BoxDecoration(
                                border: Border(bottom: BorderSide(color: Color(0xFFF1F5F9))),
                              ),
                              child: Row(
                                children: [
                                  Expanded(
                                    flex: 3,
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          m.label,
                                          style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800, color: Color(0xFF0F172A)),
                                        ),
                                        Text(
                                          '${m.count} vch',
                                          style: const TextStyle(fontSize: 9.5, color: Color(0xFF64748B)),
                                        ),
                                      ],
                                    ),
                                  ),
                                  Expanded(
                                    flex: 3,
                                    child: Text(
                                      m.debit > 0 ? rupeesShort(m.debit) : '—',
                                      textAlign: TextAlign.right,
                                      style: const TextStyle(fontSize: 11, fontFamily: 'monospace', fontWeight: FontWeight.w700, color: Color(0xFF1E293B)),
                                    ),
                                  ),
                                  Expanded(
                                    flex: 3,
                                    child: Text(
                                      m.credit > 0 ? rupeesShort(m.credit) : '—',
                                      textAlign: TextAlign.right,
                                      style: const TextStyle(fontSize: 11, fontFamily: 'monospace', fontWeight: FontWeight.w700, color: Color(0xFF15803D)),
                                    ),
                                  ),
                                  Expanded(
                                    flex: 4,
                                    child: Text(
                                      rupeesDrCr(m.closing),
                                      textAlign: TextAlign.right,
                                      style: TextStyle(
                                        fontSize: 11,
                                        fontFamily: 'monospace',
                                        fontWeight: FontWeight.w800,
                                        color: m.closing >= 0 ? const Color(0xFF0F172A) : const Color(0xFF0D9488),
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                      ],
                    )
                  else if (hasVouchers)
                    filteredVouchers.isEmpty
                        ? const EmptyState(
                            icon: Icons.filter_list_off_rounded,
                            title: 'No vouchers match filter',
                            subtitle: 'Try switching the filter to All.',
                          )
                        : Column(
                            children: [
                              if (_sortAscendingTally && _selectedMonthKey == null)
                                Container(
                                  padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 6),
                                  margin: const EdgeInsets.only(bottom: 4),
                                  decoration: BoxDecoration(
                                    color: const Color(0xFFFFFBEB),
                                    borderRadius: BorderRadius.circular(8),
                                    border: Border.all(color: const Color(0xFFFDE68A)),
                                  ),
                                  child: Row(
                                    children: [
                                      const Expanded(
                                        child: Column(
                                          crossAxisAlignment: CrossAxisAlignment.start,
                                          children: [
                                            Text(
                                              'OPENING BALANCE',
                                              style: TextStyle(fontSize: 9.5, fontWeight: FontWeight.w900, color: Color(0xFF92400E)),
                                            ),
                                            Text(
                                              '01-04-2026 • Brought forward (as of 1-Apr-2026)',
                                              style: TextStyle(fontSize: 10.5, color: Color(0xFFB45309)),
                                            ),
                                          ],
                                        ),
                                      ),
                                      Text(
                                        rupeesDrCr(openingBalance),
                                        style: const TextStyle(
                                          fontFamily: 'monospace',
                                          fontSize: 11.5,
                                          fontWeight: FontWeight.w900,
                                          color: Color(0xFF92400E),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ListView.separated(
                                shrinkWrap: true,
                                physics: const NeverScrollableScrollPhysics(),
                                itemCount: filteredVouchers.length,
                                separatorBuilder: (_, _) => const Divider(height: 1),
                                itemBuilder: (context, i) {
                                  final v = filteredVouchers[i];
                                  return _VoucherListTile(
                                    voucher: v,
                                    runningBalance: runningBalanceById[v.id],
                                  );
                                },
                              ),
                            ],
                          )
                  else
                    // Fallback to order rows when vouchers are not yet imported
                    orders.isEmpty
                        ? const EmptyState(
                            icon: Icons.receipt_long_rounded,
                            title: 'No vouchers yet',
                            subtitle: 'Import daybook.xlsx to view full transaction ledger.',
                          )
                        : SingleChildScrollView(
                            scrollDirection: Axis.horizontal,
                            child: Column(
                              children: [
                                const _LedgerRow(
                                  cells: <String>[
                                    'Invoice',
                                    'Order date',
                                    'Invoice total',
                                    'Paid',
                                    'Balance',
                                    'Due date',
                                    'Status',
                                  ],
                                  strong: true,
                                ),
                                Container(
                                  height: 1,
                                  width: 700,
                                  margin: const EdgeInsets.symmetric(vertical: 6),
                                  color: AppColors.line,
                                ),
                                for (final order in orders)
                                  _LedgerRow(
                                    cells: _orderCells(order, repo),
                                    tone: _orderTone(order, repo, now),
                                  ),
                              ],
                            ),
                          ),
                ],
              ),
            ),
            const SizedBox(height: 14),

            // ── Running Totals Summary ─────────────────────────────────────
            WhitePanel(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SectionHeading(title: 'Account Summary'),
                  const SizedBox(height: 6),
                  InfoRow(
                    label: 'Opening balance',
                    value: rupeesDrCr(openingBalance),
                    valueColor: openingBalance < 0 ? AppColors.teal : AppColors.ink,
                  ),
                  InfoRow(
                    label: 'Total debits / billed',
                    value: rupees(billed),
                  ),
                  InfoRow(
                    label: 'Total credits / receipts',
                    value: rupees(collected),
                    valueColor: AppColors.green,
                  ),
                  InfoRow(
                    label: 'Current outstanding',
                    value: rupeesDrCr(outstanding),
                    valueColor: outstanding > 0 ? AppColors.red : AppColors.green,
                  ),
                  if (overdue > 0)
                    InfoRow(
                      label: 'Overdue portion',
                      value: '${rupees(overdue)} past terms',
                      valueColor: AppColors.red,
                    ),
                  InfoRow(
                    label: 'Party ID',
                    value: customer.id,
                  ),
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 6),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        const Expanded(
                          child: Text(
                            'Party Mobile / WhatsApp',
                            style: TextStyle(color: AppColors.muted, fontSize: 12),
                          ),
                        ),
                        InkWell(
                          onTap: () => _showEditMobileDialog(context, repo, customer, debtor),
                          borderRadius: BorderRadius.circular(6),
                          child: Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(
                                  Icons.phone_rounded,
                                  size: 13,
                                  color: effectiveMobile.isNotEmpty ? AppColors.green : AppColors.orange,
                                ),
                                const SizedBox(width: 4),
                                Text(
                                  effectiveMobile.isNotEmpty ? effectiveMobile : 'Add Number',
                                  style: TextStyle(
                                    fontSize: 12,
                                    fontWeight: FontWeight.bold,
                                    color: effectiveMobile.isNotEmpty ? AppColors.ink : AppColors.purple,
                                    decoration: effectiveMobile.isEmpty ? TextDecoration.underline : null,
                                  ),
                                ),
                                const SizedBox(width: 4),
                                const Icon(Icons.edit_rounded, size: 12, color: AppColors.muted),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),

            // ── Share on WhatsApp ─────────────────────────────────────────
            WhatsAppButton(
              label: 'Share on WhatsApp',
              phone: effectiveMobile,
              message: statementText,
            ),
            const SizedBox(height: 10),

            // ── Download PDF & Print (Matching Web buttons) ────────────────
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      side: const BorderSide(color: AppColors.line),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      backgroundColor: Colors.white,
                    ),
                    onPressed: () async {
                      try {
                        final file = await StatementPdfService.saveStatementPdfLocally(pdfData);
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(
                              content: Text('Statement PDF downloaded: ${file.path.split(Platform.pathSeparator).last}'),
                              backgroundColor: AppColors.green,
                              action: SnackBarAction(
                                label: 'Share',
                                textColor: Colors.white,
                                onPressed: () => StatementPdfService.shareStatementPdf(pdfData),
                              ),
                            ),
                          );
                        }
                      } catch (e) {
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(content: Text('Error downloading PDF: $e'), backgroundColor: AppColors.red),
                          );
                        }
                      }
                    },
                    icon: const Icon(Icons.download_rounded, size: 18, color: AppColors.ink),
                    label: const Text(
                      'Download PDF',
                      style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: AppColors.ink),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      side: const BorderSide(color: AppColors.line),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      backgroundColor: Colors.white,
                    ),
                    onPressed: () => StatementPdfService.printStatementPdf(pdfData),
                    icon: const Icon(Icons.print_rounded, size: 18, color: AppColors.ink),
                    label: const Text(
                      'Print',
                      style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: AppColors.ink),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: ActionPill(
                icon: Icons.account_balance_rounded,
                label: 'Open outstanding & overdue',
                onTap: () => Navigator.of(context).pushNamed('/outstanding'),
              ),
            ),
            const SizedBox(height: 20),
          ],
        ),
      ),
    );
  }

  void _showEditMobileDialog(BuildContext context, MockRepository repo, Customer customer, DebtorItem? debtor) {
    final currentMob = (customer.mobile.isNotEmpty ? customer.mobile : (debtor?.mobile ?? '')).trim();
    final controller = TextEditingController(text: currentMob);
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(
          'WhatsApp Number: ${customer.name}',
          style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
        ),
        content: TextField(
          controller: controller,
          keyboardType: TextInputType.phone,
          autofocus: true,
          decoration: const InputDecoration(
            labelText: 'Mobile / WhatsApp Number',
            hintText: 'e.g. 9814012345 or +91...',
            border: OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.green),
            onPressed: () async {
              final newMob = controller.text.trim();
              await repo.updatePartyMobile(customer.id, newMob);
              if (debtor != null && debtor.id != customer.id) {
                await repo.updatePartyMobile(debtor.id, newMob);
              }
              if (mounted) setState(() {});
              if (ctx.mounted) Navigator.of(ctx).pop();
              if (context.mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text(newMob.isNotEmpty ? 'Mobile number saved: $newMob' : 'Mobile number cleared'),
                    backgroundColor: AppColors.green,
                  ),
                );
              }
            },
            child: const Text('Save', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  static String _buildStatementMessage({
    required Customer customer,
    required double openingBalance,
    required double totalSales,
    required double totalCredits,
    required double outstanding,
    required double bucket0_30,
    required double bucket31_60,
    required double bucket61_90,
    required double bucket90Plus,
    required List<VoucherItem> vouchers,
  }) {
    final buffer = StringBuffer();
    buffer.writeln('*DURASMART - Statement of Account*');
    buffer.writeln('--------------------------------');
    buffer.writeln('*Party:* ${customer.name}');
    buffer.writeln('*City:* ${customer.city}');
    buffer.writeln(
      '*Opening Balance:* ${rupeesDrCr(openingBalance)}',
    );
    buffer.writeln('*Total Debits / Billed:* ${rupees(totalSales)}');
    buffer.writeln('*Total Credits / Receipts:* ${rupees(totalCredits)}');
    buffer.writeln('*Current Outstanding:* ${rupeesDrCr(outstanding)}');
    buffer.writeln();
    buffer.writeln('*Aging Breakdown:*');
    buffer.writeln('• 0-30 Days: ${rupees(bucket0_30)}');
    buffer.writeln('• 31-60 Days: ${rupees(bucket31_60)}');
    buffer.writeln('• 61-90 Days: ${rupees(bucket61_90)}');
    buffer.writeln('• 90+ Days: ${rupees(bucket90Plus)}');
    if (vouchers.isNotEmpty) {
      buffer.writeln();
      buffer.writeln('*Recent Vouchers:*');
      for (final v in vouchers.take(5)) {
        final amt = v.debit > 0 ? '+${rupees(v.debit)}' : '-${rupees(v.credit)}';
        buffer.writeln(
          '• ${v.voucherDate} | ${v.voucherType} (${v.voucherNo.isNotEmpty ? v.voucherNo : '—'}): $amt',
        );
      }
    }
    buffer.writeln();
    buffer.writeln('Please clear any overdue balance at your earliest convenience.');
    buffer.writeln('Thank you,');
    buffer.write('*Dura Smart Doors & Windows*');
    return buffer.toString();
  }

  static List<String> _orderCells(SalesOrder order, MockRepository repo) {
    final balance = repo.orderBalance(order.id);
    return <String>[
      order.number,
      dayMonthLabel(order.orderDate),
      rupeesShort(order.total),
      rupeesShort(repo.orderPaid(order.id)),
      rupeesShort(balance),
      dayMonthLabel(order.dueDate),
      balance <= 0.0001
          ? 'Settled'
          : (order.dueDate.isBefore(DateTime.now()) ? 'Overdue' : 'Open'),
    ];
  }

  static _CellTone _orderTone(
    SalesOrder order,
    MockRepository repo,
    DateTime now,
  ) {
    final balance = repo.orderBalance(order.id);
    if (balance < -0.0001) return _CellTone.advance;
    if (balance > 0.0001 && order.dueDate.isBefore(now)) {
      return _CellTone.overdue;
    }
    return _CellTone.normal;
  }
}

class _AgingBucketTile extends StatelessWidget {
  const _AgingBucketTile({
    required this.label,
    required this.amount,
    required this.color,
  });

  final String label;
  final double amount;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
      decoration: BoxDecoration(
        color: AppColors.background,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.line),
      ),
      child: Column(
        children: [
          Text(
            label,
            style: const TextStyle(
              fontSize: 9.5,
              fontWeight: FontWeight.bold,
              color: AppColors.muted,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            rupeesShort(amount),
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w900,
              fontFamily: 'monospace',
              color: color,
            ),
          ),
        ],
      ),
    );
  }
}

class _VoucherListTile extends StatelessWidget {
  const _VoucherListTile({required this.voucher, this.runningBalance});
  final VoucherItem voucher;
  final double? runningBalance;

  @override
  Widget build(BuildContext context) {
    final isSales = voucher.isSales;
    final isReceipt = voucher.isReceipt;
    final isJv = voucher.isJournal;

    Color badgeBg = const Color(0xFFF1F5F9);
    Color badgeText = const Color(0xFF475569);
    if (isSales) {
      badgeBg = const Color(0xFFEFF6FF);
      badgeText = const Color(0xFF1E40AF);
    } else if (isReceipt) {
      badgeBg = const Color(0xFFECFDF5);
      badgeText = const Color(0xFF065F46);
    } else if (isJv) {
      badgeBg = const Color(0xFFFAF5FF);
      badgeText = const Color(0xFF6B21A8);
    }

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: badgeBg,
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text(
                        voucher.voucherType.toUpperCase(),
                        style: TextStyle(
                          fontSize: 9.5,
                          fontWeight: FontWeight.w900,
                          color: badgeText,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      voucher.voucherDate,
                      style: AppText.caption.copyWith(
                        fontWeight: FontWeight.bold,
                        color: AppColors.ink,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 3),
                Text(
                  voucher.voucherNo.isNotEmpty
                      ? 'Vch: ${voucher.voucherNo}'
                      : (voucher.narration.isNotEmpty ? voucher.narration : 'Day Book Voucher'),
                  style: AppText.caption.copyWith(color: AppColors.muted),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              if (voucher.debit > 0)
                Text(
                  '+${rupees(voucher.debit)}',
                  style: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 12,
                    fontWeight: FontWeight.bold,
                    color: AppColors.ink,
                  ),
                ),
              if (voucher.credit > 0)
                Text(
                  '-${rupees(voucher.credit)}',
                  style: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 12,
                    fontWeight: FontWeight.bold,
                    color: AppColors.green,
                  ),
                ),
              if (runningBalance != null) ...[
                const SizedBox(height: 2),
                Text(
                  'Bal: ${rupeesDrCr(runningBalance!)}',
                  style: TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                    color: runningBalance! >= 0 ? AppColors.muted : AppColors.teal,
                  ),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }
}

class _MonthlySummaryRow {
  const _MonthlySummaryRow({
    required this.monthKey,
    required this.label,
    required this.opening,
    required this.debit,
    required this.credit,
    required this.closing,
    required this.count,
  });

  final String monthKey;
  final String label;
  final double opening;
  final double debit;
  final double credit;
  final double closing;
  final int count;
}

String _formatMonthKey(String mk) {
  final parts = mk.split('-');
  if (parts.length != 2) return mk;
  const names = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  final m = int.tryParse(parts[1]) ?? 1;
  final idx = (m - 1).clamp(0, 11);
  return '${names[idx]} ${parts[0]}';
}

class _HeroStat extends StatelessWidget {
  const _HeroStat(this.label, this.value);
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        label,
        style: const TextStyle(
          color: Colors.white70,
          fontSize: 10,
          fontWeight: FontWeight.w600,
        ),
      ),
      const SizedBox(height: 2),
      Text(
        value,
        style: const TextStyle(
          color: Colors.white,
          fontSize: 13,
          fontWeight: FontWeight.w900,
          fontFamily: 'monospace',
        ),
      ),
    ],
  );
}

enum _CellTone { normal, overdue, advance }

class _LedgerRow extends StatelessWidget {
  const _LedgerRow({
    required this.cells,
    this.strong = false,
    this.tone = _CellTone.normal,
  });
  final List<String> cells;
  final bool strong;
  final _CellTone tone;

  static const List<double> _widths = <double>[92, 92, 110, 100, 106, 92, 96];

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 9, horizontal: 2),
    child: Row(
      children: [
        for (var i = 0; i < cells.length; i++)
          SizedBox(
            width: _widths[i],
            child: Text(
              cells[i],
              style: TextStyle(
                fontSize: 11,
                fontWeight: strong ? FontWeight.bold : FontWeight.w500,
                color: tone == _CellTone.overdue && i == 6
                    ? AppColors.red
                    : (tone == _CellTone.advance && i == 6
                        ? AppColors.teal
                        : AppColors.ink),
              ),
            ),
          ),
      ],
    ),
  );
}
