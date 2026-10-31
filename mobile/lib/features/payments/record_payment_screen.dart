import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../../data/mock_repository.dart';
import '../../data/models.dart';
import '../../core/formatters.dart';
import '../../core/share_service.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';

/// Records a money receipt against one customer invoice (demo data only).
class RecordPaymentScreen extends StatefulWidget {
  const RecordPaymentScreen({super.key});

  @override
  State<RecordPaymentScreen> createState() => _RecordPaymentScreenState();
}

class _RecordPaymentScreenState extends State<RecordPaymentScreen> {
  final _formKey = GlobalKey<FormState>();
  final _amount = TextEditingController();
  final _reference = TextEditingController();
  final _notes = TextEditingController();

  String? _customerId;
  String? _orderId;
  bool _allowAdvance = false;
  PaymentMethod _method = PaymentMethod.cash;
  DateTime _date = DateTime.now();
  String? _formError;

  String? _lastPaymentId;
  String? _lastCustomerId;
  String? _lastOrderId;

  @override
  void initState() {
    super.initState();
    _amount.addListener(_onAmountChanged);
  }

  @override
  void dispose() {
    _amount.removeListener(_onAmountChanged);
    _amount.dispose();
    _reference.dispose();
    _notes.dispose();
    super.dispose();
  }

  void _onAmountChanged() => setState(() {});

  List<Customer> _customers(MockRepository repo) {
    final list = List<Customer>.from(repo.customers);
    list.sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
    return list;
  }

  List<SalesOrder> _invoiceOptions(MockRepository repo) {
    final id = _customerId;
    if (id == null) return const [];
    final orders = repo.ordersFor(id);
    if (_allowAdvance) return orders;
    return orders
        .where((order) => repo.orderBalance(order.id) > 0.0001)
        .toList();
  }

  void _selectCustomer(MockRepository repo, String? id) {
    setState(() {
      _customerId = id;
      _orderId = null;
      _formError = null;
    });
    final options = _invoiceOptions(repo);
    if (options.isNotEmpty) {
      setState(() => _orderId = options.first.id);
    }
  }

  void _toggleAdvance(MockRepository repo, bool value) {
    setState(() {
      _allowAdvance = value;
      _formError = null;
    });
    final options = _invoiceOptions(repo);
    if (options.isEmpty) {
      setState(() => _orderId = null);
      return;
    }
    if (_orderId == null || !options.any((order) => order.id == _orderId)) {
      setState(() => _orderId = options.first.id);
    }
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _date,
      firstDate: DateTime(now.year - 1),
      lastDate: DateTime(now.year + 1, 12, 31),
    );
    if (picked == null || !mounted) return;
    setState(() => _date = picked);
  }

  String _exceedsMessage(double balance) =>
      'Exceeds outstanding ${rupees(balance)} — switch to advance if intended';

  Future<void> _submit() async {
    final repo = context.read<MockRepository>();
    final order = _orderId == null ? null : repo.orderById(_orderId!);
    final customer = _customerId == null
        ? null
        : repo.customerById(_customerId!);
    final formValid = _formKey.currentState?.validate() ?? false;

    if (customer == null || order == null) {
      setState(
        () => _formError =
            'Choose a customer and an invoice before recording a payment.',
      );
      return;
    }
    final amount = double.tryParse(_amount.text.trim());
    if (amount == null || amount <= 0) {
      setState(
        () => _formError = 'Enter the amount received (greater than zero).',
      );
      return;
    }
    if (!formValid) {
      setState(
        () => _formError = 'Fix the highlighted field before submitting.',
      );
      return;
    }

    final balance = repo.orderBalance(order.id);
    if (!_allowAdvance && amount > balance + 0.0001) {
      setState(() => _formError = _exceedsMessage(balance));
      return;
    }

    final confirmed = await ConfirmDialog.show(
      context,
      title: 'Record payment (demo)',
      message:
          'Customer: ${customer.name}\nInvoice: ${order.number}\n'
          'Amount: ${rupees(amount)}\nMethod: ${paymentMethodLabel(_method)}\n'
          'Date: ${dateLabel(_date)}\n'
          '${balance - amount >= 0 ? 'Balance after: ${rupees(balance - amount)}' : 'Advance credit: ${rupees(amount - balance)}'}\n\n'
          'This only writes to the demo data on this device.',
      confirmLabel: 'Record payment',
    );
    if (!confirmed || !mounted) return;

    final payment = repo.recordPayment(
      customerId: customer.id,
      orderId: order.id,
      amount: amount,
      method: _method,
      date: _date,
      reference: _reference.text.trim(),
      notes: _notes.text.trim(),
      allowAdvance: _allowAdvance,
    );
    if (!mounted) return;

    if (payment == null) {
      setState(() {
        _formError =
            'Payment rejected — re-check the amount against the outstanding '
            '${rupees(repo.orderBalance(order.id))}, or turn on the advance switch.';
      });
      _formKey.currentState?.validate();
      return;
    }

    final newBalance = repo.orderBalance(order.id);
    final outstanding = repo.customerOutstanding(customer.id);
    setState(() {
      _lastPaymentId = payment.id;
      _lastCustomerId = customer.id;
      _lastOrderId = order.id;
      _formError = null;
    });
    _resetInputFields();
    showDemoSnack(
      context,
      'Recorded ${rupees(payment.amount)} • new balance ${rupees(newBalance)}'
      ' • customer outstanding ${rupees(outstanding)}',
    );
  }

  void _resetInputFields() {
    _amount.clear();
    _reference.clear();
    _notes.clear();
    _formKey.currentState?.reset();
  }

  void _resetForm() {
    setState(() {
      _lastPaymentId = null;
      _lastCustomerId = null;
      _lastOrderId = null;
      _customerId = null;
      _orderId = null;
      _allowAdvance = false;
      _method = PaymentMethod.cash;
      _date = DateTime.now();
      _formError = null;
    });
    _resetInputFields();
  }

  @override
  Widget build(BuildContext context) {
    final repo = context.watch<MockRepository>();
    final customers = _customers(repo);
    final customer = _customerId == null
        ? null
        : repo.customerById(_customerId!);
    final options = _invoiceOptions(repo);
    final selectedOrderId =
        (_orderId != null && options.any((order) => order.id == _orderId))
        ? _orderId
        : null;
    final order = selectedOrderId == null
        ? null
        : repo.orderById(selectedOrderId);
    final balance = order == null ? 0.0 : repo.orderBalance(order.id);
    final entered = double.tryParse(_amount.text.trim()) ?? 0;
    final preview = balance - entered;

    final lastPayment = _lastPaymentId == null
        ? null
        : repo.payments.where((p) => p.id == _lastPaymentId).firstOrNull;
    final lastCustomer = _lastCustomerId == null
        ? null
        : repo.customerById(_lastCustomerId!);
    final lastOrderBalance = _lastOrderId == null
        ? null
        : repo.orderBalance(_lastOrderId!);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Record Payment'),
        actions: [
          IconButton(
            tooltip: 'Outstanding list',
            onPressed: () => Navigator.of(context).pushNamed('/outstanding'),
            icon: const Icon(Icons.warning_amber_rounded),
          ),
        ],
      ),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: AppSpacing.page,
          children: [
            const DemoNotice(
              text:
                  'Demo receipt entry. The payment is stored in the in-memory demo repository so the ledger and '
                  'outstanding screens update immediately — no bank or accounting entry is created.',
            ),
            const SizedBox(height: 14),
            if (customer != null)
              _PositionPanel(
                customer: customer,
                repo: repo,
                orderNumber: order?.number,
                orderBalance: order == null ? null : balance,
                entered: entered,
                preview: preview,
              ),
            if (customer != null) const SizedBox(height: 14),
            WhitePanel(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SectionHeading(title: 'Who is paying'),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    key: ValueKey<String?>('rp-customer-$_customerId'),
                    initialValue: _customerId,
                    isExpanded: true,
                    hint: const Text('Select customer'),
                    items: [
                      for (final c in customers)
                        DropdownMenuItem<String>(
                          value: c.id,
                          child: Text(
                            '${c.name} • ${c.city} • due ${rupeesShort(repo.customerOutstanding(c.id))}',
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                    ],
                    onChanged: (id) => _selectCustomer(repo, id),
                    decoration: const InputDecoration(labelText: 'Customer'),
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    key: ValueKey<String?>(
                      'rp-order-$selectedOrderId-${options.length}',
                    ),
                    initialValue: selectedOrderId,
                    isExpanded: true,
                    hint: Text(
                      customer == null
                          ? 'Pick a customer first'
                          : 'No open invoice for this customer',
                    ),
                    items: [
                      for (final o in options)
                        DropdownMenuItem<String>(
                          value: o.id,
                          child: Text(
                            '${o.number} • invoice ${rupeesShort(o.total)} • balance ${rupeesShort(repo.orderBalance(o.id))}',
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                    ],
                    onChanged: customer == null || options.isEmpty
                        ? null
                        : (id) => setState(() {
                            _orderId = id;
                            _formError = null;
                          }),
                    decoration: InputDecoration(
                      labelText: 'Invoice / order',
                      helperText: _allowAdvance
                          ? 'Advance mode: all invoices of this customer are selectable.'
                          : 'Only invoices with a balance are listed.',
                      helperStyle: const TextStyle(fontSize: 11, height: 1.3),
                    ),
                  ),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    value: _allowAdvance,
                    title: const Text('This is an advance payment'),
                    subtitle: const Text(
                      'Allows an amount above the current outstanding balance.',
                    ),
                    onChanged: (value) => _toggleAdvance(repo, value),
                  ),
                ],
              ),
            ),
            if (_formError != null) ...[
              const SizedBox(height: 12),
              _ErrorNotice(message: _formError!),
            ],
            const SizedBox(height: 14),
            WhitePanel(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SectionHeading(title: 'Payment details'),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _amount,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    inputFormatters: [
                      FilteringTextInputFormatter.allow(RegExp(r'[0-9.]')),
                    ],
                    decoration: InputDecoration(
                      labelText: 'Amount received *',
                      prefixText: '₹ ',
                      helperText: order == null
                          ? 'Select an invoice to see its balance.'
                          : 'Invoice balance ${rupees(balance)}',
                      helperStyle: const TextStyle(fontSize: 11, height: 1.3),
                    ),
                    validator: (value) {
                      final basic = Validation.positiveAmount(
                        value,
                        field: 'amount received',
                      );
                      if (basic != null) return basic;
                      if (_allowAdvance || order == null) return null;
                      final amount = double.tryParse((value ?? '').trim()) ?? 0;
                      if (amount > balance + 0.0001) {
                        return _exceedsMessage(balance);
                      }
                      return null;
                    },
                  ),
                  const SizedBox(height: 12),
                  InkWell(
                    onTap: _pickDate,
                    borderRadius: BorderRadius.circular(AppRadius.field),
                    child: InputDecorator(
                      decoration: const InputDecoration(
                        labelText: 'Payment date',
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
                            child: Text(dateLabel(_date), style: AppText.body),
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
                  DropdownButtonFormField<PaymentMethod>(
                    key: ValueKey<String>('rp-method-${_method.name}'),
                    initialValue: _method,
                    isExpanded: true,
                    items: [
                      for (final method in PaymentMethod.values)
                        DropdownMenuItem<PaymentMethod>(
                          value: method,
                          child: Text(paymentMethodLabel(method)),
                        ),
                    ],
                    onChanged: (value) =>
                        setState(() => _method = value ?? _method),
                    decoration: const InputDecoration(
                      labelText: 'Payment method',
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _reference,
                    textCapitalization: TextCapitalization.characters,
                    decoration: const InputDecoration(
                      labelText: 'Reference / UTR / cheque number',
                      hintText: 'HDFC458812, UPI-9921…',
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _notes,
                    minLines: 2,
                    maxLines: 4,
                    textCapitalization: TextCapitalization.sentences,
                    decoration: const InputDecoration(labelText: 'Notes'),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            GradientButton(
              label: 'Record Payment (Demo)',
              icon: Icons.verified_rounded,
              gradient: AppGradients.payment,
              onPressed: customer == null || order == null ? null : _submit,
            ),
            if (lastPayment != null && lastCustomer != null) ...[
              const SizedBox(height: 14),
              _SuccessPanel(
                payment: lastPayment,
                customer: lastCustomer,
                newBalance: lastOrderBalance,
                repo: repo,
                onRecordAnother: _resetForm,
              ),
            ],
            const SizedBox(height: 20),
          ],
        ),
      ),
    );
  }
}

class _PositionPanel extends StatelessWidget {
  const _PositionPanel({
    required this.customer,
    required this.repo,
    required this.orderNumber,
    required this.orderBalance,
    required this.entered,
    required this.preview,
  });
  final Customer customer;
  final MockRepository repo;
  final String? orderNumber;
  final double? orderBalance;
  final double entered;
  final double preview;

  @override
  Widget build(BuildContext context) {
    final outstanding = repo.customerOutstanding(customer.id);
    final overdue = repo.customerOverdue(customer.id);
    return WhitePanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SectionHeading(
            title: customer.name,
            subtitle:
                '${customer.city} • ${repo.salespersonName(customer.salespersonId)}',
            trailing: AvatarCircle(
              name: customer.name,
              size: 40,
              gradient: AppGradients.customer,
            ),
          ),
          const SizedBox(height: 8),
          InfoRow(label: 'Outstanding right now', value: rupees(outstanding)),
          InfoRow(
            label: 'Overdue',
            value: overdue > 0
                ? '${rupees(overdue)} • ${repo.overdueDaysFor(customer.id)} day(s)'
                : 'None',
            valueColor: overdue > 0 ? AppColors.red : AppColors.green,
          ),
          InfoRow(
            label: 'Advance credit',
            value: repo.customerAdvance(customer.id) > 0
                ? rupees(repo.customerAdvance(customer.id))
                : 'None',
          ),
          InfoRow(
            label: 'Last payment',
            value: customer.lastPaymentDate == null
                ? 'Not recorded'
                : dateLabel(customer.lastPaymentDate!),
          ),
          if (orderNumber != null && orderBalance != null) ...[
            const Divider(height: 22),
            InfoRow(
              label: 'Invoice $orderNumber balance',
              value: rupees(orderBalance!),
            ),
            InfoRow(
              label: entered <= 0
                  ? 'Enter an amount to preview'
                  : 'Balance after ${rupees(entered)}',
              value: rupees(preview),
              valueColor: preview < 0 ? AppColors.orange : AppColors.ink,
            ),
          ],
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

class _SuccessPanel extends StatelessWidget {
  const _SuccessPanel({
    required this.payment,
    required this.customer,
    required this.newBalance,
    required this.repo,
    required this.onRecordAnother,
  });
  final Payment payment;
  final Customer customer;
  final double? newBalance;
  final MockRepository repo;
  final VoidCallback onRecordAnother;

  @override
  Widget build(BuildContext context) {
    final navigator = Navigator.of(context);
    final outstanding = repo.customerOutstanding(customer.id);
    final receipt = StringBuffer();
    receipt.writeln('Dura Smart — payment receipt (demo)');
    receipt.writeln('Customer: ${customer.name} (${customer.city})');
    receipt.writeln(
      'Invoice: ${payment.invoiceNumber} of ${rupees(payment.invoiceAmount)}',
    );
    receipt.writeln(
      'Received: ${rupees(payment.amount)} via ${paymentMethodLabel(payment.method)}',
    );
    if (payment.reference.isNotEmpty) {
      receipt.writeln('Reference: ${payment.reference}');
    }
    receipt.writeln('Date: ${dateLabel(payment.date)}');
    if (payment.notes.isNotEmpty) receipt.writeln('Notes: ${payment.notes}');
    receipt.writeln('Balance on invoice now: ${rupees(newBalance ?? 0)}');
    receipt.write(
      'Total outstanding for ${customer.name}: ${rupees(outstanding)}',
    );

    return WhitePanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  gradient: AppGradients.success,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Icon(Icons.check_rounded, color: Colors.white),
              ),
              const SizedBox(width: 10),
              const Expanded(
                child: Text('Payment recorded (demo)', style: AppText.heading),
              ),
              StatusChip(label: payment.id, color: AppColors.teal),
            ],
          ),
          const SizedBox(height: 8),
          InfoRow(
            label: 'Amount received',
            value: rupees(payment.amount),
            valueColor: AppColors.green,
          ),
          InfoRow(label: 'Invoice', value: payment.invoiceNumber),
          InfoRow(label: 'Method', value: paymentMethodLabel(payment.method)),
          InfoRow(label: 'Date', value: dateLabel(payment.date)),
          InfoRow(label: 'Balance on invoice', value: rupees(newBalance ?? 0)),
          InfoRow(label: 'Customer outstanding', value: rupees(outstanding)),
          const Divider(height: 22),
          WhatsAppButton(
            label: 'Share receipt on WhatsApp',
            phone: customer.mobile,
            message: receipt.toString(),
          ),
          const SizedBox(height: 10),
          GradientButton(
            label: 'Record another payment',
            icon: Icons.restart_alt_rounded,
            gradient: AppGradients.payment,
            onPressed: onRecordAnother,
          ),
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            child: ActionPill(
              icon: Icons.receipt_long_rounded,
              label: 'Open ${customer.name} ledger',
              onTap: () => navigator.pushNamed(
                '/ledger',
                arguments: <String, String>{'customerId': customer.id},
              ),
            ),
          ),
        ],
      ),
    );
  }
}
