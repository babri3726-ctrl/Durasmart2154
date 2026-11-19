import 'dart:io';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/formatters.dart';
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
  bool _loadingVouchers = false;

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
              mobile: '919800000000',
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

    // Fallback orders & payments if no vouchers exist
    final orders = repo.ordersFor(customer.id);
    final payments = repo.paymentsFor(customer.id);

    // Sums
    final voucherSalesDebit = vouchers
        .where((v) => v.isSales)
        .fold(0.0, (sum, v) => sum + v.debit);
    final voucherReceiptsCredit = vouchers
        .where((v) =>
            v.isReceipt ||
            v.isCreditNote ||
            (v.isJournal && v.credit > 0))
        .fold(0.0, (sum, v) => sum + v.credit);
    final voucherJournalDebit = vouchers
        .where((v) => v.isJournal && v.debit > 0)
        .fold(0.0, (sum, v) => sum + v.debit);

    final billed = hasVouchers
        ? voucherSalesDebit
        : orders.fold(0.0, (sum, order) => sum + order.total);
    final collected = hasVouchers
        ? voucherReceiptsCredit
        : payments.fold(0.0, (sum, payment) => sum + payment.amount);
    final outstanding = (debtor != null && debtor.balance > 0)
        ? debtor.balance
        : (hasVouchers
            ? (openingBalance +
                    voucherSalesDebit +
                    voucherJournalDebit -
                    voucherReceiptsCredit)
                .clamp(0.0, double.infinity)
            : repo.customerOutstanding(customer.id));
    final overdue = repo.customerOverdue(customer.id);

    // FIFO Aging calculation
    double bucket0_30 = 0.0;
    double bucket31_60 = 0.0;
    double bucket61_90 = 0.0;
    double bucket90Plus = 0.0;

    if (hasVouchers) {
      double remainingCredits = voucherReceiptsCredit;
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

    final filteredVouchers = vouchers.where((v) {
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

    return Scaffold(
      appBar: AppBar(
        title: const Text('Customer Ledger'),
        actions: [
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
                        child: _HeroStat('Outstanding', rupees(outstanding)),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: _HeroStat(
                          'Opening Bal',
                          openingBalance < 0
                              ? '${rupees(openingBalance.abs())} Cr'
                              : rupees(openingBalance),
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
            const SizedBox(height: 14),

            // ── 4 Balance Metric Tiles ────────────────────────────────────
            Row(
              children: [
                Expanded(
                  child: MetricCard(
                    title: 'Opening balance',
                    value: openingBalance < 0
                        ? '${rupees(openingBalance.abs())} Cr'
                        : rupees(openingBalance),
                    caption: openingBalance < 0
                        ? 'Advance credit brought forward'
                        : 'Starting balance',
                    icon: Icons.account_balance_rounded,
                    gradient: openingBalance < 0
                        ? AppGradients.customer
                        : AppGradients.employee,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: MetricCard(
                    title: 'Total billed sales',
                    value: rupees(billed),
                    caption: hasVouchers
                        ? '${vouchers.where((v) => v.isSales).length} sales invoice(s)'
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
                        ? '${vouchers.where((v) => !v.isSales).length} payment(s) & note(s)'
                        : '${payments.length} receipt(s)',
                    icon: Icons.payments_rounded,
                    gradient: AppGradients.success,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: MetricCard(
                    title: 'Current outstanding',
                    value: rupees(outstanding),
                    caption: outstanding <= 0 ? 'Account settled' : 'Net balance payable',
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

            // ── Live Vouchers / Ledger Table ──────────────────────────────
            WhitePanel(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SectionHeading(
                    title: hasVouchers ? 'Day Book Vouchers' : 'Invoice Ledger',
                    subtitle: hasVouchers
                        ? '${filteredVouchers.length} vouchers recorded'
                        : '${orders.length} order invoice(s)',
                    trailing: hasVouchers
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
                                  DropdownMenuItem(value: 'Sales', child: Text('Sales')),
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
                  const SizedBox(height: 10),
                  if (_loadingVouchers)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 24),
                      child: Center(child: CircularProgressIndicator()),
                    )
                  else if (hasVouchers)
                    filteredVouchers.isEmpty
                        ? const EmptyState(
                            icon: Icons.filter_list_off_rounded,
                            title: 'No vouchers match filter',
                            subtitle: 'Try switching the filter to All.',
                          )
                        : ListView.separated(
                            shrinkWrap: true,
                            physics: const NeverScrollableScrollPhysics(),
                            itemCount: filteredVouchers.length,
                            separatorBuilder: (_, _) => const Divider(height: 1),
                            itemBuilder: (context, i) {
                              final v = filteredVouchers[i];
                              return _VoucherListTile(voucher: v);
                            },
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
                    value: openingBalance < 0
                        ? '${rupees(openingBalance.abs())} Cr'
                        : rupees(openingBalance),
                    valueColor: openingBalance < 0 ? AppColors.teal : AppColors.ink,
                  ),
                  InfoRow(
                    label: 'Total billed sales',
                    value: rupees(billed),
                  ),
                  InfoRow(
                    label: 'Total credits / receipts',
                    value: rupees(collected),
                    valueColor: AppColors.green,
                  ),
                  InfoRow(
                    label: 'Current outstanding',
                    value: rupees(outstanding),
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
                ],
              ),
            ),
            const SizedBox(height: 14),

            // ── Share on WhatsApp ─────────────────────────────────────────
            WhatsAppButton(
              label: 'Share ledger statement on WhatsApp',
              phone: customer.mobile,
              message: statementText,
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
      '*Opening Balance:* ${openingBalance < 0 ? '${rupees(openingBalance.abs())} Cr' : rupees(openingBalance)}',
    );
    buffer.writeln('*Total Billed Sales:* ${rupees(totalSales)}');
    buffer.writeln('*Total Credits / Receipts:* ${rupees(totalCredits)}');
    buffer.writeln('*Current Outstanding:* ${rupees(outstanding)}');
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
  const _VoucherListTile({required this.voucher});
  final VoucherItem voucher;

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
            ],
          ),
        ],
      ),
    );
  }
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
