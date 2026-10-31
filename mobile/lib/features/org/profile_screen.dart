import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/formatters.dart';
import '../../core/share_service.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import '../../data/mock_repository.dart';
import '../../data/models.dart';

/// Profile for the signed-in user: identity, mock-editable phone, live counts
/// and sign-out.
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  final _phoneFormKey = GlobalKey<FormState>();
  late final TextEditingController _phoneController;
  String _phone = '';

  @override
  void initState() {
    super.initState();
    final repo = context.read<MockRepository>();
    final user = repo.currentUser ?? repo.demoAccounts.first;
    _phone = user.phone.isEmpty ? 'Not provided' : user.phone;
    _phoneController = TextEditingController(text: user.phone);
  }

  @override
  void dispose() {
    _phoneController.dispose();
    super.dispose();
  }

  void _savePhone() {
    FocusScope.of(context).unfocus();
    if (!_phoneFormKey.currentState!.validate()) return;
    setState(() => _phone = _phoneController.text.trim());
    showDemoSnack(context, 'Demo profile updated — no backend sync');
  }

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

  String? _validatePhone(String? v) => Validation.mobile(v);

  @override
  Widget build(BuildContext context) {
    final repo = context.watch<MockRepository>();
    final user = repo.currentUser ?? repo.demoAccounts.first;
    final employeeId = user.employeeId;
    final employee = employeeId == null ? null : repo.employeeById(employeeId);
    final assignedTarget = employee?.monthlyTargetQty;
    final areasCount = employeeId == null
        ? 0
        : repo.areas.where((a) => a.salespersonId == employeeId).length;
    final openTasks = repo.tasks
        .where(
          (t) =>
              t.status != TaskStatus.completed &&
              (employeeId == null || t.assignedEmployeeId == employeeId),
        )
        .length;

    return Scaffold(
      appBar: AppBar(title: const Text('Profile'), leading: const BackButton()),
      body: SafeArea(
        child: ListView(
          padding: AppSpacing.page,
          children: [
            _hero(user),
            AppSpacing.gap,
            const SectionHeading(
              title: 'Account details',
              subtitle: 'Stored in the local demo session',
            ),
            AppSpacing.gapSm,
            WhitePanel(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              child: Column(
                children: [
                  InfoRow(label: 'Email', value: user.email),
                  InfoRow(label: 'Phone', value: _phone),
                  InfoRow(label: 'Employee ID', value: employeeId ?? '—'),
                  if (assignedTarget != null)
                    InfoRow(
                      label: 'Monthly Target',
                      value: qtyLabel(assignedTarget, 'MT'),
                    ),
                  InfoRow(label: 'Department', value: user.department),
                ],
              ),
            ),
            AppSpacing.gap,
            const SectionHeading(
              title: 'Edit contact',
              subtitle: 'Mock edit — nothing syncs to a backend',
            ),
            AppSpacing.gapSm,
            WhitePanel(
              padding: const EdgeInsets.all(16),
              child: Form(
                key: _phoneFormKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    TextFormField(
                      controller: _phoneController,
                      keyboardType: TextInputType.phone,
                      validator: _validatePhone,
                      decoration: const InputDecoration(
                        labelText: 'Mobile number',
                        hintText: '10–12 digits',
                        prefixIcon: Icon(
                          Icons.phone_rounded,
                          color: AppColors.teal,
                        ),
                      ),
                    ),
                    const SizedBox(height: 14),
                    GradientButton(
                      label: 'Save changes',
                      icon: Icons.save_rounded,
                      gradient: AppGradients.success,
                      onPressed: _savePhone,
                    ),
                  ],
                ),
              ),
            ),
            AppSpacing.gap,
            const SectionHeading(
              title: 'Workload',
              subtitle: 'Live from the demo repository',
            ),
            AppSpacing.gapSm,
            Row(
              children: [
                Expanded(
                  child: MetricCard(
                    title: 'Assigned Areas',
                    value: '$areasCount',
                    caption: 'Territories for you',
                    icon: Icons.map_rounded,
                    gradient: AppGradients.area,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: MetricCard(
                    title: 'Open Tasks',
                    value: '$openTasks',
                    caption: 'Not completed',
                    icon: Icons.task_alt_rounded,
                    gradient: AppGradients.task,
                  ),
                ),
              ],
            ),
            AppSpacing.gap,
            ActionPill(
              icon: Icons.settings_rounded,
              label: 'App settings',
              onTap: () => Navigator.pushNamed(context, '/settings'),
            ),
            AppSpacing.gap,
            GradientButton(
              label: 'Sign out',
              icon: Icons.logout_rounded,
              gradient: AppGradients.danger,
              onPressed: _logout,
            ),
            AppSpacing.gapSm,
            const DemoNotice(
              text:
                  'Profile fields are mock only. Saving updates the screen in-memory but never writes to a server, so this must not be treated as real account management.',
            ),
          ],
        ),
      ),
    );
  }

  Widget _hero(AppUser user) => Container(
    padding: const EdgeInsets.all(20),
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
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            AvatarCircle(
              name: user.name,
              size: 62,
              gradient: const LinearGradient(
                colors: [Colors.white, Color(0xFFEFF0FA)],
              ),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    user.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 19,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 10,
                          vertical: 5,
                        ),
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
                      const SizedBox(width: 8),
                      Flexible(
                        child: Text(
                          user.department,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Color(0xD9FFFFFF),
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 14),
        Text(
          user.email,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(color: Color(0xE6FFFFFF), fontSize: 12.5),
        ),
      ],
    ),
  );
}
