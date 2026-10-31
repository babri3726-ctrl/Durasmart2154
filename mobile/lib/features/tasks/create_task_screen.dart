import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/formatters.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import '../../data/mock_repository.dart';
import '../../data/models.dart';

/// Create Task — owner assigns a work task with a due alarm, priority and an
/// optional completion-photo requirement.
class CreateTaskScreen extends StatefulWidget {
  const CreateTaskScreen({super.key});

  @override
  State<CreateTaskScreen> createState() => _CreateTaskScreenState();
}

class _CreateTaskScreenState extends State<CreateTaskScreen> {
  static const _priorities = <String, TaskPriority>{
    'High — act today': TaskPriority.high,
    'Normal — this week': TaskPriority.normal,
    'Low — when free': TaskPriority.low,
  };

  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  final TextEditingController _title = TextEditingController();
  final TextEditingController _description = TextEditingController();

  String? _employeeId;
  TaskPriority _priority = TaskPriority.normal;
  bool _requiresPhoto = false;
  late DateTime _dueDate = DateTime.now().add(const Duration(days: 1));
  late TimeOfDay _dueTime = const TimeOfDay(hour: 10, minute: 0);

  @override
  void dispose() {
    _title.dispose();
    _description.dispose();
    super.dispose();
  }

  DateTime get _dueAt => DateTime(
    _dueDate.year,
    _dueDate.month,
    _dueDate.day,
    _dueTime.hour,
    _dueTime.minute,
  );

  bool get _dueInThePast => _dueAt.isBefore(DateTime.now());

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _dueDate,
      firstDate: DateTime(now.year - 1, now.month, now.day),
      lastDate: DateTime(now.year + 2, now.month, now.day),
    );
    if (picked == null || !mounted) return;
    setState(() => _dueDate = picked);
  }

  Future<void> _pickTime() async {
    final picked = await showTimePicker(
      context: context,
      initialTime: _dueTime,
    );
    if (picked == null || !mounted) return;
    setState(() => _dueTime = picked);
  }

  String _shareMessage(
    String taskTitle,
    String employeeName,
    DateTime dueAt,
    bool photoRequired,
  ) =>
      'TASK ALARM — $taskTitle\n\n'
      'Assigned to: $employeeName\n'
      'Due: ${dateTimeLabel(dueAt)}\n'
      'Priority: ${taskPriorityLabel(_priority)}\n'
      'Proof: ${photoRequired ? 'Completion photo required' : 'No photo required'}\n\n'
      'Please acknowledge the task in Dura Smart and update the status as you work.';

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    final employeeId = _employeeId;
    if (employeeId == null) return;
    final repo = context.read<MockRepository>();
    final employee = repo.employeeById(employeeId);
    final employeeName = employee?.name ?? employeeId;
    if (!mounted) return;
    final ok = await ConfirmDialog.show(
      context,
      title: 'Assign this task',
      message:
          '"${_title.text.trim()}" to $employeeName, due ${dateTimeLabel(_dueAt)}'
          '${_requiresPhoto ? ' with a completion photo' : ''}?',
      confirmLabel: 'Assign task',
    );
    if (!ok || !mounted) return;
    final task = repo.addTask(
      title: _title.text.trim(),
      assignedEmployeeId: employeeId,
      dueAt: _dueAt,
      description: _description.text.trim(),
      priority: _priority,
      requiresPhoto: _requiresPhoto,
    );
    if (!mounted) return;
    final backToTasks = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: Row(
          children: [
            const Icon(Icons.check_circle_rounded, color: AppColors.green),
            const SizedBox(width: 8),
            Expanded(
              child: Text('Task ${task.id} created', style: AppText.title),
            ),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              '${task.title}\nAssigned to $employeeName • due ${dateTimeLabel(task.dueAt)}',
              style: const TextStyle(fontSize: 13, height: 1.45),
            ),
            const SizedBox(height: 12),
            WhatsAppButton(
              label: 'Share with employee',
              phone: employee?.phone ?? '',
              message: _shareMessage(
                task.title,
                employeeName,
                task.dueAt,
                task.requiresPhoto,
              ),
            ),
            const SizedBox(height: 10),
            const DemoNotice(
              text:
                  'Sharing only opens WhatsApp with a drafted message — nothing is sent automatically.',
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Create another'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.purple),
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Back to tasks'),
          ),
        ],
      ),
    );
    if (backToTasks == true && mounted) {
      Navigator.of(
        context,
      ).pushNamedAndRemoveUntil('/tasks', ModalRoute.withName('/home'));
    }
  }

  @override
  Widget build(BuildContext context) {
    final repo = context.watch<MockRepository>();
    final employees = repo.employees;
    final selected = employees.where((e) => e.id == _employeeId).toList();
    final dueLabel = '${dateLabel(_dueDate)} • ${_dueTime.format(context)}';

    return Scaffold(
      appBar: AppBar(title: const Text('Create Task')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: AppSpacing.page,
          children: [
            const DemoNotice(
              text:
                  'Task alarms are simulated in this build: due dates drive the Overdue list, but no device notification is scheduled yet.',
            ),
            const SizedBox(height: 14),
            WhitePanel(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SectionHeading(title: 'What needs to be done'),
                  const SizedBox(height: 10),
                  TextFormField(
                    controller: _title,
                    textCapitalization: TextCapitalization.sentences,
                    decoration: const InputDecoration(
                      labelText: 'Task title *',
                      hintText: 'Collect balance from Gupta Steel Traders',
                    ),
                    validator: (value) =>
                        Validation.required(value, field: 'Task title'),
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _description,
                    minLines: 3,
                    maxLines: 6,
                    textCapitalization: TextCapitalization.sentences,
                    decoration: const InputDecoration(
                      labelText: 'Description',
                      alignLabelWithHint: true,
                      hintText:
                          'Explain the context so the employee can act without calling back.',
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            WhitePanel(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SectionHeading(title: 'Who and when'),
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    initialValue: _employeeId,
                    isExpanded: true,
                    decoration: const InputDecoration(
                      labelText: 'Assign employee *',
                    ),
                    items: [
                      for (final emp in employees)
                        DropdownMenuItem<String>(
                          value: emp.id,
                          child: Text(
                            '${emp.name} • ${emp.department}',
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                    ],
                    onChanged: (value) => setState(() => _employeeId = value),
                    validator: (value) =>
                        Validation.required(value, field: 'Employee'),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: _PickerTile(
                          icon: Icons.event_rounded,
                          label: 'Due date',
                          value: dateLabel(_dueDate),
                          onTap: _pickDate,
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: _PickerTile(
                          icon: Icons.alarm_rounded,
                          label: 'Due time',
                          value: _dueTime.format(context),
                          onTap: _pickTime,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    initialValue: _priorityKey(_priority),
                    isExpanded: true,
                    decoration: const InputDecoration(labelText: 'Priority'),
                    items: [
                      for (final entry in _priorities.entries)
                        DropdownMenuItem<String>(
                          value: entry.key,
                          child: Text(entry.key),
                        ),
                    ],
                    onChanged: (value) => setState(
                      () =>
                          _priority = _priorities[value] ?? TaskPriority.normal,
                    ),
                  ),
                  const SizedBox(height: 8),
                  SwitchListTile(
                    value: _requiresPhoto,
                    onChanged: (value) =>
                        setState(() => _requiresPhoto = value),
                    contentPadding: EdgeInsets.zero,
                    title: const Text(
                      'Completion photo required',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    subtitle: Text(
                      selected.isEmpty
                          ? 'The employee must attach a photo before closing.'
                          : 'Photo proof will be demanded from ${selected.first.name}.',
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            WhitePanel(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SectionHeading(title: 'Summary'),
                  const SizedBox(height: 4),
                  InfoRow(label: 'Due alarm', value: dueLabel),
                  InfoRow(
                    label: 'Priority',
                    value: taskPriorityLabel(_priority),
                    valueColor: _priority == TaskPriority.high
                        ? AppColors.red
                        : AppColors.ink,
                  ),
                  InfoRow(
                    label: 'Assignee',
                    value: selected.isEmpty
                        ? 'Not selected'
                        : selected.first.name,
                  ),
                  InfoRow(
                    label: 'Proof',
                    value: _requiresPhoto ? 'Photo required' : 'Not required',
                  ),
                  if (_dueInThePast) ...[
                    const SizedBox(height: 8),
                    const Row(
                      children: [
                        Icon(
                          Icons.warning_amber_rounded,
                          size: 16,
                          color: AppColors.orange,
                        ),
                        SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            'This due time is already in the past, so the task will open as overdue.',
                            style: TextStyle(
                              fontSize: 11.5,
                              color: AppColors.orange,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(height: 16),
            GradientButton(
              label: 'Assign task',
              icon: Icons.send_rounded,
              onPressed: _submit,
            ),
            const SizedBox(height: 10),
            ActionPill(
              icon: Icons.chevron_left_rounded,
              label: 'Back to task board',
              onTap: () => Navigator.of(context).pop(),
            ),
            const SizedBox(height: 18),
          ],
        ),
      ),
    );
  }
}

String _priorityKey(TaskPriority priority) => switch (priority) {
  TaskPriority.high => 'High — act today',
  TaskPriority.normal => 'Normal — this week',
  TaskPriority.low => 'Low — when free',
};

class _PickerTile extends StatelessWidget {
  const _PickerTile({
    required this.icon,
    required this.label,
    required this.value,
    required this.onTap,
  });
  final IconData icon;
  final String label;
  final String value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    borderRadius: BorderRadius.circular(AppRadius.field),
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppRadius.field),
        border: Border.all(color: AppColors.line),
      ),
      child: Row(
        children: [
          Icon(icon, size: 18, color: AppColors.purple),
          const SizedBox(width: 9),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: const TextStyle(
                    fontSize: 10.5,
                    color: AppColors.muted,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w900,
                    color: AppColors.ink,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    ),
  );
}
