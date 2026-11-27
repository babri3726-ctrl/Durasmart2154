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
  bool _isSyncing = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        context.read<MockRepository>().syncWithBackend();
      }
    });
  }

  void _shiftMonth(int delta) {
    setState(() {
      _month = DateTime(_month.year, _month.month + delta);
    });
  }

  Future<void> _handleSync(MockRepository repo) async {
    setState(() => _isSyncing = true);
    try {
      await repo.syncWithBackend();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Book1 targets synchronized successfully!'),
            duration: Duration(seconds: 2),
            backgroundColor: Color(0xFF059669),
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _isSyncing = false);
      }
    }
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
          IconButton(
            tooltip: 'Sync Book1 Targets',
            icon: _isSyncing
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.purple),
                  )
                : const Icon(Icons.sync_rounded),
            onPressed: _isSyncing ? null : () => _handleSync(repo),
          ),
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
      body: RefreshIndicator(
        onRefresh: () => repo.syncWithBackend(),
        child: ListView(
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
                  Row(
                    children: [
                      const Expanded(
                        child: Text(
                          'Target vs Achievement',
                          style: AppText.heading,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                        decoration: BoxDecoration(
                          color: const Color(0xFFECFDF5),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: const Color(0xFFA7F3D0)),
                        ),
                        child: Text(
                          '${metrics.achievementPercent.toStringAsFixed(1)}% Achieved',
                          style: const TextStyle(
                            color: Color(0xFF065F46),
                            fontWeight: FontWeight.w800,
                            fontSize: 11,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '${metrics.achievedQty.toStringAsFixed(3)} MT dispatched of ${metrics.targetQty.toStringAsFixed(3)} MT assigned target',
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
              title: 'Sales Team Quota & Achievement',
              subtitle: scopeName == 'All team'
                  ? 'Synced from Book1 Target Book'
                  : 'Filtered to $scopeName',
            ),
            const SizedBox(height: 10),
            if (repo.salespersonSummaries.isNotEmpty)
              ...repo.salespersonSummaries
                  .where((s) {
                    if (_salespersonId == null) return true;
                    return repo.matchesSalesperson(s.salesperson, _salespersonId);
                  })
                  .map(
                    (s) => Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: _salespersonSummaryCard(context, s),
                    ),
                  )
            else
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
      ),
    );
  }

  Widget _salespersonSummaryCard(BuildContext context, SalespersonSummary summary) {
    final ach = summary.achievementPercent;
    final badgeColor = ach >= 50
        ? const Color(0xFF065F46)
        : ach >= 30
            ? const Color(0xFF1E40AF)
            : const Color(0xFF92400E);
    final badgeBg = ach >= 50
        ? const Color(0xFFECFDF5)
        : ach >= 30
            ? const Color(0xFFEFF6FF)
            : const Color(0xFFFFFBEB);
    final badgeBorder = ach >= 50
        ? const Color(0xFFA7F3D0)
        : ach >= 30
            ? const Color(0xFFBFDBFE)
            : const Color(0xFFFDE68A);

    return WhitePanel(
      onTap: () => Navigator.pushNamed(context, '/performance'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              AvatarCircle(
                name: summary.salesperson,
                size: 38,
                gradient: AppGradients.employee,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      summary.salesperson,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppText.heading,
                    ),
                    Text(
                      '${summary.territory} • ${summary.partiesCount} parties',
                      style: AppText.caption,
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: badgeBg,
                  borderRadius: BorderRadius.circular(6),
                  border: Border.all(color: badgeBorder),
                ),
                child: Text(
                  '${summary.achievementPercent.toStringAsFixed(1)}%',
                  style: TextStyle(
                    color: badgeColor,
                    fontWeight: FontWeight.w900,
                    fontSize: 12,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'Dispatched / Target:',
                style: TextStyle(fontSize: 11, color: AppColors.muted, fontWeight: FontWeight.w600),
              ),
              Text(
                '${summary.totalDispatchedMt.toStringAsFixed(3)} / ${summary.totalTargetMt.toStringAsFixed(3)} MT',
                style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: AppColors.ink),
              ),
            ],
          ),
          const SizedBox(height: 6),
          ProgressRow(
            label: 'Quota Progress',
            value: summary.totalDispatchedMt,
            max: summary.totalTargetMt,
          ),
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
    final sp = _salespersonId != null ? repo.salespersonSummaryFor(_salespersonId) : null;
    final cards = <Widget>[
      HybridKpiCard(
        label: 'Sales Target',
        value: '${metrics.targetQty.toStringAsFixed(1)} MT',
        hint: _salespersonId == null ? 'Total monthly quota' : 'Assigned quota',
        icon: Icons.flag_rounded,
        gradient: const LinearGradient(colors: [Color(0xFF2563EB), Color(0xFF4F46E5)]),
      ),
      HybridKpiCard(
        label: 'Dispatched',
        value: '${metrics.achievedQty.toStringAsFixed(1)} MT',
        hint: 'Achieved on ground',
        icon: Icons.local_shipping_rounded,
        gradient: const LinearGradient(colors: [Color(0xFF059669), Color(0xFF0D9488)]),
        onTap: () => Navigator.pushNamed(context, '/dispatch'),
      ),
      HybridKpiCard(
        label: 'Pending Dispatch',
        value: '${metrics.pendingDispatchQty.toStringAsFixed(1)} MT',
        hint: 'In pipeline / production',
        icon: Icons.assignment_outlined,
        gradient: const LinearGradient(colors: [Color(0xFFD97706), Color(0xFFEA580C)]),
        onTap: () => Navigator.pushNamed(context, '/dispatch'),
      ),
      HybridKpiCard(
        label: 'Achievement',
        value: '${metrics.achievementPercent.toStringAsFixed(1)}%',
        hint: 'Progress to target',
        icon: Icons.trending_up_rounded,
        gradient: const LinearGradient(colors: [Color(0xFF9333EA), Color(0xFFDB2777)]),
      ),
      HybridKpiCard(
        label: 'Active Dealers',
        value: _salespersonId == null
            ? '${repo.serverActiveDealers ?? (repo.salesTargets.isNotEmpty ? repo.salesTargets.length : 137)}'
            : '${sp?.partiesCount ?? repo.salesTargets.where((t) => repo.matchesSalesperson(t.salesperson, _salespersonId)).length}',
        hint: _salespersonId == null
            ? 'Across Punjab & Haryana'
            : 'Parties in ${sp?.territory ?? "Territory"}',
        icon: Icons.groups_rounded,
        gradient: const LinearGradient(colors: [Color(0xFF0284C7), Color(0xFF2563EB)]),
        onTap: () => Navigator.pushNamed(context, '/debtors'),
      ),
      HybridKpiCard(
        label: _salespersonId == null ? 'Sales Team' : 'Territory',
        value: _salespersonId == null
            ? '${repo.salespersonSummaries.isNotEmpty ? repo.salespersonSummaries.length : (repo.serverSalesTeamCount ?? 13)}'
            : (sp?.territory ?? 'Assigned'),
        hint: _salespersonId == null ? 'Field representatives' : 'Assigned Territory',
        icon: Icons.military_tech_rounded,
        gradient: const LinearGradient(colors: [Color(0xFFE11D48), Color(0xFFDC2626)]),
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
          childAspectRatio: 1.15,
          crossAxisSpacing: 10,
          mainAxisSpacing: 10,
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
