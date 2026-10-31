import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/formatters.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import '../../data/mock_repository.dart';
import '../../data/models.dart';

/// Sales Department command centre. All figures are computed live from the
/// shared [MockRepository] for the selected month + salesperson scope.
class SalesDashboardScreen extends StatefulWidget {
  const SalesDashboardScreen({super.key});

  @override
  State<SalesDashboardScreen> createState() => _SalesDashboardScreenState();
}

class _SalesDashboardScreenState extends State<SalesDashboardScreen> {
  DateTime _month = DateTime(DateTime.now().year, DateTime.now().month);
  String? _salespersonId; // null => All team

  void _shiftMonth(int delta) {
    setState(() {
      _month = DateTime(_month.year, _month.month + delta);
    });
  }

  @override
  Widget build(BuildContext context) {
    final repo = context.watch<MockRepository>();
    final metrics = repo.salesMetrics(
      salespersonId: _salespersonId,
      month: _month,
    );
    final salesTeam = repo.employees
        .where((e) => e.department == 'Sales')
        .toList();
    final scopeName = _salespersonId == null
        ? 'All team'
        : repo.salespersonName(_salespersonId!);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Sales Dashboard'),
        actions: [
          if (repo.currentUser != null)
            Padding(
              padding: const EdgeInsets.only(right: 12),
              child: Center(
                child: StatusChip(
                  label: repo.currentUser!.isOwner ? 'Owner' : 'Sales',
                  color: AppColors.purple,
                ),
              ),
            ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _scopeSelector(context, repo, scopeName),
          const SizedBox(height: 12),
          _monthSelector(),
          const SizedBox(height: 16),
          _metricGrid(repo, metrics),
          const SizedBox(height: 16),
          WhitePanel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Target vs Achievement', style: AppText.heading),
                const SizedBox(height: 4),
                Text(
                  '${qtyLabel(metrics.achievedQty, 'MT')} of ${qtyLabel(metrics.targetQty, 'MT')}',
                  style: AppText.caption,
                ),
                const SizedBox(height: 12),
                ProgressRow(
                  label: 'Achievement',
                  value: metrics.achievedQty,
                  max: metrics.targetQty,
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          _monthlyChart(repo),
          const SizedBox(height: 16),
          SectionHeading(
            title: 'Sales Team',
            subtitle: scopeName == 'All team'
                ? 'Tap a member to open their performance'
                : 'Filtered to $scopeName',
          ),
          const SizedBox(height: 10),
          ...salesTeam
              .where((e) => _salespersonId == null || e.id == _salespersonId)
              .map(
                (e) => Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: _teamCard(repo, e),
                ),
              ),
          const SizedBox(height: 16),
          const SectionHeading(title: 'Quick Actions'),
          const SizedBox(height: 10),
          _quickActions(context),
          const SizedBox(height: 16),

          const SizedBox(height: 12),
        ],
      ),
    );
  }

  Widget _scopeSelector(
    BuildContext context,
    MockRepository repo,
    String scopeName,
  ) {
    final salesTeam = repo.employees
        .where((e) => e.department == 'Sales')
        .toList();
    return WhitePanel(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
      child: Row(
        children: [
          const Icon(Icons.tune_rounded, color: AppColors.purple),
          const SizedBox(width: 10),
          Expanded(
            child: DropdownButtonHideUnderline(
              child: DropdownButton<String?>(
                isExpanded: true,
                value: _salespersonId,
                items: [
                  const DropdownMenuItem<String?>(
                    value: null,
                    child: Text('All team'),
                  ),
                  for (final e in salesTeam)
                    DropdownMenuItem<String?>(value: e.id, child: Text(e.name)),
                ],
                onChanged: (v) => setState(() => _salespersonId = v),
              ),
            ),
          ),
          const SizedBox(width: 8),
          AvatarCircle(name: scopeName, size: 34, gradient: AppGradients.sales),
        ],
      ),
    );
  }

  Widget _monthSelector() {
    return Row(
      children: [
        IconButton(
          onPressed: () => _shiftMonth(-1),
          icon: const Icon(Icons.chevron_left_rounded),
          style: IconButton.styleFrom(backgroundColor: Colors.white),
        ),
        Expanded(
          child: Center(child: Text(monthLabel(_month), style: AppText.title)),
        ),
        IconButton(
          onPressed: () => _shiftMonth(1),
          icon: const Icon(Icons.chevron_right_rounded),
          style: IconButton.styleFrom(backgroundColor: Colors.white),
        ),
      ],
    );
  }

  Widget _metricGrid(MockRepository repo, SalesMetrics metrics) {
    final cards = <Widget>[
      MetricCard(
        title: 'Monthly Target',
        value: qtyLabel(metrics.targetQty, 'MT'),
        caption: 'Quantity',
        icon: Icons.flag_rounded,
        gradient: AppGradients.sales,
      ),
      MetricCard(
        title: 'Order Received',
        value: '${metrics.ordersReceived}',
        caption: '${qtyLabel(metrics.achievedQty, 'MT')} ordered',
        icon: Icons.shopping_cart_rounded,
        gradient: AppGradients.order,
      ),
      MetricCard(
        title: 'Order Pending',
        value: '${metrics.ordersPendingCount}',
        caption: 'Awaiting action',
        icon: Icons.pending_actions_rounded,
        gradient: AppGradients.area,
      ),
      MetricCard(
        title: 'Pending for Dispatch',
        value: qtyLabel(metrics.pendingDispatchQty, 'MT'),
        caption: 'To dispatch',
        icon: Icons.local_shipping_rounded,
        gradient: AppGradients.dispatch,
      ),
      MetricCard(
        title: 'Pending Target',
        value: qtyLabel(metrics.pendingTargetQty, 'MT'),
        caption: 'Remaining',
        icon: Icons.track_changes_rounded,
        gradient: AppGradients.tour,
      ),
      MetricCard(
        title: 'Payment Received',
        value: rupeesShort(metrics.paymentReceived),
        caption: rupees(metrics.paymentReceived),
        icon: Icons.payments_rounded,
        gradient: AppGradients.payment,
      ),
      MetricCard(
        title: 'Payment Balance',
        value: rupeesShort(metrics.paymentBalance),
        caption: rupees(metrics.paymentBalance),
        icon: Icons.account_balance_wallet_rounded,
        gradient: AppGradients.danger,
      ),
    ];
    return LayoutBuilder(
      builder: (context, constraints) {
        final columns = constraints.maxWidth >= 720
            ? 3
            : (constraints.maxWidth >= 460 ? 2 : 2);
        return GridView.count(
          crossAxisCount: columns,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          childAspectRatio: 1.28,
          crossAxisSpacing: 12,
          mainAxisSpacing: 12,
          children: cards,
        );
      },
    );
  }

  Widget _monthlyChart(MockRepository repo) {
    final series = repo.lastSixMonthsAchievement(salespersonId: _salespersonId);
    final maxValue = series.fold<double>(0, (m, v) => v > m ? v : m);
    final now = DateTime.now();
    return WhitePanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Last 6 Months Achievement', style: AppText.heading),
          const SizedBox(height: 4),
          const Text('Ordered quantity (MT)', style: AppText.caption),
          const SizedBox(height: 16),
          SizedBox(
            height: 150,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                for (var i = 0; i < series.length; i++)
                  Expanded(
                    child: _chartBar(
                      label: monthLabel(
                        DateTime(now.year, now.month - (5 - i)),
                      ).split(' ').first,
                      value: series[i],
                      maxValue: maxValue,
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _chartBar({
    required String label,
    required double value,
    required double maxValue,
  }) {
    final ratio = maxValue <= 0
        ? 0.0
        : (value / maxValue).clamp(0.0, 1.0).toDouble();
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 5),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          Text(
            value % 1 == 0
                ? value.toInt().toString()
                : value.toStringAsFixed(1),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
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
                heightFactor: ratio == 0 ? 0.02 : ratio,
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
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 9,
              color: AppColors.muted,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }

  Widget _teamCard(MockRepository repo, Employee employee) {
    final m = repo.salesMetrics(salespersonId: employee.id, month: _month);
    return WhitePanel(
      onTap: () => Navigator.pushNamed(context, '/performance'),
      child: Column(
        children: [
          Row(
            children: [
              AvatarCircle(
                name: employee.name,
                size: 40,
                gradient: AppGradients.employee,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      employee.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppText.heading,
                    ),
                    Text(
                      '${qtyLabel(m.achievedQty, 'MT')} / ${qtyLabel(m.targetQty, 'MT')}',
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
                  fontSize: 16,
                ),
              ),
              const Icon(Icons.chevron_right_rounded, color: AppColors.muted),
            ],
          ),
          const SizedBox(height: 10),
          ProgressRow(
            label: 'This month',
            value: m.achievedQty,
            max: m.targetQty,
          ),
        ],
      ),
    );
  }

  Widget _quickActions(BuildContext context) {
    final actions = <_QuickAction>[
      _QuickAction(
        Icons.groups_rounded,
        'Customers',
        () => Navigator.pushNamed(context, '/customers'),
      ),
      _QuickAction(
        Icons.receipt_long_rounded,
        'Debtors',
        () => Navigator.pushNamed(context, '/debtors'),
      ),
      _QuickAction(
        Icons.list_alt_rounded,
        'Orders',
        () => Navigator.pushNamed(context, '/orders'),
      ),
      _QuickAction(
        Icons.add_shopping_cart_rounded,
        'New Order',
        () => Navigator.pushNamed(context, '/new-order'),
      ),
      _QuickAction(
        Icons.local_shipping_rounded,
        'Pending Dispatch',
        () => Navigator.pushNamed(context, '/dispatch'),
      ),
      _QuickAction(
        Icons.insights_rounded,
        'Payment dashboard',
        () => Navigator.pushNamed(context, '/payments'),
      ),
    ];
    return Wrap(
      spacing: 10,
      runSpacing: 10,
      children: [
        for (final a in actions)
          SizedBox(
            width: 160,
            child: ActionPill(icon: a.icon, label: a.label, onTap: a.onTap),
          ),
      ],
    );
  }
}

class _QuickAction {
  const _QuickAction(this.icon, this.label, this.onTap);
  final IconData icon;
  final String label;
  final VoidCallback onTap;
}
