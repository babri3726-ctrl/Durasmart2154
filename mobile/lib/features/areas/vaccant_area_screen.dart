import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/formatters.dart';
import '../../core/share_service.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import '../../data/mock_repository.dart';
import '../../data/models.dart';

/// Vaccant Area — territory master screen. The label stays exactly as approved
/// in the client deck ("Vaccant Area") so the menu, hero and route agree.
class VaccantAreaScreen extends StatefulWidget {
  const VaccantAreaScreen({super.key});

  @override
  State<VaccantAreaScreen> createState() => _VaccantAreaScreenState();
}

class _VaccantAreaScreenState extends State<VaccantAreaScreen> {
  static const _filters = <String>[
    'All',
    'Vacant',
    'Assigned',
    'Partly Covered',
    'My area',
  ];
  static const _sorts = <String>[
    'Name (A–Z)',
    'Potential customers',
    'Existing customers',
    'Status',
  ];

  final TextEditingController _searchController = TextEditingController();
  String _query = '';
  String _filter = 'All';
  String _sort = 'Name (A–Z)';

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  // ── filtering / sorting ──────────────────────────────────────────────
  List<String> _filterOptions(bool hasPersonalArea) => [
    for (final option in _filters)
      if (option != 'My area' || hasPersonalArea) option,
  ];

  bool _matchesFilter(AreaInfo area, String filter, String? myEmployeeId) =>
      switch (filter) {
        'Vacant' => area.status == AreaStatus.vacant,
        'Assigned' => area.status == AreaStatus.assigned,
        'Partly Covered' => area.status == AreaStatus.partial,
        'My area' => myEmployeeId != null && area.salespersonId == myEmployeeId,
        _ => true,
      };

  bool _matchesQuery(AreaInfo area, String query) {
    if (query.trim().isEmpty) return true;
    final needle = query.trim().toLowerCase();
    return area.name.toLowerCase().contains(needle) ||
        area.city.toLowerCase().contains(needle) ||
        area.district.toLowerCase().contains(needle) ||
        area.state.toLowerCase().contains(needle);
  }

  List<AreaInfo> _visibleAreas(MockRepository repo, String? myEmployeeId) {
    final list = repo.areas
        .where((a) => _matchesFilter(a, _filter, myEmployeeId))
        .where((a) => _matchesQuery(a, _query))
        .toList();
    switch (_sort) {
      case 'Potential customers':
        list.sort(
          (a, b) => b.potentialCustomers.compareTo(a.potentialCustomers),
        );
      case 'Existing customers':
        list.sort(
          (a, b) => repo
              .existingCustomersIn(b)
              .compareTo(repo.existingCustomersIn(a)),
        );
      case 'Status':
        list.sort((a, b) {
          final byStatus = a.status.index.compareTo(b.status.index);
          return byStatus != 0 ? byStatus : a.name.compareTo(b.name);
        });
      default:
        list.sort(
          (a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()),
        );
    }
    return list;
  }

  // ── owner actions ────────────────────────────────────────────────────
  Future<void> _addArea(MockRepository repo) async {
    final draft = await showModalBottomSheet<_AreaDraft>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
      ),
      builder: (_) => const _AreaFormSheet(),
    );
    if (draft == null || !mounted) return;
    final ok = await ConfirmDialog.show(
      context,
      title: 'Add area',
      message:
          'Create "${draft.name}" covering ${draft.city}, ${draft.district} in the territory master?',
      confirmLabel: 'Add area',
    );
    if (!ok || !mounted) return;
    repo.addArea(
      name: draft.name,
      city: draft.city,
      district: draft.district,
      state: draft.state,
      salespersonId: draft.salespersonId,
      potentialCustomers: draft.potentialCustomers,
      notes: draft.notes,
    );
    showDemoSnack(context, '${draft.name} added to the territory master.');
  }

  Future<void> _editArea(MockRepository repo, AreaInfo area) async {
    final draft = await showModalBottomSheet<_AreaDraft>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
      ),
      builder: (_) => _AreaFormSheet(area: area),
    );
    if (draft == null || !mounted) return;
    final assignmentChanged = draft.salespersonId != area.salespersonId;
    final ok = await ConfirmDialog.show(
      context,
      title: 'Save area changes',
      message: assignmentChanged
          ? 'Update "${draft.name}" and change the assigned salesperson?'
          : 'Update the territory master entry for "${draft.name}"?',
      confirmLabel: 'Save changes',
    );
    if (!ok || !mounted) return;
    repo.updateArea(
      area.id,
      name: draft.name,
      city: draft.city,
      district: draft.district,
      state: draft.state,
      potentialCustomers: draft.potentialCustomers,
      notes: draft.notes,
    );
    if (assignmentChanged) repo.assignArea(area.id, draft.salespersonId);
    showDemoSnack(context, '${draft.name} updated.');
  }

  Future<void> _assignArea(MockRepository repo, AreaInfo area) async {
    final choice = await showModalBottomSheet<String>(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
      ),
      builder: (_) => _AssignAreaSheet(area: area, employees: repo.employees),
    );
    if (choice == null || !mounted) return;
    final unassign = choice.isEmpty;
    final name = unassign ? 'Unassigned' : repo.salespersonName(choice);
    final ok = await ConfirmDialog.show(
      context,
      title: unassign ? 'Unassign area' : 'Assign area',
      message: unassign
          ? 'Make "${area.name}" vacant again? Coverage planning for this territory will stop.'
          : 'Assign "${area.name}" to $name?',
      confirmLabel: unassign ? 'Unassign' : 'Assign',
      danger: unassign,
    );
    if (!ok || !mounted) return;
    repo.assignArea(area.id, unassign ? null : choice);
    showDemoSnack(
      context,
      unassign
          ? '${area.name} is now marked vacant.'
          : '${area.name} assigned to $name.',
    );
  }

  void _openDetail(AreaInfo area) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => _AreaDetailPage(areaId: area.id)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final repo = context.watch<MockRepository>();
    final user = repo.currentUser;
    final isOwner = user?.isOwner ?? true;
    final myEmployeeId = user?.employeeId;
    final areas = _visibleAreas(repo, myEmployeeId);
    final vacant = repo.areas
        .where((a) => a.status == AreaStatus.vacant)
        .length;
    final assigned = repo.areas
        .where((a) => a.status == AreaStatus.assigned)
        .length;
    final partly = repo.areas
        .where((a) => a.status == AreaStatus.partial)
        .length;
    final filterOptions = _filterOptions(myEmployeeId != null);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Vaccant Area'),
        actions: [
          PopupMenuButton<String>(
            icon: const Icon(Icons.sort_rounded),
            tooltip: 'Sort areas',
            initialValue: _sort,
            onSelected: (value) => setState(() => _sort = value),
            itemBuilder: (_) => [
              for (final option in _sorts)
                PopupMenuItem<String>(value: option, child: Text(option)),
            ],
          ),
        ],
      ),
      floatingActionButton: isOwner
          ? FloatingActionButton.extended(
              onPressed: () => _addArea(repo),
              backgroundColor: AppColors.purple,
              foregroundColor: Colors.white,
              icon: const Icon(Icons.add_location_alt_rounded),
              label: const Text('Add Area'),
            )
          : null,
      body: ListView(
        padding: AppSpacing.page,
        children: [
          GradientHero(
            height: 156,
            gradient: AppGradients.area,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'VACCANT AREA',
                  style: TextStyle(
                    color: Colors.white70,
                    fontSize: 10,
                    letterSpacing: 1.4,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 5),
                Text(
                  '${repo.areas.length} territories',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 23,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const Spacer(),
                Row(
                  children: [
                    _HeroStat(value: '$vacant', label: 'Vacant'),
                    _HeroStat(value: '$assigned', label: 'Assigned'),
                    _HeroStat(value: '$partly', label: 'Partly'),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          if (!isOwner) ...[
            const DemoNotice(
              text:
                  'Read-only view: only the owner can add, edit or assign territories. Existing coverage data is shared live from the same demo workspace.',
            ),
            const SizedBox(height: 14),
          ],
          SearchField(
            controller: _searchController,
            hint: 'Search by area, city or district',
            onChanged: (value) => setState(() => _query = value),
          ),
          const SizedBox(height: 12),
          FilterChipsRow(
            options: filterOptions,
            selected: filterOptions.contains(_filter) ? _filter : 'All',
            onSelected: (value) => setState(() => _filter = value),
          ),
          const SizedBox(height: 6),
          SectionHeading(
            title: isOwner ? 'Territory master' : 'Areas',
            subtitle:
                '${areas.length} shown • ${vacant + assigned + partly} total on record',
          ),
          const SizedBox(height: 10),
          if (areas.isEmpty)
            EmptyState(
              icon: Icons.map_outlined,
              title: 'No areas match this view',
              subtitle: _query.trim().isEmpty
                  ? 'Change the filter chips, or add a territory with Add Area.'
                  : 'Try a different area name, city or district.',
              action: isOwner
                  ? GradientButton(
                      label: 'Add Area',
                      icon: Icons.add_rounded,
                      height: 46,
                      expand: false,
                      onPressed: () => _addArea(repo),
                    )
                  : null,
            )
          else
            for (final area in areas)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: _AreaCard(
                  area: area,
                  existingCustomers: repo.existingCustomersIn(area),
                  salespersonName: area.salespersonId == null
                      ? 'Unassigned'
                      : repo.salespersonName(area.salespersonId!),
                  canManage: isOwner,
                  onTap: () => _openDetail(area),
                  onEdit: () => _editArea(repo, area),
                  onAssign: () => _assignArea(repo, area),
                ),
              ),
        ],
      ),
    );
  }
}

class _HeroStat extends StatelessWidget {
  const _HeroStat({required this.value, required this.label});
  final String value;
  final String label;

  @override
  Widget build(BuildContext context) => Expanded(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          value,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 18,
            fontWeight: FontWeight.w900,
          ),
        ),
        Text(
          label,
          style: const TextStyle(
            color: Colors.white70,
            fontSize: 10.5,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    ),
  );
}

Color _areaStatusColor(AreaStatus status) => switch (status) {
  AreaStatus.vacant => AppColors.orange,
  AreaStatus.assigned => AppColors.green,
  AreaStatus.partial => AppColors.purple,
};

class _AreaCard extends StatelessWidget {
  const _AreaCard({
    required this.area,
    required this.existingCustomers,
    required this.salespersonName,
    required this.canManage,
    required this.onTap,
    required this.onEdit,
    required this.onAssign,
  });
  final AreaInfo area;
  final int existingCustomers;
  final String salespersonName;
  final bool canManage;
  final VoidCallback onTap;
  final VoidCallback onEdit;
  final VoidCallback onAssign;

  @override
  Widget build(BuildContext context) {
    final coverage = area.potentialCustomers <= 0
        ? 0.0
        : (existingCustomers / area.potentialCustomers)
              .clamp(0.0, 1.0)
              .toDouble();
    return WhitePanel(
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  area.name,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: AppText.title,
                ),
              ),
              const SizedBox(width: 8),
              StatusChip(
                label: areaStatusLabel(area.status),
                color: _areaStatusColor(area.status),
              ),
              if (canManage) ...[
                const SizedBox(width: 2),
                IconButton(
                  onPressed: onEdit,
                  icon: const Icon(Icons.edit_rounded, size: 20),
                  color: AppColors.blue,
                  tooltip: 'Edit area',
                ),
                IconButton(
                  onPressed: onAssign,
                  icon: const Icon(Icons.person_add_alt_1_rounded, size: 20),
                  color: AppColors.purple,
                  tooltip: 'Assign salesperson',
                ),
              ],
            ],
          ),
          const SizedBox(height: 2),
          Text(
            '${area.city} • ${area.district} • ${area.state}',
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: AppColors.muted,
              fontSize: 11.5,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 8),
          InfoRow(
            label: 'Salesperson',
            value: salespersonName,
            valueColor: area.salespersonId == null
                ? AppColors.orange
                : AppColors.ink,
          ),
          InfoRow(label: 'Existing customers', value: '$existingCustomers'),
          InfoRow(
            label: 'Potential customers',
            value: '${area.potentialCustomers}',
          ),
          const SizedBox(height: 6),
          ProgressRow(
            label: 'Coverage of potential',
            value: existingCustomers.toDouble(),
            max: area.potentialCustomers <= 0
                ? 1
                : area.potentialCustomers.toDouble(),
            color: coverage >= 0.75 ? AppColors.green : AppColors.purple,
          ),
          if (area.notes.trim().isNotEmpty) ...[
            const SizedBox(height: 9),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: const Color(0xFFF6F5FE),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(
                area.notes,
                style: const TextStyle(
                  fontSize: 11.5,
                  height: 1.45,
                  color: Color(0xFF4C4870),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Values collected by the area form sheet; assignment is carried separately so
/// the caller can route it through `assignArea` when editing an existing area.
class _AreaDraft {
  const _AreaDraft({
    required this.name,
    required this.city,
    required this.district,
    required this.state,
    required this.potentialCustomers,
    required this.notes,
    this.salespersonId,
  });
  final String name;
  final String city;
  final String district;
  final String state;
  final int potentialCustomers;
  final String notes;
  final String? salespersonId;
}

class _AreaFormSheet extends StatefulWidget {
  const _AreaFormSheet({this.area});
  final AreaInfo? area;

  bool get isEdit => area != null;

  @override
  State<_AreaFormSheet> createState() => _AreaFormSheetState();
}

class _AreaFormSheetState extends State<_AreaFormSheet> {
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  late final TextEditingController _name = TextEditingController(
    text: widget.area?.name ?? '',
  );
  late final TextEditingController _city = TextEditingController(
    text: widget.area?.city ?? '',
  );
  late final TextEditingController _district = TextEditingController(
    text: widget.area?.district ?? '',
  );
  late final TextEditingController _state = TextEditingController(
    text: widget.area?.state ?? '',
  );
  late final TextEditingController _potential = TextEditingController(
    text: widget.area == null ? '' : '${widget.area!.potentialCustomers}',
  );
  late final TextEditingController _notes = TextEditingController(
    text: widget.area?.notes ?? '',
  );
  String? _salespersonId;

  @override
  void initState() {
    super.initState();
    _salespersonId = widget.area?.salespersonId;
  }

  @override
  void dispose() {
    _name.dispose();
    _city.dispose();
    _district.dispose();
    _state.dispose();
    _potential.dispose();
    _notes.dispose();
    super.dispose();
  }

  String? _validatePotential(String? value) {
    final text = (value ?? '').trim();
    if (text.isEmpty) return null;
    final parsed = int.tryParse(text);
    if (parsed == null || parsed < 0) return 'Enter a whole number (0 or more)';
    return null;
  }

  void _submit() {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    final draft = _AreaDraft(
      name: _name.text.trim(),
      city: _city.text.trim(),
      district: _district.text.trim().isEmpty
          ? _city.text.trim()
          : _district.text.trim(),
      state: _state.text.trim(),
      potentialCustomers: int.tryParse(_potential.text.trim()) ?? 0,
      notes: _notes.text.trim(),
      salespersonId: _salespersonId,
    );
    Navigator.pop(context, draft);
  }

  @override
  Widget build(BuildContext context) {
    final repo = context.watch<MockRepository>();
    final salespeople = repo.employees
        .where((e) => e.department.toLowerCase() == 'sales')
        .toList();
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
                      Icons.map_rounded,
                      color: AppColors.purple,
                      size: 20,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        widget.isEdit ? 'Edit area' : 'Add area',
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
                      children: [
                        TextFormField(
                          controller: _name,
                          textCapitalization: TextCapitalization.words,
                          decoration: const InputDecoration(
                            labelText: 'Area name *',
                            hintText: 'Bathinda Belt',
                          ),
                          validator: (value) =>
                              Validation.required(value, field: 'Area name'),
                        ),
                        const SizedBox(height: 12),
                        TextFormField(
                          controller: _city,
                          textCapitalization: TextCapitalization.words,
                          decoration: const InputDecoration(
                            labelText: 'City *',
                            hintText: 'Bathinda',
                          ),
                          validator: (value) =>
                              Validation.required(value, field: 'City'),
                        ),
                        const SizedBox(height: 12),
                        TextFormField(
                          controller: _district,
                          textCapitalization: TextCapitalization.words,
                          decoration: const InputDecoration(
                            labelText: 'District',
                            hintText: 'Defaults to city',
                          ),
                        ),
                        const SizedBox(height: 12),
                        TextFormField(
                          controller: _state,
                          textCapitalization: TextCapitalization.words,
                          decoration: const InputDecoration(
                            labelText: 'State',
                            hintText: 'Punjab',
                          ),
                        ),
                        const SizedBox(height: 12),
                        TextFormField(
                          controller: _potential,
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(
                            labelText: 'Potential customers',
                            hintText: '0',
                          ),
                          validator: _validatePotential,
                        ),
                        const SizedBox(height: 12),
                        DropdownButtonFormField<String?>(
                          initialValue: _salespersonId,
                          isExpanded: true,
                          decoration: const InputDecoration(
                            labelText: 'Assigned salesperson',
                          ),
                          items: [
                            const DropdownMenuItem<String?>(
                              value: null,
                              child: Text('Unassigned (vacant)'),
                            ),
                            for (final emp in salespeople)
                              DropdownMenuItem<String?>(
                                value: emp.id,
                                child: Text(
                                  '${emp.name} • ${emp.role}',
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                          ],
                          onChanged: (value) =>
                              setState(() => _salespersonId = value),
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
                          label: widget.isEdit ? 'Save changes' : 'Add area',
                          icon: widget.isEdit
                              ? Icons.save_rounded
                              : Icons.add_rounded,
                          onPressed: _submit,
                        ),
                        const SizedBox(height: 8),
                        const DemoNotice(
                          text:
                              'Territory records are saved in this demo workspace only. Assignments follow the Sales department list.',
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

class _AssignAreaSheet extends StatelessWidget {
  const _AssignAreaSheet({required this.area, required this.employees});
  final AreaInfo area;
  final List<Employee> employees;

  @override
  Widget build(BuildContext context) {
    final salespeople = employees
        .where((e) => e.department.toLowerCase() == 'sales')
        .toList();
    return SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(context).height * .75,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 14, 18, 8),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Assign ${area.name}', style: AppText.title),
                        const SizedBox(height: 3),
                        Text(
                          '${area.city} • ${area.district}',
                          style: AppText.caption,
                        ),
                      ],
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
              child: ListView(
                shrinkWrap: true,
                padding: const EdgeInsets.symmetric(vertical: 6),
                children: [
                  for (final emp in salespeople)
                    ListTile(
                      leading: AvatarCircle(name: emp.name, size: 38),
                      title: Text(
                        emp.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      subtitle: Text(
                        '${emp.role} • ${emp.city}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      trailing: area.salespersonId == emp.id
                          ? const Icon(
                              Icons.check_circle_rounded,
                              color: AppColors.green,
                            )
                          : const Icon(Icons.chevron_right_rounded),
                      onTap: () => Navigator.pop(context, emp.id),
                    ),
                  if (area.salespersonId != null)
                    ListTile(
                      leading: const CircleAvatar(
                        radius: 19,
                        backgroundColor: Color(0xFFFDECEC),
                        child: Icon(
                          Icons.person_off_rounded,
                          color: AppColors.red,
                          size: 20,
                        ),
                      ),
                      title: const Text(
                        'Unassign (mark area vacant)',
                        style: TextStyle(
                          color: AppColors.red,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      subtitle: const Text(
                        'Coverage planning for this territory stops',
                      ),
                      onTap: () => Navigator.pop(context, ''),
                    ),
                  if (salespeople.isEmpty)
                    const EmptyState(
                      icon: Icons.group_outlined,
                      title: 'No sales employees',
                      subtitle:
                          'Add a Sales department employee under Organisation first.',
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _AreaDetailPage extends StatelessWidget {
  const _AreaDetailPage({required this.areaId});
  final String areaId;

  @override
  Widget build(BuildContext context) {
    final repo = context.watch<MockRepository>();
    final area = repo.areaById(areaId);
    if (area == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Area detail')),
        body: const Center(
          child: EmptyState(
            icon: Icons.map_outlined,
            title: 'Area not found',
            subtitle: 'It may have been removed from the demo workspace.',
          ),
        ),
      );
    }
    final isOwner = repo.currentUser?.isOwner ?? true;
    final customers = repo.customers
        .where((c) => c.city.toLowerCase() == area.city.toLowerCase())
        .toList();
    final existing = repo.existingCustomersIn(area);
    final assignedName = area.salespersonId == null
        ? 'Unassigned'
        : repo.salespersonName(area.salespersonId!);

    return Scaffold(
      appBar: AppBar(title: Text(area.name)),
      body: ListView(
        padding: AppSpacing.page,
        children: [
          GradientHero(
            height: 132,
            gradient: AppGradients.area,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  area.name,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 20,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  '${area.city} • ${area.district} • ${area.state}',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: Colors.white70, fontSize: 12),
                ),
                const Spacer(),
                Align(
                  alignment: Alignment.centerRight,
                  child: StatusChip(
                    label: areaStatusLabel(area.status),
                    color: _areaStatusColor(area.status),
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
                const SectionHeading(title: 'Territory details'),
                const SizedBox(height: 6),
                InfoRow(
                  label: 'Salesperson',
                  value: assignedName,
                  valueColor: area.salespersonId == null
                      ? AppColors.orange
                      : AppColors.ink,
                ),
                InfoRow(label: 'Existing customers', value: '$existing'),
                InfoRow(
                  label: 'Potential customers',
                  value: '${area.potentialCustomers}',
                ),
                InfoRow(label: 'Area code', value: area.id),
                ProgressRow(
                  label: 'Coverage of potential',
                  value: existing.toDouble(),
                  max: area.potentialCustomers <= 0
                      ? 1
                      : area.potentialCustomers.toDouble(),
                ),
                if (area.notes.trim().isNotEmpty) ...[
                  const SizedBox(height: 10),
                  Text(
                    area.notes,
                    style: const TextStyle(
                      fontSize: 12,
                      height: 1.5,
                      color: Color(0xFF4C4870),
                    ),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 14),
          if (isOwner) ...[
            Row(
              children: [
                Expanded(
                  child: ActionPill(
                    icon: Icons.edit_rounded,
                    label: 'Edit area',
                    onTap: () async {
                      final draft = await showModalBottomSheet<_AreaDraft>(
                        context: context,
                        isScrollControlled: true,
                        shape: const RoundedRectangleBorder(
                          borderRadius: BorderRadius.vertical(
                            top: Radius.circular(22),
                          ),
                        ),
                        builder: (_) => _AreaFormSheet(area: area),
                      );
                      if (draft == null || !context.mounted) return;
                      final ok = await ConfirmDialog.show(
                        context,
                        title: 'Save area changes',
                        message:
                            'Update the territory master entry for "${draft.name}"?',
                        confirmLabel: 'Save changes',
                      );
                      if (!ok || !context.mounted) return;
                      repo.updateArea(
                        area.id,
                        name: draft.name,
                        city: draft.city,
                        district: draft.district,
                        state: draft.state,
                        potentialCustomers: draft.potentialCustomers,
                        notes: draft.notes,
                      );
                      if (draft.salespersonId != area.salespersonId) {
                        repo.assignArea(area.id, draft.salespersonId);
                      }
                      showDemoSnack(context, '${draft.name} updated.');
                    },
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: ActionPill(
                    icon: Icons.person_add_alt_1_rounded,
                    label: area.salespersonId == null ? 'Assign' : 'Reassign',
                    onTap: () async {
                      final choice = await showModalBottomSheet<String>(
                        context: context,
                        shape: const RoundedRectangleBorder(
                          borderRadius: BorderRadius.vertical(
                            top: Radius.circular(22),
                          ),
                        ),
                        builder: (_) => _AssignAreaSheet(
                          area: area,
                          employees: repo.employees,
                        ),
                      );
                      if (choice == null || !context.mounted) return;
                      final unassign = choice.isEmpty;
                      final name = unassign
                          ? 'Unassigned'
                          : repo.salespersonName(choice);
                      final ok = await ConfirmDialog.show(
                        context,
                        title: unassign ? 'Unassign area' : 'Assign area',
                        message: unassign
                            ? 'Make "${area.name}" vacant again?'
                            : 'Assign "${area.name}" to $name?',
                        confirmLabel: unassign ? 'Unassign' : 'Assign',
                        danger: unassign,
                      );
                      if (!ok || !context.mounted) return;
                      repo.assignArea(area.id, unassign ? null : choice);
                      showDemoSnack(
                        context,
                        unassign
                            ? '${area.name} is now marked vacant.'
                            : '${area.name} assigned to $name.',
                      );
                    },
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
          ] else
            const Padding(
              padding: EdgeInsets.only(bottom: 14),
              child: DemoNotice(
                text:
                    'Read-only: territory masters are maintained by the owner.',
              ),
            ),
          SectionHeading(
            title: 'Customers in ${area.city}',
            subtitle: '${customers.length} record(s) share this city',
            trailing: TextButton(
              onPressed: () => Navigator.pushNamed(context, '/customers'),
              child: const Text('Customers'),
            ),
          ),
          const SizedBox(height: 6),
          if (customers.isEmpty)
            const EmptyState(
              icon: Icons.storefront_outlined,
              title: 'No customers yet',
              subtitle:
                  'This territory is still a vacancy. Add customers from the Sales screen once coverage starts.',
            )
          else
            for (final customer in customers)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: WhitePanel(
                  onTap: () => Navigator.pushNamed(context, '/customers'),
                  child: Row(
                    children: [
                      AvatarCircle(
                        name: customer.name,
                        size: 40,
                        gradient: AppGradients.customer,
                      ),
                      const SizedBox(width: 11),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              customer.name,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: AppText.heading,
                            ),
                            const SizedBox(height: 3),
                            Text(
                              '${customer.type} • ${customer.city}',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: AppText.caption,
                            ),
                            const SizedBox(height: 5),
                            Text(
                              'Salesperson ${repo.salespersonName(customer.salespersonId)}',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.w700,
                                color: AppColors.purple,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const Icon(
                        Icons.chevron_right_rounded,
                        color: AppColors.muted,
                      ),
                    ],
                  ),
                ),
              ),
          const SizedBox(height: 6),
          GradientButton(
            label: 'Open full customer list',
            icon: Icons.people_alt_rounded,
            onPressed: () => Navigator.pushNamed(context, '/customers'),
          ),
          const SizedBox(height: 10),
        ],
      ),
    );
  }
}
