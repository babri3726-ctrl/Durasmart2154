import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../data/mock_repository.dart';
import '../../data/models.dart';
import '../../core/formatters.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';

/// Every dispatch recorded in this demo session, searchable by order number,
/// customer or vehicle and filterable by salesperson.
class DispatchHistoryScreen extends StatefulWidget {
  const DispatchHistoryScreen({super.key});

  @override
  State<DispatchHistoryScreen> createState() => _DispatchHistoryScreenState();
}

class _DispatchHistoryScreenState extends State<DispatchHistoryScreen> {
  final _search = TextEditingController();
  String _query = '';
  String? _salespersonId;

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  List<_HistoryRow> _rows(MockRepository repo) {
    final rows = <_HistoryRow>[];
    for (final dispatch in repo.dispatches) {
      final order = repo.orderById(dispatch.orderId);
      final customer = repo.customerById(dispatch.customerId);
      rows.add(
        _HistoryRow(
          dispatch: dispatch,
          customerName: customer?.name ?? dispatch.customerId,
          city: customer?.city ?? '',
          salespersonId: order?.salespersonId ?? '',
          salespersonName: order == null
              ? 'Unassigned'
              : repo.salespersonName(order.salespersonId),
          orderStatus: order?.status,
        ),
      );
    }
    rows.sort(
      (a, b) => b.dispatch.dispatchDate.compareTo(a.dispatch.dispatchDate),
    );

    final needle = _query.trim().toLowerCase();
    return rows.where((row) {
      if (_salespersonId != null && row.salespersonId != _salespersonId) {
        return false;
      }
      if (needle.isEmpty) return true;
      final haystacks = <String>[
        row.dispatch.orderNumber,
        row.customerName,
        row.dispatch.vehicle,
        row.dispatch.driver,
        row.dispatch.transportName,
        row.dispatch.id,
      ];
      return haystacks.any((text) => text.toLowerCase().contains(needle));
    }).toList();
  }

  void _openOrder(String orderId) => Navigator.of(
    context,
  ).pushNamed('/order', arguments: <String, String>{'orderId': orderId});

  @override
  Widget build(BuildContext context) {
    final repo = context.watch<MockRepository>();
    final rows = _rows(repo);

    final salespeople = <String, String>{};
    for (final row in rows) {
      if (row.salespersonId.isEmpty) continue;
      salespeople.putIfAbsent(row.salespersonId, () => row.salespersonName);
    }
    final allRows = _allRowsWithoutFilter(repo);
    final now = DateTime.now();
    final monthRows = rows
        .where(
          (row) =>
              row.dispatch.dispatchDate.year == now.year &&
              row.dispatch.dispatchDate.month == now.month,
        )
        .toList();
    final monthUnits = <String, double>{};
    for (final row in monthRows) {
      for (final line in row.dispatch.lines) {
        monthUnits[line.unit] = (monthUnits[line.unit] ?? 0) + line.quantity;
      }
    }
    final monthQtyText = monthUnits.isEmpty
        ? '0'
        : monthUnits.entries
              .map((entry) => qtyLabel(entry.value, entry.key))
              .join(' + ');

    return Scaffold(
      appBar: AppBar(
        title: const Text('Dispatch History'),
        actions: [
          IconButton(
            tooltip: 'New dispatch',
            onPressed: () => Navigator.of(context).pushNamed('/dispatch'),
            icon: const Icon(Icons.add_rounded),
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: Column(
              children: [
                SearchField(
                  controller: _search,
                  hint: 'Search order number, customer, vehicle…',
                  onChanged: (value) => setState(() => _query = value),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  key: ValueKey<String?>('dispatch-history-sp-$_salespersonId'),
                  initialValue: _salespersonId,
                  isExpanded: true,
                  hint: const Text('All salespersons'),
                  items: [
                    for (final entry in salespeople.entries)
                      DropdownMenuItem<String>(
                        value: entry.key,
                        child: Text(
                          entry.value,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                  ],
                  onChanged: (id) => setState(() => _salespersonId = id),
                  decoration: const InputDecoration(labelText: 'Salesperson'),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: MetricCard(
                        title: 'Dispatches shown',
                        value: '${rows.length}',
                        caption: allRows == rows.length
                            ? 'All dispatches on record'
                            : '$allRows recorded in total',
                        icon: Icons.local_shipping_rounded,
                        gradient: AppGradients.dispatch,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: MetricCard(
                        title: 'Quantity • ${monthLabel(now)}',
                        value: monthQtyText,
                        caption: '${monthRows.length} dispatch(es) this month',
                        icon: Icons.scale_rounded,
                        gradient: AppGradients.payment,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 6),
          Expanded(
            child: rows.isEmpty
                ? EmptyState(
                    icon: Icons.no_transfer_rounded,
                    title: _query.trim().isEmpty && _salespersonId == null
                        ? 'No dispatches yet'
                        : 'No dispatch matches this filter',
                    subtitle: _query.trim().isEmpty && _salespersonId == null
                        ? 'Record a dispatch from the dispatch desk to see it listed here.'
                        : 'Try a different search word, or clear the salesperson filter.',
                    action: SizedBox(
                      width: double.infinity,
                      child: ActionPill(
                        icon: Icons.local_shipping_rounded,
                        label: 'Open dispatch desk',
                        onTap: () =>
                            Navigator.of(context).pushNamed('/dispatch'),
                      ),
                    ),
                  )
                : ListView.separated(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                    itemCount: rows.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 12),
                    itemBuilder: (context, index) => _DispatchCard(
                      row: rows[index],
                      onTap: () => _openOrder(rows[index].dispatch.orderId),
                    ),
                  ),
          ),
        ],
      ),
    );
  }

  int _allRowsWithoutFilter(MockRepository repo) => repo.dispatches.length;
}

class _HistoryRow {
  const _HistoryRow({
    required this.dispatch,
    required this.customerName,
    required this.city,
    required this.salespersonId,
    required this.salespersonName,
    this.orderStatus,
  });
  final Dispatch dispatch;
  final String customerName;
  final String city;
  final String salespersonId;
  final String salespersonName;
  final OrderStatus? orderStatus;
}

/// Total quantity of a dispatch written with the units its lines actually use.
String dispatchQtyLabel(Dispatch dispatch) {
  final byUnit = <String, double>{};
  for (final line in dispatch.lines) {
    byUnit[line.unit] = (byUnit[line.unit] ?? 0) + line.quantity;
  }
  if (byUnit.isEmpty) return 'No lines';
  return byUnit.entries
      .map((entry) => qtyLabel(entry.value, entry.key))
      .join(' + ');
}

class _DispatchCard extends StatelessWidget {
  const _DispatchCard({required this.row, required this.onTap});
  final _HistoryRow row;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final dispatch = row.dispatch;
    return WhitePanel(
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(dispatch.orderNumber, style: AppText.title),
                    const SizedBox(height: 2),
                    Text(
                      '${row.customerName}${row.city.isEmpty ? '' : ' • ${row.city}'}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppText.caption,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    dateLabel(dispatch.dispatchDate),
                    style: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                      color: AppColors.muted,
                    ),
                  ),
                  const SizedBox(height: 4),
                  if (row.orderStatus != null)
                    StatusChip(
                      label: orderStatusLabel(row.orderStatus!),
                      color: row.orderStatus == OrderStatus.dispatched
                          ? AppColors.green
                          : AppColors.orange,
                    ),
                ],
              ),
            ],
          ),
          const Divider(height: 20),
          InfoRow(label: 'Dispatch ID', value: dispatch.id),
          InfoRow(label: 'Total quantity', value: dispatchQtyLabel(dispatch)),
          InfoRow(
            label: 'Vehicle',
            value: dispatch.vehicle.isEmpty ? '—' : dispatch.vehicle,
          ),
          InfoRow(
            label: 'Driver',
            value: dispatch.driver.isEmpty ? '—' : dispatch.driver,
          ),
          InfoRow(
            label: 'Transport',
            value: dispatch.transportName.isEmpty
                ? '—'
                : dispatch.transportName,
          ),
          InfoRow(label: 'Salesperson', value: row.salespersonName),
          if (dispatch.notes.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(
                    Icons.sticky_note_2_outlined,
                    size: 15,
                    color: AppColors.muted,
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      dispatch.notes,
                      style: const TextStyle(
                        fontSize: 11.5,
                        color: AppColors.muted,
                        height: 1.4,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          if (dispatch.lines.isNotEmpty) ...[
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final line in dispatch.lines)
                  StatusChip(
                    label:
                        '${line.product} ${qtyLabel(line.quantity, line.unit)}',
                    color: AppColors.purple,
                  ),
              ],
            ),
          ],
          if (dispatch.photos.isNotEmpty) ...[
            const SizedBox(height: 12),
            Text(
              '${dispatch.photos.length} photo(s) attached',
              style: const TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w800,
                color: AppColors.green,
              ),
            ),
            const SizedBox(height: 8),
            PhotoStrip(photos: dispatch.photos, size: 74),
          ],
        ],
      ),
    );
  }
}
