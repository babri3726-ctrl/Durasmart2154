import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../core/widgets.dart';

/// "More" tab: a complete directory of every module grouped by area, each row
/// navigating to a live route.
class MoreScreen extends StatelessWidget {
  const MoreScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: ListView(
        padding: AppSpacing.page,
        children: [
          _header(context),
          AppSpacing.gap,
          _section(
            context,
            'Sales',
            const Icon(
              Icons.trending_up_rounded,
              color: AppColors.blue,
              size: 18,
            ),
            [
              _Item(
                'Sales Dashboard',
                'Orders, targets & progress',
                '/sales',
                Icons.dashboard_rounded,
                AppGradients.sales,
              ),
              _Item(
                'Performance',
                'Achievement & trends',
                '/performance',
                Icons.insights_rounded,
                AppGradients.customer,
              ),
            ],
          ),
          _section(
            context,
            'Customers & Orders',
            const Icon(Icons.groups_rounded, color: AppColors.teal, size: 18),
            [
              _Item(
                'Customers',
                'All dealer & contractor records',
                '/customers',
                Icons.people_alt_rounded,
                AppGradients.customer,
              ),
              _Item(
                'Debtors',
                'Accounts with balances',
                '/debtors',
                Icons.account_balance_rounded,
                AppGradients.danger,
              ),
              _Item(
                'Orders',
                'Sales orders list',
                '/orders',
                Icons.receipt_long_rounded,
                AppGradients.order,
              ),
              _Item(
                'New Customer',
                'Register a dealer',
                '/new-customer',
                Icons.person_add_alt_1_rounded,
                AppGradients.customer,
              ),
              _Item(
                'New Order',
                'Create a sales order',
                '/new-order',
                Icons.add_shopping_cart_rounded,
                AppGradients.order,
              ),
            ],
          ),
          _section(
            context,
            'Inventory & Stock',
            const Icon(
              Icons.inventory_2_rounded,
              color: AppColors.teal,
              size: 18,
            ),
            [
              _Item(
                'Stock Inventory',
                'Live yard snapshot & 1-Click Sync',
                '/stock',
                Icons.inventory_rounded,
                AppGradients.dispatch,
              ),
            ],
          ),
          _section(
            context,
            'Dispatch',
            const Icon(
              Icons.local_shipping_rounded,
              color: AppColors.purple,
              size: 18,
            ),
            [
              _Item(
                'Dispatch',
                'Pending dispatch queue',
                '/dispatch',
                Icons.assignment_return_rounded,
                AppGradients.dispatch,
              ),
              _Item(
                'Dispatch History',
                'Past consignments',
                '/dispatch-history',
                Icons.history_rounded,
                AppGradients.employee,
              ),
            ],
          ),
          _section(
            context,
            'Payments',
            const Icon(
              Icons.payments_rounded,
              color: AppColors.orange,
              size: 18,
            ),
            [
              _Item(
                'Payments',
                'Collections dashboard',
                '/payments',
                Icons.savings_rounded,
                AppGradients.payment,
              ),
              _Item(
                'Record Payment',
                'Add a customer payment',
                '/record-payment',
                Icons.add_card_rounded,
                AppGradients.success,
              ),
              _Item(
                'Outstanding',
                'Receivables overview',
                '/outstanding',
                Icons.report_rounded,
                AppGradients.danger,
              ),
            ],
          ),
          _section(
            context,
            'Areas',
            const Icon(Icons.map_rounded, color: AppColors.pink, size: 18),
            [
              _Item(
                'Vaccant Area',
                'Open territories to claim',
                '/areas',
                Icons.terrain_rounded,
                AppGradients.area,
              ),
            ],
          ),
          _section(
            context,
            'Tours',
            const Icon(
              Icons.alt_route_rounded,
              color: AppColors.purple,
              size: 18,
            ),
            [
              _Item(
                'Tour Plan',
                'Field visit schedules',
                '/tours',
                Icons.route_rounded,
                AppGradients.tour,
              ),
            ],
          ),
          _section(
            context,
            'Tasks',
            const Icon(Icons.alarm_rounded, color: AppColors.blue, size: 18),
            [
              _Item(
                'Task Alarm',
                'Assignments & dues',
                '/tasks',
                Icons.notifications_active_rounded,
                AppGradients.task,
              ),
              _Item(
                'Create Task',
                'Assign a new task',
                '/create-task',
                Icons.add_task_rounded,
                AppGradients.sales,
              ),
              _Item(
                'Task Review',
                'Review completion photos',
                '/task-review',
                Icons.photo_camera_front_rounded,
                AppGradients.dispatch,
              ),
            ],
          ),
          _section(
            context,
            'Organisation',
            const Icon(
              Icons.apartment_rounded,
              color: AppColors.teal,
              size: 18,
            ),
            [
              _Item(
                'Employees',
                'Team directory',
                '/employees',
                Icons.badge_rounded,
                AppGradients.employee,
              ),
              _Item(
                'Profile',
                'Your account details',
                '/profile',
                Icons.person_rounded,
                AppGradients.customer,
              ),
              _Item(
                'Settings',
                'Theme, alerts & roles',
                '/settings',
                Icons.settings_rounded,
                AppGradients.payment,
              ),
            ],
          ),
          AppSpacing.gapSm,
          const DemoNotice(
            text:
                'Every row opens a live in-app module. This More directory is part of the UI prototype and mirrors the home tiles.',
          ),
        ],
      ),
    );
  }

  Widget _header(BuildContext context) => Container(
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
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
          ),
          child: const BrandMark(compact: true),
        ),
        const SizedBox(width: 14),
        const Expanded(
          child: Text(
            'All modules',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: Colors.white,
              fontSize: 18,
              fontWeight: FontWeight.w900,
            ),
          ),
        ),
        IconButton(
          onPressed: () => Navigator.pushNamed(context, '/settings'),
          icon: const Icon(Icons.settings_rounded, color: Colors.white),
        ),
      ],
    ),
  );

  Widget _section(
    BuildContext context,
    String title,
    Icon icon,
    List<_Item> items,
  ) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(4, 12, 4, 6),
          child: Row(
            children: [
              icon,
              const SizedBox(width: 8),
              Text(
                title.toUpperCase(),
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w900,
                  color: AppColors.muted,
                  letterSpacing: .6,
                ),
              ),
            ],
          ),
        ),
        WhitePanel(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
          child: Column(
            children: [
              for (var i = 0; i < items.length; i++) ...[
                _tile(context, items[i]),
                if (i != items.length - 1)
                  const Divider(height: 1, indent: 58, color: AppColors.line),
              ],
            ],
          ),
        ),
      ],
    ),
  );

  Widget _tile(BuildContext context, _Item item) => ListTile(
    onTap: () => Navigator.pushNamed(context, item.route),
    contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 2),
    leading: Container(
      width: 40,
      height: 40,
      decoration: BoxDecoration(
        gradient: item.gradient,
        borderRadius: BorderRadius.circular(13),
      ),
      child: Icon(item.icon, color: Colors.white, size: 20),
    ),
    title: Text(
      item.title,
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      style: const TextStyle(
        fontWeight: FontWeight.w800,
        fontSize: 14,
        color: AppColors.ink,
      ),
    ),
    subtitle: Text(
      item.subtitle,
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      style: const TextStyle(fontSize: 11.5, color: AppColors.muted),
    ),
    trailing: const Icon(Icons.chevron_right_rounded, color: AppColors.faint),
  );
}

class _Item {
  const _Item(this.title, this.subtitle, this.route, this.icon, this.gradient);
  final String title;
  final String subtitle;
  final String route;
  final IconData icon;
  final LinearGradient gradient;
}
