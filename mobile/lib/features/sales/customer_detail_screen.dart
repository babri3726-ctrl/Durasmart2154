import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/formatters.dart';
import '../../core/share_service.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import '../../data/mock_repository.dart';
import '../../data/models.dart';

class CustomerDetailScreen extends StatelessWidget {
  const CustomerDetailScreen({super.key, required this.customerId});
  final String customerId;

  @override
  Widget build(BuildContext context) {
    final repo = context.watch<MockRepository>();
    final customer = repo.customerById(customerId);

    if (customer == null) {
      return Scaffold(
        backgroundColor: AppColors.background,
        appBar: AppBar(title: const Text('Customer')),
        body: const Center(
          child: EmptyState(
            icon: Icons.person_off_rounded,
            title: 'Customer not found',
            subtitle: 'This customer record is no longer available.',
          ),
        ),
      );
    }

    final outstanding = repo.customerOutstanding(customerId);
    final overdue = repo.customerOverdue(customerId);
    final overdueDays = repo.overdueDaysFor(customerId);
    final orders = repo.ordersFor(customerId);
    final payments = repo.paymentsFor(customerId);

    final now = DateTime.now();
    final monthOrders = orders
        .where(
          (o) => o.orderDate.year == now.year && o.orderDate.month == now.month,
        )
        .toList();
    final monthQty = monthOrders.fold<double>(0, (s, o) => s + o.totalQty);
    final monthValue = monthOrders.fold<double>(0, (s, o) => s + o.total);
    final monthMetrics = repo.salesMetrics(
      salespersonId: customer.salespersonId,
      month: now,
    );
    final pendingOrderCount = orders
        .where(
          (o) =>
              o.status == OrderStatus.pending ||
              o.status == OrderStatus.confirmed,
        )
        .length;

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text(customer.name, overflow: TextOverflow.ellipsis),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          GradientHero(
            gradient: AppGradients.customer,
            height: 172,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  customer.name,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 22,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  '${customer.city} • ${customer.type}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white70,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const Spacer(),
                Wrap(
                  spacing: 8,
                  runSpacing: 6,
                  children: [
                    StatusChip(
                      label: customer.status == CustomerStatus.active
                          ? 'Active'
                          : 'Pending Approval',
                      color: customer.status == CustomerStatus.active
                          ? Colors.greenAccent
                          : Colors.amberAccent,
                    ),
                    StatusChip(
                      label: repo.salespersonName(customer.salespersonId),
                      color: Colors.white38,
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          WhitePanel(
            child: Column(
              children: [
                InfoRow(
                  label: 'Contact Person',
                  value: customer.contactPerson.isEmpty
                      ? '—'
                      : customer.contactPerson,
                ),
                InfoRow(
                  label: 'Mobile',
                  value: customer.mobile.isEmpty ? '—' : customer.mobile,
                ),
                InfoRow(
                  label: 'Address',
                  value: customer.address.isEmpty ? '—' : customer.address,
                ),
                InfoRow(
                  label: 'Salesperson',
                  value: repo.salespersonName(customer.salespersonId),
                ),
                InfoRow(
                  label: 'Last Payment',
                  value: customer.lastPaymentDate == null
                      ? 'No payment'
                      : dateLabel(customer.lastPaymentDate!),
                ),
                if (customer.notes.isNotEmpty)
                  InfoRow(label: 'Notes', value: customer.notes),
              ],
            ),
          ),
          const SizedBox(height: 14),
          LayoutBuilder(
            builder: (context, c) => GridView.count(
              crossAxisCount: c.maxWidth >= 560 ? 3 : 2,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              childAspectRatio: 1.3,
              crossAxisSpacing: 12,
              mainAxisSpacing: 12,
              children: [
                MetricCard(
                  title: 'Outstanding',
                  value: rupeesShort(outstanding),
                  caption: rupees(outstanding),
                  icon: Icons.account_balance_wallet_rounded,
                  gradient: AppGradients.danger,
                ),
                MetricCard(
                  title: 'Overdue',
                  value: rupeesShort(overdue),
                  caption: overdue > 0
                      ? '$overdueDays days past due'
                      : 'On track',
                  icon: Icons.warning_amber_rounded,
                  gradient: overdue > 0
                      ? AppGradients.area
                      : AppGradients.success,
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: () => _openWhatsAppSheet(
                context,
                customer: customer,
                repo: repo,
                outstanding: outstanding,
                overdue: overdue,
                overdueDays: overdueDays,
                metrics: monthMetrics,
                pendingOrderCount: pendingOrderCount,
              ),
              style: OutlinedButton.styleFrom(
                backgroundColor: AppColors.whatsapp,
                foregroundColor: Colors.white,
                side: BorderSide.none,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
              ),
              icon: const Icon(Icons.chat_rounded, size: 20),
              label: const Text(
                'WhatsApp Summary',
                style: TextStyle(fontWeight: FontWeight.w900),
              ),
            ),
          ),
          const SizedBox(height: 14),
          WhitePanel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SectionHeading(
                  title: 'This Month Orders',
                  subtitle: null,
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: _monthStat('Orders', '${monthOrders.length}'),
                    ),
                    Expanded(
                      child: _monthStat('Quantity', qtyLabel(monthQty, 'MT')),
                    ),
                    Expanded(
                      child: _monthStat('Value', rupeesShort(monthValue)),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          SectionHeading(
            title: 'Order History',
            subtitle: '${orders.length} orders',
          ),
          const SizedBox(height: 8),
          if (orders.isEmpty)
            const EmptyState(
              icon: Icons.list_alt_rounded,
              title: 'No orders',
              subtitle: 'This customer has not placed any orders yet.',
            )
          else
            WhitePanel(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Column(
                children: [
                  for (final o in orders)
                    ListTile(
                      dense: true,
                      title: Text(o.number, style: AppText.body),
                      subtitle: Text(
                        '${dateLabel(o.orderDate)} • ${qtyLabel(o.totalQty, o.unit)} • ${rupeesShort(o.total)}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      trailing: StatusChip(
                        label: orderStatusLabel(o.status),
                        color: _statusColor(o.status),
                      ),
                      onTap: () => Navigator.pushNamed(
                        context,
                        '/order',
                        arguments: {'orderId': o.id},
                      ),
                    ),
                ],
              ),
            ),
          const SizedBox(height: 16),
          SectionHeading(
            title: 'Payment History',
            subtitle: '${payments.length} payments',
          ),
          const SizedBox(height: 8),
          if (payments.isEmpty)
            const EmptyState(
              icon: Icons.payments_rounded,
              title: 'No payments',
              subtitle: 'No payments recorded for this customer yet.',
            )
          else
            WhitePanel(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Column(
                children: [
                  for (final p in payments)
                    ListTile(
                      dense: true,
                      leading: const Icon(
                        Icons.check_circle_rounded,
                        color: AppColors.green,
                      ),
                      title: Text(rupees(p.amount), style: AppText.body),
                      subtitle: Text(
                        '${dateLabel(p.date)} • ${p.invoiceNumber} • ${paymentMethodLabel(p.method)}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                ],
              ),
            ),
          const SizedBox(height: 12),
        ],
      ),
    );
  }

  Color _statusColor(OrderStatus s) => switch (s) {
    OrderStatus.pending => AppColors.orange,
    OrderStatus.confirmed => AppColors.blue,
    OrderStatus.pendingDispatch => AppColors.purple,
    OrderStatus.dispatched => AppColors.green,
  };

  Widget _monthStat(String label, String value) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(label, style: AppText.caption),
      Text(
        value,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: AppText.heading,
      ),
    ],
  );

  /// Opens a bottom sheet where the user ticks what to include, previews the
  /// message, then opens WhatsApp for manual review (never auto-sends).
  Future<void> _openWhatsAppSheet(
    BuildContext context, {
    required Customer customer,
    required MockRepository repo,
    required double outstanding,
    required double overdue,
    required int overdueDays,
    required SalesMetrics metrics,
    required int pendingOrderCount,
  }) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
      ),
      builder: (sheetContext) => Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.of(sheetContext).viewInsets.bottom,
        ),
        child: _WhatsAppSheet(
          customer: customer,
          repo: repo,
          outstanding: outstanding,
          overdue: overdue,
          overdueDays: overdueDays,
          metrics: metrics,
          pendingOrderCount: pendingOrderCount,
        ),
      ),
    );
  }
}

class _WhatsAppSheet extends StatefulWidget {
  const _WhatsAppSheet({
    required this.customer,
    required this.repo,
    required this.outstanding,
    required this.overdue,
    required this.overdueDays,
    required this.metrics,
    required this.pendingOrderCount,
  });
  final Customer customer;
  final MockRepository repo;
  final double outstanding;
  final double overdue;
  final int overdueDays;
  final SalesMetrics metrics;
  final int pendingOrderCount;

  @override
  State<_WhatsAppSheet> createState() => _WhatsAppSheetState();
}

class _WhatsAppSheetState extends State<_WhatsAppSheet> {
  bool _includeOutstanding = true;
  bool _includeOverdue = true;
  bool _includeLastPayment = true;
  bool _includeTarget = false;
  bool _includePendingOrders = false;

  String _buildMessage() {
    final c = widget.customer;
    final buffer = StringBuffer('Hello ${c.name},\n\n');
    buffer.writeln('Account summary from Dura Smart sales team:');
    if (_includeOutstanding) {
      buffer.writeln('Outstanding balance: ${rupees(widget.outstanding)}');
    }
    if (_includeOverdue) {
      buffer.writeln(
        widget.overdue > 0
            ? 'Overdue amount: ${rupees(widget.overdue)} (${widget.overdueDays} days past due)'
            : 'No overdue amount on record.',
      );
    }
    if (_includeLastPayment) {
      buffer.writeln(
        'Last payment: ${c.lastPaymentDate == null ? 'None' : dateLabel(c.lastPaymentDate!)}',
      );
    }
    if (_includeTarget) {
      buffer.writeln(
        'This month target: ${qtyLabel(widget.metrics.targetQty, 'MT')}, '
        'achieved: ${qtyLabel(widget.metrics.achievedQty, 'MT')}',
      );
    }
    if (_includePendingOrders) {
      buffer.writeln('Orders pending: ${widget.pendingOrderCount}');
    }
    buffer.write('\nPlease reach out to the sales team for any clarification.');
    return buffer.toString();
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(18, 16, 18, 18),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Compose WhatsApp message', style: AppText.title),
            const SizedBox(height: 4),
            const Text(
              'Pick what to include — you review and send in WhatsApp.',
              style: AppText.caption,
            ),
            const SizedBox(height: 8),
            Flexible(
              child: SingleChildScrollView(
                child: Column(
                  children: [
                    _check(
                      'Outstanding balance',
                      _includeOutstanding,
                      (v) => setState(() => _includeOutstanding = v),
                    ),
                    _check(
                      'Overdue amount + days',
                      _includeOverdue,
                      (v) => setState(() => _includeOverdue = v),
                    ),
                    _check(
                      'Last payment date',
                      _includeLastPayment,
                      (v) => setState(() => _includeLastPayment = v),
                    ),
                    _check(
                      'This month target / achievement',
                      _includeTarget,
                      (v) => setState(() => _includeTarget = v),
                    ),
                    _check(
                      'Orders pending count',
                      _includePendingOrders,
                      (v) => setState(() => _includePendingOrders = v),
                    ),
                    const SizedBox(height: 10),
                    WhitePanel(
                      child: Text(
                        _buildMessage(),
                        style: const TextStyle(fontSize: 12, height: 1.5),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.whatsapp,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                ),
                onPressed: () {
                  Navigator.pop(context);
                  shareWhatsAppText(
                    context,
                    phone: widget.customer.mobile,
                    message: _buildMessage(),
                  );
                },
                icon: const Icon(Icons.chat_rounded),
                label: const Text('Open WhatsApp'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _check(String label, bool value, ValueChanged<bool> onChanged) =>
      CheckboxListTile(
        dense: true,
        controlAffinity: ListTileControlAffinity.leading,
        value: value,
        onChanged: (v) => onChanged(v ?? false),
        title: Text(label, style: const TextStyle(fontSize: 13)),
        activeColor: AppColors.purple,
      );
}
