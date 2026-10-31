import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/formatters.dart';
import '../../core/share_service.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import '../../data/mock_repository.dart';
import '../../data/models.dart';

/// Task Alarm — role aware task board. Owner gets the workload summary and the
/// creation / proof-review entries; an employee gets their own day buckets.
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
    showDemoSnack(context, 'Acknowledged — ${task.title}');
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
    return ListView(
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
              'Reminders and alarms in this demo are simulated: nothing is pushed to a device yet, but every action below updates the shared workspace instantly.',
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
    final upcoming = mine
        .where(
          (task) =>
              task.status != TaskStatus.completed &&
              !task.dueAt.isBefore(now) &&
              DateUtils.dateOnly(task.dueAt).isAfter(today),
        )
        .toList();
    final dueToday = mine
        .where(
          (task) =>
              task.status != TaskStatus.completed &&
              !task.dueAt.isBefore(now) &&
              DateUtils.dateOnly(task.dueAt) == today,
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
    final tabs = <List<WorkTask>>[upcoming, dueToday, overdue, completed];

    return DefaultTabController(
      length: tabs.length,
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
              Tab(text: 'Upcoming (${upcoming.length})'),
              Tab(text: 'Due today (${dueToday.length})'),
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
                          1 =>
                            'Due today: ${dueToday.length} assignment(s) must be closed before midnight.',
                          2 =>
                            'Overdue: ${overdue.length} assignment(s) are past their due date. Acknowledge and update the owner.',
                          3 =>
                            'Completed: ${completed.length} assignment(s) closed by you in this workspace.',
                          _ =>
                            'Upcoming: ${upcoming.length} assignment(s) scheduled after today.',
                        },
                      ),
                      const SizedBox(height: 12),
                      _taskList(
                        repo: repo,
                        tasks: tabs[i],
                        myEmployeeId: myEmployeeId,
                        isOwner: false,
                        emptyTitle: switch (i) {
                          1 => 'Nothing due today',
                          2 => 'No overdue tasks',
                          3 => 'No completed tasks yet',
                          _ => 'No upcoming tasks',
                        },
                        emptySubtitle: switch (i) {
                          1 =>
                            'Enjoy the quiet — or pick a task from the Upcoming tab and finish it early.',
                          2 =>
                            'Every assignment you own is still inside its due date.',
                          3 =>
                            'Complete a task to see it archived here with its proof.',
                          _ =>
                            'New assignments from the owner will appear here.',
                        },
                      ),
                    ],
                  ),
              ],
            ),
          ),
        ],
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
