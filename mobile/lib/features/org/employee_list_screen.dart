import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/formatters.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import '../../data/mock_repository.dart';
import '../../data/models.dart';

// Department chip option that clears the department filter.
const String _allDepartmentsLabel = 'All departments';

/// Employee directory. Sales rows carry the live month target versus achieved
/// quantity; every row opens the employee profile with their book of work.
class EmployeeListScreen extends StatefulWidget {
  const EmployeeListScreen({super.key});

  @override
  State<EmployeeListScreen> createState() => _EmployeeListScreenState();
}

class _EmployeeListScreenState extends State<EmployeeListScreen> {
  final TextEditingController _searchController = TextEditingController();
  String _query = '';
  String _department = _allDepartmentsLabel;

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  static bool _isSales(Employee employee) =>
      employee.department.toLowerCase() == 'sales';

  List<String> _departments(MockRepository repo) {
    final names = repo.employees.map((e) => e.department).toSet().toList()
      ..sort();
    return <String>[_allDepartmentsLabel, ...names];
  }

  bool _matches(Employee employee, String needle) {
    if (needle.isEmpty) return true;
    return employee.name.toLowerCase().contains(needle) ||
        employee.role.toLowerCase().contains(needle) ||
        employee.department.toLowerCase().contains(needle) ||
        employee.city.toLowerCase().contains(needle) ||
        employee.email.toLowerCase().contains(needle) ||
        employee.id.toLowerCase().contains(needle) ||
        employee.phone.contains(needle);
  }

  List<Employee> _visible(MockRepository repo) {
    final needle = _query.trim().toLowerCase();
    final list = repo.employees.where((e) {
      final departmentOk =
          _department == _allDepartmentsLabel || e.department == _department;
      return departmentOk && _matches(e, needle);
    }).toList();
    list.sort((a, b) {
      final byDepartment = a.department.compareTo(b.department);
      return byDepartment != 0 ? byDepartment : a.name.compareTo(b.name);
    });
    return list;
  }

  Widget _hero(int total, int sales, int departments) => GradientHero(
    height: 148,
    gradient: AppGradients.employee,
    child: Column(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'TEAM',
                    style: TextStyle(
                      color: Colors.white70,
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 1.2,
                    ),
                  ),
                  SizedBox(height: 4),
                  Text(
                    'Employees',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 16,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ],
              ),
            ),
            Icon(Icons.badge_rounded, color: Colors.white, size: 26),
          ],
        ),
        Row(
          children: [
            Expanded(
              child: _HeaderStat(label: 'Team size', count: total),
            ),
            Expanded(
              child: _HeaderStat(label: 'Sales force', count: sales),
            ),
            Expanded(
              child: _HeaderStat(label: 'Departments', count: departments),
            ),
          ],
        ),
      ],
    ),
  );

  Widget _card(MockRepository repo, Employee employee) {
    final sales = _isSales(employee);
    final metrics = sales
        ? repo.salesMetrics(salespersonId: employee.id)
        : null;
    final customerCount = sales
        ? repo.customersForSalesperson(employee.id).length
        : 0;
    final openTasks = repo.tasks
        .where(
          (t) =>
              t.assignedEmployeeId == employee.id &&
              t.status != TaskStatus.completed,
        )
        .length;
    return WhitePanel(
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => EmployeeDetailScreen(employeeId: employee.id),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              AvatarCircle(
                name: employee.name,
                size: 46,
                gradient: AppGradients.employee,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      employee.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      employee.role,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppText.caption,
                    ),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        const Icon(
                          Icons.storefront_rounded,
                          size: 13,
                          color: AppColors.muted,
                        ),
                        const SizedBox(width: 4),
                        Flexible(
                          child: Text(
                            '${employee.department} • ${employee.city}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: AppText.caption,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        const Icon(
                          Icons.phone_rounded,
                          size: 13,
                          color: AppColors.muted,
                        ),
                        const SizedBox(width: 4),
                        Text(
                          employee.phone,
                          style: const TextStyle(
                            fontSize: 11.5,
                            fontWeight: FontWeight.w800,
                            color: AppColors.navy,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                mainAxisSize: MainAxisSize.min,
                children: [
                  StatusChip(
                    label: employee.active ? 'Active' : 'Inactive',
                    color: employee.active ? AppColors.green : AppColors.red,
                  ),
                  const SizedBox(height: 6),
                  Text(
                    employee.id,
                    style: const TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w800,
                      color: AppColors.faint,
                    ),
                  ),
                ],
              ),
            ],
          ),
          if (metrics != null) ...[
            const SizedBox(height: 13),
            ProgressRow(
              label:
                  'Month target ${qtyLabel(metrics.achievedQty, 'MT')} of ${qtyLabel(metrics.targetQty, 'MT')}',
              value: metrics.achievedQty,
              max: metrics.targetQty,
              color: AppColors.teal,
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 7,
              runSpacing: 7,
              children: [
                StatusChip(
                  label:
                      '${metrics.achievementPercent.toStringAsFixed(0)}% achieved',
                  color: AppColors.blue,
                ),
                StatusChip(
                  label: '${metrics.ordersReceived} orders',
                  color: AppColors.purple,
                ),
                StatusChip(
                  label: '$customerCount customers',
                  color: AppColors.teal,
                ),
                if (openTasks > 0)
                  StatusChip(
                    label: '$openTasks open tasks',
                    color: AppColors.orange,
                  ),
              ],
            ),
          ] else ...[
            const SizedBox(height: 11),
            Text(
              'Operations role — no sales target is set for ${employee.name}.',
              style: AppText.caption,
            ),
            const SizedBox(height: 4),
            Wrap(
              spacing: 7,
              runSpacing: 7,
              children: [
                StatusChip(
                  label: '$openTasks open tasks',
                  color: openTasks > 0 ? AppColors.orange : AppColors.muted,
                ),
                const StatusChip(
                  label: 'Support role',
                  color: AppColors.purple,
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final repo = context.watch<MockRepository>();
    final user = repo.currentUser;
    final isOwner = user?.isOwner ?? true;
    final rows = _visible(repo);
    final departments = repo.employees.map((e) => e.department).toSet().length;
    final salesCount = repo.employees.where(_isSales).length;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Employees'),
        actions: [
          IconButton(
            tooltip: 'Open task dashboard',
            onPressed: () => Navigator.of(context).pushNamed('/tasks'),
            icon: const Icon(Icons.alarm_rounded),
          ),
        ],
      ),
      body: SafeArea(
        child: ListView(
          padding: AppSpacing.page,
          children: [
            _hero(repo.employees.length, salesCount, departments),
            const SizedBox(height: 14),
            SearchField(
              hint: 'Search name, role, city, mobile or ID',
              controller: _searchController,
              onChanged: (value) => setState(() => _query = value),
            ),
            const SizedBox(height: 12),
            FilterChipsRow(
              options: _departments(repo),
              selected: _department,
              onSelected: (option) => setState(() => _department = option),
            ),
            const SizedBox(height: 12),
            DemoNotice(
              text: isOwner
                  ? 'Employee records come from the demo data set. Targets update as orders are booked against each salesperson.'
                  : 'Team directory is read-only for employee accounts. Contact a colleague on WhatsApp to coordinate.',
            ),
            const SizedBox(height: 12),
            if (rows.isEmpty)
              WhitePanel(
                child: EmptyState(
                  icon: Icons.person_search_rounded,
                  title: 'No employee matches',
                  subtitle:
                      'Clear the search text or pick another department to see the full team.',
                  action: ActionPill(
                    icon: Icons.filter_alt_off_rounded,
                    label: 'Reset filters',
                    onTap: () {
                      _searchController.clear();
                      setState(() {
                        _query = '';
                        _department = _allDepartmentsLabel;
                      });
                    },
                  ),
                ),
              )
            else
              for (final employee in rows) ...[
                _card(repo, employee),
                const SizedBox(height: 12),
              ],
            const SizedBox(height: 4),
          ],
        ),
      ),
    );
  }
}

class _HeaderStat extends StatelessWidget {
  const _HeaderStat({required this.label, required this.count});

  final String label;
  final int count;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        '$count',
        style: const TextStyle(
          color: Colors.white,
          fontSize: 22,
          fontWeight: FontWeight.w900,
          height: 1,
        ),
      ),
      const SizedBox(height: 3),
      Text(
        label,
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(
          color: Colors.white70,
          fontSize: 10,
          fontWeight: FontWeight.w700,
        ),
      ),
    ],
  );
}

/// One employee: profile, book of work, assigned areas and open tasks.
class EmployeeDetailScreen extends StatelessWidget {
  const EmployeeDetailScreen({super.key, required this.employeeId});

  final String employeeId;

  static String _taskStatusLabel(TaskStatus status) => switch (status) {
    TaskStatus.open => 'Open',
    TaskStatus.acknowledged => 'Acknowledged',
    TaskStatus.completed => 'Completed',
  };

  static Color _taskStatusColor(TaskStatus status) => switch (status) {
    TaskStatus.open => AppColors.orange,
    TaskStatus.acknowledged => AppColors.blue,
    TaskStatus.completed => AppColors.green,
  };

  String _contactMessage(Employee employee) =>
      'Hello ${employee.name},\n\n'
      'This is a message from Dura Smart regarding your work as ${employee.role}.\n'
      'Please share the update at your earliest convenience.';

  Widget _hero(Employee employee, String areaCountLabel) => GradientHero(
    height: 168,
    gradient: AppGradients.employee,
    child: Column(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            AvatarCircle(
              name: employee.name,
              size: 46,
              gradient: AppGradients.brand,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    employee.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 16,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    '${employee.role} • ${employee.department}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Colors.white70,
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    '${employee.city.isEmpty ? 'City not set' : employee.city} • $areaCountLabel',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Colors.white70,
                      fontSize: 10.5,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        Row(
          children: [
            Expanded(
              child: _HeroFact(label: 'Employee ID', value: employee.id),
            ),
            Expanded(
              child: _HeroFact(label: 'Mobile', value: employee.phone),
            ),
            Expanded(
              child: _HeroFact(
                label: 'Target',
                value: qtyLabel(employee.monthlyTargetQty, 'MT'),
              ),
            ),
          ],
        ),
      ],
    ),
  );

  @override
  Widget build(BuildContext context) {
    final repo = context.watch<MockRepository>();
    final employee = repo.employeeById(employeeId);
    final user = repo.currentUser;
    final isOwner = user?.isOwner ?? true;

    return Scaffold(
      appBar: AppBar(title: const Text('Employee profile')),
      body: SafeArea(
        child: employee == null
            ? EmptyState(
                icon: Icons.person_off_rounded,
                title: 'Employee not found',
                subtitle: 'This record is not in the demo data set.',
                action: ActionPill(
                  icon: Icons.arrow_back_rounded,
                  label: 'Back to employees',
                  onTap: () => Navigator.of(context).pop(),
                ),
              )
            : _body(context, repo, employee, isOwner),
      ),
    );
  }

  Widget _body(
    BuildContext context,
    MockRepository repo,
    Employee employee,
    bool isOwner,
  ) {
    final sales = employee.department.toLowerCase() == 'sales';
    final metrics = sales
        ? repo.salesMetrics(salespersonId: employee.id)
        : null;
    final customers = repo.customersForSalesperson(employee.id);
    final employeeTasks =
        repo.tasks.where((t) => t.assignedEmployeeId == employee.id).toList()
          ..sort((a, b) => b.dueAt.compareTo(a.dueAt));
    final openTasks = employeeTasks
        .where((t) => t.status != TaskStatus.completed)
        .toList();
    final completedTasks = employeeTasks
        .where((t) => t.status == TaskStatus.completed)
        .toList();
    final areas = repo.areas
        .where((a) => a.salespersonId == employee.id)
        .toList();
    final tours = repo.tours
        .where((t) => t.salespersonId == employee.id)
        .toList();

    return ListView(
      padding: AppSpacing.page,
      children: [
        _hero(
          employee,
          '${areas.length} assigned ${areas.length == 1 ? 'area' : 'areas'}',
        ),
        const SizedBox(height: 14),
        WhitePanel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SectionHeading(title: 'Profile'),
              const SizedBox(height: 6),
              InfoRow(label: 'Employee ID', value: employee.id),
              InfoRow(label: 'Name', value: employee.name),
              InfoRow(label: 'Role', value: employee.role),
              InfoRow(label: 'Department', value: employee.department),
              InfoRow(
                label: 'City',
                value: employee.city.isEmpty ? 'Not recorded' : employee.city,
              ),
              InfoRow(label: 'Mobile', value: employee.phone),
              InfoRow(
                label: 'Email',
                value: employee.email.isEmpty ? 'Not recorded' : employee.email,
              ),
              InfoRow(
                label: 'Monthly target',
                value: qtyLabel(employee.monthlyTargetQty, 'MT'),
              ),
              InfoRow(
                label: 'Status',
                value: employee.active ? 'Active' : 'Inactive',
                valueColor: employee.active ? AppColors.green : AppColors.red,
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        WhitePanel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SectionHeading(
                title: 'Book of work',
                subtitle: 'Counts read live from the demo data',
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: _CountTile(
                      label: 'Customers',
                      count: customers.length,
                      icon: Icons.groups_rounded,
                    ),
                  ),
                  const SizedBox(width: 9),
                  Expanded(
                    child: _CountTile(
                      label: 'Open tasks',
                      count: openTasks.length,
                      icon: Icons.alarm_on_rounded,
                    ),
                  ),
                  const SizedBox(width: 9),
                  Expanded(
                    child: _CountTile(
                      label: 'Completed',
                      count: completedTasks.length,
                      icon: Icons.task_alt_rounded,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 9),
              Row(
                children: [
                  Expanded(
                    child: _CountTile(
                      label: 'Areas',
                      count: areas.length,
                      icon: Icons.map_rounded,
                    ),
                  ),
                  const SizedBox(width: 9),
                  Expanded(
                    child: _CountTile(
                      label: 'Tour plans',
                      count: tours.length,
                      icon: Icons.route_rounded,
                    ),
                  ),
                  const Expanded(child: SizedBox()),
                ],
              ),
              if (metrics != null) ...[
                const SizedBox(height: 14),
                ProgressRow(
                  label:
                      '${monthLabel(metrics.month)} target ${qtyLabel(metrics.achievedQty, 'MT')} of ${qtyLabel(metrics.targetQty, 'MT')}',
                  value: metrics.achievedQty,
                  max: metrics.targetQty,
                  color: AppColors.teal,
                ),
                const SizedBox(height: 10),
                Wrap(
                  spacing: 7,
                  runSpacing: 7,
                  children: [
                    StatusChip(
                      label:
                          '${metrics.achievementPercent.toStringAsFixed(0)}% achieved',
                      color: AppColors.blue,
                    ),
                    StatusChip(
                      label: '${metrics.ordersReceived} orders this month',
                      color: AppColors.purple,
                    ),
                    StatusChip(
                      label:
                          '${metrics.pendingTargetQty.toStringAsFixed(1)} MT pending',
                      color: AppColors.orange,
                    ),
                    StatusChip(
                      label:
                          '${metrics.ordersPendingCount} orders awaiting dispatch',
                      color: AppColors.teal,
                    ),
                  ],
                ),
              ],
              if (areas.isNotEmpty) ...[
                const SizedBox(height: 12),
                const Text('Assigned areas', style: AppText.body),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 7,
                  runSpacing: 7,
                  children: [
                    for (final area in areas)
                      ActionPill(
                        icon: Icons.place_rounded,
                        label: area.name,
                        onTap: () => Navigator.of(context).pushNamed('/areas'),
                      ),
                  ],
                ),
              ],
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  ActionPill(
                    icon: Icons.people_alt_rounded,
                    label: 'Customer list',
                    onTap: () => Navigator.of(context).pushNamed('/customers'),
                  ),
                  ActionPill(
                    icon: Icons.route_rounded,
                    label: 'Tour plans',
                    onTap: () => Navigator.of(context).pushNamed('/tours'),
                  ),
                  ActionPill(
                    icon: Icons.alarm_rounded,
                    label: 'Task dashboard',
                    onTap: () => Navigator.of(context).pushNamed('/tasks'),
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
              SectionHeading(
                title: 'Open tasks',
                subtitle: openTasks.isEmpty
                    ? 'Nothing pending right now'
                    : '${openTasks.length} to follow up',
              ),
              const SizedBox(height: 10),
              if (openTasks.isEmpty)
                const Text(
                  'All assigned tasks are closed for this employee.',
                  style: TextStyle(fontSize: 12, color: AppColors.muted),
                )
              else
                for (final task in openTasks)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 9),
                    child: WhitePanel(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 13,
                        vertical: 12,
                      ),
                      onTap: () => Navigator.of(context).pushNamed(
                        '/task',
                        arguments: <String, String>{'taskId': task.id},
                      ),
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  task.title,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    fontSize: 12.5,
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  'Due ${relativeDay(task.dueAt)} at ${timeLabel(task.dueAt)}',
                                  style: AppText.caption,
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(width: 8),
                          StatusChip(
                            label: _taskStatusLabel(task.status),
                            color: _taskStatusColor(task.status),
                          ),
                        ],
                      ),
                    ),
                  ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        WhatsAppButton(
          label: 'WhatsApp ${employee.name.split(' ').first}',
          phone: employee.phone,
          message: _contactMessage(employee),
        ),
        const SizedBox(height: 12),
        DemoNotice(
          text: isOwner
              ? 'Owner view is read-only — employee master data is maintained in the office system.'
              : 'Colleague profile, visible to the team for coordination only.',
        ),
        const SizedBox(height: 14),
        ActionPill(
          icon: Icons.arrow_back_rounded,
          label: 'Back to employees',
          onTap: () => Navigator.of(context).pop(),
        ),
        const SizedBox(height: 8),
      ],
    );
  }
}

class _HeroFact extends StatelessWidget {
  const _HeroFact({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        label,
        style: const TextStyle(
          color: Colors.white70,
          fontSize: 9.5,
          fontWeight: FontWeight.w800,
          letterSpacing: .6,
        ),
      ),
      const SizedBox(height: 2),
      Text(
        value,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(
          color: Colors.white,
          fontSize: 12,
          fontWeight: FontWeight.w900,
        ),
      ),
    ],
  );
}

class _CountTile extends StatelessWidget {
  const _CountTile({
    required this.label,
    required this.count,
    required this.icon,
  });

  final String label;
  final int count;
  final IconData icon;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 12),
    decoration: BoxDecoration(
      color: const Color(0xFFF3F5FC),
      borderRadius: BorderRadius.circular(14),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(icon, size: 15, color: AppColors.purple),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                '$count',
                style: const TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w900,
                  color: AppColors.navy,
                  height: 1,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 5),
        Text(
          label,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            fontSize: 10,
            color: AppColors.muted,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    ),
  );
}
