import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/formatters.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import '../../data/mock_repository.dart';
import '../../data/models.dart';
import 'order_form_screen.dart';

class OrderDetailScreen extends StatelessWidget {
  const OrderDetailScreen({super.key, required this.orderId});
  final String orderId;

  @override
  Widget build(BuildContext context) {
    final repo = context.watch<MockRepository>();
    final order = repo.orderById(orderId);

    if (order == null) {
      return Scaffold(
        backgroundColor: AppColors.background,
        appBar: AppBar(title: const Text('Order')),
        body: const Center(
          child: EmptyState(
            icon: Icons.receipt_long_rounded,
            title: 'Order not found',
            subtitle: 'This order record is no longer available.',
          ),
        ),
      );
    }

    final customer = repo.customerById(order.customerId);
    final paid = repo.orderPaid(orderId);
    final balance = repo.orderBalance(orderId);
    final dispatchedQty = repo.orderDispatchedQty(orderId);
    final pendingQty = repo.orderPendingDispatchQty(orderId);
    final dispatches = repo.dispatchesFor(orderId);
    final summary = _orderSummary(repo, order);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text(order.number),
        actions: [
          IconButton(
            icon: const Icon(Icons.edit_outlined),
            tooltip: 'Edit order',
            onPressed: () {
              Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (_) => OrderFormScreen(existingOrder: order),
                ),
              );
            },
          ),
          IconButton(
            icon: const Icon(Icons.delete_outline, color: AppColors.red),
            tooltip: 'Delete order',
            onPressed: () async {
              final confirmed = await ConfirmDialog.show(
                context,
                title: 'Delete order',
                message:
                    'Are you sure you want to permanently delete order ${order.number}?',
                confirmLabel: 'Delete order',
                danger: true,
              );
              if (confirmed && context.mounted) {
                repo.deleteOrder(order.id);
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(content: Text('Order ${order.number} deleted')),
                );
                Navigator.pop(context);
              }
            },
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          GradientHero(
            gradient: AppGradients.order,
            height: 128,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  order.number,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 24,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  dateLabel(order.orderDate),
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
                      label: orderStatusLabel(order.status),
                      color: Colors.white38,
                    ),
                    StatusChip(
                      label: rupees(order.total),
                      color: Colors.white38,
                    ),
                    StatusChip(
                      label: qtyLabel(order.totalQty, order.unit),
                      color: Colors.white38,
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          if (customer != null)
            WhitePanel(
              onTap: () => Navigator.pushNamed(
                context,
                '/customer',
                arguments: {'customerId': customer.id},
              ),
              child: Row(
                children: [
                  AvatarCircle(
                    name: customer.name,
                    size: 42,
                    gradient: AppGradients.customer,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          customer.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: AppText.heading,
                        ),
                        Text(
                          '${customer.city} • ${repo.salespersonName(order.salespersonId)}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: AppText.caption,
                        ),
                      ],
                    ),
                  ),
                  const Icon(
                    Icons.chevron_right_rounded,
                    color: AppColors.muted,
                  ),
                ],
              ),
            ),
          const SizedBox(height: 14),
          const SectionHeading(title: 'Order Items'),
          const SizedBox(height: 8),
          _itemsTable(order),
          const SizedBox(height: 14),
          WhitePanel(
            child: Column(
              children: [
                InfoRow(label: 'Payment Terms', value: order.paymentTerms),
                InfoRow(label: 'Order Date', value: dateLabel(order.orderDate)),
                InfoRow(label: 'Due Date', value: dateLabel(order.dueDate)),
                InfoRow(
                  label: 'Expected Dispatch',
                  value: order.expectedDispatchDate == null
                      ? '—'
                      : dateLabel(order.expectedDispatchDate!),
                ),
                if (order.notes.isNotEmpty)
                  InfoRow(label: 'Notes', value: order.notes),
                const Divider(height: 24),
                Row(
                  children: [
                    const Expanded(
                      child: Text('Grand Total', style: AppText.title),
                    ),
                    Text(
                      rupees(order.total),
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w900,
                        color: AppColors.purple,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          WhitePanel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Dispatch Progress', style: AppText.heading),
                const SizedBox(height: 10),
                ProgressRow(
                  label: 'Dispatched',
                  value: dispatchedQty,
                  max: order.totalQty,
                  color: AppColors.teal,
                ),
                const SizedBox(height: 8),
                Text(
                  '${qtyLabel(dispatchedQty, order.unit)} dispatched • ${qtyLabel(pendingQty, order.unit)} pending',
                  style: AppText.caption,
                ),
                if (dispatchedQty > 0 && pendingQty > 0) ...[
                  const SizedBox(height: 8),
                  const StatusChip(
                    label: 'Partially dispatched',
                    color: AppColors.purple,
                  ),
                ],
              ],
            ),
          ),
          if (repo.currentUser?.isOwner == true ||
              repo.currentUser?.isDispatch == true) ...[
            const SizedBox(height: 14),
            WhitePanel(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Dispatch & Order Authority',
                    style: AppText.heading,
                  ),
                  const SizedBox(height: 4),
                  const Text(
                    'Authority to mark dispatched (tick), set pending, or cancel orders.',
                    style: AppText.caption,
                  ),
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      if (order.status != OrderStatus.dispatched)
                        ElevatedButton.icon(
                          style: ElevatedButton.styleFrom(
                            backgroundColor: AppColors.green,
                            foregroundColor: Colors.white,
                          ),
                          onPressed: () {
                            repo.quickDispatchOrder(order.id);
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                content: Text(
                                  'Order marked as Fully Dispatched (Tick)',
                                ),
                              ),
                            );
                          },
                          icon: const Icon(Icons.check_circle_outline, size: 16),
                          label: const Text('✓ Mark Dispatched (Tick)'),
                        ),
                      if (order.status == OrderStatus.pending)
                        ElevatedButton.icon(
                          style: ElevatedButton.styleFrom(
                            backgroundColor: AppColors.blue,
                            foregroundColor: Colors.white,
                          ),
                          onPressed: () {
                            repo.setOrderStatus(
                              order.id,
                              OrderStatus.confirmed,
                            );
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(content: Text('Order confirmed')),
                            );
                          },
                          icon: const Icon(Icons.check, size: 16),
                          label: const Text('Confirm Order'),
                        ),
                      if (order.status == OrderStatus.confirmed ||
                          order.status == OrderStatus.dispatched)
                        OutlinedButton.icon(
                          onPressed: () {
                            repo.setOrderStatus(
                              order.id,
                              OrderStatus.pending,
                            );
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                content: Text(
                                  'Order status set back to Pending',
                                ),
                              ),
                            );
                          },
                          icon: const Icon(
                            Icons.history_toggle_off,
                            size: 16,
                          ),
                          label: const Text('Set Pending'),
                        ),
                      OutlinedButton.icon(
                        style: OutlinedButton.styleFrom(
                          foregroundColor: AppColors.red,
                        ),
                        onPressed: () async {
                          final confirmed = await ConfirmDialog.show(
                            context,
                            title: 'Cancel order',
                            message:
                                'Are you sure you want to cancel order ${order.number}?',
                            confirmLabel: 'Cancel order',
                            danger: true,
                          );
                          if (confirmed && context.mounted) {
                            repo.deleteOrder(order.id);
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(
                                content: Text(
                                  'Order ${order.number} cancelled',
                                ),
                              ),
                            );
                            Navigator.pop(context);
                          }
                        },
                        icon: const Icon(Icons.cancel_outlined, size: 16),
                        label: const Text('Cancel Order'),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
          const SizedBox(height: 14),
          const SectionHeading(title: 'Payments'),
          const SizedBox(height: 8),
          WhitePanel(
            child: Column(
              children: [
                InfoRow(
                  label: 'Paid',
                  value: rupees(paid),
                  valueColor: AppColors.green,
                ),
                InfoRow(
                  label: 'Balance',
                  value: rupees(balance),
                  valueColor: balance > 0 ? AppColors.red : AppColors.green,
                ),
                const SizedBox(height: 10),
                SizedBox(
                  width: double.infinity,
                  child: GradientButton(
                    label: 'Record Payment',
                    height: 44,
                    icon: Icons.payments_rounded,
                    gradient: AppGradients.payment,
                    onPressed: () =>
                        Navigator.pushNamed(context, '/record-payment'),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          SectionHeading(
            title: 'Dispatches',
            subtitle: '${dispatches.length} shipment(s)',
          ),
          const SizedBox(height: 8),
          if (dispatches.isEmpty)
            const EmptyState(
              icon: Icons.local_shipping_rounded,
              title: 'No dispatches',
              subtitle: 'This order has not been dispatched yet.',
            )
          else
            WhitePanel(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Column(
                children: [
                  for (final d in dispatches)
                    ListTile(
                      dense: true,
                      leading: const Icon(
                        Icons.local_shipping_rounded,
                        color: AppColors.purple,
                      ),
                      title: Text(
                        d.vehicle.isEmpty ? 'Vehicle pending' : d.vehicle,
                        style: AppText.body,
                      ),
                      subtitle: Text(
                        '${dateLabel(d.dispatchDate)} • ${qtyLabel(d.totalQuantity, order.unit)}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                ],
              ),
            ),
          if (order.orderPhotos.isNotEmpty) ...[
            const SizedBox(height: 14),
            const SectionHeading(title: 'Order Photos'),
            const SizedBox(height: 8),
            WhitePanel(child: PhotoStrip(photos: order.orderPhotos, size: 110)),
          ],
          const SizedBox(height: 16),
          WhatsAppButton(
            label: 'Share Order Summary',
            phone: customer?.mobile ?? '',
            message: summary,
          ),
          if (order.orderPhotos.isNotEmpty) ...[
            const SizedBox(height: 10),
            WhatsAppButton(
              label: 'Share Photos + Summary',
              phone: customer?.mobile ?? '',
              message: summary,
              photos: order.orderPhotos,
            ),
          ],
          const SizedBox(height: 12),
        ],
      ),
    );
  }

  Widget _itemsTable(SalesOrder order) => SingleChildScrollView(
    scrollDirection: Axis.horizontal,
    child: DataTable(
      headingRowHeight: 38,
      dataRowMinHeight: 36,
      dataRowMaxHeight: 46,
      headingTextStyle: const TextStyle(
        fontWeight: FontWeight.w900,
        color: AppColors.ink,
      ),
      dataTextStyle: const TextStyle(fontSize: 12, color: AppColors.ink),
      columns: const [
        DataColumn(label: Text('Product')),
        DataColumn(label: Text('Qty'), numeric: true),
        DataColumn(label: Text('Rate'), numeric: true),
        DataColumn(label: Text('Line Total'), numeric: true),
      ],
      rows: [
        for (final i in order.items)
          DataRow(
            cells: [
              DataCell(Text(i.product)),
              DataCell(Text(i.quantityLabel)),
              DataCell(Text(rupees(i.rate))),
              DataCell(Text(rupees(i.lineTotal))),
            ],
          ),
        DataRow(
          cells: [
            const DataCell(
              Text('Total', style: TextStyle(fontWeight: FontWeight.w900)),
            ),
            DataCell(
              Text(
                qtyLabel(order.totalQty, order.unit),
                style: const TextStyle(fontWeight: FontWeight.w900),
              ),
            ),
            const DataCell(Text('')),
            DataCell(
              Text(
                rupees(order.total),
                style: const TextStyle(
                  fontWeight: FontWeight.w900,
                  color: AppColors.purple,
                ),
              ),
            ),
          ],
        ),
      ],
    ),
  );

  String _orderSummary(MockRepository repo, SalesOrder order) {
    final customer = repo.customerById(order.customerId);
    final buffer = StringBuffer('Order ${order.number}\n');
    buffer.writeln(
      'Customer: ${customer?.name ?? order.customerId} (${customer?.city ?? '-'})',
    );
    buffer.writeln('Date: ${dateLabel(order.orderDate)}');
    buffer.writeln('Payment terms: ${order.paymentTerms}');
    for (final i in order.items) {
      buffer.writeln(
        '- ${i.product}: ${i.quantityLabel} @ ${rupees(i.rate)} = ${rupees(i.lineTotal)}',
      );
    }
    buffer.writeln('Total quantity: ${qtyLabel(order.totalQty, order.unit)}');
    buffer.write('Order total: ${rupees(order.total)}');
    return buffer.toString();
  }
}
