import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../data/mock_repository.dart';
import '../../data/models.dart';
import '../../core/formatters.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';

/// Full account ledger for one customer: every invoice with paid / balance,
/// every receipt recorded, running totals and a shareable summary.
class CustomerLedgerScreen extends StatelessWidget {
  const CustomerLedgerScreen({super.key, required this.customerId});
  final String customerId;

  @override
  Widget build(BuildContext context) {
    final repo = context.watch<MockRepository>();
    final customer = repo.customerById(customerId);

    if (customer == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Customer Ledger')),
        body: const EmptyState(
          icon: Icons.person_off_rounded,
          title: 'Customer not found',
          subtitle:
              'Demo customers only live while this app session is open on this device.',
        ),
      );
    }

    final now = DateTime.now();
    final orders = repo.ordersFor(customer.id);
    final payments = repo.paymentsFor(customer.id);
    final billed = orders.fold(0.0, (sum, order) => sum + order.total);
    final collected = payments.fold(
      0.0,
      (sum, payment) => sum + payment.amount,
    );
    final outstanding = repo.customerOutstanding(customer.id);
    final overdue = repo.customerOverdue(customer.id);
    final advance = repo.customerAdvance(customer.id);
    final ledgerText = _ledgerMessage(
      customer,
      repo,
      orders,
      payments,
      billed,
      collected,
      outstanding,
      overdue,
      advance,
    );

    return Scaffold(
      appBar: AppBar(title: const Text('Customer Ledger')),
      body: ListView(
        padding: AppSpacing.page,
        children: [
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
                              fontSize: 17,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            '${customer.city} • ${repo.salespersonName(customer.salespersonId)}',
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
                      child: _HeroStat('Outstanding', rupeesShort(outstanding)),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: _HeroStat(
                        'Overdue',
                        overdue > 0 ? rupeesShort(overdue) : 'None',
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: _HeroStat(
                        'Last payment',
                        customer.lastPaymentDate == null
                            ? '—'
                            : dayMonthLabel(customer.lastPaymentDate!),
                      ),
                    ),
                  ],
                ),
                Text(
                  '${orders.length} invoice(s) • ${payments.length} receipt(s) • '
                  '${customer.contactPerson.isEmpty ? customer.type : '${customer.contactPerson} • ${customer.type}'}',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: Colors.white70, fontSize: 10.5),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: MetricCard(
                  title: 'Total billed',
                  value: rupeesShort(billed),
                  caption: '${orders.length} order invoice(s)',
                  icon: Icons.receipt_rounded,
                  gradient: AppGradients.order,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: MetricCard(
                  title: 'Collected',
                  value: rupeesShort(collected),
                  caption: '${payments.length} receipt(s) recorded',
                  icon: Icons.payments_rounded,
                  gradient: AppGradients.success,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: MetricCard(
                  title: 'Balance due',
                  value: rupeesShort(outstanding),
                  caption: overdue > 0
                      ? '${rupeesShort(overdue)} overdue • ${repo.overdueDaysFor(customer.id)} day(s)'
                      : 'Within credit terms',
                  icon: Icons.account_balance_wallet_rounded,
                  gradient: AppGradients.payment,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: MetricCard(
                  title: 'Advance credit',
                  value: advance > 0 ? rupeesShort(advance) : 'None',
                  caption: advance > 0
                      ? 'Available against the next order'
                      : 'No over-payment on this account',
                  icon: Icons.savings_rounded,
                  gradient: advance > 0
                      ? AppGradients.customer
                      : AppGradients.employee,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          WhitePanel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SectionHeading(
                  title: 'Invoice ledger',
                  subtitle:
                      'Swipe sideways for every column • tap a row for the order detail',
                ),
                const SizedBox(height: 10),
                if (orders.isEmpty)
                  const EmptyState(
                    icon: Icons.receipt_long_rounded,
                    title: 'No invoices yet',
                    subtitle: 'This customer has no orders in the demo data.',
                  )
                else
                  SingleChildScrollView(
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
                        const Divider(height: 14),
                        for (final order in orders)
                          _LedgerRow(
                            cells: _orderCells(order, repo),
                            tone: _orderTone(order, repo, now),
                            onTap: () => Navigator.of(context).pushNamed(
                              '/order',
                              arguments: <String, String>{'orderId': order.id},
                            ),
                          ),
                      ],
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
                SectionHeading(
                  title: 'Payments history',
                  subtitle: payments.isEmpty
                      ? null
                      : '${payments.length} receipt(s) recorded',
                ),
                const SizedBox(height: 6),
                if (payments.isEmpty)
                  EmptyState(
                    icon: Icons.hourglass_empty_rounded,
                    title: 'No payments recorded',
                    subtitle:
                        'Record a receipt from the payments screen to build this history.',
                    action: SizedBox(
                      width: double.infinity,
                      child: ActionPill(
                        icon: Icons.add_card_rounded,
                        label: 'Record a payment',
                        onTap: () =>
                            Navigator.of(context).pushNamed('/record-payment'),
                      ),
                    ),
                  )
                else
                  for (final payment in payments) _PaymentRow(payment: payment),
              ],
            ),
          ),
          const SizedBox(height: 14),
          WhitePanel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SectionHeading(title: 'Running totals'),
                const SizedBox(height: 6),
                InfoRow(
                  label: 'Billed across all invoices',
                  value: rupees(billed),
                ),
                InfoRow(
                  label: 'Collected across all receipts',
                  value: rupees(collected),
                  valueColor: AppColors.green,
                ),
                InfoRow(
                  label: 'Balance due',
                  value: rupees(outstanding),
                  valueColor: outstanding > 0 ? AppColors.red : AppColors.green,
                ),
                if (overdue > 0)
                  InfoRow(
                    label: 'Overdue portion',
                    value:
                        '${rupees(overdue)} • ${repo.overdueDaysFor(customer.id)} day(s) past due',
                    valueColor: AppColors.red,
                  ),
                if (advance > 0)
                  InfoRow(
                    label: 'Advance credit on account',
                    value: rupees(advance),
                    valueColor: AppColors.teal,
                  ),
                InfoRow(
                  label: 'Mobile on record',
                  value: customer.mobile.isEmpty
                      ? 'Not captured'
                      : customer.mobile,
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          WhatsAppButton(
            label: 'Share ledger summary on WhatsApp',
            phone: customer.mobile,
            message: ledgerText,
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
    );
  }

  List<String> _orderCells(SalesOrder order, MockRepository repo) {
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

  _CellTone _orderTone(SalesOrder order, MockRepository repo, DateTime now) {
    final balance = repo.orderBalance(order.id);
    if (balance < -0.0001) return _CellTone.advance;
    if (balance > 0.0001 && order.dueDate.isBefore(now)) {
      return _CellTone.overdue;
    }
    return _CellTone.normal;
  }

  String _ledgerMessage(
    Customer customer,
    MockRepository repo,
    List<SalesOrder> orders,
    List<Payment> payments,
    double billed,
    double collected,
    double outstanding,
    double overdue,
    double advance,
  ) {
    final buffer = StringBuffer();
    buffer.writeln('Dura Smart — account ledger');
    buffer.writeln('Customer: ${customer.name} (${customer.city})');
    buffer.writeln(
      'Salesperson: ${repo.salespersonName(customer.salespersonId)}',
    );
    buffer.writeln('Total billed: ${rupees(billed)}');
    buffer.writeln('Total collected: ${rupees(collected)}');
    buffer.writeln('Balance due: ${rupees(outstanding)}');
    if (overdue > 0) {
      buffer.writeln(
        'Overdue: ${rupees(overdue)} (${repo.overdueDaysFor(customer.id)} day(s) past the earliest due date)',
      );
    }
    if (advance > 0) buffer.writeln('Advance credit: ${rupees(advance)}');
    buffer.writeln();
    buffer.writeln('Open invoices:');
    final open = orders
        .where((order) => repo.orderBalance(order.id) > 0.0001)
        .toList();
    if (open.isEmpty) buffer.writeln('• None — the account is settled.');
    for (final order in open) {
      buffer.writeln(
        '• ${order.number} dated ${dateLabel(order.orderDate)} — balance ${rupees(repo.orderBalance(order.id))}, '
        'due ${dateLabel(order.dueDate)}',
      );
    }
    if (payments.isNotEmpty) {
      buffer.writeln();
      buffer.writeln('Latest receipts:');
      for (final payment in payments.take(5)) {
        buffer.writeln(
          '• ${dateLabel(payment.date)} ${payment.invoiceNumber} — ${rupees(payment.amount)} '
          '(${paymentMethodLabel(payment.method)})',
        );
      }
    }
    buffer.write(
      '\nDemo data — please confirm with our accounts team before reconciling.',
    );
    return buffer.toString();
  }
}

enum _CellTone { normal, overdue, advance }

class _LedgerRow extends StatelessWidget {
  const _LedgerRow({
    required this.cells,
    this.strong = false,
    this.tone = _CellTone.normal,
    this.onTap,
  });
  final List<String> cells;
  final bool strong;
  final _CellTone tone;
  final VoidCallback? onTap;

  static const List<double> _widths = <double>[92, 92, 110, 100, 106, 92, 96];

  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    child: Padding(
      padding: const EdgeInsets.symmetric(vertical: 9, horizontal: 2),
      child: Row(
        children: [
          for (var i = 0; i < cells.length && i < _widths.length; i++)
            SizedBox(
              width: _widths[i],
              child: Text(
                cells[i],
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: strong ? 11 : 12,
                  fontWeight: strong || i == 0 || i == 4
                      ? FontWeight.w900
                      : FontWeight.w600,
                  color: _colorFor(i),
                ),
              ),
            ),
        ],
      ),
    ),
  );

  Color _colorFor(int index) {
    if (strong) return AppColors.muted;
    final isMoneyCell = index == 4 || index == 6;
    if (tone == _CellTone.overdue && isMoneyCell) return AppColors.red;
    if (tone == _CellTone.advance && isMoneyCell) return AppColors.teal;
    return AppColors.ink;
  }
}

class _HeroStat extends StatelessWidget {
  const _HeroStat(this.label, this.value);
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
    decoration: BoxDecoration(
      color: Colors.white24,
      borderRadius: BorderRadius.circular(12),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            color: Colors.white70,
            fontSize: 9.5,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          value,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.w900,
            fontSize: 13,
          ),
        ),
      ],
    ),
  );
}

class _PaymentRow extends StatelessWidget {
  const _PaymentRow({required this.payment});
  final Payment payment;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 9),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 36,
          height: 36,
          decoration: BoxDecoration(
            gradient: AppGradients.success,
            borderRadius: BorderRadius.circular(11),
          ),
          child: const Icon(Icons.check_rounded, color: Colors.white, size: 18),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '${dateLabel(payment.date)} • ${payment.invoiceNumber}',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontWeight: FontWeight.w800,
                  fontSize: 12.5,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                '${paymentMethodLabel(payment.method)}'
                '${payment.reference.isEmpty ? '' : ' • ${payment.reference}'}'
                '${payment.notes.isEmpty ? '' : ' • ${payment.notes}'}',
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: AppText.caption,
              ),
            ],
          ),
        ),
        const SizedBox(width: 8),
        Text(
          rupees(payment.amount),
          style: const TextStyle(
            fontWeight: FontWeight.w900,
            fontSize: 13,
            color: AppColors.green,
          ),
        ),
      ],
    ),
  );
}
