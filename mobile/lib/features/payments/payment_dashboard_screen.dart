import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../data/mock_repository.dart';
import '../../data/models.dart';
import '../../core/formatters.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';

/// Payment control tower: choose a month, a salesperson and optionally only the
/// overdue book, then read the collected / outstanding position and jump into
/// the payment workflows.
class PaymentDashboardScreen extends StatefulWidget {
  const PaymentDashboardScreen({super.key});

  @override
  State<PaymentDashboardScreen> createState() => _PaymentDashboardScreenState();
}

class _PaymentDashboardScreenState extends State<PaymentDashboardScreen> {
  final _now = DateTime.now();
  late DateTime _month = DateTime(_now.year, _now.month);
  String? _salespersonId;
  bool _overdueOnly = false;

  void _shiftMonth(int delta) =>
      setState(() => _month = DateTime(_month.year, _month.month + delta));

  List<PaymentDashboardRow> _scopeRows(MockRepository repo) {
    final rows = <PaymentDashboardRow>[];
    for (final customer in repo.customers) {
      if (_salespersonId != null && customer.salespersonId != _salespersonId) {
        continue;
      }
      final outstanding = repo.customerOutstanding(customer.id);
      final overdue = repo.customerOverdue(customer.id);
      if (outstanding <= 0 && overdue <= 0) continue;
      rows.add(
        PaymentDashboardRow(
          customer: customer,
          outstanding: outstanding,
          overdue: overdue,
          overdueDays: repo.overdueDaysFor(customer.id),
          salespersonName: repo.salespersonName(customer.salespersonId),
          lastPaymentDate: customer.lastPaymentDate,
        ),
      );
    }
    rows.sort((a, b) => b.outstanding.compareTo(a.outstanding));
    return rows;
  }

  String _summaryText(
    List<PaymentDashboardRow> scopeRows,
    SalesMetrics metrics,
    MockRepository repo,
  ) {
    final totalOutstanding = scopeRows.fold(
      0.0,
      (sum, row) => sum + row.outstanding,
    );
    final totalOverdue = scopeRows.fold(0.0, (sum, row) => sum + row.overdue);
    final scopeName = _salespersonId == null
        ? 'Full team'
        : repo.salespersonName(_salespersonId!);
    final buffer = StringBuffer();
    buffer.writeln('Dura Smart — payment summary');
    buffer.writeln('Scope: $scopeName');
    buffer.writeln('Month: ${monthLabel(_month)}');
    if (_overdueOnly) buffer.writeln('Filter: overdue balances only');
    buffer.writeln('Customers with a balance: ${scopeRows.length}');
    buffer.writeln('Total outstanding: ${rupees(totalOutstanding)}');
    buffer.writeln('Of which overdue: ${rupees(totalOverdue)}');
    buffer.writeln(
      'Collected in ${monthLabel(_month)}: ${rupees(metrics.paymentReceived)}',
    );
    buffer.writeln();
    buffer.writeln('Largest balances:');
    final top = scopeRows.take(6).toList();
    if (top.isEmpty) buffer.writeln('• No customer balance in this scope.');
    for (final row in top) {
      buffer.writeln(
        '• ${row.customer.name} (${row.customer.city}) — ${rupees(row.outstanding)}'
        '${row.overdue > 0 ? ', overdue ${rupees(row.overdue)} for ${row.overdueDays} day(s)' : ''}',
      );
    }
    buffer.write(
      '\nCompiled from demo data on this device — verify before sharing outside the team.',
    );
    return buffer.toString();
  }

  Future<void> _pickCustomer(MockRepository repo) async {
    final navigator = Navigator.of(context);
    final rows = _scopeRows(repo);
    final picked = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
      ),
      builder: (sheetContext) => SizedBox(
        height: MediaQuery.sizeOf(context).height * .7,
        child: Column(
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 18, 20, 6),
              child: Text('Choose a customer ledger', style: AppText.title),
            ),
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 20),
              child: Text(
                'Only customers with a balance in the current scope are listed.',
                style: TextStyle(color: AppColors.muted, fontSize: 12),
              ),
            ),
            const SizedBox(height: 8),
            Expanded(
              child: rows.isEmpty
                  ? const EmptyState(
                      icon: Icons.check_circle_outline_rounded,
                      title: 'No balances in scope',
                      subtitle:
                          'Every customer in this scope is fully paid for the demo data.',
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.fromLTRB(12, 4, 12, 20),
                      itemCount: rows.length,
                      separatorBuilder: (_, _) => const Divider(height: 1),
                      itemBuilder: (context, index) => ListTile(
                        leading: AvatarCircle(
                          name: rows[index].customer.name,
                          size: 38,
                          gradient: AppGradients.customer,
                        ),
                        title: Text(
                          rows[index].customer.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        subtitle: Text(
                          '${rows[index].customer.city} • ${rupees(rows[index].outstanding)} due',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        trailing: const Icon(
                          Icons.chevron_right_rounded,
                          color: AppColors.muted,
                        ),
                        onTap: () => Navigator.of(
                          sheetContext,
                        ).pop(rows[index].customer.id),
                      ),
                    ),
            ),
          ],
        ),
      ),
    );
    if (picked == null || !mounted) return;
    navigator.pushNamed(
      '/ledger',
      arguments: <String, String>{'customerId': picked},
    );
  }

  @override
  Widget build(BuildContext context) {
    final repo = context.watch<MockRepository>();
    final scopeRows = _scopeRows(repo);
    final visibleRows = _overdueOnly
        ? scopeRows.where((row) => row.overdue > 0).toList()
        : scopeRows;
    final metrics = repo.salesMetrics(
      salespersonId: _salespersonId,
      month: _month,
    );
    final totalOutstanding = scopeRows.fold(
      0.0,
      (sum, row) => sum + row.outstanding,
    );
    final totalOverdue = scopeRows.fold(0.0, (sum, row) => sum + row.overdue);
    final scopeName = _salespersonId == null
        ? 'Full team'
        : repo.salespersonName(_salespersonId!);
    final salespeople = <String, String>{
      for (final customer in repo.customers)
        if (customer.salespersonId.isNotEmpty)
          customer.salespersonId: repo.salespersonName(customer.salespersonId),
    };
    final summary = _summaryText(scopeRows, metrics, repo);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Payments'),
        actions: [
          IconButton(
            tooltip: 'Outstanding & overdue',
            onPressed: () => Navigator.of(context).pushNamed('/outstanding'),
            icon: const Icon(Icons.warning_amber_rounded),
          ),
        ],
      ),
      body: ListView(
        padding: AppSpacing.page,
        children: [
          const DemoNotice(
            text:
                'Demo payment dashboard. Every figure below is calculated live from the demo orders, payments '
                'and dispatches on this device — nothing is linked to a bank, ERP or accounting system.',
          ),
          const SizedBox(height: 14),
          WhitePanel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SectionHeading(title: 'Scope'),
                const SizedBox(height: 12),
                Row(
                  children: [
                    IconButton(
                      onPressed: () => _shiftMonth(-1),
                      icon: const Icon(Icons.chevron_left_rounded),
                      tooltip: 'Previous month',
                    ),
                    Expanded(
                      child: Text(
                        monthLabel(_month),
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          fontWeight: FontWeight.w900,
                          fontSize: 15,
                        ),
                      ),
                    ),
                    IconButton(
                      onPressed: () => _shiftMonth(1),
                      icon: const Icon(Icons.chevron_right_rounded),
                      tooltip: 'Next month',
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                DropdownButtonFormField<String>(
                  key: ValueKey<String?>(
                    'payment-dashboard-sp-$_salespersonId',
                  ),
                  initialValue: _salespersonId,
                  isExpanded: true,
                  hint: const Text('Full team'),
                  items: [
                    for (final entry in salespeople.entries)
                      DropdownMenuItem<String>(
                        value: entry.key,
                        child: Text(
                          entry.value,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                  ],
                  onChanged: (id) => setState(() => _salespersonId = id),
                  decoration: const InputDecoration(labelText: 'Salesperson'),
                ),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  value: _overdueOnly,
                  title: const Text('Overdue balances only'),
                  subtitle: const Text(
                    'Hides customers who are still within their credit days.',
                  ),
                  onChanged: (value) => setState(() => _overdueOnly = value),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: MetricCard(
                  title: 'Total outstanding',
                  value: rupeesShort(totalOutstanding),
                  caption: '$scopeName • ${rupees(totalOutstanding)}',
                  icon: Icons.account_balance_wallet_rounded,
                  gradient: AppGradients.payment,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: MetricCard(
                  title: 'Overdue',
                  value: rupeesShort(totalOverdue),
                  caption:
                      '${scopeRows.where((row) => row.overdue > 0).length} customer(s) past due date',
                  icon: Icons.warning_amber_rounded,
                  gradient: AppGradients.danger,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: MetricCard(
                  title: 'Collected • ${monthLabel(_month)}',
                  value: rupeesShort(metrics.paymentReceived),
                  caption: 'Payments booked this month in scope',
                  icon: Icons.payments_rounded,
                  gradient: AppGradients.success,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: MetricCard(
                  title: 'Customers with balance',
                  value: '${visibleRows.length}',
                  caption: _overdueOnly
                      ? 'Overdue only • scope has ${scopeRows.length}'
                      : 'of ${repo.customers.length} customers on record',
                  icon: Icons.groups_rounded,
                  gradient: AppGradients.customer,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          const SectionHeading(title: 'Quick actions'),
          const SizedBox(height: 10),
          _PillColumn(
            onTapRecord: () =>
                Navigator.of(context).pushNamed('/record-payment'),
            onTapOutstanding: () =>
                Navigator.of(context).pushNamed('/outstanding'),
            onTapDebtors: () => Navigator.of(context).pushNamed('/debtors'),
            onTapLedger: () => _pickCustomer(repo),
          ),
          const SizedBox(height: 16),
          WhitePanel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SectionHeading(
                  title: 'Balances in scope',
                  subtitle: _overdueOnly
                      ? 'Overdue customers only • tap for the ledger'
                      : 'Tap a customer for the full ledger',
                ),
                const SizedBox(height: 6),
                if (visibleRows.isEmpty)
                  const EmptyState(
                    icon: Icons.verified_rounded,
                    title: 'Nothing to collect',
                    subtitle:
                        'No customer in this scope has an open balance for the current filters.',
                  )
                else
                  for (final row in visibleRows)
                    _CustomerBalanceRow(
                      row: row,
                      onTap: () => Navigator.of(context).pushNamed(
                        '/ledger',
                        arguments: <String, String>{
                          'customerId': row.customer.id,
                        },
                      ),
                      onTapCustomer: () => Navigator.of(context).pushNamed(
                        '/customer',
                        arguments: <String, String>{
                          'customerId': row.customer.id,
                        },
                      ),
                    ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          WhitePanel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SectionHeading(
                  title: 'Share team summary',
                  subtitle:
                      'Builds a readable text of this scope — you choose the app and the recipient.',
                ),
                const SizedBox(height: 10),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppColors.background,
                    borderRadius: BorderRadius.circular(AppRadius.field),
                    border: Border.all(color: AppColors.line),
                  ),
                  child: SelectableText(
                    summary,
                    style: const TextStyle(fontSize: 11.5, height: 1.45),
                  ),
                ),
                const SizedBox(height: 12),
                WhatsAppButton(
                  label: 'Share payment summary',
                  phone: '',
                  message: summary,
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),
        ],
      ),
    );
  }
}

class PaymentDashboardRow {
  const PaymentDashboardRow({
    required this.customer,
    required this.outstanding,
    required this.overdue,
    required this.overdueDays,
    required this.salespersonName,
    this.lastPaymentDate,
  });
  final Customer customer;
  final double outstanding;
  final double overdue;
  final int overdueDays;
  final String salespersonName;
  final DateTime? lastPaymentDate;
}

class _PillColumn extends StatelessWidget {
  const _PillColumn({
    required this.onTapRecord,
    required this.onTapOutstanding,
    required this.onTapDebtors,
    required this.onTapLedger,
  });
  final VoidCallback onTapRecord;
  final VoidCallback onTapOutstanding;
  final VoidCallback onTapDebtors;
  final VoidCallback onTapLedger;

  @override
  Widget build(BuildContext context) => Column(
    children: [
      SizedBox(
        width: double.infinity,
        child: ActionPill(
          icon: Icons.add_card_rounded,
          label: 'Record payment',
          onTap: onTapRecord,
        ),
      ),
      const SizedBox(height: 10),
      SizedBox(
        width: double.infinity,
        child: ActionPill(
          icon: Icons.warning_amber_rounded,
          label: 'Outstanding & overdue',
          onTap: onTapOutstanding,
        ),
      ),
      const SizedBox(height: 10),
      SizedBox(
        width: double.infinity,
        child: ActionPill(
          icon: Icons.person_search_rounded,
          label: 'Debtor list',
          onTap: onTapDebtors,
        ),
      ),
      const SizedBox(height: 10),
      SizedBox(
        width: double.infinity,
        child: ActionPill(
          icon: Icons.receipt_long_rounded,
          label: 'Customer ledger (pick customer)',
          onTap: onTapLedger,
        ),
      ),
    ],
  );
}

class _CustomerBalanceRow extends StatelessWidget {
  const _CustomerBalanceRow({
    required this.row,
    required this.onTap,
    required this.onTapCustomer,
  });
  final PaymentDashboardRow row;
  final VoidCallback onTap;
  final VoidCallback onTapCustomer;

  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    borderRadius: BorderRadius.circular(12),
    child: Padding(
      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 2),
      child: Row(
        children: [
          AvatarCircle(
            name: row.customer.name,
            size: 38,
            gradient: AppGradients.customer,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  row.customer.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppText.body.copyWith(fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 2),
                Text(
                  '${row.customer.city} • ${row.salespersonName}'
                  '${row.lastPaymentDate == null ? '' : ' • last pay ${dateLabel(row.lastPaymentDate!)}'}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppText.caption,
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                rupees(row.outstanding),
                style: const TextStyle(
                  fontWeight: FontWeight.w900,
                  fontSize: 13,
                ),
              ),
              const SizedBox(height: 3),
              if (row.overdue > 0)
                StatusChip(
                  label: '${row.overdueDays}d overdue',
                  color: AppColors.red,
                )
              else
                const StatusChip(label: 'Within terms', color: AppColors.green),
            ],
          ),
          IconButton(
            tooltip: 'Customer profile',
            onPressed: onTapCustomer,
            icon: const Icon(
              Icons.open_in_new_rounded,
              size: 18,
              color: AppColors.muted,
            ),
          ),
        ],
      ),
    ),
  );
}
