import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/theme.dart';
import '../../core/widgets.dart';
import '../../data/mock_repository.dart';
import '../../data/models.dart';

class DebtorListScreen extends StatefulWidget {
  const DebtorListScreen({super.key});

  @override
  State<DebtorListScreen> createState() => _DebtorListScreenState();
}

class _DebtorListScreenState extends State<DebtorListScreen> {
  String _query = '';
  String _selectedTerritory = 'All';

  void _showAddDebtorDialog(BuildContext context) {
    final nameCtrl = TextEditingController();
    final cityCtrl = TextEditingController();
    final disttCtrl = TextEditingController();
    final balCtrl = TextEditingController(text: '0.00');
    String stateVal = 'Punjab';
    final activeSalespeople = <String>[
      'Mozi Ram', 'AJAY JI', 'GAURAV JI', 'PANKAJ JI', 'MUKESH JI',
      'Amanpreet Singh', 'Harpreet Singh', 'Gurmeet Singh', 'Rajinder Kumar', 'Kuldeep Singh',
      'Unassigned'
    ];
    String selectedSp = 'Mozi Ram';

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: const Text('Add New Debtor', style: AppText.title),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: nameCtrl,
                  decoration: const InputDecoration(labelText: 'Party Name *'),
                ),
                TextField(
                  controller: cityCtrl,
                  decoration: const InputDecoration(labelText: 'Station / City'),
                ),
                TextField(
                  controller: disttCtrl,
                  decoration: const InputDecoration(labelText: 'District'),
                ),
                const SizedBox(height: 6),
                DropdownButtonFormField<String>(
                  value: selectedSp,
                  isExpanded: true,
                  decoration: const InputDecoration(labelText: 'Salesperson *'),
                  items: [
                    for (final sp in activeSalespeople)
                      DropdownMenuItem(value: sp, child: Text(sp)),
                  ],
                  onChanged: (v) => setDialogState(() => selectedSp = v ?? 'Unassigned'),
                ),
                const SizedBox(height: 6),
                TextField(
                  controller: balCtrl,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(labelText: 'Initial Balance (₹)'),
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  value: stateVal,
                  items: const [
                    DropdownMenuItem(value: 'Punjab', child: Text('Punjab')),
                    DropdownMenuItem(value: 'Haryana', child: Text('Haryana')),
                  ],
                  onChanged: (v) => setDialogState(() => stateVal = v ?? 'Punjab'),
                  decoration: const InputDecoration(labelText: 'State'),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Cancel'),
            ),
            ElevatedButton(
              onPressed: () {
                if (nameCtrl.text.trim().isEmpty) return;
                final repo = context.read<MockRepository>();
                final newId = 'DEBTOR-MAN-${repo.debtors.length + 100}';
                final bal = double.tryParse(balCtrl.text.trim()) ?? 0.0;
                repo.addDebtor(DebtorItem(
                  id: newId,
                  name: nameCtrl.text.trim(),
                  state: stateVal,
                  city: cityCtrl.text.trim(),
                  district: disttCtrl.text.trim(),
                  salesperson: selectedSp,
                  balance: bal,
                ));
                Navigator.pop(ctx);
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Debtor added successfully')),
                );
              },
              child: const Text('Add Debtor'),
            ),
          ],
        ),
      ),
    );
  }

  void _showEditDebtorDialog(BuildContext context, DebtorItem item) {
    final nameCtrl = TextEditingController(text: item.name);
    final cityCtrl = TextEditingController(text: item.city);
    final disttCtrl = TextEditingController(text: item.district);
    final balCtrl = TextEditingController(text: item.balance.toStringAsFixed(2));
    String stateVal = item.state.isEmpty ? 'Punjab' : item.state;
    final activeSalespeople = <String>[
      'Mozi Ram', 'AJAY JI', 'GAURAV JI', 'PANKAJ JI', 'MUKESH JI',
      'Amanpreet Singh', 'Harpreet Singh', 'Gurmeet Singh', 'Rajinder Kumar', 'Kuldeep Singh',
      'Unassigned'
    ];
    if (item.salesperson.isNotEmpty && !activeSalespeople.contains(item.salesperson)) {
      activeSalespeople.insert(0, item.salesperson);
    }
    String selectedSp = item.salesperson.isNotEmpty ? item.salesperson : 'Unassigned';

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: Text('Edit Debtor: ${item.name}', style: AppText.title),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: nameCtrl,
                  decoration: const InputDecoration(labelText: 'Party Name *'),
                ),
                TextField(
                  controller: cityCtrl,
                  decoration: const InputDecoration(labelText: 'Station / City'),
                ),
                TextField(
                  controller: disttCtrl,
                  decoration: const InputDecoration(labelText: 'District'),
                ),
                const SizedBox(height: 6),
                DropdownButtonFormField<String>(
                  value: selectedSp,
                  isExpanded: true,
                  decoration: const InputDecoration(labelText: 'Salesperson *'),
                  items: [
                    for (final sp in activeSalespeople)
                      DropdownMenuItem(value: sp, child: Text(sp)),
                  ],
                  onChanged: (v) => setDialogState(() => selectedSp = v ?? 'Unassigned'),
                ),
                const SizedBox(height: 6),
                TextField(
                  controller: balCtrl,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(labelText: 'Balance (₹)'),
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  value: stateVal,
                  items: const [
                    DropdownMenuItem(value: 'Punjab', child: Text('Punjab')),
                    DropdownMenuItem(value: 'Haryana', child: Text('Haryana')),
                  ],
                  onChanged: (v) => setDialogState(() => stateVal = v ?? 'Punjab'),
                  decoration: const InputDecoration(labelText: 'State'),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Cancel'),
            ),
            ElevatedButton(
              onPressed: () {
                if (nameCtrl.text.trim().isEmpty) return;
                final repo = context.read<MockRepository>();
                item.name = nameCtrl.text.trim();
                item.city = cityCtrl.text.trim();
                item.district = disttCtrl.text.trim();
                item.salesperson = selectedSp;
                item.state = stateVal;
                item.balance = double.tryParse(balCtrl.text.trim()) ?? item.balance;
                repo.updateDebtor(item);
                Navigator.pop(ctx);
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Debtor updated successfully')),
                );
              },
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    );
  }

  void _showDeleteConfirmDialog(BuildContext context, DebtorItem item) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Debtor?'),
        content: Text('Are you sure you want to delete ${item.name}? This will remove it from the Debtor Master.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.red),
            onPressed: () {
              context.read<MockRepository>().deleteDebtor(item.id);
              Navigator.pop(ctx);
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Debtor deleted')),
              );
            },
            child: const Text('Delete', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final repo = context.watch<MockRepository>();
    final items = repo.debtors.where((d) {
      if (_selectedTerritory != 'All' && d.state.toLowerCase() != _selectedTerritory.toLowerCase()) {
        return false;
      }
      if (_query.isNotEmpty) {
        final q = _query.toLowerCase();
        return d.name.toLowerCase().contains(q) ||
            d.city.toLowerCase().contains(q) ||
            d.salesperson.toLowerCase().contains(q);
      }
      return true;
    }).toList();

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Debtor Master (HR-PB)'),
        actions: [
          IconButton(
            icon: const Icon(Icons.sync_rounded),
            tooltip: '1-Click Sync HR-PB',
            onPressed: () {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('HR-PB Dealers synced with initial ₹0 balance')),
              );
            },
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showAddDebtorDialog(context),
        icon: const Icon(Icons.add),
        label: const Text('Add Debtor'),
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SearchField(
                  hint: 'Search party, city or salesperson',
                  onChanged: (v) => setState(() => _query = v),
                ),
                const SizedBox(height: 10),
                FilterChipsRow(
                  options: const ['All', 'Punjab', 'Haryana'],
                  selected: _selectedTerritory,
                  onSelected: (v) => setState(() => _selectedTerritory = v),
                ),
              ],
            ),
          ),
          Expanded(
            child: items.isEmpty
                ? const EmptyState(
                    icon: Icons.account_balance_wallet_outlined,
                    title: 'No debtors found',
                    subtitle: 'Add a new debtor or pull from HR-PB.',
                  )
                : ListView.separated(
                    padding: const EdgeInsets.fromLTRB(16, 4, 16, 80),
                    itemCount: items.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 8),
                    itemBuilder: (context, i) {
                      final item = items[i];
                      return Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: AppColors.line),
                        ),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(item.name, style: AppText.body.copyWith(fontWeight: FontWeight.bold)),
                                  const SizedBox(height: 3),
                                  Text(
                                    '${item.city.isNotEmpty ? item.city : item.district} (${item.state}) • Rep: ${item.salesperson}',
                                    style: AppText.caption.copyWith(color: AppColors.muted),
                                  ),
                                  const SizedBox(height: 6),
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                    decoration: BoxDecoration(
                                      color: item.balance == 0.0 ? AppColors.background : const Color(0xFFFFEEEE),
                                      borderRadius: BorderRadius.circular(6),
                                      border: Border.all(color: AppColors.line),
                                    ),
                                    child: Text(
                                      'Balance: ${item.balanceFormatted}',
                                      style: AppText.caption.copyWith(
                                        fontWeight: FontWeight.bold,
                                        color: item.balance == 0.0 ? AppColors.muted : AppColors.red,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                IconButton(
                                  icon: const Icon(Icons.edit_outlined, size: 20),
                                  color: AppColors.muted,
                                  onPressed: () => _showEditDebtorDialog(context, item),
                                ),
                                IconButton(
                                  icon: const Icon(Icons.delete_outline_rounded, size: 20),
                                  color: AppColors.red,
                                  onPressed: () => _showDeleteConfirmDialog(context, item),
                                ),
                              ],
                            ),
                          ],
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}
