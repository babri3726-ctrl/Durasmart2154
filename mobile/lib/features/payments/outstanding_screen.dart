import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../data/mock_repository.dart';
import '../../data/models.dart';
import '../../core/formatters.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';

/// The collection list: every customer with an open balance, sortable by overdue,
/// balance or name, with a one-tap WhatsApp reminder built from live records.
class OutstandingScreen extends StatefulWidget {
  const OutstandingScreen({super.key});

  @override
  State<OutstandingScreen> createState() => _OutstandingScreenState();
}

class _OutstandingScreenState extends State<OutstandingScreen> {
  static const _modes = <String>['All outstanding', 'Overdue only'];
  static const _sorts = <String>[
    'Overdue first',
    'Highest balance',
    'Customer name',
  ];

  String _mode = _modes.first;
  String _sort = _sorts.first;

  List<_OutstandingRow> _rows(MockRepository repo) {
    final now = DateTime.now();
    final rows = <_OutstandingRow>[];
    for (final customer in repo.customers) {
      final outstanding = repo.customerOutstanding(customer.id);
      if (outstanding <= 0.0001) continue;
      final openOrders =
          repo
              .ordersFor(customer.id)
              .where((order) => repo.orderBalance(order.id) > 0.0001)
              .toList()
            ..sort((a, b) => a.dueDate.compareTo(b.dueDate));
      final overdue = repo.customerOverdue(customer.id);
      rows.add(
        _OutstandingRow(
          customer: customer,
          outstanding: outstanding,
          overdue: overdue,
          overdueDays: repo.overdueDaysFor(customer.id),
          salespersonName: repo.salespersonName(customer.salespersonId),
          nextDueDate: openOrders.isEmpty ? null : openOrders.first.dueDate,
          openOrderCount: openOrders.length,
          advance: repo.customerAdvance(customer.id),
          openOrders: openOrders,
          now: now,
        ),
      );
    }

    final visible = _mode == _modes[1]
        ? rows.where((row) => row.overdue > 0).toList()
        : rows;
    switch (_sort) {
      case 'Highest balance':
        visible.sort((a, b) => b.outstanding.compareTo(a.outstanding));
      case 'Customer name':
        visible.sort(
          (a, b) => a.customer.name.toLowerCase().compareTo(
            b.customer.name.toLowerCase(),
          ),
        );
      default:
        visible.sort((a, b) {
          final byOverdue = b.overdue.compareTo(a.overdue);
          if (byOverdue != 0) return byOverdue;
          final byDays = b.overdueDays.compareTo(a.overdueDays);
          if (byDays != 0) return byDays;
          return b.outstanding.compareTo(a.outstanding);
        });
    }
    return visible;
  }

  @override
  Widget build(BuildContext context) {
    final repo = context.watch<MockRepository>();
    final rows = _rows(repo);
    final totalOutstanding = rows.fold(
      0.0,
      (sum, row) => sum + row.outstanding,
    );
    final totalOverdue = rows.fold(0.0, (sum, row) => sum + row.overdue);
    final overdueCount = rows.where((row) => row.overdue > 0).length;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Outstanding & Overdue'),
        actions: [
          IconButton(
            tooltip: 'Record a payment',
            onPressed: () => Navigator.of(context).pushNamed('/record-payment'),
            icon: const Icon(Icons.add_card_rounded),
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const DemoNotice(
                  text:
                      'Demo collection list, calculated from the demo invoices and receipts on this device. '
                      'Reminder messages are only drafted — nothing is sent automatically.',
                ),
                const SizedBox(height: 12),
                FilterChipsRow(
                  options: _modes,
                  selected: _mode,
                  onSelected: (value) => setState(() => _mode = value),
                ),
                const SizedBox(height: 4),
                FilterChipsRow(
                  options: _sorts,
                  selected: _sort,
                  onSelected: (value) => setState(() => _sort = value),
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: MetricCard(
                        title: 'Customers to follow up',
                        value: '${rows.length}',
                        caption:
                            '$overdueCount overdue • ${repo.customers.length} customers on record',
                        icon: Icons.groups_rounded,
                        gradient: AppGradients.customer,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: MetricCard(
                        title: 'Total outstanding',
                        value: rupeesShort(totalOutstanding),
                        caption: 'Overdue share ${rupeesShort(totalOverdue)}',
                        icon: Icons.account_balance_wallet_rounded,
                        gradient: AppGradients.payment,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 6),
          Expanded(
            child: rows.isEmpty
                ? EmptyState(
                    icon: Icons.verified_rounded,
                    title: _mode == _modes[1]
                        ? 'No overdue balances'
                        : 'Everything is settled',
                    subtitle: _mode == _modes[1]
                        ? 'Customers in this demo still have balances, but none are past their due date.'
                        : 'No customer has an open balance in the demo data.',
                    action: SizedBox(
                      width: double.infinity,
                      child: ActionPill(
                        icon: Icons.account_balance_rounded,
                        label: 'Back to payments',
                        onTap: () =>
                            Navigator.of(context).pushNamed('/payments'),
                      ),
                    ),
                  )
                : ListView.separated(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                    itemCount: rows.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 12),
                    itemBuilder: (context, index) => _OutstandingCard(
                      row: rows[index],
                      repo: repo,
                      onOpen: () => Navigator.of(context).pushNamed(
                        '/customer',
                        arguments: <String, String>{
                          'customerId': rows[index].customer.id,
                        },
                      ),
                      onLedger: () => Navigator.of(context).pushNamed(
                        '/ledger',
                        arguments: <String, String>{
                          'customerId': rows[index].customer.id,
                        },
                      ),
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}

class _OutstandingRow {
  const _OutstandingRow({
    required this.customer,
    required this.outstanding,
    required this.overdue,
    required this.overdueDays,
    required this.salespersonName,
    required this.nextDueDate,
    required this.openOrderCount,
    required this.advance,
    required this.openOrders,
    required this.now,
  });
  final Customer customer;
  final double outstanding;
  final double overdue;
  final int overdueDays;
  final String salespersonName;
  final DateTime? nextDueDate;
  final int openOrderCount;
  final double advance;
  final List<SalesOrder> openOrders;
  final DateTime now;
}

class _OutstandingCard extends StatelessWidget {
  const _OutstandingCard({
    required this.row,
    required this.repo,
    required this.onOpen,
    required this.onLedger,
  });
  final _OutstandingRow row;
  final MockRepository repo;
  final VoidCallback onOpen;
  final VoidCallback onLedger;

  @override
  Widget build(BuildContext context) {
    final reminderText = _buildReminder(row, repo);
    return WhitePanel(
      onTap: onOpen,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              AvatarCircle(
                name: row.customer.name,
                size: 42,
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
                      style: AppText.heading,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${row.customer.city} • ${row.salespersonName}',
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
                      fontSize: 15,
                      color: AppColors.ink,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    alignment: WrapAlignment.end,
                    children: [
                      if (row.overdue > 0)
                        StatusChip(
                          label: '${rupeesShort(row.overdue)} overdue',
                          color: AppColors.red,
                        ),
                      if (row.overdueDays > 0)
                        StatusChip(
                          label: '${row.overdueDays}d late',
                          color: AppColors.orange,
                        ),
                      if (row.overdue <= 0)
                        const StatusChip(
                          label: 'Within terms',
                          color: AppColors.green,
                        ),
                    ],
                  ),
                ],
              ),
            ],
          ),
          const Divider(height: 20),
          InfoRow(label: 'Open invoices', value: '${row.openOrderCount}'),
          InfoRow(
            label: 'Next due date',
            value: row.nextDueDate == null
                ? 'None'
                : '${dateLabel(row.nextDueDate!)}'
                      '${row.nextDueDate!.isBefore(row.now) ? ' • overdue' : ''}',
            valueColor:
                row.nextDueDate != null && row.nextDueDate!.isBefore(row.now)
                ? AppColors.red
                : AppColors.ink,
          ),
          if (row.advance > 0)
            InfoRow(
              label: 'Advance credit',
              value: rupees(row.advance),
              valueColor: AppColors.teal,
            ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: WhatsAppButton(
                  label: row.customer.mobile.isEmpty
                      ? 'Add mobile to remind'
                      : 'Send reminder',
                  phone: row.customer.mobile,
                  message: reminderText,
                  outlined: true,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: ActionPill(
                  icon: Icons.receipt_long_rounded,
                  label: 'Ledger',
                  onTap: onLedger,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

String _buildReminder(_OutstandingRow row, MockRepository repo) {
  final buffer = StringBuffer();
  buffer.writeln(
    'Hello ${row.customer.contactPerson.isEmpty ? row.customer.name : row.customer.contactPerson},',
  );
  buffer.writeln();
  buffer.writeln(
    'Payment reminder from Dura Smart for ${row.customer.name} (${row.customer.city}):',
  );
  buffer.writeln('Total outstanding: ${rupees(row.outstanding)}');
  if (row.overdue > 0) {
    buffer.writeln(
      'Overdue amount: ${rupees(row.overdue)} — ${row.overdueDays} day(s) past the earliest due date',
    );
  } else {
    buffer.writeln(
      'Nothing overdue as of today — the balance is within the agreed credit period.',
    );
  }
  buffer.writeln('Open invoices (${row.openOrderCount}):');
  for (final order in row.openOrders) {
    final pastDue =
        order.dueDate.isBefore(row.now) && repo.orderBalance(order.id) > 0;
    buffer.writeln(
      '• ${order.number} dated ${dateLabel(order.orderDate)} — balance ${rupees(repo.orderBalance(order.id))}, '
      'due ${dateLabel(order.dueDate)}${pastDue ? ' (overdue)' : ''}',
    );
  }
  if (row.advance > 0) {
    buffer.writeln('Advance credit on your account: ${rupees(row.advance)}');
  }
  buffer.write(
    '\nPlease arrange the payment at your convenience. Call our team for any clarification.',
  );
  return buffer.toString();
}
