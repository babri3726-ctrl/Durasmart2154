import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/formatters.dart';
import '../../core/share_service.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import '../../data/mock_repository.dart';
import '../../data/models.dart';

class CustomerListScreen extends StatefulWidget {
  const CustomerListScreen({super.key});

  @override
  State<CustomerListScreen> createState() => _CustomerListScreenState();
}

enum _Sort { name, outstanding, overdue, recent }

class _CustomerListScreenState extends State<CustomerListScreen> {
  String _query = '';
  String _salesFilter = 'All';
  _Sort _sort = _Sort.name;

  @override
  Widget build(BuildContext context) {
    final repo = context.watch<MockRepository>();
    final isOwner = repo.currentUser?.isOwner ?? false;
    final salesNames = repo.employees
        .where((e) => e.department == 'Sales')
        .map((e) => e.name)
        .toList();
    final filterOptions = <String>['All', ...salesNames];

    final filtered = repo.customers.where((c) {
      final matchesQuery =
          _query.isEmpty ||
          c.name.toLowerCase().contains(_query.toLowerCase()) ||
          c.city.toLowerCase().contains(_query.toLowerCase()) ||
          repo
              .salespersonName(c.salespersonId)
              .toLowerCase()
              .contains(_query.toLowerCase());
      final matchesSales =
          _salesFilter == 'All' ||
          repo.salespersonName(c.salespersonId) == _salesFilter;
      return matchesQuery && matchesSales;
    }).toList();

    filtered.sort((a, b) {
      switch (_sort) {
        case _Sort.name:
          return a.name.toLowerCase().compareTo(b.name.toLowerCase());
        case _Sort.outstanding:
          return repo
              .customerOutstanding(b.id)
              .compareTo(repo.customerOutstanding(a.id));
        case _Sort.overdue:
          return repo
              .customerOverdue(b.id)
              .compareTo(repo.customerOverdue(a.id));
        case _Sort.recent:
          // Newly added customers are inserted at the front of the store, so
          // preserving repository order yields most-recent-first.
          return repo.customers.indexOf(a).compareTo(repo.customers.indexOf(b));
      }
    });

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Customers')),
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: AppColors.purple,
        foregroundColor: Colors.white,
        onPressed: () => Navigator.pushNamed(context, '/new-customer'),
        icon: const Icon(Icons.person_add_rounded),
        label: const Text('New Customer'),
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            child: Column(
              children: [
                SearchField(
                  hint: 'Search name, city or salesperson',
                  onChanged: (v) => setState(() => _query = v),
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: FilterChipsRow(
                        options: filterOptions,
                        selected: _salesFilter,
                        onSelected: (v) => setState(() => _salesFilter = v),
                      ),
                    ),
                    const SizedBox(width: 8),
                    _sortDropdown(),
                  ],
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    '${filtered.length} customer(s)',
                    style: AppText.caption,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                if (isOwner)
                  const Flexible(
                    child: StatusChip(
                      label: 'Owner: approvals enabled',
                      color: AppColors.teal,
                    ),
                  ),
              ],
            ),
          ),
          Expanded(
            child: filtered.isEmpty
                ? const EmptyState(
                    icon: Icons.search_off_rounded,
                    title: 'No customers found',
                    subtitle: 'Try a different search term or filter.',
                  )
                : ListView.builder(
                    padding: const EdgeInsets.fromLTRB(16, 4, 16, 96),
                    itemCount: filtered.length,
                    itemBuilder: (context, i) => Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: _customerRow(repo, filtered[i], isOwner),
                    ),
                  ),
          ),
        ],
      ),
    );
  }

  Widget _sortDropdown() => Container(
    padding: const EdgeInsets.symmetric(horizontal: 12),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(AppRadius.field),
      border: Border.all(color: AppColors.line),
    ),
    child: DropdownButtonHideUnderline(
      child: DropdownButton<_Sort>(
        value: _sort,
        borderRadius: BorderRadius.circular(14),
        style: const TextStyle(
          color: AppColors.ink,
          fontWeight: FontWeight.w700,
          fontSize: 12,
        ),
        items: const [
          DropdownMenuItem(value: _Sort.name, child: Text('Name A-Z')),
          DropdownMenuItem(
            value: _Sort.outstanding,
            child: Text('Outstanding'),
          ),
          DropdownMenuItem(value: _Sort.overdue, child: Text('Overdue')),
          DropdownMenuItem(value: _Sort.recent, child: Text('Recently added')),
        ],
        onChanged: (v) => setState(() => _sort = v ?? _Sort.name),
      ),
    ),
  );

  Widget _customerRow(MockRepository repo, Customer c, bool isOwner) {
    final outstanding = repo.customerOutstanding(c.id);
    final overdue = repo.customerOverdue(c.id);
    final overdueDays = repo.overdueDaysFor(c.id);
    return WhitePanel(
      onTap: () => Navigator.pushNamed(
        context,
        '/customer',
        arguments: {'customerId': c.id},
      ),
      child: Column(
        children: [
          Row(
            children: [
              AvatarCircle(
                name: c.name,
                size: 44,
                gradient: AppGradients.customer,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Flexible(
                          child: Text(
                            c.name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: AppText.heading,
                          ),
                        ),
                        if (c.status == CustomerStatus.pendingApproval) ...[
                          const SizedBox(width: 8),
                          const StatusChip(
                            label: 'Pending',
                            color: AppColors.orange,
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${c.city} • ${repo.salespersonName(c.salespersonId)}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppText.caption,
                    ),
                    const SizedBox(height: 6),
                    Wrap(
                      spacing: 8,
                      runSpacing: 6,
                      children: [
                        Text(
                          rupees(outstanding),
                          style: const TextStyle(
                            fontWeight: FontWeight.w900,
                            color: AppColors.ink,
                            fontSize: 13,
                          ),
                        ),
                        overdue > 0
                            ? StatusChip(
                                label: '${overdueDays}d overdue',
                                color: AppColors.red,
                              )
                            : const StatusChip(
                                label: 'On track',
                                color: AppColors.green,
                              ),
                      ],
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right_rounded, color: AppColors.muted),
            ],
          ),
          if (isOwner && c.status == CustomerStatus.pendingApproval) ...[
            const SizedBox(height: 10),
            SizedBox(
              width: double.infinity,
              child: GradientButton(
                label: 'Approve Customer',
                height: 42,
                icon: Icons.check_rounded,
                gradient: AppGradients.success,
                onPressed: () => _approve(repo, c),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Future<void> _approve(MockRepository repo, Customer c) async {
    final ok = await ConfirmDialog.show(
      context,
      title: 'Approve customer?',
      message: 'Approve ${c.name} so they can receive orders.',
      confirmLabel: 'Approve',
    );
    if (!ok || !mounted) return;
    repo.approveCustomer(c.id);
    showDemoSnack(context, '${c.name} approved (demo).');
  }
}
