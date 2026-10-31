import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/formatters.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import '../../data/mock_repository.dart';
import '../../data/models.dart';

/// Team-wide sales performance. Tapping a member opens an in-file detail page.
class PerformanceScreen extends StatelessWidget {
  const PerformanceScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final repo = context.watch<MockRepository>();
    final team = repo.employees.where((e) => e.department == 'Sales').toList();
    final teamMetrics = repo.salesMetrics();

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Sales Performance')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _teamHeader(teamMetrics),
          const SizedBox(height: 16),
          const SectionHeading(
            title: 'Sales Team',
            subtitle: 'This month snapshot',
          ),
          const SizedBox(height: 10),
          _hrPbTargetsSection(context, repo),
          const SizedBox(height: 16),
          const SectionHeading(
            title: 'Sales Team Breakdown',
            subtitle: 'Monthly targets & achievements',
          ),
          const SizedBox(height: 10),
          ...team.map(
            (e) => Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: _employeeCard(context, repo, e),
            ),
          ),

          const SizedBox(height: 12),
        ],
      ),
    );
  }

  Widget _teamHeader(SalesMetrics metrics) {
    return GradientHero(
      gradient: AppGradients.sales,
      height: 168,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'TEAM TOTAL',
            style: TextStyle(
              color: Colors.white70,
              fontSize: 11,
              fontWeight: FontWeight.w800,
              letterSpacing: 1,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            '${qtyLabel(metrics.achievedQty, 'MT')} / ${qtyLabel(metrics.targetQty, 'MT')}',
            style: const TextStyle(
              color: Colors.white,
              fontSize: 26,
              fontWeight: FontWeight.w900,
            ),
          ),
          const Spacer(),
          Row(
            children: [
              Expanded(
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(20),
                  child: LinearProgressIndicator(
                    value: metrics.targetQty <= 0
                        ? 0
                        : (metrics.achievedQty / metrics.targetQty)
                              .clamp(0.0, 1.0)
                              .toDouble(),
                    minHeight: 8,
                    backgroundColor: Colors.white24,
                    color: Colors.white,
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Text(
                '${metrics.achievementPercent.round()}%',
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _employeeCard(BuildContext context, MockRepository repo, Employee e) {
    final m = repo.salesMetrics(salespersonId: e.id);
    return WhitePanel(
      onTap: () => Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => _SalespersonDetailScreen(salespersonId: e.id),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              AvatarCircle(
                name: e.name,
                size: 44,
                gradient: AppGradients.employee,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      e.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppText.title,
                    ),
                    Text(
                      e.role,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppText.caption,
                    ),
                  ],
                ),
              ),
              Text(
                '${m.achievementPercent.round()}%',
                style: const TextStyle(
                  color: AppColors.purple,
                  fontWeight: FontWeight.w900,
                  fontSize: 18,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          ProgressRow(
            label: 'Target ${qtyLabel(e.monthlyTargetQty, 'MT')}',
            value: m.achievedQty,
            max: e.monthlyTargetQty,
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _miniStat(
                'Achieved',
                qtyLabel(m.achievedQty, 'MT'),
                AppColors.blue,
              ),
              _miniStat('Orders', '${m.ordersReceived}', AppColors.purple),
              _miniStat('Pending', '${m.ordersPendingCount}', AppColors.orange),
              _miniStat(
                'Collected',
                rupeesShort(m.paymentReceived),
                AppColors.teal,
              ),
              _miniStat(
                'Balance',
                rupeesShort(m.paymentBalance),
                AppColors.navy,
              ),
              _miniStat(
                'Overdue',
                rupeesShort(m.overdueBalance),
                AppColors.red,
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _miniStat(String label, String value, Color color) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
    decoration: BoxDecoration(
      color: color.withValues(alpha: .08),
      borderRadius: BorderRadius.circular(12),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: TextStyle(
            fontSize: 9,
            color: color,
            fontWeight: FontWeight.w800,
          ),
        ),
        Text(
          value,
          style: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w900,
            color: AppColors.ink,
          ),
        ),
      ],
    ),
  );

  Widget _hrPbTargetsSection(BuildContext context, MockRepository repo) {
    if (repo.salesTargets.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeading(
          title: 'HR-PB Dealer Targets',
          subtitle: 'Punjab & Haryana territory check',
        ),
        const SizedBox(height: 10),
        ...repo.salesTargets.map((t) => Container(
          margin: const EdgeInsets.only(bottom: 8),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: AppColors.line),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Expanded(
                    child: Text(
                      t.partyName,
                      style: AppText.body.copyWith(fontWeight: FontWeight.bold),
                    ),
                  ),
                  Text(
                    t.state,
                    style: AppText.caption,
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                t.station + ' • Rep: ' + t.salesperson,
                style: AppText.caption,
              ),
              const SizedBox(height: 6),
              Wrap(
                spacing: 12,
                runSpacing: 4,
                children: [
                  Text('Target: ' + t.targetMt + ' MT', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600)),
                  Text('Dispatched: ' + t.dispatchedMt + ' MT', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: AppColors.green)),
                  Text('Pending: ' + t.pendingMt + ' MT', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: AppColors.orange)),
                ],
              ),
            ],
          ),
        )),
      ],
    );
  }

}

class _SalespersonDetailScreen extends StatelessWidget {
  const _SalespersonDetailScreen({required this.salespersonId});
  final String salespersonId;

  @override
  Widget build(BuildContext context) {
    final repo = context.watch<MockRepository>();
    final employee = repo.employeeById(salespersonId);
    final name = employee?.name ?? 'Salesperson';
    final m = repo.salesMetrics(salespersonId: salespersonId);
    final series = repo.lastSixMonthsAchievement(salespersonId: salespersonId);
    final customers = repo.customers
        .where((c) => c.salespersonId == salespersonId)
        .toList();
    final orders =
        repo.orders.where((o) => o.salespersonId == salespersonId).toList()
          ..sort((a, b) => b.orderDate.compareTo(a.orderDate));

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: Text(name)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          WhitePanel(
            child: Row(
              children: [
                AvatarCircle(
                  name: name,
                  size: 48,
                  gradient: AppGradients.employee,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppText.title,
                      ),
                      Text(employee?.role ?? '', style: AppText.caption),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          _metricsGrid(m),
          const SizedBox(height: 16),
          _chart(context, name, series),
          const SizedBox(height: 16),
          SectionHeading(
            title: 'Customers',
            subtitle: '${customers.length} assigned',
          ),
          const SizedBox(height: 8),
          if (customers.isEmpty)
            const EmptyState(
              icon: Icons.groups_rounded,
              title: 'No customers',
              subtitle: 'This salesperson has no customers yet.',
            )
          else
            WhitePanel(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Column(
                children: [
                  for (final c in customers)
                    ListTile(
                      leading: AvatarCircle(
                        name: c.name,
                        size: 36,
                        gradient: AppGradients.customer,
                      ),
                      title: Text(
                        c.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      subtitle: Text(
                        '${c.city} • ${rupeesShort(repo.customerOutstanding(c.id))} balance',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      trailing: const Icon(
                        Icons.chevron_right_rounded,
                        color: AppColors.muted,
                      ),
                      onTap: () => Navigator.pushNamed(
                        context,
                        '/customer',
                        arguments: {'customerId': c.id},
                      ),
                    ),
                ],
              ),
            ),
          const SizedBox(height: 16),
          SectionHeading(title: 'Orders', subtitle: '${orders.length} total'),
          const SizedBox(height: 8),
          if (orders.isEmpty)
            const EmptyState(
              icon: Icons.list_alt_rounded,
              title: 'No orders',
              subtitle: 'No orders recorded for this salesperson.',
            )
          else
            WhitePanel(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Column(
                children: [
                  for (final o in orders)
                    ListTile(
                      leading: AvatarCircle(
                        name: 'ORD',
                        size: 36,
                        gradient: AppGradients.order,
                      ),
                      title: Text(
                        '${o.number} • ${qtyLabel(o.totalQty, o.unit)} • ${rupeesShort(o.total)}',
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

  Widget _metricsGrid(SalesMetrics m) {
    final items = <MetricCard>[
      MetricCard(
        title: 'Monthly Target',
        value: qtyLabel(m.targetQty, 'MT'),
        icon: Icons.flag_rounded,
        gradient: AppGradients.sales,
      ),
      MetricCard(
        title: 'Achieved',
        value: qtyLabel(m.achievedQty, 'MT'),
        caption: '${m.achievementPercent.round()}%',
        icon: Icons.trending_up_rounded,
        gradient: AppGradients.payment,
      ),
      MetricCard(
        title: 'Pending Target',
        value: qtyLabel(m.pendingTargetQty, 'MT'),
        icon: Icons.track_changes_rounded,
        gradient: AppGradients.tour,
      ),
      MetricCard(
        title: 'Orders Received',
        value: '${m.ordersReceived}',
        caption: 'Pending ${m.ordersPendingCount}',
        icon: Icons.shopping_cart_rounded,
        gradient: AppGradients.order,
      ),
      MetricCard(
        title: 'Payment Collected',
        value: rupeesShort(m.paymentReceived),
        caption: rupees(m.paymentReceived),
        icon: Icons.payments_rounded,
        gradient: AppGradients.customer,
      ),
      MetricCard(
        title: 'Payment Balance',
        value: rupeesShort(m.paymentBalance),
        caption: rupees(m.paymentBalance),
        icon: Icons.account_balance_wallet_rounded,
        gradient: AppGradients.danger,
      ),
      MetricCard(
        title: 'Overdue',
        value: rupeesShort(m.overdueBalance),
        caption: rupees(m.overdueBalance),
        icon: Icons.warning_amber_rounded,
        gradient: AppGradients.area,
      ),
      MetricCard(
        title: 'Pending Dispatch',
        value: qtyLabel(m.pendingDispatchQty, 'MT'),
        icon: Icons.local_shipping_rounded,
        gradient: AppGradients.dispatch,
      ),
    ];
    return LayoutBuilder(
      builder: (context, c) {
        final columns = c.maxWidth >= 620 ? 3 : 2;
        return GridView.count(
          crossAxisCount: columns,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          childAspectRatio: 1.3,
          crossAxisSpacing: 12,
          mainAxisSpacing: 12,
          children: items,
        );
      },
    );
  }

  Widget _chart(BuildContext context, String name, List<double> series) {
    final maxV = series.fold<double>(0, (mx, v) => v > mx ? v : mx);
    final now = DateTime.now();
    return WhitePanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '$name — 6 month trend',
            style: AppText.heading,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          const Text('Ordered quantity (MT)', style: AppText.caption),
          const SizedBox(height: 14),
          SizedBox(
            height: 140,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                for (var i = 0; i < series.length; i++)
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 5),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.end,
                        children: [
                          Text(
                            series[i] % 1 == 0
                                ? series[i].toInt().toString()
                                : series[i].toStringAsFixed(1),
                            maxLines: 1,
                            style: const TextStyle(
                              fontSize: 9,
                              fontWeight: FontWeight.w800,
                              color: AppColors.muted,
                            ),
                          ),
                          const SizedBox(height: 3),
                          Expanded(
                            child: Align(
                              alignment: Alignment.bottomCenter,
                              child: FractionallySizedBox(
                                heightFactor: maxV <= 0
                                    ? 0.02
                                    : (series[i] / maxV)
                                          .clamp(0.02, 1.0)
                                          .toDouble(),
                                child: Container(
                                  decoration: BoxDecoration(
                                    gradient: AppGradients.sales,
                                    borderRadius: BorderRadius.circular(7),
                                  ),
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(height: 6),
                          Text(
                            monthLabel(
                              DateTime(now.year, now.month - (5 - i)),
                            ).split(' ').first,
                            maxLines: 1,
                            style: const TextStyle(
                              fontSize: 9,
                              color: AppColors.muted,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
