import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/formatters.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import '../../core/api_sync_service.dart';
import '../../data/mock_repository.dart';

/// Settings: theme/app info, server endpoint, demo notification switches,
/// role/permission overview and department assignment.
class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  bool _orderUpdates = true;
  bool _dispatchReminders = true;
  bool _taskDueAlerts = false;

  static const _permissionRows = <_PermissionRow>[
    _PermissionRow('Sales & targets', true, true),
    _PermissionRow('Customers & orders', true, true),
    _PermissionRow('Dispatch', true, true),
    _PermissionRow('Tour plans', true, true),
    _PermissionRow('Tasks', true, true),
    _PermissionRow('Payments', true, false),
    _PermissionRow('Vaccant Area', true, false),
    _PermissionRow('Employees', true, false),
    _PermissionRow('Settings', true, false),
  ];

  Future<void> _logout() async {
    final repo = context.read<MockRepository>();
    final ok = await ConfirmDialog.show(
      context,
      title: 'Sign out?',
      message:
          'You will return to the login screen. Your demo session will end.',
      confirmLabel: 'Sign out',
      danger: true,
    );
    if (!ok || !mounted) return;
    repo.logout();
    Navigator.pushReplacementNamed(context, '/login');
  }

  @override
  Widget build(BuildContext context) {
    final repo = context.watch<MockRepository>();

    return Scaffold(
      appBar: AppBar(
        title: const Text('Settings'),
        leading: const BackButton(),
      ),
      body: SafeArea(
        child: ListView(
          padding: AppSpacing.page,
          children: [
            const SectionHeading(
              title: 'Theme & app',
              subtitle: 'Option 3 colourful gradient',
            ),
            AppSpacing.gapSm,
            _themeCard(),
            AppSpacing.gap,
            const SectionHeading(
              title: 'Server Connection',
              subtitle: 'Tailscale VPN, Cloudflare Tunnel, or Local LAN',
            ),
            AppSpacing.gapSm,
            _serverConnectionCard(),
            AppSpacing.gap,
            const SectionHeading(
              title: 'Notifications',
              subtitle: 'Demo preferences — stored locally only',
            ),
            AppSpacing.gapSm,
            _notificationsCard(),
            AppSpacing.gap,
            const SectionHeading(
              title: 'Role & permissions',
              subtitle: 'Owner vs Employee visibility',
            ),
            AppSpacing.gapSm,
            _permissionCard(),
            AppSpacing.gap,
            SectionHeading(
              title: 'Department assignment',
              subtitle: '${repo.employees.length} team members',
            ),
            AppSpacing.gapSm,
            _departmentsCard(repo),
            AppSpacing.gap,
            const DemoNotice(
              text:
                  'Notification switches and this permission overview are demo UI. '
                  'No real alarms, sounds or push delivery are wired yet, and role '
                  'visibility here only filters the interface — it is not security.',
            ),
            AppSpacing.gap,
            GradientButton(
              label: 'Sign out',
              icon: Icons.logout_rounded,
              gradient: AppGradients.danger,
              onPressed: _logout,
            ),
          ],
        ),
      ),
    );
  }

  Widget _themeCard() => WhitePanel(
    padding: const EdgeInsets.all(16),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 9,
          runSpacing: 9,
          children: [
            _chip('Brand', AppGradients.brand),
            _chip('Sales', AppGradients.sales),
            _chip('Payment', AppGradients.payment),
            _chip('Area', AppGradients.area),
            _chip('Tour', AppGradients.tour),
            _chip('Order', AppGradients.order),
            _chip('Task', AppGradients.task),
            _chip('Dispatch', AppGradients.dispatch),
          ],
        ),
        const SizedBox(height: 16),
        const InfoRow(label: 'App version', value: 'v0.1.0 demo'),
        const InfoRow(label: 'Theme', value: 'Option 3 • colourful gradient'),
        const InfoRow(
          label: 'Surfaces',
          value: 'Blue, purple, orange, teal, pink',
        ),
      ],
    ),
  );

  Widget _serverConnectionCard() {
    final current = ApiSyncService.currentHost ?? 'Auto (LAN / Localhost)';
    return WhitePanel(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.cloud_sync_rounded, color: AppColors.blue, size: 20),
              SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Active Backend Host',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppColors.ink),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            current,
            style: const TextStyle(fontFamily: 'monospace', fontSize: 13, color: AppColors.blue, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 12),
          const Text(
            'Connect from anywhere using your Tailscale IP (e.g. http://100.x.y.z:8010) or Cloudflare Tunnel (https://xxx.trycloudflare.com).',
            style: TextStyle(fontSize: 12, color: AppColors.muted),
          ),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            icon: const Icon(Icons.edit_location_alt_rounded, size: 16),
            label: const Text('Change Server Host'),
            onPressed: _showServerHostDialog,
          ),
        ],
      ),
    );
  }

  void _showServerHostDialog() {
    final controller = TextEditingController(text: ApiSyncService.userCustomHost ?? '');
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Configure Backend Host'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Enter Tailscale IP or Cloud URL:',
              style: TextStyle(fontSize: 13),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: controller,
              decoration: const InputDecoration(
                hintText: 'e.g. http://100.85.12.34:8010',
                border: OutlineInputBorder(),
                isDense: true,
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'Leave blank for auto-detection.',
              style: TextStyle(fontSize: 11, color: Colors.grey),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () {
              ApiSyncService.setCustomHost(controller.text);
              Navigator.pop(ctx);
              setState(() {});
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text('Server endpoint updated to: ${ApiSyncService.currentHost ?? "Auto"}')),
              );
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
  }

  Widget _notificationsCard() => WhitePanel(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
    child: Column(
      children: [
        SwitchListTile(
          value: _orderUpdates,
          onChanged: (v) => setState(() => _orderUpdates = v),
          secondary: const Icon(
            Icons.receipt_long_rounded,
            color: AppColors.blue,
          ),
          title: const Text(
            'Order updates',
            style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5),
          ),
          subtitle: const Text(
            'New orders & approvals',
            style: TextStyle(fontSize: 11.5, color: AppColors.muted),
          ),
        ),
        SwitchListTile(
          value: _dispatchReminders,
          onChanged: (v) => setState(() => _dispatchReminders = v),
          secondary: const Icon(
            Icons.local_shipping_rounded,
            color: AppColors.teal,
          ),
          title: const Text(
            'Dispatch reminders',
            style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5),
          ),
          subtitle: const Text(
            'Pending consignment nudges',
            style: TextStyle(fontSize: 11.5, color: AppColors.muted),
          ),
        ),
        SwitchListTile(
          value: _taskDueAlerts,
          onChanged: (v) => setState(() => _taskDueAlerts = v),
          secondary: const Icon(Icons.alarm_rounded, color: AppColors.orange),
          title: const Text(
            'Task due alerts',
            style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5),
          ),
          subtitle: const Text(
            'Toggle reflects a saved preference only (demo)',
            style: TextStyle(fontSize: 11.5, color: AppColors.muted),
          ),
        ),
      ],
    ),
  );

  Widget _permissionCard() => WhitePanel(
    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
    child: Column(
      children: [
        const Padding(
          padding: EdgeInsets.only(bottom: 6),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  'Module',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w900,
                    color: AppColors.muted,
                  ),
                ),
              ),
              SizedBox(
                width: 60,
                child: Text(
                  'Owner',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w900,
                    color: AppColors.purple,
                  ),
                ),
              ),
              SizedBox(
                width: 60,
                child: Text(
                  'Employee',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w900,
                    color: AppColors.blue,
                  ),
                ),
              ),
            ],
          ),
        ),
        for (final row in _permissionRows)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    row.module,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: AppColors.ink,
                    ),
                  ),
                ),
                SizedBox(width: 60, child: Center(child: _tick(row.owner))),
                SizedBox(width: 60, child: Center(child: _tick(row.employee))),
              ],
            ),
          ),
      ],
    ),
  );

  Widget _departmentsCard(MockRepository repo) => WhitePanel(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
    child: Column(
      children: [
        for (var i = 0; i < repo.employees.length; i++) ...[
          ListTile(
            dense: true,
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 10,
              vertical: 2,
            ),
            leading: AvatarCircle(name: repo.employees[i].name, size: 36),
            title: Text(
              repo.employees[i].name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontWeight: FontWeight.w800,
                fontSize: 13.5,
                color: AppColors.ink,
              ),
            ),
            subtitle: Text(
              '${repo.employees[i].role} • ${repo.employees[i].department}',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 11.5, color: AppColors.muted),
            ),
            trailing: Text(
              qtyLabel(repo.employees[i].monthlyTargetQty, 'MT'),
              style: const TextStyle(
                fontSize: 11.5,
                fontWeight: FontWeight.w800,
                color: AppColors.purple,
              ),
            ),
          ),
          if (i != repo.employees.length - 1)
            const Divider(height: 1, indent: 56, color: AppColors.line),
        ],
      ],
    ),
  );

  Widget _chip(String label, Gradient gradient) => Container(
    width: 78,
    height: 46,
    alignment: Alignment.centerLeft,
    padding: const EdgeInsets.symmetric(horizontal: 10),
    decoration: BoxDecoration(
      gradient: gradient,
      borderRadius: BorderRadius.circular(13),
    ),
    child: Text(
      label,
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      style: const TextStyle(
        color: Colors.white,
        fontSize: 11,
        fontWeight: FontWeight.w800,
      ),
    ),
  );

  Widget _tick(bool allowed) => allowed
      ? Container(
          width: 22,
          height: 22,
          decoration: BoxDecoration(
            color: AppColors.green.withValues(alpha: .14),
            shape: BoxShape.circle,
          ),
          child: const Icon(
            Icons.check_rounded,
            size: 15,
            color: AppColors.green,
          ),
        )
      : Container(
          width: 22,
          height: 22,
          decoration: BoxDecoration(
            color: AppColors.faint.withValues(alpha: .18),
            shape: BoxShape.circle,
          ),
          child: const Icon(
            Icons.close_rounded,
            size: 15,
            color: AppColors.faint,
          ),
        );
}

class _PermissionRow {
  const _PermissionRow(this.module, this.owner, this.employee);
  final String module;
  final bool owner;
  final bool employee;
}
