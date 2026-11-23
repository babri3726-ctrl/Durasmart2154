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
  String _selectedStatus = 'All'; // 'All', 'Verified', 'Mismatches'

  Widget _statusFilterChip(String key, String label, {bool isSuccess = false, bool isWarning = false}) {
    final isSelected = _selectedStatus == key;
    Color bg;
    Color border;
    Color text;

    if (isSelected) {
      if (isSuccess) {
        bg = const Color(0xFF16A34A);
        border = const Color(0xFF15803D);
        text = Colors.white;
      } else if (isWarning) {
        bg = const Color(0xFFD97706);
        border = const Color(0xFFB45309);
        text = Colors.white;
      } else {
        bg = const Color(0xFF0F172A);
        border = const Color(0xFF0F172A);
        text = Colors.white;
      }
    } else {
      if (isSuccess) {
        bg = const Color(0xFFF0FDF4);
        border = const Color(0xFFBBF7D0);
        text = const Color(0xFF15803D);
      } else if (isWarning) {
        bg = const Color(0xFFFEF3C7);
        border = const Color(0xFFFDE68A);
        text = const Color(0xFFB45309);
      } else {
        bg = Colors.white;
        border = const Color(0xFFE2E8F0);
        text = const Color(0xFF64748B);
      }
    }

    return InkWell(
      borderRadius: BorderRadius.circular(20),
      onTap: () => setState(() => _selectedStatus = key),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color: bg,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: border),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 11,
            fontWeight: isSelected ? FontWeight.w800 : FontWeight.w600,
            color: text,
          ),
        ),
      ),
    );
  }

  void _showAddDebtorDialog(BuildContext context) {
    final repo = context.read<MockRepository>();
    final nameCtrl = TextEditingController();
    final cityCtrl = TextEditingController();
    final disttCtrl = TextEditingController();
    final balCtrl = TextEditingController(text: '0.00');
    String stateVal = 'Punjab';
    final liveTeam = repo.employees
        .where((e) => e.department == 'Sales')
        .map((e) => e.name)
        .toList();
    final activeSalespeople = liveTeam.isNotEmpty
        ? liveTeam
        : <String>[
            'AJAY JI',
            'Aksit',
            'GAURAV JI',
            'JAGDEEP 2/ Aakash Kumar',
            'JAGDEEP 3/ Dalip Kumar',
            'Jagdeep Singh',
            'Mozi Ram',
            'PANKAJ JI',
            'Pankaj Goyal',
            'SANDEEP2/Mozi Ram',
            'Sandeep Mahajan',
            'Suresh Jindal',
            'VIJAY JI',
          ];
    String selectedSp = activeSalespeople.first;

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
    final int verifiedTotal = repo.debtors.where((d) => d.isVerified).length;
    final int mismatchTotal = repo.debtors.where((d) => d.isMismatch).length;
    final int punjabCount = repo.debtors.where((d) => d.state.toLowerCase() == 'punjab').length;
    final int haryanaCount = repo.debtors.where((d) => d.state.toLowerCase() == 'haryana').length;

    final items = repo.debtors.where((d) {
      if (_selectedTerritory != 'All' &&
          d.state.toLowerCase() != _selectedTerritory.toLowerCase()) {
        return false;
      }
      if (_selectedStatus == 'Verified' && !d.isVerified) {
        return false;
      }
      if (_selectedStatus == 'Mismatches' && !d.isMismatch) {
        return false;
      }
      if (_query.isNotEmpty) {
        final q = _query.toLowerCase();
        return d.name.toLowerCase().contains(q) ||
            d.city.toLowerCase().contains(q) ||
            d.id.toLowerCase().contains(q) ||
            d.salesperson.toLowerCase().contains(q);
      }
      return true;
    }).toList();

    items.sort((a, b) {
      // Prioritize mismatches first if not filtered, then balances
      if (_selectedStatus == 'All') {
        if (a.isMismatch && !b.isMismatch) return -1;
        if (b.isMismatch && !a.isMismatch) return 1;
      }
      if (a.balance > 0 && b.balance <= 0) return -1;
      if (b.balance > 0 && a.balance <= 0) return 1;
      final cmp = b.balance.compareTo(a.balance);
      if (cmp != 0) return cmp;
      return a.name.compareTo(b.name);
    });

    final double totalReceivables = (_query.isEmpty && _selectedTerritory == 'All' && _selectedStatus == 'All' && repo.serverOutstanding != null)
        ? repo.serverOutstanding!
        : items.fold(0.0, (sum, d) => sum + d.balance);

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
          // KPI Summary & Filters Container
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
                // Territory Filters
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
                const SizedBox(height: 8),
                // Verification Status Filter Pills
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: [
                      _statusFilterChip('All', 'All (${repo.debtors.length})'),
                      const SizedBox(width: 6),
                      _statusFilterChip('Verified', '✓ Verified ($verifiedTotal)', isSuccess: true),
                      const SizedBox(width: 6),
                      _statusFilterChip('Mismatches', '⚠ Mismatches ($mismatchTotal)', isWarning: true),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
                // KPI Metric Cards
                Row(
                  children: [
                    Expanded(
                      flex: 6,
                      child: Container(
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFFFBEB),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: const Color(0xFFFDE68A)),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'TOTAL RECEIVABLES',
                              style: TextStyle(
                                fontSize: 9.5,
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
                                fontSize: 14.5,
                                fontWeight: FontWeight.w900,
                                color: Color(0xFFB45309),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      flex: 5,
                      child: Container(
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: const Color(0xFFF0FDF4),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: const Color(0xFFBBF7D0)),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              '✓ VERIFIED',
                              style: TextStyle(
                                fontSize: 9.5,
                                fontWeight: FontWeight.w800,
                                color: Color(0xFF166534),
                                letterSpacing: 0.5,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              '$verifiedTotal accounts',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontSize: 14.5,
                                fontWeight: FontWeight.w900,
                                color: Color(0xFF15803D),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    if (mismatchTotal > 0) ...[
                      const SizedBox(width: 6),
                      Expanded(
                        flex: 5,
                        child: Container(
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            color: const Color(0xFFFEF2F2),
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: const Color(0xFFFECACA)),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text(
                                '⚠ MISMATCH',
                                style: TextStyle(
                                  fontSize: 9.5,
                                  fontWeight: FontWeight.w800,
                                  color: Color(0xFF991B1B),
                                  letterSpacing: 0.5,
                                ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                '$mismatchTotal alerts',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontSize: 14.5,
                                  fontWeight: FontWeight.w900,
                                  color: Color(0xFFDC2626),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
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
                            color: item.isMismatch ? const Color(0xFFFFFDF5) : Colors.white,
                            borderRadius: BorderRadius.circular(14),
                            border: Border.all(
                              color: item.isMismatch
                                  ? const Color(0xFFFDE68A)
                                  : const Color(0xFFE2E8F0),
                              width: item.isMismatch ? 1.5 : 1.0,
                            ),
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
                                          if (item.id.isNotEmpty) ...[
                                            const SizedBox(height: 2),
                                            Text(
                                              item.id,
                                              style: const TextStyle(
                                                fontSize: 10,
                                                fontWeight: FontWeight.w500,
                                                color: Color(0xFF94A3B8),
                                              ),
                                            ),
                                          ],
                                          const SizedBox(height: 3),
                                          Text(
                                            '${item.city.isNotEmpty ? item.city : item.district} (${item.state}) • Rep: ${item.salesperson}',
                                            style: const TextStyle(
                                              fontSize: 11,
                                              fontWeight: FontWeight.w500,
                                              color: Color(0xFF64748B),
                                            ),
                                          ),
                                          // Tally Verification Badge
                                          if (item.isMismatch) ...[
                                            const SizedBox(height: 6),
                                            Container(
                                              padding: const EdgeInsets.symmetric(
                                                horizontal: 7,
                                                vertical: 3,
                                              ),
                                              decoration: BoxDecoration(
                                                color: const Color(0xFFFEF3C7),
                                                borderRadius: BorderRadius.circular(6),
                                                border: Border.all(
                                                  color: const Color(0xFFFDE68A),
                                                ),
                                              ),
                                              child: Row(
                                                mainAxisSize: MainAxisSize.min,
                                                children: [
                                                  const Icon(
                                                    Icons.warning_amber_rounded,
                                                    size: 13,
                                                    color: Color(0xFFD97706),
                                                  ),
                                                  const SizedBox(width: 4),
                                                  Flexible(
                                                    child: Text(
                                                      'Tally Mismatch • Tally: ${item.tallyClosingFormatted} (${item.tallyDiffFormatted})',
                                                      style: const TextStyle(
                                                        fontSize: 10.5,
                                                        fontWeight: FontWeight.w800,
                                                        color: Color(0xFFB45309),
                                                      ),
                                                    ),
                                                  ),
                                                ],
                                              ),
                                            ),
                                          ] else if (item.isVerified) ...[
                                            const SizedBox(height: 6),
                                            Container(
                                              padding: const EdgeInsets.symmetric(
                                                horizontal: 7,
                                                vertical: 3,
                                              ),
                                              decoration: BoxDecoration(
                                                color: const Color(0xFFF0FDF4),
                                                borderRadius: BorderRadius.circular(6),
                                                border: Border.all(
                                                  color: const Color(0xFFBBF7D0),
                                                ),
                                              ),
                                              child: Row(
                                                mainAxisSize: MainAxisSize.min,
                                                children: [
                                                  const Icon(
                                                    Icons.check_circle_rounded,
                                                    size: 13,
                                                    color: Color(0xFF16A34A),
                                                  ),
                                                  const SizedBox(width: 4),
                                                  Text(
                                                    item.hasAuthoritativeLedger
                                                        ? 'Verified (Party Ledger)'
                                                        : 'Verified with Tally',
                                                    style: const TextStyle(
                                                      fontSize: 10.5,
                                                      fontWeight: FontWeight.w800,
                                                      color: Color(0xFF15803D),
                                                    ),
                                                  ),
                                                ],
                                              ),
                                            ),
                                          ],
                                          const SizedBox(height: 6),
                                          // Balance Pill with Tally detail
                                          Container(
                                            padding: const EdgeInsets.symmetric(
                                              horizontal: 8,
                                              vertical: 3,
                                            ),
                                            decoration: BoxDecoration(
                                              color: item.isMismatch
                                                  ? const Color(0xFFFFFBEB)
                                                  : hasBalance
                                                      ? const Color(0xFFFEF2F2)
                                                      : const Color(0xFFF0FDF4),
                                              borderRadius: BorderRadius.circular(6),
                                              border: Border.all(
                                                color: item.isMismatch
                                                    ? const Color(0xFFFDE68A)
                                                    : hasBalance
                                                        ? const Color(0xFFFECACA)
                                                        : const Color(0xFFBBF7D0),
                                              ),
                                            ),
                                            child: Column(
                                              crossAxisAlignment: CrossAxisAlignment.start,
                                              children: [
                                                Text(
                                                  hasBalance
                                                      ? 'Balance: ${item.balanceFormatted}'
                                                      : 'Balance: ₹0.00 (Cleared)',
                                                  style: TextStyle(
                                                    fontSize: 11,
                                                    fontWeight: FontWeight.w800,
                                                    color: item.isMismatch
                                                        ? const Color(0xFF92400E)
                                                        : hasBalance
                                                            ? const Color(0xFFDC2626)
                                                            : const Color(0xFF166534),
                                                  ),
                                                ),
                                                if (item.isMismatch && item.tallyClosing != null)
                                                  Text(
                                                    'Tally Closing: ${item.tallyClosingFormatted}',
                                                    style: const TextStyle(
                                                      fontSize: 9.5,
                                                      fontWeight: FontWeight.w700,
                                                      color: Color(0xFFB45309),
                                                    ),
                                                  ),
                                              ],
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
