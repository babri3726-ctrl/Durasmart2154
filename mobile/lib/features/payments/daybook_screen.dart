import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/formatters.dart';
import '../../core/widgets.dart';
import '../../data/mock_repository.dart';

/// Company-wide Day Book & Liquid Books browser for Mobile APK.
/// Mirrors Web Panel `/daybook` with hybrid KPI cards, book sources, and voucher filters.
class DaybookScreen extends StatefulWidget {
  const DaybookScreen({super.key});

  @override
  State<DaybookScreen> createState() => _DaybookScreenState();
}

class _DaybookScreenState extends State<DaybookScreen> {
  String _searchQuery = '';
  String _selectedSource = 'All Books';
  String _selectedType = 'All';
  bool _isLoading = false;

  final List<String> _bookSources = const [
    'All Books',
    'Day Book',
    'Yes Bank Book',
    'HDFC Bank Book',
    'Cash Book',
  ];

  final List<String> _voucherTypes = const [
    'All',
    'Sales',
    'Receipt',
    'Payment',
    'Journal',
    'Credit Note',
  ];

  @override
  void initState() {
    super.initState();
    _loadVouchers();
  }

  Future<void> _loadVouchers() async {
    setState(() => _isLoading = true);
    final repo = context.read<MockRepository>();
    await repo.fetchDaybookVouchers(
      bookSource: _selectedSource == 'All Books' ? null : _selectedSource,
      voucherType: _selectedType == 'All' ? null : _selectedType,
      q: _searchQuery.isEmpty ? null : _searchQuery,
    );
    if (mounted) {
      setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final repo = context.watch<MockRepository>();
    final allVouchers = repo.daybookVouchers;

    // Filter vouchers based on book source, voucher type, and search query
    final filtered = allVouchers.where((v) {
      if (_selectedSource != 'All Books') {
        if (!v.bookSource.toLowerCase().contains(_selectedSource.toLowerCase().replaceAll(' book', ''))) {
          return false;
        }
      }
      if (_selectedType != 'All') {
        if (!v.voucherType.toLowerCase().contains(_selectedType.toLowerCase())) {
          return false;
        }
      }
      if (_searchQuery.isNotEmpty) {
        final q = _searchQuery.toLowerCase();
        final matchesParty = v.partyName.toLowerCase().contains(q);
        final matchesNo = v.voucherNumber.toLowerCase().contains(q);
        final matchesNarration = v.narration.toLowerCase().contains(q);
        if (!matchesParty && !matchesNo && !matchesNarration) {
          return false;
        }
      }
      return true;
    }).toList();

    // Summary calculations
    final double totalDebits = filtered.fold(0.0, (sum, v) => sum + v.debit);
    final double totalCredits = filtered.fold(0.0, (sum, v) => sum + v.credit);
    final double netMovement = totalDebits - totalCredits;

    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        title: const Text('Day Book & Transactions'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            tooltip: 'Sync Vouchers with Server',
            onPressed: () async {
              final sm = ScaffoldMessenger.of(context);
              sm.showSnackBar(
                const SnackBar(
                  content: Text('Syncing latest Day Book vouchers...'),
                  duration: Duration(seconds: 1),
                ),
              );
              await _loadVouchers();
              sm.showSnackBar(
                const SnackBar(content: Text('Day Book synchronized successfully')),
              );
            },
          ),
        ],
      ),
      body: Column(
        children: [
          // Filter & Search Controls
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
                  hint: 'Search by party, voucher no, or narration…',
                  onChanged: (val) {
                    setState(() => _searchQuery = val.trim());
                  },
                ),
                const SizedBox(height: 10),
                HybridPillFilter(
                  options: _bookSources,
                  selected: _selectedSource,
                  onSelected: (val) {
                    setState(() => _selectedSource = val);
                    _loadVouchers();
                  },
                ),
                const SizedBox(height: 8),
                HybridPillFilter(
                  options: _voucherTypes,
                  selected: _selectedType,
                  onSelected: (val) {
                    setState(() => _selectedType = val);
                    _loadVouchers();
                  },
                ),
              ],
            ),
          ),

          // KPI Summary Row
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: Row(
              children: [
                Expanded(
                  child: Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: const Color(0xFFE2E8F0)),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'TOTAL DEBITS',
                          style: TextStyle(
                            fontSize: 10,
                            fontWeight: FontWeight.w800,
                            color: Color(0xFF64748B),
                            letterSpacing: 0.5,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          rupees(totalDebits),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w900,
                            color: Color(0xFF2563EB),
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
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: const Color(0xFFE2E8F0)),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'TOTAL CREDITS',
                          style: TextStyle(
                            fontSize: 10,
                            fontWeight: FontWeight.w800,
                            color: Color(0xFF64748B),
                            letterSpacing: 0.5,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          rupees(totalCredits),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w900,
                            color: Color(0xFF059669),
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
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: const Color(0xFFE2E8F0)),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'NET MOVEMENT',
                          style: TextStyle(
                            fontSize: 10,
                            fontWeight: FontWeight.w800,
                            color: Color(0xFF64748B),
                            letterSpacing: 0.5,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          rupees(netMovement),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w900,
                            color: netMovement >= 0
                                ? const Color(0xFF0F172A)
                                : const Color(0xFFDC2626),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),

          // Voucher List
          Expanded(
            child: RefreshIndicator(
              onRefresh: _loadVouchers,
              child: _isLoading
                  ? const Center(child: CircularProgressIndicator())
                  : filtered.isEmpty
                      ? ListView(
                          physics: const AlwaysScrollableScrollPhysics(),
                          children: const [
                            SizedBox(height: 60),
                            EmptyState(
                              icon: Icons.receipt_long_outlined,
                              title: 'No vouchers found',
                              subtitle: 'Try adjusting book sources or search filters.',
                            ),
                          ],
                        )
                      : ListView.separated(
                          physics: const AlwaysScrollableScrollPhysics(),
                          padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
                          itemCount: filtered.length,
                          separatorBuilder: (_, _) => const SizedBox(height: 8),
                          itemBuilder: (context, i) {
                            final v = filtered[i];
                            final isDebit = v.debit > 0;
                            final amount = isDebit ? v.debit : v.credit;

                            return Container(
                              padding: const EdgeInsets.all(14),
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
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      HybridVoucherBadge(voucherType: v.voucherType),
                                      const SizedBox(width: 8),
                                      Expanded(
                                        child: Text(
                                          v.partyName,
                                          maxLines: 2,
                                          overflow: TextOverflow.ellipsis,
                                          style: const TextStyle(
                                            fontSize: 13,
                                            fontWeight: FontWeight.w800,
                                            color: Color(0xFF0F172A),
                                          ),
                                        ),
                                      ),
                                      const SizedBox(width: 8),
                                      Text(
                                        '${isDebit ? '+' : '-'}${rupees(amount)}',
                                        style: TextStyle(
                                          fontSize: 14,
                                          fontWeight: FontWeight.w900,
                                          color: isDebit
                                              ? const Color(0xFF2563EB)
                                              : const Color(0xFF059669),
                                        ),
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 8),
                                  Row(
                                    children: [
                                      Text(
                                        v.voucherDate,
                                        style: const TextStyle(
                                          fontSize: 11,
                                          fontWeight: FontWeight.w600,
                                          color: Color(0xFF64748B),
                                        ),
                                      ),
                                      if (v.voucherNumber.isNotEmpty) ...[
                                        const Text(' • ', style: TextStyle(color: Color(0xFFCBD5E1))),
                                        Text(
                                          'Vch: ${v.voucherNumber}',
                                          style: const TextStyle(
                                            fontSize: 11,
                                            fontWeight: FontWeight.w600,
                                            color: Color(0xFF64748B),
                                          ),
                                        ),
                                      ],
                                      const Spacer(),
                                      Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                                        decoration: BoxDecoration(
                                          color: const Color(0xFFF1F5F9),
                                          borderRadius: BorderRadius.circular(4),
                                        ),
                                        child: Text(
                                          v.bookSource,
                                          style: const TextStyle(
                                            fontSize: 9.5,
                                            fontWeight: FontWeight.w700,
                                            color: Color(0xFF475569),
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                  if (v.narration.isNotEmpty) ...[
                                    const SizedBox(height: 6),
                                    Text(
                                      v.narration,
                                      maxLines: 2,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(
                                        fontSize: 11,
                                        fontStyle: FontStyle.italic,
                                        color: Color(0xFF94A3B8),
                                      ),
                                    ),
                                  ],
                                ],
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
