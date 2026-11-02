import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/formatters.dart';
import '../../core/share_service.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import '../../data/mock_repository.dart';
import '../../data/models.dart';

/// Holds editable state for one order line.
class _LineRow {
  _LineRow() : qty = TextEditingController();
  final TextEditingController qty;
  String? product;

  double get qtyValue => double.tryParse(qty.text.trim()) ?? 0;

  void dispose() {
    qty.dispose();
  }
}

class OrderFormScreen extends StatefulWidget {
  const OrderFormScreen({super.key, this.existingOrder});
  final SalesOrder? existingOrder;

  @override
  State<OrderFormScreen> createState() => _OrderFormScreenState();
}

class _OrderFormScreenState extends State<OrderFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _notes = TextEditingController();
  String? _customerId;
  DateTime _orderDate = DateTime.now();
  DateTime? _expectedDispatch;
  String _paymentTerms = '30 days credit';
  final List<DemoPhoto> _photos = [];
  final List<_LineRow> _lines = [_LineRow()];

  static const _terms = ['30 days credit', 'Advance', 'COD', '15 days credit'];

  @override
  void initState() {
    super.initState();
    final o = widget.existingOrder;
    if (o != null) {
      _customerId = o.customerId;
      _orderDate = o.orderDate;
      _expectedDispatch = o.expectedDispatchDate;
      _paymentTerms = o.paymentTerms;
      _notes.text = o.notes;
      _photos.addAll(o.orderPhotos);
      if (o.items.isNotEmpty) {
        _lines.clear();
        for (final item in o.items) {
          final row = _LineRow();
          row.product = item.product;
          row.qty.text = item.quantity.toStringAsFixed(3);
          _lines.add(row);
        }
      }
    }
  }

  @override
  void dispose() {
    for (final l in _lines) {
      l.dispose();
    }
    _notes.dispose();
    super.dispose();
  }

  Customer? get _customer {
    final id = _customerId;
    if (id == null) return null;
    return context.read<MockRepository>().customerById(id);
  }

  Future<void> _pickDate({required bool dispatch}) async {
    final now = DateTime.now();
    final initial = dispatch ? (_expectedDispatch ?? now) : _orderDate;
    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime(now.year - 2),
      lastDate: DateTime(now.year + 2),
    );
    if (picked == null) return;
    setState(() {
      if (dispatch) {
        _expectedDispatch = picked;
      } else {
        _orderDate = picked;
      }
    });
  }

  bool _validate() {
    if (_customerId == null) {
      showDemoSnack(context, 'Please select a customer.');
      return false;
    }
    final hasLines = _lines.any((l) => l.product != null && l.qtyValue > 0);
    if (!hasLines && _photos.isEmpty) {
      showDemoSnack(
        context,
        'Add at least one product line or capture an order slip photo.',
      );
      return false;
    }
    return true;
  }

  List<OrderItem> _buildItems(MockRepository repo) {
    final validLines = _lines
        .where((l) => l.product != null && l.qtyValue > 0)
        .toList();
    if (validLines.isEmpty && _photos.isNotEmpty) {
      return [
        OrderItem(
          product: 'Order as per attached slip',
          quantity: 1.0,
          unit: 'MT',
          rate: 0.0,
        ),
      ];
    }
    return validLines
        .map(
          (l) => OrderItem(
            product: l.product!,
            quantity: l.qtyValue,
            unit: 'MT',
            rate: 0.0,
          ),
        )
        .toList();
  }

  @override
  Widget build(BuildContext context) {
    final repo = context.watch<MockRepository>();
    final customers = repo.customers
        .where((c) => c.status == CustomerStatus.active)
        .toList();
    final customer = _customer;

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text(
          widget.existingOrder != null
              ? 'Edit Order ${widget.existingOrder!.number}'
              : 'New Order',
        ),
      ),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            WhitePanel(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const _FieldLabel('Customer / Dealer *'),
                  DropdownButtonFormField<String>(
                    initialValue: _customerId,
                    isExpanded: true,
                    decoration: const InputDecoration(
                      hintText: 'Select dealer',
                    ),
                    items: customers
                        .map(
                          (c) => DropdownMenuItem<String>(
                            value: c.id,
                            child: Text(
                              '${c.name} (${c.city})',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        )
                        .toList(),
                    onChanged: (v) => setState(() => _customerId = v),
                    validator: (v) => v == null ? 'Select a customer' : null,
                  ),
                  const SizedBox(height: 10),
                  InfoRow(label: 'Station', value: customer?.city ?? '—'),
                  InfoRow(
                    label: 'Sales Officer (Auto-assigned)',
                    value: customer == null
                        ? '—'
                        : repo.salespersonName(customer.salespersonId),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            // Handwritten slip capture
            PhotoPickerPanel(
              title: '📸 Handwritten Order Slip / List Photo',
              helper:
                  'Capture with camera or upload a photo of the handwritten slip, diary note, or WhatsApp order list.',
              photos: _photos,
              onPhotosChanged: (p) => setState(() {
                _photos
                  ..clear()
                  ..addAll(p);
              }),
            ),
            const SizedBox(height: 14),
            WhitePanel(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const _FieldLabel('Order Date'),
                  _dateButton(
                    label: dateLabel(_orderDate),
                    onTap: () => _pickDate(dispatch: false),
                  ),
                  const SizedBox(height: 14),
                  const _FieldLabel('Payment Terms'),
                  DropdownButtonFormField<String>(
                    initialValue: _paymentTerms,
                    isExpanded: true,
                    decoration: const InputDecoration(),
                    items: _terms
                        .map((t) => DropdownMenuItem(value: t, child: Text(t)))
                        .toList(),
                    onChanged: (v) =>
                        setState(() => _paymentTerms = v ?? _paymentTerms),
                  ),
                  const SizedBox(height: 14),
                  const _FieldLabel('Expected Dispatch Date (optional)'),
                  _dateButton(
                    label: _expectedDispatch == null
                        ? 'Select date'
                        : dateLabel(_expectedDispatch!),
                    onTap: () => _pickDate(dispatch: true),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            const SectionHeading(
              title: 'Order Products (Optional if slip attached)',
              subtitle: 'Add product line with quantity in MT',
            ),
            const SizedBox(height: 8),
            ...List.generate(
              _lines.length,
              (i) => Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: _productRow(repo, i),
              ),
            ),
            OutlinedButton.icon(
              onPressed: () => setState(() => _lines.add(_LineRow())),
              icon: const Icon(Icons.add_rounded),
              label: const Text('Add material line'),
            ),
            const SizedBox(height: 14),
            WhitePanel(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const _FieldLabel('Notes'),
                  TextFormField(
                    controller: _notes,
                    maxLines: 2,
                    decoration: const InputDecoration(hintText: 'Order notes'),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => _saveDraft(repo),
                    icon: const Icon(Icons.edit_note_rounded),
                    label: const Text('Save Draft'),
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => _preview(repo),
                    icon: const Icon(Icons.visibility_rounded),
                    label: const Text('Preview'),
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            GradientButton(
              label: 'Submit Order',
              icon: Icons.send_rounded,
              gradient: AppGradients.order,
              onPressed: () => _submit(repo),
            ),
            const SizedBox(height: 12),
          ],
        ),
      ),
    );
  }

  Widget _dateButton({required String label, required VoidCallback onTap}) =>
      InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadius.field),
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(AppRadius.field),
            border: Border.all(color: AppColors.line),
          ),
          child: Row(
            children: [
              const Icon(
                Icons.calendar_today_rounded,
                size: 18,
                color: AppColors.purple,
              ),
              const SizedBox(width: 10),
              Expanded(child: Text(label, style: AppText.body)),
            ],
          ),
        ),
      );

  Widget _productRow(MockRepository repo, int index) {
    final line = _lines[index];
    return WhitePanel(
      child: Column(
        children: [
          DropdownButtonFormField<String>(
            initialValue: line.product,
            isExpanded: true,
            decoration: const InputDecoration(
              hintText: 'Select product / material',
            ),
            items: repo.products
                .map((p) => DropdownMenuItem(value: p, child: Text(p)))
                .toList(),
            onChanged: (v) => setState(() => line.product = v),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: TextFormField(
                  controller: line.qty,
                  onChanged: (_) => setState(() {}),
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  decoration: const InputDecoration(
                    labelText: 'Quantity (MT)',
                    hintText: 'e.g. 10.0',
                  ),
                ),
              ),
              const SizedBox(width: 10),
              IconButton(
                onPressed: _lines.length > 1
                    ? () => setState(() {
                        _lines.removeAt(index).dispose();
                      })
                    : null,
                icon: const Icon(
                  Icons.delete_outline_rounded,
                  color: AppColors.red,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  void _preview(MockRepository repo) {
    final customer = _customer;
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (context) {
        final items = _buildItems(repo);
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Order Preview', style: AppText.title),
                const SizedBox(height: 12),
                InfoRow(label: 'Customer', value: customer?.name ?? '—'),
                InfoRow(label: 'Date', value: dateLabel(_orderDate)),
                InfoRow(label: 'Terms', value: _paymentTerms),
                if (_expectedDispatch != null)
                  InfoRow(
                    label: 'Expected Dispatch',
                    value: dateLabel(_expectedDispatch!),
                  ),
                if (customer != null)
                  InfoRow(
                    label: 'Sales Officer',
                    value: repo.salespersonName(customer.salespersonId),
                  ),
                const SizedBox(height: 10),
                Text('Items (${items.length}):', style: AppText.caption),
                const SizedBox(height: 6),
                for (final item in items)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 2),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(item.product, style: AppText.body),
                        Text(
                          '${item.quantity} MT',
                          style: const TextStyle(fontWeight: FontWeight.bold),
                        ),
                      ],
                    ),
                  ),
                if (_photos.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(
                      '📸 ${_photos.length} slip photo(s) attached',
                      style: const TextStyle(
                        fontWeight: FontWeight.bold,
                        color: AppColors.purple,
                      ),
                    ),
                  ),
                const SizedBox(height: 16),
                GradientButton(
                  label: 'Close Preview',
                  icon: Icons.check_rounded,
                  gradient: AppGradients.order,
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  void _saveDraft(MockRepository repo) {
    if (_customerId == null) {
      showDemoSnack(context, 'Please select a customer.');
      return;
    }
    final items = _buildItems(repo);
    if (widget.existingOrder != null) {
      final updated = repo.updateOrder(
        id: widget.existingOrder!.id,
        customerId: _customerId,
        items: items,
        expectedDispatchDate: _expectedDispatch,
        paymentTerms: _paymentTerms,
        notes: _notes.text.trim(),
      );
      showDemoSnack(
        context,
        'Order updated: ${updated?.number ?? widget.existingOrder!.number}',
      );
      Navigator.of(context).pop();
      return;
    }
    final order = repo.addOrder(
      customerId: _customerId!,
      items: items,
      orderDate: _orderDate,
      expectedDispatchDate: _expectedDispatch,
      paymentTerms: _paymentTerms,
      notes: _notes.text.trim(),
      photos: _photos,
      status: OrderStatus.pending,
    );
    showDemoSnack(context, 'Draft saved: ${order.number}');
    Navigator.of(context).pop();
  }

  void _submit(MockRepository repo) {
    if (!_validate()) return;
    final items = _buildItems(repo);
    if (widget.existingOrder != null) {
      final updated = repo.updateOrder(
        id: widget.existingOrder!.id,
        customerId: _customerId,
        items: items,
        expectedDispatchDate: _expectedDispatch,
        paymentTerms: _paymentTerms,
        notes: _notes.text.trim(),
      );
      showDemoSnack(
        context,
        'Order updated: ${updated?.number ?? widget.existingOrder!.number}',
      );
      Navigator.of(context).pop();
      return;
    }
    final order = repo.addOrder(
      customerId: _customerId!,
      items: items,
      orderDate: _orderDate,
      expectedDispatchDate: _expectedDispatch,
      paymentTerms: _paymentTerms,
      notes: _notes.text.trim(),
      photos: _photos,
      status: OrderStatus.pending,
    );
    showDemoSnack(context, 'Order submitted: ${order.number}');
    Navigator.of(context).pop();
  }
}

class _FieldLabel extends StatelessWidget {
  const _FieldLabel(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 6),
    child: Text(text, style: AppText.caption),
  );
}
