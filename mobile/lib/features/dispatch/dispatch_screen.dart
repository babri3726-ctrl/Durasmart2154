import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../../data/mock_repository.dart';
import '../../data/models.dart';
import '../../core/formatters.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';

/// Dispatch desk: pick an order that still needs goods, confirm the quantities
/// actually loaded, capture vehicle / driver details and photos, then record the
/// dispatch against the in-memory repository (demo only — nothing is sent to a
/// real ERP or transporter).
class DispatchScreen extends StatefulWidget {
  const DispatchScreen({super.key});

  @override
  State<DispatchScreen> createState() => _DispatchScreenState();
}

class _DispatchScreenState extends State<DispatchScreen> {
  final _vehicle = TextEditingController();
  final _driver = TextEditingController();
  final _transport = TextEditingController();
  final _notes = TextEditingController();
  final _qty = <String, TextEditingController>{};

  /// Every quantity controller this screen creates. They are released with the
  /// screen instead of on order change: a field element can be reused when two
  /// orders share a product name, and disposing the controller it still points
  /// at mid-rebuild would throw.
  final _ownedQtyControllers = <TextEditingController>[];

  List<DemoPhoto> _photos = const [];
  List<_OrderLineDraft> _drafts = const [];
  String? _orderId;
  DateTime _dispatchDate = DateTime.now();
  String? _formError;

  @override
  void dispose() {
    _vehicle.dispose();
    _driver.dispose();
    _transport.dispose();
    _notes.dispose();
    for (final controller in _ownedQtyControllers) {
      controller.dispose();
    }
    _ownedQtyControllers.clear();
    super.dispose();
  }

  // ── data helpers ──────────────────────────────────────────────────────
  // Confirmed orders, orders waiting for goods (including a partial dispatch that
  // the repository left open) and any order still short of its ordered quantity.
  List<SalesOrder> _dispatchableOrders(MockRepository repo) => repo.orders
      .where(
        (o) =>
            o.status == OrderStatus.pendingDispatch ||
            o.status == OrderStatus.confirmed ||
            (o.status == OrderStatus.dispatched &&
                repo.orderDispatchedQty(o.id) < o.totalQty),
      )
      .where((o) => repo.orderPendingDispatchQty(o.id) > 0.0001)
      .toList();

  SalesOrder? _orderById(MockRepository repo, String? id) {
    if (id == null) return null;
    return repo.orderById(id);
  }

  void _selectOrder(MockRepository repo, String? id) {
    _qty.clear();
    _drafts = const [];
    if (id != null) {
      final order = repo.orderById(id);
      if (order != null) {
        _drafts = _orderLineDrafts(order, repo);
        for (final draft in _drafts) {
          final controller = TextEditingController(
            text: _plainQty(draft.remaining),
          );
          _qty[draft.product] = controller;
          _ownedQtyControllers.add(controller);
        }
      }
    }
    setState(() {
      _orderId = id;
      _formError = null;
    });
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _dispatchDate,
      firstDate: DateTime(now.year - 1),
      lastDate: DateTime(now.year + 1, 12, 31),
    );
    if (picked == null || !mounted) return;
    setState(() => _dispatchDate = picked);
  }

  // ── submit ────────────────────────────────────────────────────────────
  Future<void> _submit() async {
    final repo = context.read<MockRepository>();
    final dispatchable = _dispatchableOrders(repo);
    final selectedId =
        (_orderId != null && dispatchable.any((o) => o.id == _orderId))
        ? _orderId
        : null;
    final order = _orderById(repo, selectedId);
    if (order == null) {
      setState(() => _formError = 'Select an order that still needs dispatch.');
      return;
    }

    final lines = <DispatchLine>[];
    String? lineError;
    for (final draft in _drafts) {
      final raw = _qty[draft.product]?.text;
      final qty = double.tryParse((raw ?? '').trim());
      if (draft.covered) {
        if (qty != null && qty > 0.0001) {
          lineError ??=
              '${draft.product} is already fully dispatched — set it to 0.';
        }
        continue;
      }
      if (qty == null) {
        lineError ??= 'Enter a valid quantity for ${draft.product}.';
        continue;
      }
      if (qty <= 0) {
        lineError ??= 'Quantity for ${draft.product} must be greater than 0.';
        continue;
      }
      if (qty > draft.remaining + 0.0001) {
        lineError ??=
            '${draft.product} cannot exceed the pending ${qtyLabel(draft.remaining, draft.unit)}.';
        continue;
      }
      lines.add(
        DispatchLine(product: draft.product, quantity: qty, unit: draft.unit),
      );
    }

    final vehicleError = Validation.required(
      _vehicle.text,
      field: 'Vehicle number',
    );
    final driverError = Validation.required(
      _driver.text,
      field: 'Driver / in-charge name',
    );

    if (lineError != null || vehicleError != null || driverError != null) {
      setState(() => _formError = lineError ?? vehicleError ?? driverError);
      return;
    }
    if (lines.isEmpty) {
      setState(
        () => _formError = 'Enter a dispatch quantity for at least one item.',
      );
      return;
    }

    final totalQty = lines.fold(0.0, (sum, l) => sum + l.quantity);
    final confirmed = await ConfirmDialog.show(
      context,
      title: 'Record dispatch (demo)',
      message:
          'Order ${order.number}\nCustomer: ${repo.customerById(order.customerId)?.name ?? order.customerId}\n'
          'Items: ${lines.map((l) => qtyLabel(l.quantity, l.unit)).join(', ')}\n'
          'Total: ${qtyLabel(totalQty, order.unit)}\nVehicle: ${_vehicle.text.trim()}\n'
          'Driver: ${_driver.text.trim()}\nDate: ${dateLabel(_dispatchDate)}\n\n'
          'This only writes to the demo data on this device.',
      confirmLabel: 'Confirm dispatch',
    );
    if (!confirmed || !mounted) return;

    final dispatch = repo.addDispatch(
      orderId: order.id,
      lines: lines,
      dispatchDate: _dispatchDate,
      vehicle: _vehicle.text.trim(),
      driver: _driver.text.trim(),
      transportName: _transport.text.trim(),
      notes: _notes.text.trim(),
      photos: _photos,
    );
    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute<void>(
        builder: (_) => DispatchSuccessScreen(dispatchId: dispatch.id),
      ),
    );
  }

  // ── ui ────────────────────────────────────────────────────────────────
  @override
  Widget build(BuildContext context) {
    final repo = context.watch<MockRepository>();
    final orders = _dispatchableOrders(repo);
    final selectedId = (_orderId != null && orders.any((o) => o.id == _orderId))
        ? _orderId
        : null;
    final order = _orderById(repo, selectedId);
    final customer = order == null ? null : repo.customerById(order.customerId);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Dispatch Desk'),
        actions: [
          IconButton(
            tooltip: 'Dispatch history',
            onPressed: () =>
                Navigator.of(context).pushNamed('/dispatch-history'),
            icon: const Icon(Icons.history_rounded),
          ),
        ],
      ),
      body: ListView(
        padding: AppSpacing.page,
        children: [
          const DemoNotice(
            text:
                'Demo dispatch screen. Records a dispatch into the in-memory demo data so you can see the '
                'flow — no ERP, transporter or WhatsApp message is ever sent automatically.',
          ),
          const SizedBox(height: 14),
          WhitePanel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SectionHeading(
                  title: 'Order to dispatch',
                  subtitle: orders.isEmpty
                      ? 'No order is waiting for goods right now.'
                      : '${orders.length} order(s) pending dispatch.',
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  key: ValueKey<String?>('dispatch-order-$selectedId'),
                  initialValue: selectedId,
                  isExpanded: true,
                  hint: const Text('Select an order'),
                  items: [
                    for (final o in orders)
                      DropdownMenuItem<String>(
                        value: o.id,
                        child: Text(
                          '${o.number} • ${repo.customerById(o.customerId)?.name ?? o.customerId} • '
                          'pending ${qtyLabel(repo.orderPendingDispatchQty(o.id), o.unit)}',
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                  ],
                  onChanged: (id) => _selectOrder(repo, id),
                  decoration: const InputDecoration(labelText: 'Order'),
                ),
              ],
            ),
          ),
          if (_formError != null) ...[
            const SizedBox(height: 12),
            _ErrorNotice(message: _formError!),
          ],
          if (order != null) ...[
            const SizedBox(height: 14),
            _OrderSummaryPanel(order: order, customer: customer, repo: repo),
            const SizedBox(height: 14),
            WhitePanel(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SectionHeading(
                    title: 'Quantity loaded',
                    subtitle:
                        'Defaults to the full pending quantity. Reduce it for a partial dispatch.',
                  ),
                  const SizedBox(height: 12),
                  for (final draft in _drafts)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: TextFormField(
                        key: ValueKey<String>('qty-${draft.product}'),
                        controller: _qty[draft.product],
                        keyboardType: const TextInputType.numberWithOptions(
                          decimal: true,
                        ),
                        inputFormatters: [
                          FilteringTextInputFormatter.allow(RegExp(r'[0-9.]')),
                        ],
                        decoration: InputDecoration(
                          labelText: '${draft.product} (${draft.unit})',
                          helperText: draft.covered
                              ? 'Already fully dispatched (${qtyLabel(draft.dispatched, draft.unit)})'
                              : 'Ordered ${qtyLabel(draft.ordered, draft.unit)} • already dispatched '
                                    '${qtyLabel(draft.dispatched, draft.unit)} • pending ${qtyLabel(draft.remaining, draft.unit)}',
                          helperStyle: const TextStyle(
                            fontSize: 11,
                            height: 1.3,
                          ),
                          suffixText: draft.unit,
                        ),
                      ),
                    ),
                  if (_drafts.isEmpty)
                    const Text(
                      'This order has no line items.',
                      style: AppText.body,
                    ),
                ],
              ),
            ),
          ],
          const SizedBox(height: 14),
          WhitePanel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SectionHeading(title: 'Transport details'),
                const SizedBox(height: 12),
                InkWell(
                  onTap: _pickDate,
                  borderRadius: BorderRadius.circular(AppRadius.field),
                  child: InputDecorator(
                    decoration: const InputDecoration(
                      labelText: 'Dispatch date',
                    ),
                    child: Row(
                      children: [
                        const Icon(
                          Icons.event_rounded,
                          size: 18,
                          color: AppColors.purple,
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            dateLabel(_dispatchDate),
                            style: AppText.body,
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
                const SizedBox(height: 12),
                TextFormField(
                  controller: _vehicle,
                  textCapitalization: TextCapitalization.characters,
                  decoration: const InputDecoration(
                    labelText: 'Vehicle number *',
                    hintText: 'PB10 A 4422',
                  ),
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _driver,
                  textCapitalization: TextCapitalization.words,
                  decoration: const InputDecoration(
                    labelText: 'Driver / in-charge name *',
                  ),
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _transport,
                  textCapitalization: TextCapitalization.words,
                  decoration: const InputDecoration(
                    labelText: 'Transport company name',
                    hintText: 'Gill Logistics',
                  ),
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _notes,
                  minLines: 2,
                  maxLines: 4,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: const InputDecoration(
                    labelText: 'Notes',
                    hintText: 'Loading remarks, challan reference…',
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          PhotoPickerPanel(
            title: 'Dispatch photos',
            helper:
                'Loaded goods, the vehicle and any additional proof required before release.',
            photos: _photos,
            onPhotosChanged: (photos) => setState(() => _photos = photos),
            maxPhotos: 6,
          ),
          const SizedBox(height: 16),
          GradientButton(
            label: 'Confirm Dispatch (Demo)',
            icon: Icons.local_shipping_rounded,
            gradient: AppGradients.dispatch,
            onPressed: order == null ? null : _submit,
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: ActionPill(
              icon: Icons.history_rounded,
              label: 'Open dispatch history',
              onTap: () => Navigator.of(context).pushNamed('/dispatch-history'),
            ),
          ),
          const SizedBox(height: 10),
        ],
      ),
    );
  }
}

class _OrderSummaryPanel extends StatelessWidget {
  const _OrderSummaryPanel({
    required this.order,
    required this.customer,
    required this.repo,
  });
  final SalesOrder order;
  final Customer? customer;
  final MockRepository repo;

  @override
  Widget build(BuildContext context) {
    final drafts = _orderLineDrafts(order, repo);
    return WhitePanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SectionHeading(
            title: order.number,
            subtitle:
                '${customer?.name ?? order.customerId} • ${customer?.city ?? 'City not captured'}',
            trailing: StatusChip(
              label: orderStatusLabel(order.status),
              color: order.status == OrderStatus.dispatched
                  ? AppColors.green
                  : AppColors.orange,
            ),
          ),
          const SizedBox(height: 8),
          InfoRow(
            label: 'Salesperson',
            value: repo.salespersonName(order.salespersonId),
          ),
          InfoRow(label: 'Order date', value: dateLabel(order.orderDate)),
          InfoRow(label: 'Payment terms', value: order.paymentTerms),
          InfoRow(label: 'Due date', value: dateLabel(order.dueDate)),
          if (order.expectedDispatchDate != null)
            InfoRow(
              label: 'Expected dispatch',
              value: dateLabel(order.expectedDispatchDate!),
            ),
          InfoRow(label: 'Order value', value: rupees(order.total)),
          InfoRow(
            label: 'Balance on this order',
            value: rupees(repo.orderBalance(order.id)),
            valueColor: repo.orderBalance(order.id) > 0
                ? AppColors.red
                : AppColors.green,
          ),
          const Divider(height: 24),
          const Text('Items & dispatch progress', style: AppText.heading),
          const SizedBox(height: 8),
          for (final draft in drafts) ...[
            InfoRow(
              label: draft.product,
              value:
                  '${qtyLabel(draft.dispatched, draft.unit)} / ${qtyLabel(draft.ordered, draft.unit)} dispatched',
              valueColor: draft.covered ? AppColors.green : AppColors.ink,
            ),
            ProgressRow(
              label: 'Pending ${qtyLabel(draft.remaining, draft.unit)}',
              value: draft.dispatched,
              max: draft.ordered,
              color: draft.covered ? AppColors.green : AppColors.purple,
            ),
            const SizedBox(height: 10),
          ],
          InfoRow(
            label: 'Total pending for dispatch',
            value: qtyLabel(repo.orderPendingDispatchQty(order.id), order.unit),
          ),
        ],
      ),
    );
  }
}

class _ErrorNotice extends StatelessWidget {
  const _ErrorNotice({required this.message});
  final String message;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: AppColors.red.withValues(alpha: .10),
      borderRadius: BorderRadius.circular(14),
      border: Border.all(color: AppColors.red.withValues(alpha: .35)),
    ),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Icon(Icons.error_outline_rounded, color: AppColors.red, size: 18),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            message,
            style: const TextStyle(
              color: AppColors.red,
              fontSize: 12,
              height: 1.4,
            ),
          ),
        ),
      ],
    ),
  );
}

/// One order line rolled up by product with its dispatch progress.
class _OrderLineDraft {
  const _OrderLineDraft({
    required this.product,
    required this.unit,
    required this.ordered,
    required this.dispatched,
  });
  final String product;
  final String unit;
  final double ordered;
  final double dispatched;

  double get remaining {
    final left = ordered - dispatched;
    if (left <= 0.0001) return 0;
    return left;
  }

  bool get covered => remaining <= 0.0001;
}

List<_OrderLineDraft> _orderLineDrafts(SalesOrder order, MockRepository repo) {
  final drafts = <String, _OrderLineDraft>{};
  for (final item in order.items) {
    final existing = drafts[item.product];
    drafts[item.product] = _OrderLineDraft(
      product: item.product,
      unit: item.unit,
      ordered: (existing?.ordered ?? 0) + item.quantity,
      dispatched:
          existing?.dispatched ??
          repo.dispatchedQtyForItem(order.id, item.product),
    );
  }
  return drafts.values.toList();
}

String _plainQty(double value) =>
    value % 1 == 0 ? value.toInt().toString() : value.toStringAsFixed(2);

/// Total of a dispatch written with the units its own lines use.
String _dispatchQtyLabel(Dispatch dispatch) {
  final byUnit = <String, double>{};
  for (final line in dispatch.lines) {
    byUnit[line.unit] = (byUnit[line.unit] ?? 0) + line.quantity;
  }
  if (byUnit.isEmpty) return 'No lines';
  return byUnit.entries
      .map((entry) => qtyLabel(entry.value, entry.key))
      .join(' + ');
}

/// Shown after a dispatch is recorded: summary, photos, share and navigation.
class DispatchSuccessScreen extends StatelessWidget {
  const DispatchSuccessScreen({super.key, required this.dispatchId});
  final String dispatchId;

  @override
  Widget build(BuildContext context) {
    final repo = context.watch<MockRepository>();
    Dispatch? dispatch;
    for (final d in repo.dispatches) {
      if (d.id == dispatchId) dispatch = d;
    }
    if (dispatch == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Dispatch')),
        body: EmptyState(
          icon: Icons.local_shipping_rounded,
          title: 'Dispatch not found',
          subtitle:
              'Recorded demo dispatches only live while this app session is open.',
          action: GradientButton(
            label: 'Back to dashboard',
            icon: Icons.home_rounded,
            onPressed: () => Navigator.of(
              context,
            ).pushNamedAndRemoveUntil('/home', (route) => false),
          ),
        ),
      );
    }

    final order = repo.orderById(dispatch.orderId);
    final customer = repo.customerById(dispatch.customerId);
    final lines = dispatch.lines
        .map((l) => qtyLabel(l.quantity, l.unit))
        .join(', ');
    final summary = dispatchShareText(dispatch, repo);

    return Scaffold(
      appBar: AppBar(title: const Text('Dispatch recorded')),
      body: ListView(
        padding: AppSpacing.page,
        children: [
          GradientHero(
            gradient: AppGradients.dispatch,
            height: 150,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    Container(
                      width: 42,
                      height: 42,
                      decoration: const BoxDecoration(
                        color: Colors.white24,
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(
                        Icons.check_rounded,
                        color: Colors.white,
                        size: 24,
                      ),
                    ),
                    const SizedBox(width: 10),
                    const Expanded(
                      child: Text(
                        'Dispatch recorded (demo)',
                        style: TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w900,
                          fontSize: 18,
                        ),
                      ),
                    ),
                  ],
                ),
                Text(
                  '${dispatch.id} • ${dispatch.orderNumber}',
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w800,
                    fontSize: 13,
                  ),
                ),
                Text(
                  'Saved on this device only • ${dateLabel(dispatch.dispatchDate)}',
                  style: const TextStyle(color: Colors.white70, fontSize: 11),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          WhitePanel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SectionHeading(title: 'Dispatch summary'),
                const SizedBox(height: 6),
                InfoRow(label: 'Order number', value: dispatch.orderNumber),
                InfoRow(
                  label: 'Customer',
                  value: customer?.name ?? dispatch.customerId,
                ),
                InfoRow(label: 'City', value: customer?.city ?? '—'),
                InfoRow(
                  label: 'Dispatch date',
                  value: dateLabel(dispatch.dispatchDate),
                ),
                InfoRow(
                  label: 'Items dispatched',
                  value: lines.isEmpty ? '—' : lines,
                ),
                InfoRow(
                  label: 'Total quantity',
                  value: _dispatchQtyLabel(dispatch),
                ),
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
                InfoRow(
                  label: 'Notes',
                  value: dispatch.notes.isEmpty ? '—' : dispatch.notes,
                ),
                if (order != null) ...[
                  const Divider(height: 24),
                  InfoRow(
                    label: 'Order status now',
                    value: orderStatusLabel(order.status),
                  ),
                  InfoRow(
                    label: 'Still pending dispatch',
                    value: qtyLabel(
                      repo.orderPendingDispatchQty(order.id),
                      order.unit,
                    ),
                    valueColor: repo.orderPendingDispatchQty(order.id) > 0.0001
                        ? AppColors.orange
                        : AppColors.green,
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 14),
          WhitePanel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SectionHeading(
                  title: 'Photos',
                  subtitle: dispatch.photos.isEmpty
                      ? 'No photos were attached to this dispatch.'
                      : '${dispatch.photos.length} photo(s) attached.',
                ),
                if (dispatch.photos.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  PhotoStrip(photos: dispatch.photos, size: 96),
                ],
              ],
            ),
          ),
          const SizedBox(height: 14),
          WhitePanel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SectionHeading(
                  title: 'Share with the customer',
                  subtitle:
                      'Opens WhatsApp with the text ready — you always review before sending.',
                ),
                const SizedBox(height: 12),
                WhatsAppButton(
                  label: 'Share dispatch summary',
                  phone: customer?.mobile ?? '',
                  message: summary,
                ),
                const SizedBox(height: 10),
                WhatsAppButton(
                  label: dispatch.photos.isEmpty
                      ? 'Summary needs photos to share'
                      : 'Share photos + summary',
                  phone: customer?.mobile ?? '',
                  message: summary,
                  photos: dispatch.photos.isEmpty ? null : dispatch.photos,
                  outlined: true,
                ),
                if (dispatch.photos.isEmpty)
                  const Padding(
                    padding: EdgeInsets.only(top: 8),
                    child: Text(
                      'Photo share is enabled once a dispatch has photos attached.',
                      style: TextStyle(fontSize: 11, color: AppColors.muted),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          GradientButton(
            label: 'Back to dashboard',
            icon: Icons.home_rounded,
            gradient: AppGradients.success,
            onPressed: () => Navigator.of(
              context,
            ).pushNamedAndRemoveUntil('/home', (route) => false),
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: ActionPill(
              icon: Icons.history_rounded,
              label: 'View dispatch history',
              onTap: () => Navigator.of(context).pushNamed('/dispatch-history'),
            ),
          ),
          const SizedBox(height: 10),
        ],
      ),
    );
  }
}

/// Readable order + dispatch text for WhatsApp, built from live records only.
String dispatchShareText(Dispatch dispatch, MockRepository repo) {
  final customer = repo.customerById(dispatch.customerId);
  final order = repo.orderById(dispatch.orderId);
  final buffer = StringBuffer();
  buffer.writeln('Dura Smart — dispatch update');
  buffer.writeln('Order: ${dispatch.orderNumber}');
  if (customer != null) {
    buffer.writeln('Customer: ${customer.name} (${customer.city})');
  }
  buffer.writeln(
    'Dispatch: ${dispatch.id} on ${dateLabel(dispatch.dispatchDate)}',
  );
  buffer.writeln('Items loaded:');
  for (final line in dispatch.lines) {
    buffer.writeln('• ${line.product} — ${qtyLabel(line.quantity, line.unit)}');
  }
  buffer.writeln('Total quantity: ${_dispatchQtyLabel(dispatch)}');
  if (dispatch.vehicle.isNotEmpty) {
    buffer.writeln('Vehicle: ${dispatch.vehicle}');
  }
  if (dispatch.driver.isNotEmpty) buffer.writeln('Driver: ${dispatch.driver}');
  if (dispatch.transportName.isNotEmpty) {
    buffer.writeln('Transport: ${dispatch.transportName}');
  }
  if (dispatch.notes.isNotEmpty) buffer.writeln('Notes: ${dispatch.notes}');
  if (order != null) {
    buffer.writeln('Order status: ${orderStatusLabel(order.status)}');
    buffer.writeln('Balance: ${rupees(repo.orderBalance(order.id))}');
  }
  buffer.write('\n(Demo data — please verify against the printed challan.)');
  return buffer.toString();
}
