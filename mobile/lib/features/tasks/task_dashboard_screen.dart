import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../../core/formatters.dart';
import '../../core/share_service.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import '../../data/mock_repository.dart';
import '../../data/models.dart';

/// Task Alarm — role aware task board. Owner gets the workload summary and the
/// creation / proof-review entries; an employee gets their own day buckets
/// (Today, Pending, Overdue, Completed) with audible & vibrate alarm triggers.
class TaskDashboardScreen extends StatefulWidget {
  const TaskDashboardScreen({super.key});

  @override
  State<TaskDashboardScreen> createState() => _TaskDashboardScreenState();
}

class _TaskDashboardScreenState extends State<TaskDashboardScreen> {
  static const _statusFilters = <String>[
    'All',
    'Open',
    'Acknowledged',
    'Completed',
    'Overdue',
  ];
  static const _priorityFilters = <String>[
    'Any priority',
    'High',
    'Normal',
    'Low',
  ];

  String _status = 'All';
  String _priority = 'Any priority';
  Timer? _alarmTimer;
  final Set<String> _rungTaskIds = <String>{};
  bool _isSyncing = false;
  bool _alarmDialogShowing = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _syncAndCheck();
    });
    // Periodic check every 15 seconds for tasks whose time is up
    _alarmTimer = Timer.periodic(const Duration(seconds: 15), (_) {
      _checkAlarms();
    });
  }

  @override
  void dispose() {
    _alarmTimer?.cancel();
    _alarmTimer = null;
    super.dispose();
  }

  Future<void> _syncAndCheck() async {
    if (!mounted) return;
    setState(() => _isSyncing = true);
    final repo = Provider.of<MockRepository>(context, listen: false);
    await repo.syncTasksFromBackend();
    if (mounted) {
      setState(() => _isSyncing = false);
      _checkAlarms();
    }
  }

  void _checkAlarms() {
    if (!mounted || _alarmDialogShowing) return;
    final repo = Provider.of<MockRepository>(context, listen: false);
    final user = repo.currentUser;
    final myEmployeeId = user?.employeeId;
    final now = DateTime.now();

    final alarmCandidates = repo.tasks.where((t) {
      if (t.status == TaskStatus.completed) return false;
      if (myEmployeeId != null && t.assignedEmployeeId != myEmployeeId) {
        return false;
      }
      return t.dueAt.isBefore(now);
    }).toList();

    for (final task in alarmCandidates) {
      if (!_rungTaskIds.contains(task.id)) {
        _rungTaskIds.add(task.id);
        _triggerAlarm(task);
        break; // Show one alarm at a time
      }
    }
  }

  Future<void> _triggerAlarm(WorkTask task, {bool isTest = false}) async {
    _alarmDialogShowing = true;
    // Play audible chime and trigger haptic vibration pulses
    for (var i = 0; i < 3; i++) {
      HapticFeedback.heavyImpact();
      SystemSound.play(SystemSoundType.alert);
      await Future.delayed(const Duration(milliseconds: 350));
    }

    if (!mounted) {
      _alarmDialogShowing = false;
      return;
    }

    final repo = Provider.of<MockRepository>(context, listen: false);

    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        actionsOverflowButtonSpacing: 6,
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: AppColors.red.withValues(alpha: 0.12),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.alarm_on_rounded, color: AppColors.red, size: 28),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                isTest ? '🔔 Test Alarm Triggered' : '🚨 TASK ALARM: Time Up!',
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w900,
                  color: AppColors.red,
                ),
              ),
            ),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              task.title,
              style: const TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w800,
                color: AppColors.ink,
              ),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                const Icon(Icons.access_time_rounded, size: 15, color: AppColors.muted),
                const SizedBox(width: 4),
                Expanded(
                  child: Text(
                    'Due: ${dateLabel(task.dueAt)} at ${timeLabel(task.dueAt)}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: AppColors.red,
                    ),
                  ),
                ),
              ],
            ),
            if (task.description.trim().isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(
                task.description.trim(),
                style: const TextStyle(fontSize: 12, color: AppColors.muted),
              ),
            ],
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: const Color(0xFFFFF1F2),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: const Color(0xFFFECDD3)),
              ),
              child: const Row(
                children: [
                  Icon(Icons.vibration_rounded, size: 16, color: AppColors.red),
                  SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      'Audible chime & phone vibration fired. Please complete or acknowledge your assignment.',
                      style: TextStyle(
                        fontSize: 11,
                        color: Color(0xFF9F1239),
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () {
              Navigator.pop(ctx);
              _acknowledge(repo, task);
            },
            child: const Text('Acknowledge'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.green),
            onPressed: () {
              Navigator.pop(ctx);
              _complete(repo, task);
            },
            child: const Text('Mark Complete'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Dismiss', style: TextStyle(color: AppColors.muted)),
          ),
        ],
      ),
    );

    _alarmDialogShowing = false;
  }

  void _testAlarm() {
    final repo = Provider.of<MockRepository>(context, listen: false);
    final sampleTask = repo.tasks.isNotEmpty
        ? repo.tasks.first
        : WorkTask(
            id: 'TEST-ALARM',
            title: 'Sample Task Due Alarm',
            description: 'This is a test alarm demonstrating audible chime and phone vibration.',
            assignedEmployeeId: repo.currentUser?.employeeId ?? 'EMP-01',
            dueAt: DateTime.now(),
            priority: TaskPriority.high,
          );
    _triggerAlarm(sampleTask, isTest: true);
  }

  Color _statusColor(TaskStatus status) => switch (status) {
    TaskStatus.open => AppColors.blue,
    TaskStatus.acknowledged => AppColors.orange,
    TaskStatus.completed => AppColors.green,
  };

  String _statusLabel(TaskStatus status) => switch (status) {
    TaskStatus.open => 'Open',
    TaskStatus.acknowledged => 'Acknowledged',
    TaskStatus.completed => 'Completed',
  };

  Color _priorityColor(TaskPriority priority) => switch (priority) {
    TaskPriority.high => AppColors.red,
    TaskPriority.normal => AppColors.purple,
    TaskPriority.low => AppColors.muted,
  };

  List<WorkTask> _ownerTasks(MockRepository repo) {
    final now = DateTime.now();
    return repo.tasks.where((task) {
      final matchesStatus = switch (_status) {
        'Open' => task.status == TaskStatus.open,
        'Acknowledged' => task.status == TaskStatus.acknowledged,
        'Completed' => task.status == TaskStatus.completed,
        'Overdue' =>
          task.status != TaskStatus.completed && task.dueAt.isBefore(now),
        _ => true,
      };
      final matchesPriority = switch (_priority) {
        'High' => task.priority == TaskPriority.high,
        'Normal' => task.priority == TaskPriority.normal,
        'Low' => task.priority == TaskPriority.low,
        _ => true,
      };
      return matchesStatus && matchesPriority;
    }).toList()..sort((a, b) => a.dueAt.compareTo(b.dueAt));
  }

  Future<void> _acknowledge(MockRepository repo, WorkTask task) async {
    repo.acknowledgeTask(task.id);
    if (mounted) {
      showDemoSnack(context, 'Acknowledged — ${task.title}');
    }
  }

  Future<void> _complete(MockRepository repo, WorkTask task) async {
    if (task.requiresPhoto && task.completionPhoto == null) {
      if (!mounted) return;
      final open = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(20),
          ),
          title: const Text('Proof needed', style: AppText.title),
          content: Text(
            '"${task.title}" requires a completion photo before it can be closed. '
            'Open the task and attach the photo — closing it now would be flagged as missing proof.',
            style: const TextStyle(fontSize: 13, height: 1.4),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('Open task'),
            ),
          ],
        ),
      );
      if (open == true && mounted) {
        Navigator.pushNamed(
          context,
          '/task',
          arguments: <String, String>{'taskId': task.id},
        );
      }
      return;
    }
    if (!mounted) return;
    final ok = await ConfirmDialog.show(
      context,
      title: 'Mark task complete',
      message: 'Close "${task.title}" and record the completion time?',
      confirmLabel: 'Complete',
    );
    if (!ok || !mounted) return;
    repo.completeTask(task.id);
    showDemoSnack(context, '${task.title} marked complete.');
  }

  void _openTask(WorkTask task) {
    Navigator.pushNamed(
      context,
      '/task',
      arguments: <String, String>{'taskId': task.id},
    );
  }

  Widget _headerCards(MockRepository repo) {
    final now = DateTime.now();
    final open = repo.tasks.where((t) => t.status == TaskStatus.open).length;
    final acknowledged = repo.tasks
        .where((t) => t.status == TaskStatus.acknowledged)
        .length;
    final completed = repo.tasks
        .where((t) => t.status == TaskStatus.completed)
        .length;
    final overdue = repo.tasks
        .where((t) => t.status != TaskStatus.completed && t.dueAt.isBefore(now))
        .length;
    return SizedBox(
      height: 152,
      child: ListView(
        scrollDirection: Axis.horizontal,
        children: [
          SizedBox(
            width: 154,
            child: MetricCard(
              title: 'Open tasks',
              value: '$open',
              caption: 'Not acknowledged yet',
              icon: Icons.fact_check_outlined,
              gradient: AppGradients.task,
            ),
          ),
          const SizedBox(width: 10),
          SizedBox(
            width: 154,
            child: MetricCard(
              title: 'Acknowledged',
              value: '$acknowledged',
              caption: 'Accepted by staff',
              icon: Icons.mark_email_read_outlined,
              gradient: AppGradients.payment,
            ),
          ),
          const SizedBox(width: 10),
          SizedBox(
            width: 154,
            child: MetricCard(
              title: 'Completed',
              value: '$completed',
              caption: 'Closed in this workspace',
              icon: Icons.verified_outlined,
              gradient: AppGradients.success,
            ),
          ),
          const SizedBox(width: 10),
          SizedBox(
            width: 154,
            child: MetricCard(
              title: 'Overdue',
              value: '$overdue',
              caption: 'Past the due date',
              icon: Icons.alarm_on_outlined,
              gradient: AppGradients.danger,
            ),
          ),
        ],
      ),
    );
  }

  Widget _taskList({
    required MockRepository repo,
    required List<WorkTask> tasks,
    required String? myEmployeeId,
    required bool isOwner,
    required String emptyTitle,
    required String emptySubtitle,
  }) {
    if (tasks.isEmpty) {
      return EmptyState(
        icon: Icons.alarm_off_rounded,
        title: emptyTitle,
        subtitle: emptySubtitle,
        action: isOwner
            ? GradientButton(
                label: 'Create task',
                icon: Icons.add_rounded,
                height: 46,
                expand: false,
                onPressed: () => Navigator.pushNamed(context, '/create-task'),
              )
            : null,
      );
    }
    return Column(
      children: [
        for (final task in tasks)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: _TaskRow(
              task: task,
              assigneeName: repo.salespersonName(task.assignedEmployeeId),
              statusLabel: _statusLabel(task.status),
              statusColor: _statusColor(task.status),
              priorityColor: _priorityColor(task.priority),
              canComplete:
                  myEmployeeId != null &&
                  task.assignedEmployeeId == myEmployeeId,
              onTap: () => _openTask(task),
              onAcknowledge: task.status == TaskStatus.open
                  ? () => _acknowledge(repo, task)
                  : null,
              onComplete: () => _complete(repo, task),
            ),
          ),
      ],
    );
  }

  Widget _ownerView(MockRepository repo, String? myEmployeeId) {
    final tasks = _ownerTasks(repo);
    return RefreshIndicator(
      onRefresh: _syncAndCheck,
      child: ListView(
        padding: AppSpacing.page,
        children: [
          _headerCards(repo),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: ActionPill(
                  icon: Icons.add_task_rounded,
                  label: 'Create task',
                  onTap: () => Navigator.pushNamed(context, '/create-task'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: ActionPill(
                  icon: Icons.photo_library_outlined,
                  label: 'Review completion photos',
                  onTap: () => Navigator.pushNamed(context, '/task-review'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          const DemoNotice(
            text:
                'Executive Control: Create assignments in panel or app. Alarms trigger on employee devices when due time is up.',
          ),
          const SizedBox(height: 14),
          FilterChipsRow(
            options: _statusFilters,
            selected: _status,
            onSelected: (value) => setState(() => _status = value),
          ),
          const SizedBox(height: 8),
          FilterChipsRow(
            options: _priorityFilters,
            selected: _priority,
            onSelected: (value) => setState(() => _priority = value),
          ),
          const SizedBox(height: 10),
          SectionHeading(
            title: 'All assignments',
            subtitle: '${tasks.length} task(s) in this view',
          ),
          const SizedBox(height: 10),
          _taskList(
            repo: repo,
            tasks: tasks,
            myEmployeeId: myEmployeeId,
            isOwner: true,
            emptyTitle: 'Nothing in this filter',
            emptySubtitle:
                'Change the status or priority chips, or create a new assignment.',
          ),
        ],
      ),
    );
  }

  Widget _employeeView(MockRepository repo, String? myEmployeeId) {
    final now = DateTime.now();
    final today = DateUtils.dateOnly(now);
    final mine = repo.tasks
        .where(
          (task) =>
              myEmployeeId != null && task.assignedEmployeeId == myEmployeeId,
        )
        .toList();

    // 4 buckets requested by user: Today, Pending, Overdue, Completed
    final dueToday = mine
        .where(
          (task) =>
              task.status != TaskStatus.completed &&
              !task.dueAt.isBefore(now) &&
              DateUtils.dateOnly(task.dueAt) == today,
        )
        .toList();

    final pending = mine
        .where(
          (task) =>
              task.status != TaskStatus.completed &&
              !task.dueAt.isBefore(now) &&
              DateUtils.dateOnly(task.dueAt).isAfter(today),
        )
        .toList();

    final overdue = mine
        .where(
          (task) =>
              task.status != TaskStatus.completed && task.dueAt.isBefore(now),
        )
        .toList();

    final completed =
        mine.where((task) => task.status == TaskStatus.completed).toList()
          ..sort(
            (a, b) =>
                (b.completedAt ?? b.dueAt).compareTo(a.completedAt ?? a.dueAt),
          );

    final tabs = <List<WorkTask>>[dueToday, pending, overdue, completed];

    return DefaultTabController(
      length: tabs.length,
      child: RefreshIndicator(
        onRefresh: _syncAndCheck,
        child: Column(
          children: [
            TabBar(
              isScrollable: true,
              tabAlignment: TabAlignment.start,
              labelColor: AppColors.purple,
              unselectedLabelColor: AppColors.muted,
              indicatorColor: AppColors.purple,
              dividerColor: AppColors.line,
              labelStyle: const TextStyle(
                fontWeight: FontWeight.w900,
                fontSize: 12.5,
              ),
              unselectedLabelStyle: const TextStyle(
                fontWeight: FontWeight.w600,
                fontSize: 12.5,
              ),
              tabs: [
                Tab(text: 'Today (${dueToday.length})'),
                Tab(text: 'Pending (${pending.length})'),
                Tab(text: 'Overdue (${overdue.length})'),
                Tab(text: 'Completed (${completed.length})'),
              ],
            ),
            Expanded(
              child: TabBarView(
                children: [
                  for (var i = 0; i < tabs.length; i++)
                    ListView(
                      padding: AppSpacing.page,
                      children: [
                        DemoNotice(
                          text: switch (i) {
                            0 =>
                              'Today: ${dueToday.length} task(s) due today. Phone alarm will sound & vibrate when time is up.',
                            1 =>
                              'Pending: ${pending.length} upcoming task(s) scheduled for future dates.',
                            2 =>
                              'Overdue: ${overdue.length} task(s) past due time! Alarm active — complete or acknowledge.',
                            _ =>
                              'Completed: ${completed.length} assignment(s) closed with proof.',
                          },
                        ),
                        const SizedBox(height: 12),
                        _taskList(
                          repo: repo,
                          tasks: tabs[i],
                          myEmployeeId: myEmployeeId,
                          isOwner: false,
                          emptyTitle: switch (i) {
                            0 => 'Nothing due today',
                            1 => 'No pending upcoming tasks',
                            2 => 'No overdue tasks',
                            _ => 'No completed tasks yet',
                          },
                          emptySubtitle: switch (i) {
                            0 =>
                              'Enjoy the day or review upcoming tasks from the Pending tab.',
                            1 =>
                              'All future assignments will appear here.',
                            2 =>
                              'Excellent! Every assignment is on schedule.',
                            _ =>
                              'Complete a task to see it archived here with its proof.',
                          },
                        ),
                      ],
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final repo = context.watch<MockRepository>();
    final user = repo.currentUser;
    final isOwner = user?.isOwner ?? true;
    final myEmployeeId = user?.employeeId;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Task Alarm'),
        actions: [
          IconButton(
            tooltip: 'Test Alarm (Chime & Vibrate)',
            icon: const Icon(Icons.alarm_on_rounded, color: AppColors.red),
            onPressed: _testAlarm,
          ),
          IconButton(
            tooltip: 'Sync Tasks',
            icon: _isSyncing
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.sync_rounded),
            onPressed: _syncAndCheck,
          ),
          IconButton(
            tooltip: 'Review completion photos',
            icon: const Icon(Icons.photo_camera_rounded),
            onPressed: () => Navigator.pushNamed(context, '/task-review'),
          ),
        ],
      ),
      floatingActionButton: isOwner
          ? FloatingActionButton.extended(
              onPressed: () => Navigator.pushNamed(context, '/create-task'),
              backgroundColor: AppColors.purple,
              foregroundColor: Colors.white,
              icon: const Icon(Icons.add_rounded),
              label: const Text('Create task'),
            )
          : null,
      body: isOwner
          ? _ownerView(repo, myEmployeeId)
          : _employeeView(repo, myEmployeeId),
    );
  }
}

class _TaskRow extends StatelessWidget {
  const _TaskRow({
    required this.task,
    required this.assigneeName,
    required this.statusLabel,
    required this.statusColor,
    required this.priorityColor,
    required this.canComplete,
    required this.onTap,
    required this.onAcknowledge,
    required this.onComplete,
  });
  final WorkTask task;
  final String assigneeName;
  final String statusLabel;
  final Color statusColor;
  final Color priorityColor;
  final bool canComplete;
  final VoidCallback onTap;
  final VoidCallback? onAcknowledge;
  final VoidCallback onComplete;

  @override
  Widget build(BuildContext context) {
    return WhitePanel(
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                decoration: BoxDecoration(
                  gradient: AppGradients.task,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  task.id.replaceFirst('TSK-', '#'),
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 10,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              const SizedBox(width: 9),
              Expanded(
                child: Text(
                  task.title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: AppText.heading,
                ),
              ),
              if (task.requiresPhoto)
                const Padding(
                  padding: EdgeInsets.only(left: 6),
                  child: Icon(
                    Icons.photo_camera_rounded,
                    size: 18,
                    color: AppColors.purple,
                  ),
                ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            '$assigneeName • due ${relativeDay(task.dueAt)} at ${timeLabel(task.dueAt)}',
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 11.5,
              color: AppColors.muted,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              StatusChip(label: statusLabel, color: statusColor),
              if (task.overdue)
                const StatusChip(label: 'Overdue', color: AppColors.red),
              if (task.priority == TaskPriority.high)
                const StatusChip(label: 'High priority', color: AppColors.red)
              else
                StatusChip(
                  label: '${taskPriorityLabel(task.priority)} priority',
                  color: priorityColor,
                ),
              if (task.requiresPhoto)
                StatusChip(
                  label: task.completionPhoto != null
                      ? 'Photo attached'
                      : (task.missingProof
                            ? 'Proof missing'
                            : 'Photo required'),
                  color: task.completionPhoto != null
                      ? AppColors.green
                      : (task.missingProof ? AppColors.red : AppColors.orange),
                ),
            ],
          ),
          if (task.description.trim().isNotEmpty) ...[
            const SizedBox(height: 9),
            Text(
              task.description.trim(),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontSize: 11.5,
                height: 1.4,
                color: Color(0xFF4C4870),
              ),
            ),
          ],
          if (onAcknowledge != null || canComplete) ...[
            const SizedBox(height: 11),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                if (onAcknowledge != null)
                  ActionPill(
                    icon: Icons.done_all_rounded,
                    label: 'Acknowledge',
                    onTap: onAcknowledge!,
                  ),
                if (canComplete && task.status != TaskStatus.completed)
                  ActionPill(
                    icon: Icons.verified_rounded,
                    label: 'Mark complete',
                    onTap: onComplete,
                  ),
                ActionPill(
                  icon: Icons.open_in_new_rounded,
                  label: 'Open task',
                  onTap: onTap,
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}
