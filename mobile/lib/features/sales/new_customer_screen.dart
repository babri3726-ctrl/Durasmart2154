import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/formatters.dart';
import '../../core/share_service.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import '../../data/mock_repository.dart';

class NewCustomerScreen extends StatefulWidget {
  const NewCustomerScreen({super.key});

  @override
  State<NewCustomerScreen> createState() => _NewCustomerScreenState();
}

class _NewCustomerScreenState extends State<NewCustomerScreen> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _contact = TextEditingController();
  final _mobile = TextEditingController();
  final _city = TextEditingController();
  final _address = TextEditingController();
  final _notes = TextEditingController();
  String _type = 'Dealer';
  String? _salespersonId;
  bool _dirty = false;

  static const _types = [
    'Dealer',
    'Retailer',
    'Contractor',
    'Fabricator',
    'Other',
  ];

  @override
  void dispose() {
    _name.dispose();
    _contact.dispose();
    _mobile.dispose();
    _city.dispose();
    _address.dispose();
    _notes.dispose();
    super.dispose();
  }

  void _touch() {
    if (!_dirty) setState(() => _dirty = true);
  }

  @override
  Widget build(BuildContext context) {
    final repo = context.watch<MockRepository>();
    final salesTeam = repo.employees
        .where((e) => e.department == 'Sales')
        .toList();
    if (_salespersonId == null && salesTeam.isNotEmpty) {
      _salespersonId = repo.currentUser?.employeeId;
      if (_salespersonId == null ||
          !salesTeam.any((e) => e.id == _salespersonId)) {
        _salespersonId = salesTeam.first.id;
      }
    }

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('New Customer')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            
            const SizedBox(height: 14),
            WhitePanel(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _label('Customer Name *'),
                  TextFormField(
                    controller: _name,
                    onChanged: (_) => _touch(),
                    validator: (v) => Validation.required(v, field: 'Name'),
                    textCapitalization: TextCapitalization.words,
                    decoration: const InputDecoration(
                      hintText: 'e.g. Gupta Steel Traders',
                    ),
                  ),
                  const SizedBox(height: 14),
                  _label('Contact Person'),
                  TextFormField(
                    controller: _contact,
                    onChanged: (_) => _touch(),
                    textCapitalization: TextCapitalization.words,
                    decoration: const InputDecoration(
                      hintText: 'Person to contact',
                    ),
                  ),
                  const SizedBox(height: 14),
                  _label('Mobile Number *'),
                  TextFormField(
                    controller: _mobile,
                    onChanged: (_) => _touch(),
                    keyboardType: TextInputType.phone,
                    validator: Validation.mobile,
                    maxLength: 14,
                    decoration: const InputDecoration(hintText: '10–12 digits'),
                  ),
                  const SizedBox(height: 14),
                  _label('City *'),
                  TextFormField(
                    controller: _city,
                    onChanged: (_) => _touch(),
                    validator: (v) => Validation.required(v, field: 'City'),
                    textCapitalization: TextCapitalization.words,
                    decoration: const InputDecoration(
                      hintText: 'e.g. Ludhiana',
                    ),
                  ),
                  const SizedBox(height: 14),
                  _label('Address'),
                  TextFormField(
                    controller: _address,
                    onChanged: (_) => _touch(),
                    maxLines: 3,
                    textCapitalization: TextCapitalization.words,
                    decoration: const InputDecoration(hintText: 'Full address'),
                  ),
                  const SizedBox(height: 14),
                  _label('Customer Type'),
                  DropdownButtonFormField<String>(
                    initialValue: _type,
                    decoration: const InputDecoration(),
                    items: _types
                        .map((t) => DropdownMenuItem(value: t, child: Text(t)))
                        .toList(),
                    onChanged: (v) => setState(() {
                      _type = v ?? _type;
                      _touch();
                    }),
                  ),
                  const SizedBox(height: 14),
                  _label('Assigned Salesperson'),
                  DropdownButtonFormField<String>(
                    initialValue: _salespersonId,
                    decoration: const InputDecoration(
                      hintText: 'Select salesperson',
                    ),
                    items: salesTeam
                        .map(
                          (e) => DropdownMenuItem(
                            value: e.id,
                            child: Text(e.name),
                          ),
                        )
                        .toList(),
                    onChanged: (v) => setState(() {
                      _salespersonId = v ?? _salespersonId;
                      _touch();
                    }),
                  ),
                  const SizedBox(height: 14),
                  _label('Notes'),
                  TextFormField(
                    controller: _notes,
                    onChanged: (_) => _touch(),
                    maxLines: 2,
                    decoration: const InputDecoration(
                      hintText: 'Anything to remember',
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _preview,
                    icon: const Icon(Icons.visibility_rounded),
                    label: const Text('Preview'),
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: OutlinedButton(
                    onPressed: _cancel,
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.red,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                    child: const Text('Cancel'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            GradientButton(
              label: 'Save Customer',
              icon: Icons.save_rounded,
              gradient: AppGradients.success,
              onPressed: () => _save(repo),
            ),
            const SizedBox(height: 12),
          ],
        ),
      ),
    );
  }

  Widget _label(String text) => Padding(
    padding: const EdgeInsets.only(bottom: 6),
    child: Text(
      text,
      style: const TextStyle(
        fontWeight: FontWeight.w800,
        fontSize: 12,
        color: AppColors.ink,
      ),
    ),
  );

  void _preview() {
    final repo = context.read<MockRepository>();
    showModalBottomSheet<void>(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
      ),
      builder: (sheetContext) => SafeArea(
        child: SingleChildScrollView(
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Preview Customer Record', style: AppText.title),
                const SizedBox(height: 12),
                InfoRow(
                  label: 'Name',
                  value: _name.text.trim().isEmpty ? '—' : _name.text.trim(),
                ),
                InfoRow(
                  label: 'Contact',
                  value: _contact.text.trim().isEmpty
                      ? '—'
                      : _contact.text.trim(),
                ),
                InfoRow(
                  label: 'Mobile',
                  value: _mobile.text.trim().isEmpty
                      ? '—'
                      : _mobile.text.trim(),
                ),
                InfoRow(
                  label: 'City',
                  value: _city.text.trim().isEmpty ? '—' : _city.text.trim(),
                ),
                InfoRow(
                  label: 'Address',
                  value: _address.text.trim().isEmpty
                      ? '—'
                      : _address.text.trim(),
                ),
                InfoRow(label: 'Type', value: _type),
                InfoRow(
                  label: 'Salesperson',
                  value: repo.salespersonName(_salespersonId ?? ''),
                ),
                InfoRow(
                  label: 'Notes',
                  value: _notes.text.trim().isEmpty ? '—' : _notes.text.trim(),
                ),
                const InfoRow(label: 'Status', value: 'Pending Approval'),
                const SizedBox(height: 12),
                GradientButton(
                  label: 'Close',
                  gradient: AppGradients.sales,
                  onPressed: () => Navigator.pop(sheetContext),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _cancel() async {
    if (_dirty) {
      final leave = await ConfirmDialog.show(
        context,
        title: 'Discard changes?',
        message: 'You have unsaved customer details. Discard them?',
        confirmLabel: 'Discard',
        danger: true,
      );
      if (!leave || !mounted) return;
    }
    if (mounted) Navigator.pop(context);
  }

  Future<void> _save(MockRepository repo) async {
    if (!(_formKey.currentState?.validate() ?? false)) {
      showDemoSnack(context, 'Please fix the highlighted fields.');
      return;
    }
    final ok = await ConfirmDialog.show(
      context,
      title: 'Save customer?',
      message: 'Save ${_name.text.trim()} as a new customer awaiting approval.',
      confirmLabel: 'Save',
    );
    if (!ok || !mounted) return;
    repo.addCustomer(
      name: _name.text.trim(),
      city: _city.text.trim(),
      mobile: _mobile.text.trim(),
      salespersonId: _salespersonId ?? '',
      contactPerson: _contact.text.trim(),
      address: _address.text.trim(),
      type: _type,
      notes: _notes.text.trim(),
      approvalRequired: true,
    );
    if (!mounted) return;
    showDemoSnack(context, 'Customer saved as Pending Approval (demo)');
    Navigator.pop(context);
  }
}
