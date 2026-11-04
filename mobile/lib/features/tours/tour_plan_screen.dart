import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/formatters.dart';
import '../../core/share_service.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import '../../data/mock_repository.dart';
import '../../data/models.dart';

/// Tour Plan — field beat planner: daily visits, upcoming plans, completed
/// days and missed visits, with GPS/photo proof capture per visit.
class TourPlanScreen extends StatefulWidget {
  const TourPlanScreen({super.key});

  @override
  State<TourPlanScreen> createState() => _TourPlanScreenState();
}

class _TourPlanScreenState extends State<TourPlanScreen> {
  static const _tabs = <String>[
    'Daily',
    'Upcoming',
    'Completed',
    'Missed visits',
  ];

  List<TourPlan> _scopedPlans(
    MockRepository repo,
    bool isOwner,
    String? myEmployeeId,
  ) => isOwner
      ? List<TourPlan>.from(repo.tours)
      : repo.tours
            .where(
              (plan) =>
                  myEmployeeId != null && plan.salespersonId == myEmployeeId,
            )
            .toList();

  List<TourPlan> _plansForTab(List<TourPlan> plans, int tab) {
    final today = DateUtils.dateOnly(DateTime.now());
    final tomorrow = today.add(const Duration(days: 1));
    final result = <TourPlan>[];
    for (final plan in plans) {
      final day = DateUtils.dateOnly(plan.date);
      final allDone =
          plan.visits.isNotEmpty &&
          plan.visits.every((v) => v.status == VisitStatus.completed);
      final include = switch (tab) {
        0 => !day.isBefore(today) && !day.isAfter(tomorrow),
        1 => day.isAfter(tomorrow),
        2 => day.isBefore(today) || allDone,
        _ => false,
      };
      if (include) result.add(plan);
    }
    result.sort(
      tab == 2
          ? (a, b) => b.date.compareTo(a.date)
          : (a, b) => a.date.compareTo(b.date),
    );
    return result;
  }

  List<_MissedRow> _missedRows(List<TourPlan> plans) {
    final rows = <_MissedRow>[];
    for (final plan in plans) {
      for (final visit in plan.visits) {
        if (visit.status == VisitStatus.missed) {
          rows.add(_MissedRow(plan, visit));
        }
      }
    }
    rows.sort((a, b) {
      final byDate = b.plan.date.compareTo(a.plan.date);
      return byDate != 0
          ? byDate
          : a.visit.sequence.compareTo(b.visit.sequence);
    });
    return rows;
  }

  Future<void> _addPlan(
    MockRepository repo, {
    String? lockedSalespersonId,
  }) async {
    final draft = await showModalBottomSheet<_PlanDraft>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
      ),
      builder: (_) => _PlanFormSheet(
        employees: repo.employees,
        lockedSalespersonId: lockedSalespersonId,
      ),
    );
    if (draft == null || !mounted) return;
    final ok = await ConfirmDialog.show(
      context,
      title: 'Save tour plan',
      message:
          'Create the ${relativeDay(draft.date)} beat plan for ${repo.salespersonName(draft.salespersonId)} covering ${draft.area}?',
      confirmLabel: 'Save plan',
    );
    if (!ok || !mounted) return;
    final plan = repo.addTourPlan(
      salespersonId: draft.salespersonId,
      date: draft.date,
      area: draft.area,
      notes: draft.notes,
    );
    if (!mounted) return;
    showDemoSnack(context, '${plan.id} created — add the visits now.');
    Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => _TourDetailPage(tourId: plan.id)),
    );
  }

  Widget _scopeNotice(
    bool isOwner,
    String? myEmployeeId,
    MockRepository repo,
  ) => isOwner
      ? const DemoNotice(
          text:
              'Owner view — every salesperson beat plan is listed. Field staff only ever see their own plan.',
        )
      : DemoNotice(
          text:
              'Scoped for ${myEmployeeId == null ? 'your login' : repo.salespersonName(myEmployeeId)} — only your own tour plans appear here.',
        );

  Widget _plansTab({
    required MockRepository repo,
    required List<TourPlan> plans,
    required bool isOwner,
    required bool canPlan,
    required String? myEmployeeId,
    required String emptyTitle,
    required String emptySubtitle,
  }) {
    return ListView(
      padding: AppSpacing.page,
      children: [
        _scopeNotice(isOwner, myEmployeeId, repo),
        const SizedBox(height: 14),
        if (plans.isEmpty)
          EmptyState(
            icon: Icons.route_outlined,
            title: emptyTitle,
            subtitle: emptySubtitle,
            action: canPlan
                ? GradientButton(
                    label: 'Add plan',
                    icon: Icons.add_rounded,
                    height: 46,
                    expand: false,
                    onPressed: () => _addPlan(
                      repo,
                      lockedSalespersonId: isOwner ? null : myEmployeeId,
                    ),
                  )
                : null,
          )
        else ...[
          SectionHeading(
            title: '${plans.length} plan(s)',
            subtitle:
                'Open a plan to update visit status, GPS proof and photos.',
          ),
          const SizedBox(height: 10),
          for (final plan in plans)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: _TourPlanCard(
                plan: plan,
                salespersonName: repo.salespersonName(plan.salespersonId),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => _TourDetailPage(tourId: plan.id),
                  ),
                ),
              ),
            ),
        ],
      ],
    );
  }

  Widget _missedTab({
    required MockRepository repo,
    required List<_MissedRow> rows,
    required bool isOwner,
    required String? myEmployeeId,
  }) {
    return ListView(
      padding: AppSpacing.page,
      children: [
        _scopeNotice(isOwner, myEmployeeId, repo),
        const SizedBox(height: 14),
        if (rows.isEmpty)
          const EmptyState(
            icon: Icons.how_to_reg_outlined,
            title: 'No missed visits',
            subtitle: 'Every visit on the plans you can see is still on track.',
          )
        else ...[
          SectionHeading(
            title: '${rows.length} missed visit(s)',
            subtitle: 'Open the plan to reschedule or record a reason.',
          ),
          const SizedBox(height: 10),
          for (final row in rows)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: _TourPlanCard(
                plan: row.plan,
                salespersonName: repo.salespersonName(row.plan.salespersonId),
                missedVisitId: row.visit.id,
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => _TourDetailPage(tourId: row.plan.id),
                  ),
                ),
              ),
            ),
        ],
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final repo = context.watch<MockRepository>();
    final user = repo.currentUser;
    final isOwner = user?.isOwner ?? true;
    final myEmployeeId = user?.employeeId;
    final canPlan =
        isOwner || (user?.department ?? '').toLowerCase() == 'sales';

    final visible = _scopedPlans(repo, isOwner, myEmployeeId);
    final daily = _plansForTab(visible, 0);
    final upcoming = _plansForTab(visible, 1);
    final completed = _plansForTab(visible, 2);
    final missed = _missedRows(visible);

    return DefaultTabController(
      length: _tabs.length,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Tour Plan'),
          actions: [
            if (canPlan)
              IconButton(
                tooltip: 'Add tour plan',
                icon: const Icon(Icons.add_rounded),
                onPressed: () => _addPlan(
                  repo,
                  lockedSalespersonId: isOwner ? null : myEmployeeId,
                ),
              ),
          ],
          bottom: TabBar(
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
              Tab(text: 'Daily (${daily.length})'),
              Tab(text: 'Upcoming (${upcoming.length})'),
              Tab(text: 'Completed (${completed.length})'),
              Tab(text: 'Missed visits (${missed.length})'),
            ],
          ),
        ),
        floatingActionButton: canPlan
            ? FloatingActionButton.extended(
                onPressed: () => _addPlan(
                  repo,
                  lockedSalespersonId: isOwner ? null : myEmployeeId,
                ),
                backgroundColor: AppColors.purple,
                foregroundColor: Colors.white,
                icon: const Icon(Icons.add_rounded),
                label: const Text('Add plan'),
              )
            : null,
        body: TabBarView(
          children: [
            _plansTab(
              repo: repo,
              plans: daily,
              isOwner: isOwner,
              canPlan: canPlan,
              myEmployeeId: myEmployeeId,
              emptyTitle: 'No plans for today or tomorrow',
              emptySubtitle:
                  'Create a beat plan for today or tomorrow to start the round.',
            ),
            _plansTab(
              repo: repo,
              plans: upcoming,
              isOwner: isOwner,
              canPlan: canPlan,
              myEmployeeId: myEmployeeId,
              emptyTitle: 'Nothing planned ahead',
              emptySubtitle:
                  'Add a tour plan for a future date to build the visit calendar.',
            ),
            _plansTab(
              repo: repo,
              plans: completed,
              isOwner: isOwner,
              canPlan: canPlan,
              myEmployeeId: myEmployeeId,
              emptyTitle: 'No completed plans yet',
              emptySubtitle:
                  'A plan lands here once its date has passed or every visit is marked completed.',
            ),
            _missedTab(
              repo: repo,
              rows: missed,
              isOwner: isOwner,
              myEmployeeId: myEmployeeId,
            ),
          ],
        ),
      ),
    );
  }
}

class _MissedRow {
  const _MissedRow(this.plan, this.visit);
  final TourPlan plan;
  final TourVisit visit;
}

Color _visitStatusColor(VisitStatus status) => switch (status) {
  VisitStatus.planned => AppColors.blue,
  VisitStatus.completed => AppColors.green,
  VisitStatus.missed => AppColors.red,
};

Color _planDateColor(DateTime date) {
  final today = DateUtils.dateOnly(DateTime.now());
  final day = DateUtils.dateOnly(date);
  if (day.isBefore(today)) return AppColors.muted;
  if (day == today) return AppColors.purple;
  return AppColors.blue;
}

List<TourVisit> _orderedVisits(TourPlan plan) {
  final list = List<TourVisit>.from(plan.visits);
  list.sort((a, b) => a.sequence.compareTo(b.sequence));
  return list;
}

int _nextSequence(List<TourVisit> visits) {
  var max = 0;
  for (final visit in visits) {
    if (visit.sequence > max) max = visit.sequence;
  }
  return max + 1;
}

String _shortName(String name) {
  final parts = name.trim().split(RegExp(r'\s+'));
  final short = parts.length <= 2 ? name.trim() : '${parts[0]} ${parts[1]}';
  return short.length <= 20 ? short : '${short.substring(0, 20)}…';
}

String _tourShareText(TourPlan plan, MockRepository repo) {
  final visits = _orderedVisits(plan);
  var completed = 0;
  var missed = 0;
  for (final visit in visits) {
    if (visit.status == VisitStatus.completed) completed++;
    if (visit.status == VisitStatus.missed) missed++;
  }
  final buffer = StringBuffer()
    ..writeln('TOUR PLAN ${plan.id}')
    ..writeln('Salesperson: ${repo.salespersonName(plan.salespersonId)}')
    ..writeln('Date: ${dateLabel(plan.date)} (${relativeDay(plan.date)})')
    ..writeln('Area: ${plan.area}')
    ..writeln(
      'Visits: ${visits.length} • completed $completed • missed $missed',
    )
    ..writeln('');
  for (final visit in visits) {
    buffer.write('#${visit.sequence} ${visit.customerName} (${visit.city})\n');
    buffer.write('   ${visit.purpose} — ${visitStatusLabel(visit.status)}');
    if (visit.actualTime != null) {
      buffer.write(' at ${timeLabel(visit.actualTime!)}');
    }
    if (visit.gpsVerified) {
      buffer.write(' • GPS verified');
    } else if (visit.gpsLat != null) {
      buffer.write(' • location entered manually');
    }
    if (visit.notes.trim().isNotEmpty) {
      buffer.write('\n   Note: ${visit.notes.trim()}');
    }
    buffer.write('\n');
  }
  buffer.write('\nShared from the Dura Smart demo workspace.');
  return buffer.toString();
}

class _TourPlanCard extends StatelessWidget {
  const _TourPlanCard({
    required this.plan,
    required this.salespersonName,
    required this.onTap,
    this.missedVisitId,
  });
  final TourPlan plan;
  final String salespersonName;
  final VoidCallback onTap;
  final String? missedVisitId;

  @override
  Widget build(BuildContext context) {
    final visits = _orderedVisits(plan);
    var completed = 0;
    var planned = 0;
    var missed = 0;
    for (final visit in visits) {
      switch (visit.status) {
        case VisitStatus.completed:
          completed++;
        case VisitStatus.planned:
          planned++;
        case VisitStatus.missed:
          missed++;
      }
    }
    TourVisit? focused;
    if (missedVisitId != null) {
      for (final visit in visits) {
        if (visit.id == missedVisitId) focused = visit;
      }
    }
    return WhitePanel(
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  salespersonName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppText.title,
                ),
              ),
              const SizedBox(width: 8),
              StatusChip(
                label: relativeDay(plan.date),
                color: _planDateColor(plan.date),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Row(
            children: [
              const Icon(
                Icons.place_outlined,
                size: 15,
                color: AppColors.muted,
              ),
              const SizedBox(width: 5),
              Expanded(
                child: Text(
                  '${plan.area} • ${dateLabel(plan.date)}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.muted,
                    fontSize: 11.5,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 9),
          Text(
            '${visits.length} visit(s) • $completed completed • $planned planned • $missed missed',
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 11.5,
              fontWeight: FontWeight.w800,
              color: AppColors.ink,
            ),
          ),
          const SizedBox(height: 9),
          if (visits.isEmpty)
            const Text(
              'No visits added yet — open the plan to add the first customer.',
              style: TextStyle(fontSize: 11.5, color: AppColors.muted),
            )
          else
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final visit in visits)
                  StatusChip(
                    label:
                        '#${visit.sequence} ${_shortName(visit.customerName)} • ${visitStatusLabel(visit.status)}',
                    color: _visitStatusColor(visit.status),
                  ),
              ],
            ),
          if (focused != null) ...[
            const SizedBox(height: 10),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
              decoration: BoxDecoration(
                color: const Color(0xFFFDECEE),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(
                'Missed • #${focused.sequence} ${focused.customerName} (${focused.city})${focused.notes.trim().isEmpty ? '' : ' — ${focused.notes.trim()}'}',
                style: const TextStyle(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w800,
                  color: AppColors.red,
                  height: 1.4,
                ),
              ),
            ),
          ],
          if (plan.notes.trim().isNotEmpty) ...[
            const SizedBox(height: 10),
            Text(
              plan.notes.trim(),
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontSize: 11.5,
                height: 1.45,
                color: Color(0xFF4C4870),
              ),
            ),
          ],
          const SizedBox(height: 10),
          const Row(
            children: [
              Icon(
                Icons.arrow_forward_rounded,
                size: 16,
                color: AppColors.purple,
              ),
              SizedBox(width: 5),
              Text(
                'Open plan detail',
                style: TextStyle(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w900,
                  color: AppColors.purple,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _PlanDraft {
  const _PlanDraft({
    required this.salespersonId,
    required this.date,
    required this.area,
    required this.notes,
  });
  final String salespersonId;
  final DateTime date;
  final String area;
  final String notes;
}

class _PlanFormSheet extends StatefulWidget {
  const _PlanFormSheet({required this.employees, this.lockedSalespersonId});
  final List<Employee> employees;
  final String? lockedSalespersonId;

  @override
  State<_PlanFormSheet> createState() => _PlanFormSheetState();
}

class _PlanFormSheetState extends State<_PlanFormSheet> {
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  final TextEditingController _area = TextEditingController();
  final TextEditingController _notes = TextEditingController();
  late DateTime _date = DateUtils.dateOnly(DateTime.now());
  String? _salespersonId;

  @override
  void initState() {
    super.initState();
    _salespersonId = widget.lockedSalespersonId;
  }

  @override
  void dispose() {
    _area.dispose();
    _notes.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _date,
      firstDate: DateTime(now.year - 1, now.month, now.day),
      lastDate: DateTime(now.year + 2, now.month, now.day),
    );
    if (picked == null || !mounted) return;
    setState(() => _date = DateUtils.dateOnly(picked));
  }

  void _submit() {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    final salespersonId = widget.lockedSalespersonId ?? _salespersonId;
    if (salespersonId == null) return;
    Navigator.pop(
      context,
      _PlanDraft(
        salespersonId: salespersonId,
        date: _date,
        area: _area.text.trim(),
        notes: _notes.text.trim(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final salespeople = widget.employees
        .where((e) => e.department.toLowerCase() == 'sales')
        .toList();
    final locked = widget.lockedSalespersonId != null;
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;

    return Padding(
      padding: EdgeInsets.only(bottom: bottomInset),
      child: SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxHeight: MediaQuery.sizeOf(context).height * .9,
          ),
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(18, 14, 18, 6),
                child: Row(
                  children: [
                    const Icon(
                      Icons.route_rounded,
                      color: AppColors.purple,
                      size: 20,
                    ),
                    const SizedBox(width: 8),
                    const Expanded(
                      child: Text('New tour plan', style: AppText.title),
                    ),
                    IconButton(
                      onPressed: () => Navigator.pop(context),
                      icon: const Icon(Icons.close_rounded),
                    ),
                  ],
                ),
              ),
              const Divider(height: 1),
              Flexible(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.fromLTRB(18, 14, 18, 8),
                  child: Form(
                    key: _formKey,
                    child: Column(
                      children: [
                        if (locked)
                          WhitePanel(
                            child: InfoRow(
                              label: 'Salesperson',
                              value: salespeople.isEmpty
                                  ? widget.lockedSalespersonId!
                                  : _nameOf(
                                      salespeople,
                                      widget.lockedSalespersonId!,
                                    ),
                            ),
                          )
                        else ...[
                          DropdownButtonFormField<String>(
                            initialValue: _salespersonId,
                            isExpanded: true,
                            decoration: const InputDecoration(
                              labelText: 'Salesperson *',
                            ),
                            items: [
                              for (final emp in salespeople)
                                DropdownMenuItem<String>(
                                  value: emp.id,
                                  child: Text(
                                    '${emp.name} • ${emp.role}',
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                            ],
                            onChanged: (value) =>
                                setState(() => _salespersonId = value),
                            validator: (value) => Validation.required(
                              value,
                              field: 'Salesperson',
                            ),
                          ),
                          const SizedBox(height: 12),
                        ],
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.fromLTRB(14, 8, 8, 8),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(
                              AppRadius.field,
                            ),
                            border: Border.all(color: AppColors.line),
                          ),
                          child: Row(
                            children: [
                              const Icon(
                                Icons.event_rounded,
                                size: 18,
                                color: AppColors.purple,
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Text(
                                  '${dateLabel(_date)} • ${relativeDay(_date)}',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    fontWeight: FontWeight.w800,
                                    fontSize: 13,
                                  ),
                                ),
                              ),
                              TextButton(
                                onPressed: _pickDate,
                                child: const Text('Change'),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 12),
                        TextFormField(
                          controller: _area,
                          textCapitalization: TextCapitalization.words,
                          decoration: const InputDecoration(
                            labelText: 'Area / route *',
                            hintText: 'Ludhiana + Khanna',
                          ),
                          validator: (value) =>
                              Validation.required(value, field: 'Area'),
                        ),
                        const SizedBox(height: 12),
                        TextFormField(
                          controller: _notes,
                          minLines: 2,
                          maxLines: 4,
                          decoration: const InputDecoration(
                            labelText: 'Plan notes',
                            alignLabelWithHint: true,
                            hintText: 'Payment follow-up round, carry samples',
                          ),
                        ),
                        const SizedBox(height: 14),
                        GradientButton(
                          label: 'Save plan',
                          icon: Icons.save_rounded,
                          onPressed: _submit,
                        ),
                        const SizedBox(height: 8),
                        const DemoNotice(
                          text:
                              'The plan is created empty. Add customers as visits right after saving — each visit can carry its own GPS and photo proof.',
                        ),
                        const SizedBox(height: 10),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _nameOf(List<Employee> employees, String id) {
    for (final emp in employees) {
      if (emp.id == id) return '${emp.name} • ${emp.role}';
    }
    return id;
  }
}

class _VisitDraft {
  const _VisitDraft({
    required this.customerId,
    required this.customerName,
    required this.city,
    required this.purpose,
    required this.notes,
  });
  final String customerId;
  final String customerName;
  final String city;
  final String purpose;
  final String notes;
}

class _VisitFormSheet extends StatefulWidget {
  const _VisitFormSheet({required this.customers});
  final List<Customer> customers;

  @override
  State<_VisitFormSheet> createState() => _VisitFormSheetState();
}

class _VisitFormSheetState extends State<_VisitFormSheet> {
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  final TextEditingController _purpose = TextEditingController();
  final TextEditingController _notes = TextEditingController();
  String? _customerId;

  @override
  void dispose() {
    _purpose.dispose();
    _notes.dispose();
    super.dispose();
  }

  Customer? get _selected {
    for (final customer in widget.customers) {
      if (customer.id == _customerId) return customer;
    }
    return null;
  }

  void _submit() {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    final customer = _selected;
    if (customer == null) return;
    Navigator.pop(
      context,
      _VisitDraft(
        customerId: customer.id,
        customerName: customer.name,
        city: customer.city,
        purpose: _purpose.text.trim(),
        notes: _notes.text.trim(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final sorted = List<Customer>.from(widget.customers)
      ..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
    final selected = _selected;
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;

    return Padding(
      padding: EdgeInsets.only(bottom: bottomInset),
      child: SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxHeight: MediaQuery.sizeOf(context).height * .9,
          ),
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(18, 14, 18, 6),
                child: Row(
                  children: [
                    const Icon(
                      Icons.add_business_rounded,
                      color: AppColors.purple,
                      size: 20,
                    ),
                    const SizedBox(width: 8),
                    const Expanded(
                      child: Text('Add visit', style: AppText.title),
                    ),
                    IconButton(
                      onPressed: () => Navigator.pop(context),
                      icon: const Icon(Icons.close_rounded),
                    ),
                  ],
                ),
              ),
              const Divider(height: 1),
              Flexible(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.fromLTRB(18, 14, 18, 8),
                  child: Form(
                    key: _formKey,
                    child: Column(
                      children: [
                        DropdownButtonFormField<String>(
                          initialValue: _customerId,
                          isExpanded: true,
                          decoration: const InputDecoration(
                            labelText: 'Customer *',
                          ),
                          items: [
                            for (final customer in sorted)
                              DropdownMenuItem<String>(
                                value: customer.id,
                                child: Text(
                                  '${customer.name} • ${customer.city}',
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                          ],
                          onChanged: (value) =>
                              setState(() => _customerId = value),
                          validator: (value) =>
                              Validation.required(value, field: 'Customer'),
                        ),
                        const SizedBox(height: 10),
                        if (selected != null)
                          WhitePanel(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 14,
                              vertical: 6,
                            ),
                            child: Column(
                              children: [
                                InfoRow(
                                  label: 'City filled automatically',
                                  value: selected.city,
                                ),
                                InfoRow(
                                  label: 'Customer salesperson',
                                  value: context
                                      .watch<MockRepository>()
                                      .salespersonName(selected.salespersonId),
                                ),
                              ],
                            ),
                          )
                        else
                          const DemoNotice(
                            text:
                                'Pick a customer — the visit city is taken from the customer record automatically.',
                          ),
                        const SizedBox(height: 12),
                        TextFormField(
                          controller: _purpose,
                          textCapitalization: TextCapitalization.sentences,
                          decoration: const InputDecoration(
                            labelText: 'Purpose *',
                            hintText: 'Payment follow-up',
                          ),
                          validator: (value) =>
                              Validation.required(value, field: 'Purpose'),
                        ),
                        const SizedBox(height: 12),
                        TextFormField(
                          controller: _notes,
                          minLines: 2,
                          maxLines: 4,
                          decoration: const InputDecoration(
                            labelText: 'Notes',
                            alignLabelWithHint: true,
                          ),
                        ),
                        const SizedBox(height: 14),
                        GradientButton(
                          label: 'Add visit',
                          icon: Icons.add_rounded,
                          onPressed: _submit,
                        ),
                        const SizedBox(height: 10),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _VisitProof {
  const _VisitProof({
    required this.gpsVerified,
    required this.notes,
    this.actualTime,
    this.lat,
    this.lng,
    this.photo,
  });
  final bool gpsVerified;
  final String notes;
  final DateTime? actualTime;
  final double? lat;
  final double? lng;
  final DemoPhoto? photo;
}

class _VisitProofSheet extends StatefulWidget {
  const _VisitProofSheet({required this.visit});
  final TourVisit visit;

  @override
  State<_VisitProofSheet> createState() => _VisitProofSheetState();
}

class _VisitProofSheetState extends State<_VisitProofSheet> {
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  late final TextEditingController _notes = TextEditingController(
    text: widget.visit.notes,
  );
  final TextEditingController _lat = TextEditingController();
  final TextEditingController _lng = TextEditingController();
  final DateTime _capturedAt = DateTime.now();
  List<DemoPhoto> _photos = <DemoPhoto>[];
  bool _recordTime = true;
  bool _gpsCaptured = false;

  @override
  void dispose() {
    _notes.dispose();
    _lat.dispose();
    _lng.dispose();
    super.dispose();
  }

  String? _validateCoord(
    String? value, {
    required String field,
    required double limit,
  }) {
    final text = (value ?? '').trim();
    if (text.isEmpty) return null;
    final parsed = double.tryParse(text);
    if (parsed == null || parsed.abs() > limit) {
      return 'Enter a valid $field (±${limit.toStringAsFixed(0)})';
    }
    return null;
  }

  void _submit() {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    Navigator.pop(
      context,
      _VisitProof(
        gpsVerified: _gpsCaptured,
        notes: _notes.text.trim(),
        actualTime: _recordTime ? _capturedAt : null,
        lat: double.tryParse(_lat.text.trim()),
        lng: double.tryParse(_lng.text.trim()),
        photo: _photos.isEmpty ? null : _photos.first,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;
    return Padding(
      padding: EdgeInsets.only(bottom: bottomInset),
      child: SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxHeight: MediaQuery.sizeOf(context).height * .92,
          ),
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(18, 14, 18, 6),
                child: Row(
                  children: [
                    const Icon(
                      Icons.check_circle_rounded,
                      color: AppColors.green,
                      size: 20,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'Complete #${widget.visit.sequence} • ${widget.visit.customerName}',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: AppText.title,
                      ),
                    ),
                    IconButton(
                      onPressed: () => Navigator.pop(context),
                      icon: const Icon(Icons.close_rounded),
                    ),
                  ],
                ),
              ),
              const Divider(height: 1),
              Flexible(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.fromLTRB(18, 14, 18, 8),
                  child: Form(
                    key: _formKey,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        CheckboxListTile(
                          value: _recordTime,
                          onChanged: (value) =>
                              setState(() => _recordTime = value ?? false),
                          controlAffinity: ListTileControlAffinity.leading,
                          contentPadding: EdgeInsets.zero,
                          title: const Text(
                            'Record actual time now',
                            style: TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          subtitle: Text(
                            'Captured as ${dateTimeLabel(_capturedAt)}',
                            style: AppText.caption,
                          ),
                        ),
                        const SizedBox(height: 6),
                        const DemoNotice(
                          text:
                              'Live GPS is not available in this demo build. Tick "GPS captured" only when you really have a device location, or enter the coordinates manually.',
                        ),
                        const SizedBox(height: 6),
                        CheckboxListTile(
                          value: _gpsCaptured,
                          onChanged: (value) =>
                              setState(() => _gpsCaptured = value ?? false),
                          controlAffinity: ListTileControlAffinity.leading,
                          contentPadding: EdgeInsets.zero,
                          title: const Text(
                            'GPS captured (demo)',
                            style: TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          subtitle: Text(
                            _gpsCaptured
                                ? 'This visit will be flagged as location verified.'
                                : 'Without this tick the visit stays marked as manually entered.',
                            style: AppText.caption,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Row(
                          children: [
                            Expanded(
                              child: TextFormField(
                                controller: _lat,
                                keyboardType:
                                    const TextInputType.numberWithOptions(
                                      decimal: true,
                                      signed: true,
                                    ),
                                decoration: const InputDecoration(
                                  labelText: 'Latitude',
                                ),
                                validator: (value) => _validateCoord(
                                  value,
                                  field: 'latitude',
                                  limit: 90,
                                ),
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: TextFormField(
                                controller: _lng,
                                keyboardType:
                                    const TextInputType.numberWithOptions(
                                      decimal: true,
                                      signed: true,
                                    ),
                                decoration: const InputDecoration(
                                  labelText: 'Longitude',
                                ),
                                validator: (value) => _validateCoord(
                                  value,
                                  field: 'longitude',
                                  limit: 180,
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        TextFormField(
                          controller: _notes,
                          minLines: 2,
                          maxLines: 4,
                          decoration: const InputDecoration(
                            labelText: 'Visit notes',
                            alignLabelWithHint: true,
                            hintText: 'Dealer promised balance by Friday',
                          ),
                        ),
                        const SizedBox(height: 12),
                        PhotoPickerPanel(
                          title: 'Visit photo (optional)',
                          helper:
                              'Shop-board or goods photo as visit proof. One photo is stored for the demo.',
                          photos: _photos,
                          maxPhotos: 1,
                          onPhotosChanged: (photos) =>
                              setState(() => _photos = photos),
                        ),
                        const SizedBox(height: 14),
                        GradientButton(
                          label: 'Save completed visit',
                          icon: Icons.save_rounded,
                          onPressed: _submit,
                        ),
                        const SizedBox(height: 10),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MissedDraft {
  const _MissedDraft(this.reason);
  final String reason;
}

class _MissedReasonSheet extends StatefulWidget {
  const _MissedReasonSheet({required this.visit});
  final TourVisit visit;

  @override
  State<_MissedReasonSheet> createState() => _MissedReasonSheetState();
}

class _MissedReasonSheetState extends State<_MissedReasonSheet> {
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  late final TextEditingController _reason = TextEditingController(
    text: widget.visit.notes,
  );

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  void _submit() {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    Navigator.pop(context, _MissedDraft(_reason.text.trim()));
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;
    return Padding(
      padding: EdgeInsets.only(bottom: bottomInset),
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(18, 14, 18, 14),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  const Icon(
                    Icons.do_not_disturb_on_outlined,
                    color: AppColors.red,
                    size: 20,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Miss #${widget.visit.sequence} • ${widget.visit.customerName}',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: AppText.title,
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(Icons.close_rounded),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Form(
                key: _formKey,
                child: TextFormField(
                  controller: _reason,
                  minLines: 3,
                  maxLines: 5,
                  autofocus: true,
                  decoration: const InputDecoration(
                    labelText: 'Reason / remarks *',
                    alignLabelWithHint: true,
                    hintText:
                        'Shop shut for maintenance, rescheduled next week',
                  ),
                  validator: (value) =>
                      Validation.required(value, field: 'Reason'),
                ),
              ),
              const SizedBox(height: 12),
              GradientButton(
                label: 'Continue',
                icon: Icons.arrow_forward_rounded,
                onPressed: _submit,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

Future<void> _addVisit(
  BuildContext context,
  MockRepository repo,
  TourPlan plan,
) async {
  final draft = await showModalBottomSheet<_VisitDraft>(
    context: context,
    isScrollControlled: true,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
    ),
    builder: (_) => _VisitFormSheet(customers: repo.customers),
  );
  if (draft == null || !context.mounted) return;
  final sequence = _nextSequence(plan.visits);
  repo.addVisit(
    plan.id,
    TourVisit(
      id: 'VST-${DateTime.now().microsecondsSinceEpoch}',
      customerId: draft.customerId,
      customerName: draft.customerName,
      city: draft.city,
      purpose: draft.purpose,
      sequence: sequence,
      notes: draft.notes,
    ),
  );
  showDemoSnack(context, '${draft.customerName} added as visit #$sequence.');
}

Future<void> _completeVisit(
  BuildContext context,
  MockRepository repo,
  TourPlan plan,
  TourVisit visit,
) async {
  final ok = await ConfirmDialog.show(
    context,
    title: 'Mark visit completed',
    message:
        'Log the visit to ${visit.customerName} (${visit.city}) as completed? Actual time, GPS and photo can be added next.',
    confirmLabel: 'Complete visit',
  );
  if (!ok || !context.mounted) return;
  final proof = await showModalBottomSheet<_VisitProof>(
    context: context,
    isScrollControlled: true,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
    ),
    builder: (_) => _VisitProofSheet(visit: visit),
  );
  if (proof == null || !context.mounted) return;
  repo.updateVisit(
    plan.id,
    visit.id,
    status: VisitStatus.completed,
    actualTime: proof.actualTime,
    gpsLat: proof.lat,
    gpsLng: proof.lng,
    gpsVerified: proof.gpsVerified,
    notes: proof.notes,
    photo: proof.photo,
  );
  showDemoSnack(
    context,
    proof.photo == null
        ? '${visit.customerName} completed — no visit photo attached.'
        : '${visit.customerName} completed with photo proof.',
  );
}

Future<void> _missVisit(
  BuildContext context,
  MockRepository repo,
  TourPlan plan,
  TourVisit visit,
) async {
  final ok = await ConfirmDialog.show(
    context,
    title: 'Mark visit missed',
    message:
        'Mark #${visit.sequence} ${visit.customerName} as missed? A reason will be stored on the visit.',
    confirmLabel: 'Mark missed',
    danger: true,
  );
  if (!ok || !context.mounted) return;
  final draft = await showModalBottomSheet<_MissedDraft>(
    context: context,
    isScrollControlled: true,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
    ),
    builder: (_) => _MissedReasonSheet(visit: visit),
  );
  if (draft == null || !context.mounted) return;
  repo.updateVisit(
    plan.id,
    visit.id,
    status: VisitStatus.missed,
    notes: draft.reason,
  );
  showDemoSnack(context, '${visit.customerName} recorded as missed.');
}

void _moveVisit(
  MockRepository repo,
  TourPlan plan,
  TourVisit visit,
  int delta,
) {
  final ordered = _orderedVisits(plan);
  final index = ordered.indexWhere((v) => v.id == visit.id);
  final swapWith = index + delta;
  if (index < 0 || swapWith < 0 || swapWith >= ordered.length) return;
  final current = ordered[index];
  final other = ordered[swapWith];
  final currentSequence = current.sequence;
  current.sequence = other.sequence;
  other.sequence = currentSequence;
  repo.updateVisit(plan.id, current.id, notes: current.notes);
  repo.updateVisit(plan.id, other.id, notes: other.notes);
}

class _VisitTile extends StatelessWidget {
  const _VisitTile({
    required this.visit,
    required this.index,
    required this.total,
    required this.canEdit,
    required this.onComplete,
    required this.onMiss,
    required this.onMove,
  });
  final TourVisit visit;
  final int index;
  final int total;
  final bool canEdit;
  final VoidCallback onComplete;
  final VoidCallback onMiss;
  final ValueChanged<int> onMove;

  @override
  Widget build(BuildContext context) {
    final photo = visit.photo;
    return WhitePanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
                decoration: BoxDecoration(
                  gradient: AppGradients.tour,
                  borderRadius: BorderRadius.circular(9),
                ),
                child: Text(
                  '#${visit.sequence}',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 11,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              const SizedBox(width: 9),
              Expanded(
                child: Text(
                  visit.customerName,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: AppText.heading,
                ),
              ),
              const SizedBox(width: 8),
              StatusChip(
                label: visitStatusLabel(visit.status),
                color: _visitStatusColor(visit.status),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            '${visit.city} • ${visit.purpose}',
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
              StatusChip(
                label: visit.actualTime == null
                    ? 'No actual time'
                    : 'Actual ${timeLabel(visit.actualTime!)}',
                color: visit.actualTime == null
                    ? AppColors.muted
                    : AppColors.teal,
              ),
              if (visit.gpsVerified)
                const StatusChip(label: 'GPS verified', color: AppColors.green)
              else if (visit.gpsLat != null)
                const StatusChip(
                  label: 'Manual location',
                  color: AppColors.orange,
                )
              else
                const StatusChip(label: 'No location', color: AppColors.faint),
              if (visit.gpsLat != null && visit.gpsLng != null)
                StatusChip(
                  label:
                      '${visit.gpsLat!.toStringAsFixed(3)}, ${visit.gpsLng!.toStringAsFixed(3)}',
                  color: AppColors.blue,
                ),
              InkWell(
                onTap: () {
                  final url = (visit.gpsLat != null && visit.gpsLng != null)
                      ? 'https://www.openstreetmap.org/directions?to=${visit.gpsLat},${visit.gpsLng}'
                      : 'https://www.openstreetmap.org/search?query=${Uri.encodeComponent('${visit.customerName}, ${visit.city}')}';
                  launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
                },
                borderRadius: BorderRadius.circular(16),
                child: const StatusChip(
                  label: '📍 Open Map',
                  color: AppColors.purple,
                ),
              ),
            ],
          ),
          if (visit.notes.trim().isNotEmpty) ...[
            const SizedBox(height: 10),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: const Color(0xFFF6F5FE),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(
                visit.notes.trim(),
                style: const TextStyle(
                  fontSize: 11.5,
                  height: 1.45,
                  color: Color(0xFF4C4870),
                ),
              ),
            ),
          ],
          if (photo != null) ...[
            const SizedBox(height: 10),
            PhotoThumbnail(photo: photo, size: 78),
          ],
          if (canEdit) ...[
            const SizedBox(height: 11),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                ActionPill(
                  icon: visit.status == VisitStatus.completed
                      ? Icons.update_rounded
                      : Icons.check_circle_outline_rounded,
                  label: visit.status == VisitStatus.completed
                      ? 'Update proof'
                      : 'Mark completed',
                  onTap: onComplete,
                ),
                ActionPill(
                  icon: Icons.do_not_disturb_on_outlined,
                  label: visit.status == VisitStatus.missed
                      ? 'Reason'
                      : 'Mark missed',
                  onTap: onMiss,
                ),
                ActionPill(
                  icon: Icons.arrow_upward_rounded,
                  label: 'Up',
                  onTap: index > 0
                      ? () => onMove(-1)
                      : () => showDemoSnack(
                          context,
                          'This is already the first visit.',
                        ),
                ),
                ActionPill(
                  icon: Icons.arrow_downward_rounded,
                  label: 'Down',
                  onTap: index < total - 1
                      ? () => onMove(1)
                      : () => showDemoSnack(
                          context,
                          'This is already the last visit.',
                        ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _TourDetailPage extends StatelessWidget {
  const _TourDetailPage({required this.tourId});
  final String tourId;

  @override
  Widget build(BuildContext context) {
    final repo = context.watch<MockRepository>();
    final plan = repo.tourById(tourId);
    if (plan == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Tour plan')),
        body: const Center(
          child: EmptyState(
            icon: Icons.route_outlined,
            title: 'Plan not found',
            subtitle: 'It may have been removed from the demo workspace.',
          ),
        ),
      );
    }
    final user = repo.currentUser;
    final isOwner = user?.isOwner ?? true;
    final myEmployeeId = user?.employeeId;
    final canEdit =
        isOwner || (myEmployeeId != null && plan.salespersonId == myEmployeeId);
    final visits = _orderedVisits(plan);
    final employee = repo.employeeById(plan.salespersonId);
    var completed = 0;
    var planned = 0;
    var missed = 0;
    for (final visit in visits) {
      switch (visit.status) {
        case VisitStatus.completed:
          completed++;
        case VisitStatus.planned:
          planned++;
        case VisitStatus.missed:
          missed++;
      }
    }

    return Scaffold(
      appBar: AppBar(
        title: Text('Tour ${plan.id}'),
        actions: [
          if (canEdit)
            IconButton(
              tooltip: 'Add visit',
              icon: const Icon(Icons.add_business_rounded),
              onPressed: () => _addVisit(context, repo, plan),
            ),
        ],
      ),
      body: ListView(
        padding: AppSpacing.page,
        children: [
          GradientHero(
            height: 148,
            gradient: AppGradients.tour,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  repo.salespersonName(plan.salespersonId),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 19,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  '${plan.area} • ${relativeDay(plan.date)}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: Colors.white70, fontSize: 12),
                ),
                const Spacer(),
                Row(
                  children: [
                    _PlanStat(label: 'Visits', count: visits.length),
                    _PlanStat(label: 'Done', count: completed),
                    _PlanStat(label: 'Planned', count: planned),
                    _PlanStat(label: 'Missed', count: missed),
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
                const SectionHeading(title: 'Plan details'),
                const SizedBox(height: 4),
                InfoRow(
                  label: 'Salesperson',
                  value: repo.salespersonName(plan.salespersonId),
                ),
                InfoRow(
                  label: 'Plan date',
                  value: '${dateLabel(plan.date)} (${relativeDay(plan.date)})',
                ),
                InfoRow(label: 'Area / route', value: plan.area),
                InfoRow(
                  label: 'Visits',
                  value: '${visits.length}',
                  valueColor: visits.isEmpty ? AppColors.orange : AppColors.ink,
                ),
                InfoRow(
                  label: 'Completion',
                  value:
                      '${visits.isEmpty ? 0 : ((completed / visits.length) * 100).round()}%',
                ),
                if (plan.notes.trim().isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Text(
                    plan.notes.trim(),
                    style: const TextStyle(
                      fontSize: 11.5,
                      height: 1.45,
                      color: Color(0xFF4C4870),
                    ),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 12),
          if (!canEdit)
            const DemoNotice(
              text:
                  'Read-only plan: only the owner or the assigned salesperson can update these visits.',
            )
          else
            const DemoNotice(
              text:
                  'Update visit status, actual time, GPS and photos as the round progresses. Reorder with Up / Down.',
            ),
          const SizedBox(height: 14),
          SectionHeading(
            title: 'Visit sequence',
            subtitle: '${visits.length} stop(s) on this route',
          ),
          const SizedBox(height: 8),
          if (visits.isEmpty)
            EmptyState(
              icon: Icons.add_business_outlined,
              title: 'No visits yet',
              subtitle: 'Add the customers you plan to meet on this round.',
              action: canEdit
                  ? GradientButton(
                      label: 'Add visit',
                      icon: Icons.add_rounded,
                      height: 46,
                      expand: false,
                      onPressed: () => _addVisit(context, repo, plan),
                    )
                  : null,
            )
          else
            for (var i = 0; i < visits.length; i++)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: _VisitTile(
                  visit: visits[i],
                  index: i,
                  total: visits.length,
                  canEdit: canEdit,
                  onComplete: () =>
                      _completeVisit(context, repo, plan, visits[i]),
                  onMiss: () => _missVisit(context, repo, plan, visits[i]),
                  onMove: (delta) => _moveVisit(repo, plan, visits[i], delta),
                ),
              ),
          const SizedBox(height: 6),
          if (canEdit) ...[
            GradientButton(
              label: 'Add visit',
              icon: Icons.add_business_rounded,
              onPressed: () => _addVisit(context, repo, plan),
            ),
            const SizedBox(height: 10),
          ],
          WhatsAppButton(
            label: 'Share visit list',
            phone: employee?.phone ?? '',
            message: _tourShareText(plan, repo),
          ),
          const SizedBox(height: 12),
          ActionPill(
            icon: Icons.chevron_left_rounded,
            label: 'Back to tour plans',
            onTap: () => Navigator.of(context).pop(),
          ),
          const SizedBox(height: 10),
        ],
      ),
    );
  }
}

class _PlanStat extends StatelessWidget {
  const _PlanStat({required this.label, required this.count});
  final String label;
  final int count;

  @override
  Widget build(BuildContext context) => Expanded(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '$count',
          style: const TextStyle(
            color: Colors.white,
            fontSize: 17,
            fontWeight: FontWeight.w900,
          ),
        ),
        Text(
          label,
          style: const TextStyle(
            color: Colors.white70,
            fontSize: 10,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    ),
  );
}
