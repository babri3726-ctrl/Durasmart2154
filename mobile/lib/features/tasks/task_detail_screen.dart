import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/formatters.dart';
import '../../core/share_service.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import '../../data/mock_repository.dart';
import '../../data/models.dart';

/// Task alarm detail. The assigned employee acknowledges, adds completion
/// notes and attaches proof; the owner reads the full record and can send a
/// WhatsApp reminder.
class TaskDetailScreen extends StatefulWidget {
  const TaskDetailScreen({super.key, required this.taskId});

  final String taskId;

  @override
  State<TaskDetailScreen> createState() => _TaskDetailScreenState();
}

class _TaskDetailScreenState extends State<TaskDetailScreen> {
  final TextEditingController _notesController = TextEditingController();
  List<DemoPhoto> _proofPhotos = const [];
  bool _notesSeeded = false;

  @override
  void dispose() {
    _notesController.dispose();
    super.dispose();
  }

  // ── status helpers ───────────────────────────────────────────────────
  static String _statusLabel(TaskStatus status) => switch (status) {
    TaskStatus.open => 'Open',
    TaskStatus.acknowledged => 'Acknowledged',
    TaskStatus.completed => 'Completed',
  };

  static Color _statusColor(TaskStatus status) => switch (status) {
    TaskStatus.open => AppColors.orange,
    TaskStatus.acknowledged => AppColors.blue,
    TaskStatus.completed => AppColors.green,
  };

  static Color _priorityColor(TaskPriority priority) => switch (priority) {
    TaskPriority.high => AppColors.red,
    TaskPriority.normal => AppColors.purple,
    TaskPriority.low => AppColors.teal,
  };

  static int _overdueDays(WorkTask task) =>
      task.overdue ? DateTime.now().difference(task.dueAt).inDays : 0;

  static String _shortId(String id) => id.replaceFirst('TSK-', '#');

  String _reminderMessage(WorkTask task, String employeeName) =>
      'TASK ALARM — ${task.title}\n'
      'Reference: ${task.id}\n'
      'Assigned to: $employeeName\n'
      'Due: ${dateTimeLabel(task.dueAt)} (${relativeDay(task.dueAt)})\n'
      'Priority: ${taskPriorityLabel(task.priority)}\n'
      'Status: ${_statusLabel(task.status)}\n'
      'Photo proof: ${task.requiresPhoto ? 'Required' : 'Not required'}\n\n'
      'Please acknowledge and update this task in Dura Smart.';

  // ── employee actions ─────────────────────────────────────────────────
  Future<void> _acknowledge(MockRepository repo, WorkTask task) async {
    final ok = await ConfirmDialog.show(
      context,
      title: 'Acknowledge task',
      message:
          'Confirm you will action "${task.title}" before ${dateTimeLabel(task.dueAt)}.',
      confirmLabel: 'Acknowledge',
    );
    if (!ok || !mounted) return;
    repo.acknowledgeTask(task.id);
    showDemoSnack(
      context,
      'Acknowledged — the owner now sees this task as accepted.',
    );
  }

  Future<void> _complete(MockRepository repo, WorkTask task) async {
    final photo = _proofPhotos.isEmpty ? null : _proofPhotos.first;
    if (task.requiresPhoto && task.completionPhoto == null && photo == null) {
      showDemoSnack(
        context,
        'This task needs a completion photo — add it in the proof panel below.',
      );
      return;
    }
    final ok = await ConfirmDialog.show(
      context,
      title: 'Mark task complete',
      message: photo == null
          ? 'Close "${task.title}"${task.completionNotes.trim().isEmpty ? '' : ' with your notes'}?'
          : 'Close "${task.title}" and attach the selected completion photo?',
      confirmLabel: 'Mark complete',
    );
    if (!ok || !mounted) return;
    final notes = _notesController.text.trim();
    repo.completeTask(task.id, notes: notes, photo: photo);
    setState(() => _proofPhotos = const []);
    showDemoSnack(context, 'Task completed — status refreshed for the owner.');
  }

  Future<void> _attachProof(MockRepository repo, WorkTask task) async {
    if (_proofPhotos.isEmpty) return;
    final photo = _proofPhotos.first;
    final ok = await ConfirmDialog.show(
      context,
      title: 'Attach completion photo',
      message:
          'Add this photo as proof for "${task.title}"? The owner reviews it in the completion photo queue.',
      confirmLabel: 'Attach photo',
    );
    if (!ok || !mounted) return;
    if (task.status == TaskStatus.completed) {
      // Keep the recorded completion time and store the notes together with
      // the proof — attaching the photo is what refreshes the listeners.
      task.completionNotes = _notesController.text.trim();
    }
    repo.attachCompletionPhoto(task.id, photo);
    setState(() => _proofPhotos = const []);
    showDemoSnack(context, 'Completion photo attached.');
  }

  void _saveNotes(MockRepository repo, WorkTask task) {
    final notes = _notesController.text.trim();
    task.completionNotes = notes;
    final photo = task.completionPhoto;
    if (photo != null) {
      repo.attachCompletionPhoto(task.id, photo);
    } else {
      repo.completeTask(task.id, notes: notes);
    }
    if (!mounted) return;
    showDemoSnack(
      context,
      notes.isEmpty ? 'Completion notes cleared.' : 'Completion notes saved.',
    );
  }

  void _openTaskReview() => Navigator.of(context).pushNamed('/task-review');

  // ── widgets ──────────────────────────────────────────────────────────
  Widget _hero(WorkTask task, int overdueDays) => GradientHero(
    height: 150,
    gradient: task.priority == TaskPriority.high
        ? AppGradients.danger
        : AppGradients.task,
    child: Column(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                'TASK ${_shortId(task.id)}',
                style: const TextStyle(
                  color: Colors.white70,
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 1,
                ),
              ),
            ),
            Icon(
              task.requiresPhoto
                  ? Icons.photo_camera_rounded
                  : Icons.check_circle_rounded,
              color: Colors.white,
              size: 20,
            ),
          ],
        ),
        Text(
          task.title,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 16,
            fontWeight: FontWeight.w900,
            height: 1.25,
          ),
        ),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            _HeroChip(label: _statusLabel(task.status)),
            _HeroChip(label: '${taskPriorityLabel(task.priority)} priority'),
            if (overdueDays > 0)
              _HeroChip(
                label: overdueDays == 1
                    ? '1 day overdue'
                    : '$overdueDays days overdue',
              ),
          ],
        ),
      ],
    ),
  );

  Widget _chipsPanel(WorkTask task, int overdueDays) => WhitePanel(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeading(title: 'Where it stands'),
        const SizedBox(height: 10),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            StatusChip(
              label: _statusLabel(task.status),
              color: _statusColor(task.status),
            ),
            StatusChip(
              label: '${taskPriorityLabel(task.priority)} priority',
              color: _priorityColor(task.priority),
            ),
            if (overdueDays > 0)
              StatusChip(
                label: overdueDays == 1
                    ? 'Overdue 1 day'
                    : 'Overdue $overdueDays days',
                color: AppColors.red,
              )
            else if (task.status != TaskStatus.completed)
              const StatusChip(label: 'On time', color: AppColors.green),
            if (task.requiresPhoto)
              const StatusChip(
                label: 'Photo proof required',
                color: AppColors.purple,
              ),
            if (task.missingProof)
              const StatusChip(label: 'Proof missing', color: AppColors.red),
            if (task.completionPhoto != null)
              const StatusChip(label: 'Proof attached', color: AppColors.green),
          ],
        ),
        const SizedBox(height: 10),
        Text(
          task.status == TaskStatus.completed
              ? 'Completed ${dateTimeLabel(task.completedAt ?? task.dueAt)}.'
              : 'Due ${dateTimeLabel(task.dueAt)} • ${relativeDay(task.dueAt)}.',
          style: AppText.caption,
        ),
      ],
    ),
  );

  Widget _recordPanel(
    WorkTask task,
    String assigneeName,
    String creatorName,
    bool isOwner,
  ) {
    final createdLabel = task.createdAt == null
        ? 'Not recorded'
        : dateTimeLabel(task.createdAt!);
    return WhitePanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SectionHeading(
            title: 'Task record',
            subtitle: 'Everything the alarm was created with',
          ),
          const SizedBox(height: 6),
          InfoRow(label: 'Reference', value: task.id),
          InfoRow(label: 'Title', value: task.title),
          InfoRow(label: 'Assigned to', value: assigneeName),
          InfoRow(label: 'Created by', value: creatorName),
          InfoRow(label: 'Created on', value: createdLabel),
          InfoRow(
            label: 'Due',
            value: '${dateTimeLabel(task.dueAt)} (${relativeDay(task.dueAt)})',
          ),
          InfoRow(
            label: 'Priority',
            value: taskPriorityLabel(task.priority),
            valueColor: _priorityColor(task.priority),
          ),
          InfoRow(
            label: 'Status',
            value: _statusLabel(task.status),
            valueColor: _statusColor(task.status),
          ),
          InfoRow(
            label: 'Overdue',
            value: task.overdue ? 'Yes' : 'No',
            valueColor: task.overdue ? AppColors.red : AppColors.green,
          ),
          InfoRow(
            label: 'Completed',
            value: task.completedAt == null
                ? 'Not completed'
                : dateTimeLabel(task.completedAt!),
          ),
          InfoRow(
            label: 'Completion notes',
            value: task.completionNotes.trim().isEmpty
                ? 'None yet'
                : task.completionNotes.trim(),
          ),
          const SizedBox(height: 4),
          DemoNotice(
            text: isOwner
                ? 'Owner view is read-only here — the assigned employee updates the status from their own task list.'
                : 'Only the assigned employee can change this status. Alarms in this demo are in-app only, the device is not notified.',
          ),
        ],
      ),
    );
  }

  Widget _descriptionPanel(WorkTask task) => WhitePanel(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeading(title: 'What needs to be done'),
        const SizedBox(height: 8),
        Text(
          task.description.trim().isEmpty
              ? 'No description was added when this task was created.'
              : task.description.trim(),
          style: AppText.body.copyWith(height: 1.5),
        ),
      ],
    ),
  );

  Widget _proofPanel(
    MockRepository repo,
    WorkTask task, {
    required bool canAttach,
  }) {
    final photo = task.completionPhoto;
    return WhitePanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(
                child: SectionHeading(
                  title: 'Completion photo',
                  subtitle: 'Photo proof for this task',
                ),
              ),
              StatusChip(
                label: photo != null ? 'Proof attached' : 'Proof missing',
                color: photo != null ? AppColors.green : AppColors.red,
              ),
            ],
          ),
          const SizedBox(height: 12),
          if (photo != null)
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                PhotoThumbnail(photo: photo, size: 96),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        photo.name,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontWeight: FontWeight.w800,
                          fontSize: 12,
                        ),
                      ),
                      const SizedBox(height: 6),
                      const Text(
                        'Tap the photo to open it full screen.',
                        style: TextStyle(fontSize: 11, color: AppColors.muted),
                      ),
                    ],
                  ),
                ),
              ],
            )
          else
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: const Color(0xFFFFF4F5),
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: const Color(0xFFF6D3D7)),
              ),
              child: const Row(
                children: [
                  Icon(
                    Icons.no_photography_rounded,
                    color: AppColors.red,
                    size: 20,
                  ),
                  SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'No completion photo stored yet. This task is flagged as needing proof.',
                      style: TextStyle(
                        fontSize: 11.5,
                        color: Color(0xFF9C3A45),
                        height: 1.4,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          if (canAttach) ...[
            const SizedBox(height: 14),
            PhotoPickerPanel(
              title: 'Attach proof photo',
              helper:
                  'Take one photo of the finished work. The owner reviews it in the completion photo queue.',
              photos: _proofPhotos,
              maxPhotos: 1,
              onPhotosChanged: (photos) =>
                  setState(() => _proofPhotos = photos),
            ),
            const SizedBox(height: 12),
            GradientButton(
              label: _proofPhotos.isEmpty
                  ? 'Select a photo first'
                  : 'Attach completion photo',
              icon: Icons.cloud_upload_rounded,
              gradient: AppGradients.task,
              onPressed: _proofPhotos.isEmpty
                  ? null
                  : () => _attachProof(repo, task),
            ),
          ] else if (task.requiresPhoto && photo == null && !canAttach) ...[
            const SizedBox(height: 12),
            const DemoNotice(
              text:
                  'The assigned employee adds the proof photo. As owner you can review it, or attach a fallback photo from the completion photo queue.',
            ),
            const SizedBox(height: 12),
            ActionPill(
              icon: Icons.photo_library_rounded,
              label: 'Open completion photo queue',
              onTap: _openTaskReview,
            ),
          ],
        ],
      ),
    );
  }

  Widget _notesPanel(
    MockRepository repo,
    WorkTask task, {
    required bool editable,
  }) {
    if (!editable) {
      return WhitePanel(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SectionHeading(title: 'Completion notes'),
            const SizedBox(height: 8),
            Text(
              task.completionNotes.trim().isEmpty
                  ? 'The employee has not added completion notes yet.'
                  : task.completionNotes.trim(),
              style: AppText.body.copyWith(height: 1.5),
            ),
          ],
        ),
      );
    }
    return WhitePanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SectionHeading(
            title: 'Completion notes',
            subtitle: 'What you did, and anything to follow up on',
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _notesController,
            minLines: 3,
            maxLines: 6,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(
              hintText:
                  'e.g. Met the owner, collected ₹50,000 by NEFT, balance promised Friday.',
              labelText: 'Notes',
            ),
          ),
          const SizedBox(height: 10),
          if (task.status == TaskStatus.completed &&
              task.completionPhoto == null)
            const DemoNotice(
              text:
                  'Saving notes on a completed task without a proof photo refreshes its completion time in this demo build.',
            ),
          const SizedBox(height: 10),
          GradientButton(
            label: task.status == TaskStatus.completed
                ? 'Save completion notes'
                : 'Save notes',
            icon: Icons.save_rounded,
            gradient: AppGradients.task,
            onPressed: () => _saveNotes(repo, task),
          ),
        ],
      ),
    );
  }

  Widget _actionsPanel(
    WorkTask task, {
    required bool isAssignee,
    required bool isOwner,
    required String assigneeName,
    required String assigneePhone,
  }) {
    if (isAssignee && task.status != TaskStatus.completed) {
      return WhitePanel(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SectionHeading(title: 'Your actions'),
            const SizedBox(height: 12),
            if (task.status == TaskStatus.open)
              GradientButton(
                label: 'Acknowledge task',
                icon: Icons.how_to_reg_rounded,
                gradient: AppGradients.success,
                onPressed: () =>
                    _acknowledge(context.read<MockRepository>(), task),
              ),
            if (task.status == TaskStatus.open) const SizedBox(height: 12),
            GradientButton(
              label: 'Mark complete',
              icon: Icons.check_circle_rounded,
              gradient: AppGradients.task,
              onPressed: () => _complete(context.read<MockRepository>(), task),
            ),
            const SizedBox(height: 12),
            const DemoNotice(
              text:
                  'Marking complete records the timestamp shown above. Photo-required tasks need a proof photo first.',
            ),
          ],
        ),
      );
    }
    if (isOwner) {
      return WhitePanel(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SectionHeading(
              title: 'Follow up',
              subtitle: 'Send the assignee a prefilled WhatsApp reminder',
            ),
            const SizedBox(height: 12),
            WhatsAppButton(
              label: 'Remind $assigneeName on WhatsApp',
              phone: assigneePhone,
              message: _reminderMessage(task, assigneeName),
            ),
            const SizedBox(height: 12),
            ActionPill(
              icon: Icons.assignment_rounded,
              label: 'Back to task dashboard',
              onTap: () => Navigator.of(context).pushNamed('/tasks'),
            ),
            const SizedBox(height: 10),
            const DemoNotice(
              text:
                  'Review the message before sending — the app never sends anything on its own.',
            ),
          ],
        ),
      );
    }
    return WhitePanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SectionHeading(title: 'Follow up'),
          const SizedBox(height: 12),
          WhatsAppButton(
            label: 'Remind $assigneeName on WhatsApp',
            phone: assigneePhone,
            message: _reminderMessage(task, assigneeName),
          ),
          const SizedBox(height: 10),
          DemoNotice(
            text: isAssignee
                ? 'This task is already closed.'
                : 'This task belongs to $assigneeName, so you can read it but not change its status.',
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final repo = context.watch<MockRepository>();
    final task = repo.taskById(widget.taskId);
    if (!_notesSeeded && task != null) {
      _notesController.text = task.completionNotes;
      _notesSeeded = true;
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Task detail')),
      body: SafeArea(
        child: task == null
            ? EmptyState(
                icon: Icons.search_off_rounded,
                title: 'Task not found',
                subtitle:
                    'This task record is no longer available in the demo data.',
                action: ActionPill(
                  icon: Icons.arrow_back_rounded,
                  label: 'Back to tasks',
                  onTap: () => Navigator.of(context).pop(),
                ),
              )
            : _body(repo, task),
      ),
    );
  }

  Widget _body(MockRepository repo, WorkTask task) {
    final user = repo.currentUser;
    final isOwner = user?.isOwner ?? true;
    final isAssignee =
        user != null && user.employeeId == task.assignedEmployeeId;
    final employee = repo.employeeById(task.assignedEmployeeId);
    final assigneeName =
        employee?.name ?? repo.salespersonName(task.assignedEmployeeId);
    final assigneePhone = employee?.phone ?? user?.phone ?? '';
    final creatorName = task.createdBy.trim().isEmpty
        ? 'Owner'
        : task.createdBy;
    final overdueDays = _overdueDays(task);
    final canAttachProof =
        isAssignee && task.requiresPhoto && task.completionPhoto == null;

    return ListView(
      padding: AppSpacing.page,
      children: [
        _hero(task, overdueDays),
        const SizedBox(height: 14),
        _chipsPanel(task, overdueDays),
        const SizedBox(height: 14),
        _recordPanel(task, assigneeName, creatorName, isOwner),
        const SizedBox(height: 14),
        _descriptionPanel(task),
        if (task.requiresPhoto) ...[
          const SizedBox(height: 14),
          _proofPanel(repo, task, canAttach: canAttachProof),
        ],
        const SizedBox(height: 14),
        _notesPanel(repo, task, editable: isAssignee),
        const SizedBox(height: 14),
        _actionsPanel(
          task,
          isAssignee: isAssignee,
          isOwner: isOwner,
          assigneeName: assigneeName,
          assigneePhone: assigneePhone,
        ),
        const SizedBox(height: 14),
        ActionPill(
          icon: Icons.arrow_back_rounded,
          label: 'Back',
          onTap: () => Navigator.of(context).pop(),
        ),
        const SizedBox(height: 8),
      ],
    );
  }
}

/// Solid white chip used on the gradient hero, where the translucent
/// [StatusChip] tint would lose contrast.
class _HeroChip extends StatelessWidget {
  const _HeroChip({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
    decoration: BoxDecoration(
      color: Colors.white.withValues(alpha: .92),
      borderRadius: BorderRadius.circular(50),
    ),
    child: Text(
      label,
      style: const TextStyle(
        color: AppColors.navy,
        fontWeight: FontWeight.w900,
        fontSize: 9.5,
      ),
    ),
  );
}
