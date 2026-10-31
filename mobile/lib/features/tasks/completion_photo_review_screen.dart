import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/formatters.dart';
import '../../core/share_service.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import '../../data/mock_repository.dart';
import '../../data/models.dart';

/// Owner queue for completion photos of finished tasks. Filter between missing
/// and attached proof, open the task, and add a fallback photo with a note when
/// the employee could not upload one.
class CompletionPhotoReviewScreen extends StatefulWidget {
  const CompletionPhotoReviewScreen({super.key});

  @override
  State<CompletionPhotoReviewScreen> createState() =>
      _CompletionPhotoReviewScreenState();
}

class _CompletionPhotoReviewScreenState
    extends State<CompletionPhotoReviewScreen> {
  static const _filters = <String>[
    'Missing proof',
    'With proof',
    'All completed',
  ];

  String _filter = _filters.first;

  // ── data ─────────────────────────────────────────────────────────────
  List<WorkTask> _completedTasks(
    MockRepository repo, {
    required bool isOwner,
    required String? myEmployeeId,
  }) {
    final list = repo.tasks
        .where((t) => t.status == TaskStatus.completed)
        .where((t) {
          if (isOwner) return true;
          return myEmployeeId != null && t.assignedEmployeeId == myEmployeeId;
        })
        .toList();
    list.sort(
      (a, b) => (b.completedAt ?? b.dueAt).compareTo(a.completedAt ?? a.dueAt),
    );
    return list;
  }

  List<WorkTask> _visible(
    MockRepository repo, {
    required bool isOwner,
    required String? myEmployeeId,
  }) {
    final all = _completedTasks(
      repo,
      isOwner: isOwner,
      myEmployeeId: myEmployeeId,
    );
    return switch (_filter) {
      'Missing proof' =>
        all.where((t) => t.requiresPhoto && t.completionPhoto == null).toList(),
      'With proof' => all.where((t) => t.completionPhoto != null).toList(),
      _ => all,
    };
  }

  int _missingCount(List<WorkTask> all) =>
      all.where((t) => t.requiresPhoto && t.completionPhoto == null).length;

  // ── owner fallback ───────────────────────────────────────────────────
  Future<void> _attachFallback(MockRepository repo, WorkTask task) async {
    final draft = await showModalBottomSheet<_FallbackDraft>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
      ),
      builder: (_) => _FallbackPhotoSheet(task: task),
    );
    if (draft == null || !mounted) return;
    final ok = await ConfirmDialog.show(
      context,
      title: 'Attach fallback photo',
      message:
          'Use this photo as the completion proof for "${task.title}"? Your note is stored with the task so the record shows it came from the review queue.',
      confirmLabel: 'Attach photo',
    );
    if (!ok || !mounted) return;
    final tag =
        'Owner fallback photo added from the review queue${draft.note.isEmpty ? '' : ': ${draft.note}'}';
    final base = task.completionNotes.trim();
    task.completionNotes = base.isEmpty ? tag : '$base\n$tag';
    repo.attachCompletionPhoto(task.id, draft.photo);
    showDemoSnack(context, 'Fallback photo saved against ${task.id}.');
  }

  // ── widgets ──────────────────────────────────────────────────────────
  Widget _header(List<WorkTask> all, int missing, int withProof) =>
      GradientHero(
        height: 172,
        gradient: AppGradients.task,
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
                        'COMPLETION PHOTOS',
                        style: TextStyle(
                          color: Colors.white70,
                          fontSize: 11,
                          fontWeight: FontWeight.w800,
                          letterSpacing: 1.2,
                        ),
                      ),
                      SizedBox(height: 4),
                      Text(
                        'Proof review for closed tasks',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 15,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ],
                  ),
                ),
                Icon(Icons.fact_check_rounded, color: Colors.white, size: 26),
              ],
            ),
            Row(
              children: [
                Expanded(
                  child: _SummaryStat(label: 'Closed tasks', count: all.length),
                ),
                Expanded(
                  child: _SummaryStat(label: 'Missing proof', count: missing),
                ),
                Expanded(
                  child: _SummaryStat(label: 'With photo', count: withProof),
                ),
              ],
            ),
          ],
        ),
      );

  Widget _row(MockRepository repo, WorkTask task, {required bool isOwner}) {
    final photo = task.completionPhoto;
    final assigneeName = repo.salespersonName(task.assignedEmployeeId);
    final completedAt = task.completedAt ?? task.dueAt;
    final notes = task.completionNotes.trim();
    return WhitePanel(
      onTap: () => Navigator.of(
        context,
      ).pushNamed('/task', arguments: <String, String>{'taskId': task.id}),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
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
                        fontSize: 13.5,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text('${task.id} • $assigneeName', style: AppText.caption),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              StatusChip(
                label: task.requiresPhoto
                    ? 'Photo required'
                    : 'No photo needed',
                color: task.requiresPhoto ? AppColors.purple : AppColors.muted,
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (photo != null)
                PhotoThumbnail(photo: photo, size: 78)
              else
                const _DashedPlaceholder(size: 78),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    InfoRow(
                      label: 'Completed',
                      value: dateTimeLabel(completedAt),
                    ),
                    InfoRow(
                      label: 'Due was',
                      value:
                          '${dateLabel(task.dueAt)} • ${timeLabel(task.dueAt)}',
                    ),
                    InfoRow(
                      label: 'Proof',
                      value: photo != null
                          ? 'Attached'
                          : (task.requiresPhoto ? 'Missing' : 'Not required'),
                      valueColor: photo != null
                          ? AppColors.green
                          : (task.requiresPhoto
                                ? AppColors.red
                                : AppColors.muted),
                    ),
                    if (notes.isNotEmpty) ...[
                      const SizedBox(height: 6),
                      Text(
                        notes,
                        maxLines: 3,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 11.5,
                          color: AppColors.muted,
                          height: 1.4,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              ActionPill(
                icon: Icons.open_in_new_rounded,
                label: 'Open task',
                onTap: () => Navigator.of(context).pushNamed(
                  '/task',
                  arguments: <String, String>{'taskId': task.id},
                ),
              ),
              if (isOwner && task.requiresPhoto)
                ActionPill(
                  icon: photo == null
                      ? Icons.add_a_photo_rounded
                      : Icons.swap_horiz_rounded,
                  label: photo == null
                      ? 'Add fallback photo'
                      : 'Replace with fallback',
                  onTap: () => _attachFallback(repo, task),
                ),
            ],
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
    final all = _completedTasks(
      repo,
      isOwner: isOwner,
      myEmployeeId: myEmployeeId,
    );
    final missing = _missingCount(all);
    final withProof = all.where((t) => t.completionPhoto != null).length;
    final rows = _visible(repo, isOwner: isOwner, myEmployeeId: myEmployeeId);

    return Scaffold(
      appBar: AppBar(
        title: Text(isOwner ? 'Completion photos' : 'My completion photos'),
      ),
      body: SafeArea(
        child: ListView(
          padding: AppSpacing.page,
          children: [
            _header(all, missing, withProof),
            const SizedBox(height: 14),
            FilterChipsRow(
              options: isOwner
                  ? _filters
                  : const <String>[
                      'Missing proof',
                      'With proof',
                      'My completed',
                    ],
              selected: _filter,
              onSelected: (option) => setState(() => _filter = option),
            ),
            const SizedBox(height: 12),
            DemoNotice(
              text: isOwner
                  ? 'Fallback photos are stored on the task record with your note so the audit trail shows who supplied the proof. Nothing here touches a live server.'
                  : 'You can review your own closed tasks here. The owner controls the fallback proof in the review queue.',
            ),
            const SizedBox(height: 12),
            if (rows.isEmpty)
              WhitePanel(
                child: EmptyState(
                  icon: _filter == 'Missing proof'
                      ? Icons.verified_rounded
                      : Icons.photo_library_rounded,
                  title: _filter == 'Missing proof'
                      ? 'No proof pending'
                      : 'Nothing in this list',
                  subtitle: _filter == 'Missing proof'
                      ? 'Every closed task that needs a photo already has one.'
                      : 'Try another filter — closed tasks appear as soon as they are completed.',
                ),
              )
            else
              for (final task in rows) ...[
                _row(repo, task, isOwner: isOwner),
                const SizedBox(height: 12),
              ],
            const SizedBox(height: 4),
          ],
        ),
      ),
    );
  }
}

/// Header counters for the review queue.
class _SummaryStat extends StatelessWidget {
  const _SummaryStat({required this.label, required this.count});

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

/// Photo frame shown when a completed task has no proof image attached.
class _DashedPlaceholder extends StatelessWidget {
  const _DashedPlaceholder({required this.size});

  final double size;

  @override
  Widget build(BuildContext context) => SizedBox(
    width: size,
    height: size,
    child: CustomPaint(
      painter: _DashedRRectPainter(color: AppColors.red.withValues(alpha: .55)),
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.no_photography_rounded,
              color: AppColors.red,
              size: 20,
            ),
            const SizedBox(height: 3),
            Text(
              'No photo',
              style: TextStyle(
                color: AppColors.red.withValues(alpha: .9),
                fontSize: 9.5,
                fontWeight: FontWeight.w800,
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

class _DashedRRectPainter extends CustomPainter {
  _DashedRRectPainter({required this.color});

  final Color color;

  static const double _radius = 13;
  static const double _dash = 5;
  static const double _gap = 4;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.5;
    final path = Path()
      ..addRRect(
        RRect.fromRectAndRadius(
          Offset.zero & size,
          const Radius.circular(_radius),
        ),
      );
    for (final metric in path.computeMetrics()) {
      double distance = 0;
      while (distance < metric.length) {
        canvas.drawPath(metric.extractPath(distance, distance + _dash), paint);
        distance += _dash + _gap;
      }
    }
  }

  @override
  bool shouldRepaint(_DashedRRectPainter oldDelegate) =>
      oldDelegate.color != color;
}

class _FallbackDraft {
  _FallbackDraft(this.photo, this.note);

  final DemoPhoto photo;
  final String note;
}

class _FallbackPhotoSheet extends StatefulWidget {
  const _FallbackPhotoSheet({required this.task});

  final WorkTask task;

  @override
  State<_FallbackPhotoSheet> createState() => _FallbackPhotoSheetState();
}

class _FallbackPhotoSheetState extends State<_FallbackPhotoSheet> {
  final TextEditingController _noteController = TextEditingController();
  List<DemoPhoto> _photos = const [];

  @override
  void dispose() {
    _noteController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => SafeArea(
    child: Padding(
      padding: EdgeInsets.fromLTRB(
        16,
        14,
        16,
        16 + MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 42,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.line,
                borderRadius: BorderRadius.circular(4),
              ),
            ),
            const SizedBox(height: 14),
            Text('Fallback proof — ${widget.task.id}', style: AppText.title),
            const SizedBox(height: 4),
            Text(
              widget.task.title,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: AppText.caption,
            ),
            const SizedBox(height: 14),
            PhotoPickerPanel(
              title: 'Photo from the review queue',
              helper:
                  'Pick one image that supports the completion — for example the dispatched goods or the signed papers.',
              photos: _photos,
              maxPhotos: 1,
              onPhotosChanged: (photos) => setState(() => _photos = photos),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: _noteController,
              minLines: 2,
              maxLines: 4,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(
                labelText: 'Why is this photo added?',
                hintText:
                    'e.g. Employee phone camera failed, shop photo taken on the owner device.',
              ),
            ),
            const SizedBox(height: 14),
            const DemoNotice(
              text:
                  'Photos stay in this demo session only. The note is appended to the task completion notes.',
            ),
            const SizedBox(height: 14),
            GradientButton(
              label: 'Attach fallback photo',
              icon: Icons.cloud_upload_rounded,
              gradient: AppGradients.task,
              onPressed: _photos.isEmpty
                  ? null
                  : () => Navigator.of(context).pop(
                      _FallbackDraft(
                        _photos.first,
                        _noteController.text.trim(),
                      ),
                    ),
            ),
          ],
        ),
      ),
    ),
  );
}
