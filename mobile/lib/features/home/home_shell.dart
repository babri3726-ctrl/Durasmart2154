import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/formatters.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import '../../data/mock_repository.dart';
import '../../data/models.dart';
import 'placeholder_screen.dart';

/// Root shell shown after sign-in: app bar (notifications + profile avatar),
/// a bottom navigation with Home + More tabs, and the home dashboard.
class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _index = 0;

  void _openNotifications(BuildContext context, MockRepository repo) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (sheetContext) => Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.of(sheetContext).viewInsets.bottom,
        ),
        child: StatefulBuilder(
          builder: (context, setSheetState) {
            final items = repo.notifications;
            return SafeArea(
              child: ConstrainedBox(
                constraints: BoxConstraints(
                  maxHeight: MediaQuery.of(context).size.height * 0.72,
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(18, 16, 12, 6),
                      child: Row(
                        children: [
                          const Text('Notifications', style: AppText.title),
                          const Spacer(),
                          StatusChip(
                            label: '${repo.unreadNotifications} unread',
                            color: AppColors.purple,
                          ),
                        ],
                      ),
                    ),
                    if (items.isEmpty)
                      const Padding(
                        padding: EdgeInsets.all(24),
                        child: Text(
                          'No notifications yet.',
                          style: AppText.body,
                        ),
                      )
                    else
                      Flexible(
                        child: ListView.separated(
                          shrinkWrap: true,
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 4,
                          ),
                          itemCount: items.length,
                          separatorBuilder: (_, _) => const Divider(
                            height: 1,
                            indent: 56,
                            color: AppColors.line,
                          ),
                          itemBuilder: (context, i) {
                            final n = items[i];
                            return ListTile(
                              onTap: () => setSheetState(
                                () => repo.markNotificationRead(n.id),
                              ),
                              leading: Container(
                                width: 38,
                                height: 38,
                                decoration: BoxDecoration(
                                  gradient: AppGradients.brand,
                                  borderRadius: BorderRadius.circular(12),
                                ),
                                child: Icon(
                                  n.read
                                      ? Icons.notifications_none_rounded
                                      : Icons.notifications_active_rounded,
                                  color: Colors.white,
                                  size: 19,
                                ),
                              ),
                              title: Text(
                                n.title,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontWeight: n.read
                                      ? FontWeight.w600
                                      : FontWeight.w900,
                                  fontSize: 13.5,
                                  color: AppColors.ink,
                                ),
                              ),
                              subtitle: Text(
                                '${n.body}\n${dateTimeLabel(n.time)}',
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontSize: 11.5,
                                  color: AppColors.muted,
                                  height: 1.3,
                                ),
                              ),
                              trailing: n.read
                                  ? const Icon(
                                      Icons.done_all_rounded,
                                      color: AppColors.green,
                                      size: 18,
                                    )
                                  : Container(
                                      width: 9,
                                      height: 9,
                                      decoration: const BoxDecoration(
                                        color: AppColors.pink,
                                        shape: BoxShape.circle,
                                      ),
                                    ),
                            );
                          },
                        ),
                      ),
                    const SizedBox(height: 8),
                  ],
                ),
              ),
            );
          },
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final repo = context.watch<MockRepository>();
    final user = repo.currentUser ?? repo.demoAccounts.first;
    final unread = repo.unreadNotifications;

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 16,
        title: const BrandMark(compact: true),
        actions: [
          IconButton(
            tooltip: 'Notifications',
            onPressed: () => _openNotifications(context, repo),
            icon: Stack(
              clipBehavior: Clip.none,
              children: [
                const Icon(
                  Icons.notifications_none_rounded,
                  size: 26,
                  color: AppColors.ink,
                ),
                if (unread > 0)
                  Positioned(
                    right: -7,
                    top: -4,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 5,
                        vertical: 2,
                      ),
                      constraints: const BoxConstraints(minWidth: 18),
                      decoration: BoxDecoration(
                        color: AppColors.pink,
                        borderRadius: BorderRadius.circular(50),
                      ),
                      child: Text(
                        '$unread',
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 10,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.only(right: 14),
            child: GestureDetector(
              onTap: () => Navigator.pushNamed(context, '/profile'),
              child: AvatarCircle(name: user.name, size: 34),
            ),
          ),
        ],
      ),
      body: IndexedStack(
        index: _index,
        children: [
          _HomeDashboard(user: user),
          const MoreScreen(),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.dashboard_outlined),
            selectedIcon: Icon(Icons.dashboard_rounded),
            label: 'Home',
          ),
          NavigationDestination(
            icon: Icon(Icons.grid_view_outlined),
            selectedIcon: Icon(Icons.grid_view_rounded),
            label: 'More',
          ),
        ],
      ),
    );
  }
}

/// Owner/employee home content.
class _HomeDashboard extends StatelessWidget {
  const _HomeDashboard({required this.user});
  final AppUser user;

  List<_MenuEntry> get _entries => <_MenuEntry>[
    _MenuEntry(
      'Sales',
      '/sales',
      Icons.storefront_rounded,
      'Orders & monthly targets',
      AppGradients.sales,
    ),
    _MenuEntry(
      'Payment',
      '/payments',
      Icons.payments_rounded,
      'Collections & debtor dues',
      AppGradients.payment,
      showForEmployee: false,
    ),
    _MenuEntry(
      'Vaccant Area',
      '/areas',
      Icons.map_rounded,
      'Open territories to claim',
      AppGradients.area,
      showForEmployee: false,
    ),
    _MenuEntry(
      'Tour Plan',
      '/tours',
      Icons.alt_route_rounded,
      'Field visit schedules',
      AppGradients.tour,
    ),
    _MenuEntry(
      'New Customer Add',
      '/new-customer',
      Icons.person_add_alt_1_rounded,
      'Register a dealer',
      AppGradients.customer,
    ),
    _MenuEntry(
      'New Order',
      '/new-order',
      Icons.add_shopping_cart_rounded,
      'Create a sales order',
      AppGradients.order,
    ),
    _MenuEntry(
      'Task Alarm',
      '/tasks',
      Icons.alarm_rounded,
      'Your assignments & dues',
      AppGradients.task,
    ),
    _MenuEntry(
      'Stock Inventory',
      '/stock',
      Icons.inventory_2_rounded,
      'Live yard & 1-Click Sync',
      AppGradients.dispatch,
    ),
  ];

  @override
  Widget build(BuildContext context) {
    final repo = context.watch<MockRepository>();
    final scopeId = user.isOwner ? null : user.employeeId;
    final metrics = repo.salesMetrics(salespersonId: scopeId);
    final tiles = _entries
        .where((e) => user.isOwner || e.showForEmployee)
        .toList();
    final openTasks = repo.tasks
        .where(
          (t) =>
              t.status != TaskStatus.completed &&
              (scopeId == null || t.assignedEmployeeId == scopeId),
        )
        .length;
    final outstanding = user.isOwner
        ? repo.totalOutstanding()
        : metrics.paymentBalance;
    final overdue = user.isOwner ? repo.totalOverdue() : metrics.overdueBalance;

    return SafeArea(
      child: ListView(
        padding: AppSpacing.page,
        children: [
          _welcome(),
          AppSpacing.gap,
          if (!user.isOwner)
            const Padding(
              padding: EdgeInsets.only(bottom: 6),
              child: DemoNotice(
                text:
                    'Role-based tile filtering here is UI convenience only for the '
                    'demo. It is not security — hide nothing sensitive behind the '
                    'employee view without real backend authorization.',
              ),
            ),
          SectionHeading(
            title: 'Modules',
            subtitle: user.isOwner
                ? 'All business areas'
                : 'Areas available to you',
          ),
          AppSpacing.gapSm,
          _tiles(context, tiles),
          AppSpacing.gap,
          SectionHeading(
            title: 'This month',
            subtitle: monthLabel(DateTime.now()),
          ),
          AppSpacing.gapSm,
          _summary(metrics, outstanding, overdue, openTasks),
          AppSpacing.gap,
          const SectionHeading(
            title: 'Recent activity',
            subtitle: 'Latest alerts and updates',
          ),
          AppSpacing.gapSm,
          _activity(repo),
        ],
      ),
    );
  }

  Widget _welcome() => Container(
    padding: const EdgeInsets.all(18),
    decoration: BoxDecoration(
      gradient: AppGradients.brand,
      borderRadius: BorderRadius.circular(24),
      boxShadow: const [
        BoxShadow(
          color: Color(0x225034A0),
          blurRadius: 22,
          offset: Offset(0, 11),
        ),
      ],
    ),
    child: Row(
      children: [
        AvatarCircle(
          name: user.name,
          size: 52,
          gradient: const LinearGradient(
            colors: [Colors.white, Color(0xFFF0F1FB)],
          ),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Welcome, ${user.name}',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 18,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                user.department,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(color: Color(0xD9FFFFFF), fontSize: 12),
              ),
            ],
          ),
        ),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(50),
          ),
          child: Text(
            user.isOwner ? 'Owner' : 'Employee',
            style: const TextStyle(
              color: AppColors.purple,
              fontWeight: FontWeight.w900,
              fontSize: 11,
            ),
          ),
        ),
      ],
    ),
  );

  Widget _tiles(BuildContext context, List<_MenuEntry> tiles) => GridView.count(
    crossAxisCount: 2,
    shrinkWrap: true,
    physics: const NeverScrollableScrollPhysics(),
    mainAxisSpacing: 12,
    crossAxisSpacing: 12,
    childAspectRatio: 0.82,
    children: [
      for (final entry in tiles)
        WhitePanel(
          padding: const EdgeInsets.all(14),
          onTap: () => Navigator.pushNamed(context, entry.route),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 50,
                height: 50,
                decoration: BoxDecoration(
                  gradient: entry.gradient,
                  borderRadius: BorderRadius.circular(15),
                ),
                child: Icon(entry.icon, color: Colors.white, size: 26),
              ),
              const SizedBox(height: 10),
              Text(
                entry.label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w900,
                  color: AppColors.ink,
                ),
              ),
              const SizedBox(height: 2),
              Expanded(
                child: Text(
                  entry.subtitle,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 11,
                    color: AppColors.muted,
                    height: 1.3,
                  ),
                ),
              ),
            ],
          ),
        ),
    ],
  );

  Widget _summary(
    SalesMetrics metrics,
    double outstanding,
    double overdue,
    int openTasks,
  ) {
    final cards = <Widget>[
      MetricCard(
        title: 'Achieved / Target',
        value: qtyLabel(metrics.achievedQty, 'MT'),
        caption:
            'of ${qtyLabel(metrics.targetQty, 'MT')} • ${metrics.achievementPercent.toStringAsFixed(0)}%',
        icon: Icons.trending_up_rounded,
        gradient: AppGradients.sales,
      ),
      MetricCard(
        title: 'Outstanding',
        value: rupeesShort(outstanding),
        caption: 'Total receivable',
        icon: Icons.account_balance_wallet_rounded,
        gradient: AppGradients.payment,
      ),
      MetricCard(
        title: 'Overdue',
        value: rupeesShort(overdue),
        caption: 'Past due date',
        icon: Icons.warning_amber_rounded,
        gradient: AppGradients.danger,
      ),
      MetricCard(
        title: 'Pending Orders',
        value: '${metrics.ordersPendingCount}',
        caption: 'Awaiting action',
        icon: Icons.receipt_long_rounded,
        gradient: AppGradients.order,
      ),
      MetricCard(
        title: 'Pending Dispatch',
        value: qtyLabel(metrics.pendingDispatchQty, 'MT'),
        caption: 'Goods to send',
        icon: Icons.local_shipping_rounded,
        gradient: AppGradients.dispatch,
      ),
      MetricCard(
        title: 'Open Tasks',
        value: '$openTasks',
        caption: 'Not completed',
        icon: Icons.task_alt_rounded,
        gradient: AppGradients.task,
      ),
    ];
    return GridView.count(
      crossAxisCount: 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 12,
      crossAxisSpacing: 12,
      childAspectRatio: 1.22,
      children: cards,
    );
  }

  Widget _activity(MockRepository repo) {
    final items = repo.notifications.take(6).toList();
    if (items.isEmpty) {
      return const WhitePanel(
        child: Text('No recent activity.', style: AppText.body),
      );
    }
    return WhitePanel(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      child: Column(
        children: [
          for (final n in items)
            ListTile(
              dense: true,
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 8,
                vertical: 2,
              ),
              leading: Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  gradient: AppGradients.brand,
                  borderRadius: BorderRadius.circular(11),
                ),
                child: const Icon(
                  Icons.bolt_rounded,
                  color: Colors.white,
                  size: 18,
                ),
              ),
              title: Text(
                n.title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontWeight: FontWeight.w800,
                  fontSize: 13,
                  color: AppColors.ink,
                ),
              ),
              subtitle: Text(
                '${n.body} • ${relativeDay(n.time)}',
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 11,
                  color: AppColors.muted,
                  height: 1.3,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _MenuEntry {
  const _MenuEntry(
    this.label,
    this.route,
    this.icon,
    this.subtitle,
    this.gradient, {
    this.showForEmployee = true,
  });
  final String label;
  final String route;
  final IconData icon;
  final String subtitle;
  final LinearGradient gradient;
  final bool showForEmployee;
}
