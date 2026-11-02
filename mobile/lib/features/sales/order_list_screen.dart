import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/formatters.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import '../../data/mock_repository.dart';
import '../../data/models.dart';

class OrderListScreen extends StatefulWidget {
  const OrderListScreen({super.key});

  @override
  State<OrderListScreen> createState() => _OrderListScreenState();
}

class _OrderListScreenState extends State<OrderListScreen> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final repo = context.watch<MockRepository>();

    final scopedOrders = repo.ordersForUser(repo.currentUser);

    int countFor(OrderStatus? status) =>
        scopedOrders.where((o) => status == null || o.status == status).length;

    final tabs = <(String, OrderStatus?)>[
      ('All', null),
      ('Pending', OrderStatus.pending),
      ('Confirmed', OrderStatus.confirmed),
      ('Pending for Dispatch', OrderStatus.pendingDispatch),
      ('Dispatched', OrderStatus.dispatched),
    ];

    return DefaultTabController(
      length: tabs.length,
      child: Scaffold(
        backgroundColor: AppColors.background,
        appBar: AppBar(
          title: const Text('Orders'),
          bottom: TabBar(
            isScrollable: true,
            tabAlignment: TabAlignment.start,
            dividerColor: AppColors.line,
            labelColor: AppColors.purple,
            unselectedLabelColor: AppColors.muted,
            indicatorColor: AppColors.purple,
            tabs: [
              for (final t in tabs) Tab(text: '${t.$1} (${countFor(t.$2)})'),
            ],
          ),
        ),
        floatingActionButton: FloatingActionButton.extended(
          backgroundColor: AppColors.orange,
          foregroundColor: Colors.white,
          onPressed: () => Navigator.pushNamed(context, '/new-order'),
          icon: const Icon(Icons.add_rounded),
          label: const Text('New Order'),
        ),
        body: Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
          child: Column(
            children: [
                            if (repo.currentUser?.isSalesperson == true)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                    decoration: BoxDecoration(
                      color: AppColors.purple.withValues(alpha: 0.08),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: AppColors.purple.withValues(alpha: 0.2)),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.person_outline, size: 16, color: AppColors.purple),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            'Your Assigned Orders (${repo.currentUser?.name ?? "Sales Officer"})',
                            style: const TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.bold,
                              color: AppColors.purple,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              SearchField(
                hint: 'Search order number or customer',
                onChanged: (v) => setState(() => _query = v),
              ),
              const SizedBox(height: 8),
              Expanded(
                child: TabBarView(
                  children: [for (final t in tabs) _tabList(repo, t.$2)],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _tabList(MockRepository repo, OrderStatus? status) {
    final scopedOrders = repo.ordersForUser(repo.currentUser);
    final orders = scopedOrders.where((o) {
      final matchesStatus = status == null || o.status == status;
      final customer = repo.customerById(o.customerId);
      final matchesQuery =
          _query.isEmpty ||
          o.number.toLowerCase().contains(_query.toLowerCase()) ||
          (customer?.name.toLowerCase().contains(_query.toLowerCase()) ??
              false);
      return matchesStatus && matchesQuery;
    }).toList()..sort((a, b) => b.orderDate.compareTo(a.orderDate));

    if (orders.isEmpty) {
      return const EmptyState(
        icon: Icons.receipt_long_rounded,
        title: 'No orders',
        subtitle: 'No orders match this view or search.',
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.only(bottom: 96, top: 4),
      itemCount: orders.length,
      itemBuilder: (context, i) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: OrderCard(order: orders[i], repo: repo),
      ),
    );
  }
}

/// Shared order row card used by [OrderListScreen] and any in-file variants.
class OrderCard extends StatelessWidget {
  const OrderCard({super.key, required this.order, required this.repo});
  final SalesOrder order;
  final MockRepository repo;

  Color get _statusColor => switch (order.status) {
    OrderStatus.pending => AppColors.orange,
    OrderStatus.confirmed => AppColors.blue,
    OrderStatus.pendingDispatch => AppColors.purple,
    OrderStatus.dispatched => AppColors.green,
  };

  String get _productsSummary {
    if (order.items.isEmpty) return 'No products';
    if (order.items.length == 1) return order.items.first.product;
    final names = order.items.map((i) => i.product).take(2).join(', ');
    return '$names +${order.items.length - 2} more';
  }

  @override
  Widget build(BuildContext context) {
    final customer = repo.customerById(order.customerId);
    final dispatchedQty = repo.orderDispatchedQty(order.id);
    final pendingQty = repo.orderPendingDispatchQty(order.id);

    return WhitePanel(
      onTap: () => Navigator.pushNamed(
        context,
        '/order',
        arguments: {'orderId': order.id},
      ),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Flexible(
                          child: Text(order.number, style: AppText.heading),
                        ),
                        const SizedBox(width: 8),
                        StatusChip(
                          label: orderStatusLabel(order.status),
                          color: _statusColor,
                        ),
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      customer?.name ?? order.customerId,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppText.body,
                    ),
                    Text(
                      '${customer?.city ?? '-'} • $_productsSummary',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppText.caption,
                    ),
                    const SizedBox(height: 6),
                    Wrap(
                      spacing: 10,
                      runSpacing: 4,
                      children: [
                        Text(
                          rupees(order.total),
                          style: const TextStyle(
                            fontWeight: FontWeight.w900,
                            color: AppColors.ink,
                            fontSize: 13,
                          ),
                        ),
                        Text(
                          qtyLabel(order.totalQty, order.unit),
                          style: AppText.caption,
                        ),
                      ],
                    ),
                    if (dispatchedQty > 0) ...[
                      const SizedBox(height: 4),
                      Text(
                        'Dispatched ${qtyLabel(dispatchedQty, order.unit)} • Pending ${qtyLabel(pendingQty, order.unit)}',
                        style: const TextStyle(
                          fontSize: 10,
                          color: AppColors.purple,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              const Icon(Icons.chevron_right_rounded, color: AppColors.muted),
            ],
          ),
          if (order.status == OrderStatus.pendingDispatch) ...[
            const SizedBox(height: 10),
            SizedBox(
              width: double.infinity,
              child: GradientButton(
                label: 'Go to Dispatch',
                height: 42,
                icon: Icons.local_shipping_rounded,
                gradient: AppGradients.dispatch,
                onPressed: () => Navigator.pushNamed(context, '/dispatch'),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
