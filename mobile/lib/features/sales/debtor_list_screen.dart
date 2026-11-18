import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_sync_service.dart';
import '../../core/formatters.dart';
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
      'Mozi Ram',
      'AJAY JI',
      'GAURAV JI',
      'PANKAJ JI',
      'MUKESH JI',
      'Amanpreet Singh',
      'Harpreet Singh',
      'Gurmeet Singh',
      'Rajinder Kumar',
      'Kuldeep Singh',
      'Unassigned',
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
                  decoration: const InputDecoration(
                    labelText: 'Station / City',
                  ),
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
                  onChanged: (v) =>
                      setDialogState(() => selectedSp = v ?? 'Unassigned'),
                ),
                const SizedBox(height: 6),
                TextField(
                  controller: balCtrl,
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  decoration: const InputDecoration(
                    labelText: 'Initial Balance (₹)',
                  ),
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  value: stateVal,
                  items: const [
                    DropdownMenuItem(value: 'Punjab', child: Text('Punjab')),
                    DropdownMenuItem(value: 'Haryana', child: Text('Haryana')),
                  ],
                  onChanged: (v) =>
                      setDialogState(() => stateVal = v ?? 'Punjab'),
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
                repo.addDebtor(
                  DebtorItem(
                    id: newId,
                    name: nameCtrl.text.trim(),
                    state: stateVal,
                    city: cityCtrl.text.trim(),
                    district: disttCtrl.text.trim(),
                    salesperson: selectedSp,
                    balance: bal,
                  ),
                );
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
    final balCtrl = TextEditingController(
      text: item.balance.toStringAsFixed(2),
    );
    String stateVal = item.state.isEmpty ? 'Punjab' : item.state;
    final activeSalespeople = <String>[
      'Mozi Ram',
      'AJAY JI',
      'GAURAV JI',
      'PANKAJ JI',
      'MUKESH JI',
      'Amanpreet Singh',
      'Harpreet Singh',
      'Gurmeet Singh',
      'Rajinder Kumar',
      'Kuldeep Singh',
      'Unassigned',
    ];
    if (item.salesperson.isNotEmpty &&
        !activeSalespeople.contains(item.salesperson)) {
      activeSalespeople.insert(0, item.salesperson);
    }
    String selectedSp = item.salesperson.isNotEmpty
        ? item.salesperson
        : 'Unassigned';

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
                  decoration: const InputDecoration(
                    labelText: 'Station / City',
                  ),
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
                  onChanged: (v) =>
                      setDialogState(() => selectedSp = v ?? 'Unassigned'),
                ),
                const SizedBox(height: 6),
                TextField(
                  controller: balCtrl,
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  decoration: const InputDecoration(labelText: 'Balance (₹)'),
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  value: stateVal,
                  items: const [
                    DropdownMenuItem(value: 'Punjab', child: Text('Punjab')),
                    DropdownMenuItem(value: 'Haryana', child: Text('Haryana')),
                  ],
                  onChanged: (v) =>
                      setDialogState(() => stateVal = v ?? 'Punjab'),
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
                item.balance =
                    double.tryParse(balCtrl.text.trim()) ?? item.balance;
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
        content: Text(
          'Are you sure you want to delete ${item.name}? This will remove it from the Debtor Master.',
        ),
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
              ScaffoldMessenger.of(
                context,
              ).showSnackBar(const SnackBar(content: Text('Debtor deleted')));
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
      if (_selectedTerritory != 'All' &&
          d.state.toLowerCase() != _selectedTerritory.toLowerCase()) {
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

    final double totalReceivables = items.fold(0.0, (sum, d) => sum + d.balance);
    final int punjabCount = repo.debtors.where((d) => d.state.toLowerCase() == 'punjab').length;
    final int haryanaCount = repo.debtors.where((d) => d.state.toLowerCase() == 'haryana').length;

    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        title: const Text('Debtor Master (HR-PB)'),
        actions: [
          IconButton(
            icon: const Icon(Icons.sync_rounded),
            tooltip: '1-Click Sync HR-PB',
            onPressed: () async {
              final sm = ScaffoldMessenger.of(context);
              sm.showSnackBar(
                const SnackBar(
                  content: Text('Syncing HR-PB Dealers & Targets with server...'),
                  duration: Duration(seconds: 1),
                ),
              );
              try {
                final result = await ApiSyncService.syncHrPbTargets();
                await repo.syncWithBackend();
                sm.showSnackBar(
                  SnackBar(
                    content: Text(
                      result != null && result['ok'] == true
                          ? 'HR-PB Synced: ${result['customers_imported'] ?? result['dealers_matched'] ?? 'completed'}'
                          : 'HR-PB refreshed with server',
                    ),
                  ),
                );
              } catch (e) {
                sm.showSnackBar(
                  SnackBar(content: Text('HR-PB Sync failed: $e')),
                );
              }
            },
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: const Color(0xFF059669),
        foregroundColor: Colors.white,
        onPressed: () => _showAddDebtorDialog(context),
        icon: const Icon(Icons.add),
        label: const Text('Add Debtor', style: TextStyle(fontWeight: FontWeight.w800)),
      ),
      body: Column(
        children: [
          // KPI Summary Row
          Container(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
            decoration: const BoxDecoration(
              color: Colors.white,
              border: Border(bottom: BorderSide(color: Color(0xFFE2E8F0))),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SearchField(
                  hint: 'Search by party, city or salesperson…',
                  onChanged: (v) => setState(() => _query = v),
                ),
                const SizedBox(height: 10),
                HybridPillFilter(
                  options: [
                    'All (${repo.debtors.length})',
                    'Punjab ($punjabCount)',
                    'Haryana ($haryanaCount)',
                  ],
                  selected: _selectedTerritory == 'All'
                      ? 'All (${repo.debtors.length})'
                      : _selectedTerritory == 'Punjab'
                          ? 'Punjab ($punjabCount)'
                          : 'Haryana ($haryanaCount)',
                  onSelected: (v) {
                    setState(() {
                      if (v.startsWith('Punjab')) {
                        _selectedTerritory = 'Punjab';
                      } else if (v.startsWith('Haryana')) {
                        _selectedTerritory = 'Haryana';
                      } else {
                        _selectedTerritory = 'All';
                      }
                    });
                  },
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFFFBEB),
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(color: const Color(0xFFFDE68A)),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'TOTAL RECEIVABLES',
                              style: TextStyle(
                                fontSize: 10,
                                fontWeight: FontWeight.w800,
                                color: Color(0xFF92400E),
                                letterSpacing: 0.5,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              rupees(totalReceivables),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.w900,
                                color: Color(0xFFB45309),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: const Color(0xFFF0FDF4),
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(color: const Color(0xFFBBF7D0)),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'VERIFIED DEALERS',
                              style: TextStyle(
                                fontSize: 10,
                                fontWeight: FontWeight.w800,
                                color: Color(0xFF166534),
                                letterSpacing: 0.5,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              '${items.length} accounts',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.w900,
                                color: Color(0xFF15803D),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: () => repo.syncWithBackend(),
              child: items.isEmpty
                  ? ListView(
                      physics: const AlwaysScrollableScrollPhysics(),
                      children: const [
                        SizedBox(height: 60),
                        EmptyState(
                          icon: Icons.account_balance_wallet_outlined,
                          title: 'No debtors found',
                          subtitle: 'Add a new debtor or pull from HR-PB.',
                        ),
                      ],
                    )
                  : ListView.separated(
                      physics: const AlwaysScrollableScrollPhysics(),
                      padding: const EdgeInsets.fromLTRB(16, 10, 16, 80),
                      itemCount: items.length,
                      separatorBuilder: (_, _) => const SizedBox(height: 8),
                      itemBuilder: (context, i) {
                        final item = items[i];
                        final hasBalance = item.balance > 0;

                        return Container(
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(14),
                            border: Border.all(color: const Color(0xFFE2E8F0)),
                            boxShadow: const [
                              BoxShadow(
                                color: Color(0x060F172A),
                                blurRadius: 8,
                                offset: Offset(0, 2),
                              ),
                            ],
                          ),
                          child: Material(
                            color: Colors.transparent,
                            borderRadius: BorderRadius.circular(14),
                            child: InkWell(
                              borderRadius: BorderRadius.circular(14),
                              onTap: () => Navigator.of(context).pushNamed(
                                '/ledger',
                                arguments: {'customerId': item.id},
                              ),
                              child: Padding(
                                padding: const EdgeInsets.all(14),
                                child: Row(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            item.name,
                                            style: const TextStyle(
                                              fontSize: 13.5,
                                              fontWeight: FontWeight.w800,
                                              color: Color(0xFF0F172A),
                                            ),
                                          ),
                                          const SizedBox(height: 4),
                                          Text(
                                            '${item.city.isNotEmpty ? item.city : item.district} (${item.state}) • Rep: ${item.salesperson}',
                                            style: const TextStyle(
                                              fontSize: 11,
                                              fontWeight: FontWeight.w500,
                                              color: Color(0xFF64748B),
                                            ),
                                          ),
                                          const SizedBox(height: 8),
                                          Container(
                                            padding: const EdgeInsets.symmetric(
                                              horizontal: 8,
                                              vertical: 3,
                                            ),
                                            decoration: BoxDecoration(
                                              color: hasBalance
                                                  ? const Color(0xFFFEF2F2)
                                                  : const Color(0xFFF0FDF4),
                                              borderRadius: BorderRadius.circular(6),
                                              border: Border.all(
                                                color: hasBalance
                                                    ? const Color(0xFFFECACA)
                                                    : const Color(0xFFBBF7D0),
                                              ),
                                            ),
                                            child: Text(
                                              hasBalance
                                                  ? 'Balance: ${item.balanceFormatted}'
                                                  : 'Balance: ₹0.00 (Cleared)',
                                              style: TextStyle(
                                                fontSize: 11,
                                                fontWeight: FontWeight.w800,
                                                color: hasBalance
                                                    ? const Color(0xFFDC2626)
                                                    : const Color(0xFF166534),
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
                                          icon: const Icon(
                                            Icons.receipt_long_rounded,
                                            size: 20,
                                          ),
                                          color: const Color(0xFF2563EB),
                                          tooltip: 'View Statement',
                                          onPressed: () => Navigator.of(context).pushNamed(
                                            '/ledger',
                                            arguments: {'customerId': item.id},
                                          ),
                                        ),
                                        IconButton(
                                          icon: const Icon(
                                            Icons.edit_outlined,
                                            size: 19,
                                          ),
                                          color: const Color(0xFF64748B),
                                          tooltip: 'Edit Debtor',
                                          onPressed: () =>
                                              _showEditDebtorDialog(context, item),
                                        ),
                                        IconButton(
                                          icon: const Icon(
                                            Icons.delete_outline_rounded,
                                            size: 19,
                                          ),
                                          color: const Color(0xFFEF4444),
                                          tooltip: 'Delete',
                                          onPressed: () =>
                                              _showDeleteConfirmDialog(context, item),
                                        ),
                                      ],
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                        );
                      },
                    ),
            ),
          ),
        ],
      ),
    );
  }
}
