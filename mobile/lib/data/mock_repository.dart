import 'package:flutter/foundation.dart';

import '../core/api_sync_service.dart';
import 'models.dart';

/// In-memory mock repository for the Demo Operations demo build.
/// All records are demonstration data. Nothing here is connected to a
/// backend, database or shared company data. The demo passcode below is a
/// UI mock only — it is NOT secure authentication; production sign-in must
/// be enforced by a real backend.
class MockRepository extends ChangeNotifier {
  MockRepository() {
    _seed();
  }

  static const demoPasscode = 'demo123';

  // ── session ──────────────────────────────────────────────────────────
  AppUser? currentUser;
  bool signedIn = false;

  AppUser? authenticate(String idOrEmail, String password) {
    final key = idOrEmail.trim().toLowerCase();
    for (final u in _accounts) {
      final matches =
          u.email.toLowerCase() == key ||
          u.id.toLowerCase() == key ||
          (u.employeeId?.toLowerCase() == key);
      if (matches && password == demoPasscode) {
        currentUser = u;
        signedIn = true;
        notifyListeners();
        return u;
      }
    }
    return null;
  }

  void logout() {
    currentUser = null;
    signedIn = false;
    notifyListeners();
  }

  // ── collections ──────────────────────────────────────────────────────
  final employees = <Employee>[];
  final customers = <Customer>[];
  final orders = <SalesOrder>[];
  final payments = <Payment>[];
  final dispatches = <Dispatch>[];
  final areas = <AreaInfo>[];
  final tours = <TourPlan>[];
  final tasks = <WorkTask>[];
  final notifications = <AppNotification>[];
  final debtors = <DebtorItem>[];
  final salesTargets = <SalesTargetItem>[];

  void addDebtor(DebtorItem item) {
    debtors.insert(0, item);
    // Mirror into customers list so debtor is immediately selectable in New Order form
    final existingCust = customers.where((c) => c.id == item.id).firstOrNull;
    if (existingCust == null) {
      customers.insert(
        0,
        Customer(
          id: item.id,
          name: item.name,
          type: 'Dealer',
          contactPerson: item.name,
          mobile: '919800000000',
          city: item.city.isNotEmpty
              ? item.city
              : (item.district.isNotEmpty ? item.district : item.state),
          salespersonId: item.salesperson,
          status: CustomerStatus.active,
        ),
      );
    }
    // Asynchronously synchronize with FastAPI backend
    ApiSyncService.postDebtor({
      'id': item.id,
      'name': item.name,
      'state': item.state,
      'city': item.city,
      'district': item.district,
      'salesperson': item.salesperson,
      'balance': item.balance,
    });
    notifyListeners();
  }

  void updateDebtor(DebtorItem item) {
    final idx = debtors.indexWhere((d) => d.id == item.id);
    if (idx != -1) {
      debtors[idx] = item;
      final cIdx = customers.indexWhere((c) => c.id == item.id);
      if (cIdx != -1) {
        customers[cIdx] = Customer(
          id: item.id,
          name: item.name,
          type: 'Dealer',
          contactPerson: item.name,
          mobile: customers[cIdx].mobile,
          city: item.city.isNotEmpty ? item.city : item.district,
          salespersonId: item.salesperson,
          status: customers[cIdx].status,
        );
      }
      ApiSyncService.postDebtor({
        'id': item.id,
        'name': item.name,
        'state': item.state,
        'city': item.city,
        'district': item.district,
        'salesperson': item.salesperson,
        'balance': item.balance,
      });
      notifyListeners();
    }
  }

  void deleteDebtor(String id) {
    debtors.removeWhere((d) => d.id == id);
    customers.removeWhere((c) => c.id == id);
    notifyListeners();
  }

  final products = <String>[
    'UPVC',
    'Slit Coil Kamdhenu',
    'Slit Coil JSW',
    'Profile',
  ];

  // ── lookups ──────────────────────────────────────────────────────────
  Customer? customerById(String id) =>
      customers.where((c) => c.id == id).firstOrNull;
  SalesOrder? orderById(String id) =>
      orders.where((o) => o.id == id).firstOrNull;
  Employee? employeeById(String id) =>
      employees.where((e) => e.id == id).firstOrNull;
  WorkTask? taskById(String id) => tasks.where((t) => t.id == id).firstOrNull;
  AreaInfo? areaById(String id) => areas.where((a) => a.id == id).firstOrNull;
  TourPlan? tourById(String id) => tours.where((t) => t.id == id).firstOrNull;

  String salespersonName(String employeeId) =>
      employeeById(employeeId)?.name ?? 'Unassigned';

  List<SalesOrder> ordersFor(String customerId) =>
      orders.where((o) => o.customerId == customerId).toList()
        ..sort((a, b) => b.orderDate.compareTo(a.orderDate));

  /// Scopes orders based on user authority:
  /// - Owner: sees all orders
  /// - Dispatch: sees all orders (needed to load and dispatch across yard)
  /// - Sales Employee: sees only their assigned orders
  List<SalesOrder> ordersForUser(AppUser? user) {
    if (user == null || user.isOwner || user.isDispatch) {
      return List.unmodifiable(orders);
    }
    return orders.where((o) {
      final cust = customerById(o.customerId);
      return o.salespersonId == user.employeeId ||
          o.salespersonId == user.id ||
          cust?.salespersonId == user.employeeId ||
          cust?.salespersonId == user.id;
    }).toList();
  }

  List<Payment> paymentsFor(String customerId) =>
      payments.where((p) => p.customerId == customerId).toList()
        ..sort((a, b) => b.date.compareTo(a.date));

  List<Dispatch> dispatchesFor(String orderId) =>
      dispatches.where((d) => d.orderId == orderId).toList();

  /// Scopes dispatches based on user role:
  /// - Owner and Dispatch: see all dispatches
  /// - Sales Employee: sees only dispatches belonging to their orders
  List<Dispatch> dispatchesForUser(AppUser? user) {
    if (user == null || user.isOwner || user.isDispatch) {
      return List.unmodifiable(dispatches);
    }
    final allowedOrderIds = ordersForUser(user).map((o) => o.id).toSet();
    return dispatches
        .where((d) => allowedOrderIds.contains(d.orderId))
        .toList();
  }

  List<Customer> customersForSalesperson(String employeeId) =>
      customers.where((c) => c.salespersonId == employeeId).toList();

  // ── derived money ────────────────────────────────────────────────────
  double orderPaid(String orderId) => payments
      .where((p) => p.orderId == orderId)
      .fold(0, (sum, p) => sum + p.amount);

  double orderBalance(String orderId) {
    final order = orderById(orderId);
    if (order == null) return 0;
    return order.total - orderPaid(orderId);
  }

  double customerOutstanding(String customerId) => ordersFor(
    customerId,
  ).fold(0, (sum, o) => sum + _positive(orderBalance(o.id)));

  double customerAdvance(String customerId) {
    var credit = 0.0;
    for (final o in ordersFor(customerId)) {
      final bal = orderBalance(o.id);
      if (bal < 0) credit += -bal;
    }
    return credit;
  }

  double customerOverdue(String customerId) {
    final now = DateTime.now();
    var overdue = 0.0;
    for (final o in ordersFor(customerId)) {
      final bal = orderBalance(o.id);
      if (bal > 0 && o.dueDate.isBefore(now)) overdue += bal;
    }
    return overdue;
  }

  bool customerHasOverdue(String customerId) => customerOverdue(customerId) > 0;

  int overdueDaysFor(String customerId) {
    final now = DateTime.now();
    var worst = 0;
    for (final o in ordersFor(customerId)) {
      if (orderBalance(o.id) > 0 && o.dueDate.isBefore(now)) {
        final days = now.difference(o.dueDate).inDays;
        if (days > worst) worst = days;
      }
    }
    return worst;
  }

  double totalOutstanding() =>
      customers.fold(0.0, (sum, c) => sum + customerOutstanding(c.id));
  double totalOverdue() =>
      customers.fold(0.0, (sum, c) => sum + customerOverdue(c.id));

  // ── derived dispatch progress ────────────────────────────────────────
  double dispatchedQtyForItem(String orderId, String product) {
    var qty = 0.0;
    for (final d in dispatchesFor(orderId)) {
      for (final l in d.lines) {
        if (l.product == product) qty += l.quantity;
      }
    }
    return qty;
  }

  double orderDispatchedQty(String orderId) {
    final order = orderById(orderId);
    if (order == null) return 0;
    return order.items.fold(
      0.0,
      (sum, i) =>
          sum + dispatchedQtyForItem(orderId, i.product).clamp(0, i.quantity),
    );
  }

  double orderPendingDispatchQty(String orderId) {
    final order = orderById(orderId);
    if (order == null) return 0;
    return order.totalQty - orderDispatchedQty(orderId);
  }

  // ── derived sales metrics ────────────────────────────────────────────
  SalesMetrics salesMetrics({String? salespersonId, DateTime? month}) {
    final m = month ?? DateTime.now();
    final now = DateTime.now();
    final monthOrders = orders.where(
      (o) =>
          o.orderDate.year == m.year &&
          o.orderDate.month == m.month &&
          (salespersonId == null || o.salespersonId == salespersonId),
    );
    final monthPayments = payments.where(
      (p) =>
          p.date.year == m.year &&
          p.date.month == m.month &&
          (salespersonId == null ||
              customerBelongsTo(p.customerId, salespersonId)),
    );

    final target = salespersonId != null
        ? employeeById(salespersonId)?.monthlyTargetQty ?? 0
        : employees.fold(0.0, (sum, e) => sum + e.monthlyTargetQty);
    final achieved = monthOrders.fold(0.0, (sum, o) => sum + o.totalQty);
    final pendingDispatch = orders
        .where((o) => salespersonId == null || o.salespersonId == salespersonId)
        .where(
          (o) =>
              o.status == OrderStatus.pendingDispatch ||
              o.status == OrderStatus.confirmed,
        )
        .fold(0.0, (sum, o) => sum + orderPendingDispatchQty(o.id));
    final outstanding = customers
        .where((c) => salespersonId == null || c.salespersonId == salespersonId)
        .fold(0.0, (sum, c) => sum + customerOutstanding(c.id));
    final pendingOrderCount = orders
        .where((o) => salespersonId == null || o.salespersonId == salespersonId)
        .where(
          (o) =>
              o.status == OrderStatus.pending ||
              o.status == OrderStatus.confirmed,
        )
        .length;

    return SalesMetrics(
      targetQty: target,
      achievedQty: achieved,
      pendingTargetQty: (target - achieved)
          .clamp(0, double.infinity)
          .toDouble(),
      ordersReceived: monthOrders.length,
      ordersPendingCount: pendingOrderCount,
      pendingDispatchQty: pendingDispatch,
      paymentReceived: monthPayments.fold(0.0, (sum, p) => sum + p.amount),
      paymentBalance: outstanding,
      overdueBalance: customers
          .where(
            (c) => salespersonId == null || c.salespersonId == salespersonId,
          )
          .fold(0.0, (sum, c) => sum + customerOverdue(c.id)),
      achievementPercent: target <= 0
          ? 0
          : (achieved / target * 100).clamp(0, 999),
      month: m,
      asOf: now,
    );
  }

  bool customerBelongsTo(String customerId, String? salespersonId) {
    if (salespersonId == null) return true;
    return customerById(customerId)?.salespersonId == salespersonId;
  }

  // ── monthly series for charts ────────────────────────────────────────
  List<double> lastSixMonthsAchievement({String? salespersonId}) {
    final now = DateTime.now();
    return List.generate(6, (i) {
      final m = DateTime(now.year, now.month - (5 - i));
      return orders
          .where(
            (o) =>
                o.orderDate.year == m.year &&
                o.orderDate.month == m.month &&
                (salespersonId == null || o.salespersonId == salespersonId),
          )
          .fold(0.0, (sum, o) => sum + o.totalQty);
    });
  }

  // ── actions ──────────────────────────────────────────────────────────
  String nextCustomerId() => 'CUS-${1000 + customers.length + 1}';
  String nextOrderNumber() {
    final n = 2600 + orders.length + 1;
    return 'DS-$n';
  }

  Customer addCustomer({
    required String name,
    required String city,
    required String mobile,
    required String salespersonId,
    String contactPerson = '',
    String address = '',
    String type = 'Dealer',
    String notes = '',
    bool approvalRequired = true,
  }) {
    final customer = Customer(
      id: nextCustomerId(),
      name: name,
      city: city,
      mobile: mobile,
      salespersonId: salespersonId,
      contactPerson: contactPerson,
      address: address,
      type: type,
      notes: notes,
      status: approvalRequired
          ? CustomerStatus.pendingApproval
          : CustomerStatus.active,
    );
    customers.insert(0, customer);
    _pushNotification(
      'New customer submitted',
      '$name ($city) is awaiting approval.',
    );
    notifyListeners();
    return customer;
  }

  void approveCustomer(String customerId) {
    customerById(customerId)?.status = CustomerStatus.active;
    notifyListeners();
  }

  SalesOrder addOrder({
    required String customerId,
    required List<OrderItem> items,
    DateTime? orderDate,
    DateTime? dueDate,
    String paymentTerms = '30 days credit',
    DateTime? expectedDispatchDate,
    String notes = '',
    List<DemoPhoto> photos = const [],
    OrderStatus status = OrderStatus.pending,
  }) {
    final customer = customerById(customerId);
    final created = orderDate ?? DateTime.now();
    final order = SalesOrder(
      id: 'ORD-${100 + orders.length + 1}',
      number: nextOrderNumber(),
      customerId: customerId,
      salespersonId: customer?.salespersonId ?? '',
      orderDate: created,
      items: items,
      dueDate:
          dueDate ?? DateTime(created.year, created.month, created.day + 30),
      paymentTerms: paymentTerms,
      expectedDispatchDate: expectedDispatchDate,
      notes: notes,
      orderPhotos: photos,
      status: status,
    );
    orders.insert(0, order);
    // Asynchronously synchronize order with FastAPI backend
    ApiSyncService.postOrder({
      'customerId': customerId,
      'customerName': customer?.name ?? customerId,
      'salespersonName': salespersonName(customer?.salespersonId ?? ''),
      'state': customer?.city ?? '',
      'orderDate': created.toIso8601String().substring(0, 10),
      'expectedDispatchDate': expectedDispatchDate?.toIso8601String().substring(
        0,
        10,
      ),
      'paymentTerms': paymentTerms,
      'notes': notes,
      'status': 'pendingApproval',
      'lines': items
          .map(
            (i) => {
              'product': i.product,
              'quantity': i.quantity.toStringAsFixed(3),
              'unit': i.unit,
              'ratePaise': (i.rate * 100).round(),
              'amountPaise': (i.lineTotal * 100).round(),
            },
          )
          .toList(),
    });
    _pushNotification(
      'Order submitted',
      '${order.number} • ${customer?.name ?? customerId}',
    );
    notifyListeners();
    return order;
  }

  bool deleteOrder(String orderId) {
    final idx = orders.indexWhere((o) => o.id == orderId);
    if (idx != -1) {
      final order = orders.removeAt(idx);
      _pushNotification(
        'Order deleted',
        '${order.number} permanently deleted',
      );
      ApiSyncService.deleteOrder(orderId);
      notifyListeners();
      return true;
    }
    return false;
  }

  SalesOrder? updateOrder({
    required String id,
    String? customerId,
    List<OrderItem>? items,
    DateTime? dueDate,
    String? paymentTerms,
    DateTime? expectedDispatchDate,
    String? notes,
  }) {
    final idx = orders.indexWhere((o) => o.id == id);
    if (idx == -1) return null;
    final old = orders[idx];
    final custId = customerId ?? old.customerId;
    final customer = customerById(custId);
    final updated = SalesOrder(
      id: old.id,
      number: old.number,
      customerId: custId,
      salespersonId: customer?.salespersonId ?? old.salespersonId,
      orderDate: old.orderDate,
      items: items ?? old.items,
      dueDate: dueDate ?? old.dueDate,
      paymentTerms: paymentTerms ?? old.paymentTerms,
      expectedDispatchDate: expectedDispatchDate ?? old.expectedDispatchDate,
      notes: notes ?? old.notes,
      status: old.status,
      orderPhotos: old.orderPhotos,
    );
    orders[idx] = updated;

    ApiSyncService.patchOrder(id, {
      if (customerId != null) 'customerId': customerId,
      if (paymentTerms != null) 'paymentTerms': paymentTerms,
      if (expectedDispatchDate != null)
        'expectedDispatchDate':
            expectedDispatchDate.toIso8601String().substring(0, 10),
      if (dueDate != null)
        'dueDate': dueDate.toIso8601String().substring(0, 10),
      if (notes != null) 'notes': notes,
      if (items != null)
        'lines': items
            .map(
              (i) => {
                'product': i.product,
                'quantity': i.quantity.toStringAsFixed(3),
                'unit': i.unit,
                'ratePaise': (i.rate * 100).round(),
                'amountPaise': (i.lineTotal * 100).round(),
              },
            )
            .toList(),
    });

    _pushNotification(
      'Order updated',
      '${updated.number} • ${customer?.name ?? updated.customerId}',
    );
    notifyListeners();
    return updated;
  }

  /// Records a dispatch and refreshes the order's dispatch state. An order is
  /// marked fully dispatched only when every item quantity is covered.
  Dispatch addDispatch({
    required String orderId,
    required List<DispatchLine> lines,
    DateTime? dispatchDate,
    String vehicle = '',
    String driver = '',
    String transportName = '',
    String notes = '',
    List<DemoPhoto> photos = const [],
  }) {
    final order = orderById(orderId)!;
    final dispatch = Dispatch(
      id: 'DSP-${100 + dispatches.length + 1}',
      orderId: orderId,
      orderNumber: order.number,
      customerId: order.customerId,
      dispatchDate: dispatchDate ?? DateTime.now(),
      lines: lines,
      vehicle: vehicle,
      driver: driver,
      transportName: transportName,
      notes: notes,
      photos: photos,
    );
    dispatches.insert(0, dispatch);
    _recomputeDispatchStatus(order);
    _pushNotification(
      'Dispatch recorded',
      '${order.number} • ${customerById(order.customerId)?.name ?? ''}',
    );
    notifyListeners();
    return dispatch;
  }

  void _recomputeDispatchStatus(SalesOrder order) {
    final remaining = orderPendingDispatchQty(order.id);
    if (remaining <= 0.0001) {
      order.status = OrderStatus.dispatched;
    } else if (orderDispatchedQty(order.id) > 0) {
      order.status = OrderStatus.pendingDispatch;
    }
  }

  /// Sets order status (e.g. pending, confirmed, or dispatched / cancelled)
  void setOrderStatus(String orderId, OrderStatus status, {String? reason}) {
    final order = orderById(orderId);
    if (order == null) return;
    order.status = status;
    String statusStr = 'pending';
    if (status == OrderStatus.confirmed) statusStr = 'confirmed';
    if (status == OrderStatus.dispatched) statusStr = 'dispatched';
    ApiSyncService.postOrderStatus(orderId, statusStr, reason: reason);
    _pushNotification(
      'Order status updated',
      '${order.number} marked as ${orderStatusLabel(status)}',
    );
    notifyListeners();
  }

  /// Quick dispatches an order in full
  void quickDispatchOrder(
    String orderId, {
    String vehicleNo = 'PB 10 CT 4421',
    String notes = 'Full order dispatched',
  }) {
    final order = orderById(orderId);
    if (order == null) return;
    final lines = order.items
        .map(
          (i) => DispatchLine(
            product: i.product,
            quantity: i.quantity,
            unit: i.unit,
          ),
        )
        .toList();
    addDispatch(
      orderId: orderId,
      lines: lines,
      vehicle: vehicleNo,
      notes: notes,
    );
    ApiSyncService.quickDispatchOrder(
      orderId,
      vehicleNo: vehicleNo,
      notes: notes,
    );
  }

  /// Records a payment against an order invoice or on-account. Returns null and changes
  /// nothing when validation fails.
  Payment? recordPayment({
    required String customerId,
    String? orderId,
    required double amount,
    required PaymentMethod method,
    DateTime? date,
    String reference = '',
    String notes = '',
    bool allowAdvance = false,
  }) {
    if (amount <= 0) return null;
    final order = orderId != null ? orderById(orderId) : null;
    if (orderId != null && order != null) {
      final balance = orderBalance(orderId);
      if (amount > balance + 0.0001 && !allowAdvance) return null;
    }
    final payment = Payment(
      id: 'PAY-${100 + payments.length + 1}',
      customerId: customerId,
      orderId: orderId ?? '',
      invoiceNumber: order?.number ?? 'ON-ACCOUNT',
      invoiceAmount: order?.total ?? 0.0,
      amount: amount,
      date: date ?? DateTime.now(),
      method: method,
      reference: reference,
      notes: notes,
    );
    payments.insert(0, payment);
    final customer = customerById(customerId);
    if (customer != null) {
      customer.lastPaymentDate = payment.date;
    }
    _pushNotification(
      'Payment recorded',
      '${rupeesPlain(amount)} against ${order?.number ?? customer?.name ?? "Account"}',
    );

    // Asynchronously dispatch payment to backend SQLite database
    final payPayload = {
      'customerId': customerId,
      'customerName': customer?.name ?? 'Direct Dealer',
      'amountPaise': (amount * 100).round(),
      'paymentDate': (date ?? DateTime.now()).toIso8601String().substring(
        0,
        10,
      ),
      'method': paymentMethodLabel(method),
      'reference': reference,
      'notes': notes,
    };
    ApiSyncService.postPayment(payPayload);

    notifyListeners();
    return payment;
  }

  WorkTask addTask({
    required String title,
    required String assignedEmployeeId,
    required DateTime dueAt,
    String description = '',
    TaskPriority priority = TaskPriority.normal,
    bool requiresPhoto = false,
  }) {
    final task = WorkTask(
      id: 'TSK-${100 + tasks.length + 1}',
      title: title,
      description: description,
      assignedEmployeeId: assignedEmployeeId,
      dueAt: dueAt,
      createdBy: currentUser?.name ?? 'Owner',
      createdAt: DateTime.now(),
      priority: priority,
      requiresPhoto: requiresPhoto,
    );
    tasks.insert(0, task);
    _pushNotification('Task assigned', '$title • due ${_fmtShort(dueAt)}');
    notifyListeners();
    return task;
  }

  void acknowledgeTask(String taskId) {
    final t = taskById(taskId);
    if (t != null && t.status == TaskStatus.open) {
      t.status = TaskStatus.acknowledged;
    }
    notifyListeners();
  }

  /// Completing a photo-required task stores the proof later via
  /// [attachCompletionPhoto]; until then the task shows missing proof.
  void completeTask(String taskId, {String notes = '', DemoPhoto? photo}) {
    final t = taskById(taskId);
    if (t == null) return;
    t.status = TaskStatus.completed;
    t.completedAt = DateTime.now();
    t.completionNotes = notes;
    if (photo != null) t.completionPhoto = photo;
    notifyListeners();
  }

  void attachCompletionPhoto(String taskId, DemoPhoto photo) {
    final t = taskById(taskId);
    if (t != null) {
      t.completionPhoto = photo;
      notifyListeners();
    }
  }

  AreaInfo addArea({
    required String name,
    required String city,
    required String district,
    required String state,
    String? salespersonId,
    int potentialCustomers = 0,
    String notes = '',
  }) {
    final area = AreaInfo(
      id: 'AREA-${100 + areas.length + 1}',
      name: name,
      city: city,
      district: district,
      state: state,
      salespersonId: salespersonId,
      potentialCustomers: potentialCustomers,
      status: salespersonId == null ? AreaStatus.vacant : AreaStatus.assigned,
      notes: notes,
    );
    areas.insert(0, area);
    notifyListeners();
    return area;
  }

  void updateArea(
    String areaId, {
    String? name,
    String? city,
    String? district,
    String? state,
    int? potentialCustomers,
    String? notes,
  }) {
    final a = areaById(areaId);
    if (a == null) return;
    if (name != null && name.trim().isNotEmpty) a.name = name.trim();
    if (city != null && city.trim().isNotEmpty) a.city = city.trim();
    if (district != null && district.trim().isNotEmpty) {
      a.district = district.trim();
    }
    if (state != null && state.trim().isNotEmpty) a.state = state.trim();
    if (potentialCustomers != null) a.potentialCustomers = potentialCustomers;
    if (notes != null) a.notes = notes;
    notifyListeners();
  }

  void assignArea(String areaId, String? salespersonId) {
    final a = areaById(areaId);
    if (a == null) return;
    a.salespersonId = salespersonId;
    a.status = salespersonId == null ? AreaStatus.vacant : AreaStatus.assigned;
    notifyListeners();
  }

  int existingCustomersIn(AreaInfo area) => customers
      .where((c) => c.city.toLowerCase() == area.city.toLowerCase())
      .length;

  TourPlan addTourPlan({
    required String salespersonId,
    required DateTime date,
    required String area,
    List<TourVisit> visits = const [],
    String notes = '',
  }) {
    final tour = TourPlan(
      id: 'TOUR-${100 + tours.length + 1}',
      salespersonId: salespersonId,
      date: date,
      area: area,
      visits: List.of(visits),
      notes: notes,
    );
    tours.insert(0, tour);
    notifyListeners();
    return tour;
  }

  void addVisit(String tourId, TourVisit visit) {
    tourById(tourId)?.visits.add(visit);
    notifyListeners();
  }

  void updateVisit(
    String tourId,
    String visitId, {
    VisitStatus? status,
    DateTime? actualTime,
    double? gpsLat,
    double? gpsLng,
    bool? gpsVerified,
    String? notes,
    DemoPhoto? photo,
  }) {
    final tour = tourById(tourId);
    if (tour == null) return;
    final visit = tour.visits.where((v) => v.id == visitId).firstOrNull;
    if (visit == null) return;
    if (status != null) visit.status = status;
    if (actualTime != null) visit.actualTime = actualTime;
    if (gpsLat != null) visit.gpsLat = gpsLat;
    if (gpsLng != null) visit.gpsLng = gpsLng;
    if (gpsVerified != null) visit.gpsVerified = gpsVerified;
    if (notes != null) visit.notes = notes;
    if (photo != null) visit.photo = photo;
    notifyListeners();
  }

  void markNotificationRead(String id) {
    final n = notifications.where((n) => n.id == id).firstOrNull;
    if (n != null) n.read = true;
    notifyListeners();
  }

  int get unreadNotifications => notifications.where((n) => !n.read).length;

  void _pushNotification(String title, String body) {
    notifications.insert(
      0,
      AppNotification(
        id: 'NTF-${1000 + notifications.length}',
        title: title,
        body: body,
        time: DateTime.now(),
      ),
    );
  }

  String _fmtShort(DateTime d) =>
      '${d.day}/${d.month} ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';

  // ── seed demo data ───────────────────────────────────────────────────
  final _accounts = <AppUser>[
    AppUser(
      id: 'USR-001',
      name: 'Rajinder Malhotra',
      email: 'owner@example.test',
      role: UserRole.owner,
      department: 'Management',
      phone: '919814011111',
    ),
    AppUser(
      id: 'EMP-101',
      name: 'Amanpreet Singh',
      email: 'amanpreet@example.test',
      role: UserRole.employee,
      department: 'Sales',
      employeeId: 'SAL-01',
      phone: '919814022101',
    ),
    AppUser(
      id: 'EMP-102',
      name: 'Harpreet Singh',
      email: 'harpreet@example.test',
      role: UserRole.employee,
      department: 'Sales',
      employeeId: 'SAL-02',
      phone: '919815540021',
    ),
    AppUser(
      id: 'EMP-103',
      name: 'Rohit Kumar',
      email: 'rohit@example.test',
      role: UserRole.employee,
      department: 'Sales',
      employeeId: 'SAL-03',
      phone: '919876011234',
    ),
    AppUser(
      id: 'EMP-201',
      name: 'Simran Kaur',
      email: 'simran@example.test',
      role: UserRole.employee,
      department: 'Dispatch',
      employeeId: 'OPS-01',
      phone: '919872055410',
    ),
  ];

  List<AppUser> get demoAccounts => List.unmodifiable(_accounts);

  void _seed() {
    final now = DateTime.now();
    DateTime d(int day, {int monthOffset = 0}) =>
        DateTime(now.year, now.month + monthOffset, day);

    employees.addAll([
      Employee(
        id: 'SAL-01',
        name: 'Amanpreet Singh',
        role: 'Area Sales Manager',
        department: 'Sales',
        phone: '919814022101',
        email: 'amanpreet@example.test',
        city: 'Ludhiana',
        monthlyTargetQty: 100,
      ),
      Employee(
        id: 'SAL-02',
        name: 'Harpreet Singh',
        role: 'Sales Executive',
        department: 'Sales',
        phone: '919815540021',
        email: 'harpreet@example.test',
        city: 'Jalandhar',
        monthlyTargetQty: 85,
      ),
      Employee(
        id: 'SAL-03',
        name: 'Rohit Kumar',
        role: 'Sales Executive',
        department: 'Sales',
        phone: '919876011234',
        email: 'rohit@example.test',
        city: 'Amritsar',
        monthlyTargetQty: 75,
      ),
      Employee(
        id: 'SAL-04',
        name: 'Vikram Anand',
        role: 'Sales Executive',
        department: 'Sales',
        phone: '919877712345',
        email: 'vikram@example.test',
        city: 'Patiala',
        monthlyTargetQty: 60,
      ),
      Employee(
        id: 'OPS-01',
        name: 'Simran Kaur',
        role: 'Dispatch Coordinator',
        department: 'Dispatch',
        phone: '919872055410',
        email: 'simran@example.test',
        city: 'Ludhiana',
      ),
      Employee(
        id: 'OPS-02',
        name: 'Gurmeet Singh',
        role: 'Warehouse In-charge',
        department: 'Stores',
        phone: '919814455667',
        email: 'gurmeet@example.test',
        city: 'Ludhiana',
      ),
    ]);

    customers.addAll([
      Customer(
        id: 'CUS-1001',
        name: 'Gupta Steel Traders',
        city: 'Ludhiana',
        mobile: '919814022110',
        salespersonId: 'SAL-01',
        contactPerson: 'Anil Gupta',
        address: 'Shop 14, Steel Market, Ludhiana',
        type: 'Dealer',
        lastPaymentDate: d(2),
      ),
      Customer(
        id: 'CUS-1002',
        name: 'Bansal Iron & Pipes',
        city: 'Jalandhar',
        mobile: '919815540021',
        salespersonId: 'SAL-02',
        contactPerson: 'Sunil Bansal',
        address: 'Industrial Area B, Jalandhar',
        type: 'Dealer',
        lastPaymentDate: d(5),
      ),
      Customer(
        id: 'CUS-1003',
        name: 'Sharma Roofing Works',
        city: 'Amritsar',
        mobile: '919876011234',
        salespersonId: 'SAL-03',
        contactPerson: 'Rakesh Sharma',
        address: 'Grand Trunk Road, Amritsar',
        type: 'Contractor',
        lastPaymentDate: d(1),
      ),
      Customer(
        id: 'CUS-1004',
        name: 'Khanna Sheet Metal',
        city: 'Khanna',
        mobile: '919872055410',
        salespersonId: 'SAL-01',
        contactPerson: 'Mandeep Khanna',
        address: 'GT Nagar Market, Khanna',
        type: 'Dealer',
        lastPaymentDate: d(8),
      ),
      Customer(
        id: 'CUS-1005',
        name: 'Patiala Buildmart',
        city: 'Patiala',
        mobile: '919877712345',
        salespersonId: 'SAL-04',
        contactPerson: 'Deep Sandhu',
        address: 'Bus Stand Road, Patiala',
        type: 'Retailer',
        lastPaymentDate: null,
      ),
      Customer(
        id: 'CUS-1006',
        name: 'Chawla Engineering Co',
        city: 'Ludhiana',
        mobile: '919814099887',
        salespersonId: 'SAL-01',
        contactPerson: 'Pankaj Chawla',
        address: 'CISCO Market, Ludhiana',
        type: 'Fabricator',
        lastPaymentDate: d(12),
      ),
      Customer(
        id: 'CUS-1007',
        name: 'Nakra Fabricators',
        city: 'Amritsar',
        mobile: '919876500112',
        salespersonId: 'SAL-03',
        contactPerson: 'Rajeev Nakra',
        address: 'Hall Bazaar, Amritsar',
        type: 'Fabricator',
        lastPaymentDate: null,
      ),
      Customer(
        id: 'CUS-1008',
        name: 'Brar Traders',
        city: 'Bathinda',
        mobile: '919814455667',
        salespersonId: 'SAL-02',
        contactPerson: 'Jaspreet Brar',
        address: 'Kachi Arzi, Bathinda',
        type: 'Dealer',
        status: CustomerStatus.pendingApproval,
        lastPaymentDate: null,
      ),
    ]);

    orders.addAll([
      SalesOrder(
        id: 'ORD-101',
        number: 'DS-2591',
        customerId: 'CUS-1001',
        salespersonId: 'SAL-01',
        orderDate: d(1),
        items: [
          OrderItem(
            product: 'PPGI Coil',
            quantity: 12,
            unit: 'MT',
            rate: 62000,
          ),
        ],
        dueDate: d(-6),
        status: OrderStatus.dispatched,
        paymentTerms: '30 days credit',
      ),
      SalesOrder(
        id: 'ORD-102',
        number: 'DS-2596',
        customerId: 'CUS-1002',
        salespersonId: 'SAL-02',
        orderDate: d(3),
        items: [
          OrderItem(
            product: 'Galvanized C Purlin',
            quantity: 8,
            unit: 'MT',
            rate: 58500,
          ),
        ],
        dueDate: d(-1),
        status: OrderStatus.dispatched,
      ),
      SalesOrder(
        id: 'ORD-103',
        number: 'DS-2601',
        customerId: 'CUS-1001',
        salespersonId: 'SAL-01',
        orderDate: d(6),
        items: [
          OrderItem(
            product: 'PPGI Coil',
            quantity: 4.5,
            unit: 'MT',
            rate: 62500,
          ),
          OrderItem(
            product: 'Colour Coated Sheet',
            quantity: 2.5,
            unit: 'MT',
            rate: 71000,
          ),
        ],
        expectedDispatchDate: d(14),
        dueDate: d(36),
        status: OrderStatus.pendingDispatch,
      ),
      SalesOrder(
        id: 'ORD-104',
        number: 'DS-2602',
        customerId: 'CUS-1002',
        salespersonId: 'SAL-02',
        orderDate: d(7),
        items: [
          OrderItem(product: 'Z Purlin', quantity: 6, unit: 'MT', rate: 59000),
        ],
        dueDate: d(37),
        status: OrderStatus.pending,
      ),
      SalesOrder(
        id: 'ORD-105',
        number: 'DS-2603',
        customerId: 'CUS-1003',
        salespersonId: 'SAL-03',
        orderDate: d(8),
        items: [
          OrderItem(
            product: 'UPVC Roofing Sheet',
            quantity: 3.2,
            unit: 'MT',
            rate: 94000,
          ),
        ],
        expectedDispatchDate: d(15),
        dueDate: d(38),
        status: OrderStatus.pendingDispatch,
      ),
      SalesOrder(
        id: 'ORD-106',
        number: 'DS-2604',
        customerId: 'CUS-1004',
        salespersonId: 'SAL-01',
        orderDate: d(8),
        items: [
          OrderItem(product: 'PPGL Coil', quantity: 5, unit: 'MT', rate: 64000),
        ],
        dueDate: d(38),
        status: OrderStatus.confirmed,
      ),
      SalesOrder(
        id: 'ORD-107',
        number: 'DS-2605',
        customerId: 'CUS-1005',
        salespersonId: 'SAL-04',
        orderDate: d(9),
        items: [
          OrderItem(
            product: 'Colour Coated Sheet',
            quantity: 3,
            unit: 'MT',
            rate: 72000,
          ),
        ],
        dueDate: d(39),
        status: OrderStatus.pending,
      ),
      SalesOrder(
        id: 'ORD-108',
        number: 'DS-2606',
        customerId: 'CUS-1006',
        salespersonId: 'SAL-01',
        orderDate: d(9),
        items: [
          OrderItem(
            product: 'Hot Rolled Coil',
            quantity: 9,
            unit: 'MT',
            rate: 56000,
          ),
        ],
        dueDate: d(39),
        status: OrderStatus.confirmed,
      ),
      SalesOrder(
        id: 'ORD-109',
        number: 'DS-2588',
        customerId: 'CUS-1007',
        salespersonId: 'SAL-03',
        orderDate: d(2, monthOffset: -1),
        items: [
          OrderItem(product: 'PPGI Coil', quantity: 6, unit: 'MT', rate: 61500),
        ],
        dueDate: d(28, monthOffset: -1),
        status: OrderStatus.dispatched,
      ),
      SalesOrder(
        id: 'ORD-110',
        number: 'DS-2584',
        customerId: 'CUS-1003',
        salespersonId: 'SAL-03',
        orderDate: d(10, monthOffset: -1),
        items: [
          OrderItem(
            product: 'UPVC Roofing Sheet',
            quantity: 2.4,
            unit: 'MT',
            rate: 93000,
          ),
        ],
        dueDate: d(6, monthOffset: -1),
        status: OrderStatus.dispatched,
      ),
    ]);

    dispatches.addAll([
      Dispatch(
        id: 'DSP-101',
        orderId: 'ORD-101',
        orderNumber: 'DS-2591',
        customerId: 'CUS-1001',
        dispatchDate: d(3),
        lines: [DispatchLine(product: 'PPGI Coil', quantity: 12, unit: 'MT')],
        vehicle: 'PB10 A 4422',
        driver: 'Manjit Singh',
        transportName: 'Gill Logistics',
        notes: 'Full consignment loaded',
      ),
      Dispatch(
        id: 'DSP-102',
        orderId: 'ORD-102',
        orderNumber: 'DS-2596',
        customerId: 'CUS-1002',
        dispatchDate: d(5),
        lines: [
          DispatchLine(product: 'Galvanized C Purlin', quantity: 8, unit: 'MT'),
        ],
        vehicle: 'PB14 C 9071',
        driver: 'Harjinder Singh',
        transportName: 'Sandhu Carriers',
      ),
      Dispatch(
        id: 'DSP-103',
        orderId: 'ORD-109',
        orderNumber: 'DS-2588',
        customerId: 'CUS-1007',
        dispatchDate: d(4, monthOffset: -1),
        lines: [DispatchLine(product: 'PPGI Coil', quantity: 6, unit: 'MT')],
        vehicle: 'PB08 G 1123',
        driver: 'Lakhwinder Singh',
        transportName: 'Nakoda Transport',
      ),
      Dispatch(
        id: 'DSP-104',
        orderId: 'ORD-110',
        orderNumber: 'DS-2584',
        customerId: 'CUS-1003',
        dispatchDate: d(12, monthOffset: -1),
        lines: [
          DispatchLine(
            product: 'UPVC Roofing Sheet',
            quantity: 2.4,
            unit: 'MT',
          ),
        ],
        vehicle: 'PB02 H 5566',
        driver: 'Gurdev Singh',
        transportName: 'Nakoda Transport',
      ),
    ]);

    payments.addAll([
      Payment(
        id: 'PAY-101',
        customerId: 'CUS-1001',
        orderId: 'ORD-101',
        invoiceNumber: 'DS-2591',
        invoiceAmount: 744000,
        amount: 500000,
        date: d(2),
        method: PaymentMethod.neft,
        reference: 'HDFC458812',
        notes: 'Part payment',
      ),
      Payment(
        id: 'PAY-102',
        customerId: 'CUS-1002',
        orderId: 'ORD-102',
        invoiceNumber: 'DS-2596',
        invoiceAmount: 468000,
        amount: 250000,
        date: d(5),
        method: PaymentMethod.upi,
        reference: 'UPI-9921',
      ),
      Payment(
        id: 'PAY-103',
        customerId: 'CUS-1003',
        orderId: 'ORD-110',
        invoiceNumber: 'DS-2584',
        invoiceAmount: 223200,
        amount: 100000,
        date: d(8),
        method: PaymentMethod.cheque,
        reference: 'CHQ-778211',
      ),
      Payment(
        id: 'PAY-104',
        customerId: 'CUS-1004',
        orderId: 'ORD-106',
        invoiceNumber: 'DS-2604',
        invoiceAmount: 320000,
        amount: 100000,
        date: d(9),
        method: PaymentMethod.cash,
        notes: 'Advance against order',
      ),
      Payment(
        id: 'PAY-105',
        customerId: 'CUS-1006',
        orderId: 'ORD-108',
        invoiceNumber: 'DS-2606',
        invoiceAmount: 504000,
        amount: 150000,
        date: d(12, monthOffset: -1),
        method: PaymentMethod.neft,
        reference: 'ICICI77120',
      ),
      Payment(
        id: 'PAY-106',
        customerId: 'CUS-1007',
        orderId: 'ORD-109',
        invoiceNumber: 'DS-2588',
        invoiceAmount: 369000,
        amount: 369000,
        date: d(18, monthOffset: -1),
        method: PaymentMethod.neft,
        reference: 'AXIS55210',
      ),
    ]);

    areas.addAll([
      AreaInfo(
        id: 'AREA-101',
        name: 'Bathinda Belt',
        city: 'Bathinda',
        district: 'Bathinda',
        state: 'Punjab',
        potentialCustomers: 14,
        notes: 'Two fabricator clusters near Kachi Arzi. No active dealer yet.',
      ),
      AreaInfo(
        id: 'AREA-102',
        name: 'Moga Corridor',
        city: 'Moga',
        district: 'Moga',
        state: 'Punjab',
        potentialCustomers: 9,
        notes: 'Roofing contractors demand UPVC sheets.',
      ),
      AreaInfo(
        id: 'AREA-103',
        name: 'Firozpur South',
        city: 'Firozpur',
        district: 'Firozpur',
        state: 'Punjab',
        salespersonId: 'SAL-03',
        potentialCustomers: 7,
        status: AreaStatus.partial,
        notes: 'One dealer active, coverage pending.',
      ),
      AreaInfo(
        id: 'AREA-104',
        name: 'Sangrur Town',
        city: 'Sangrur',
        district: 'Sangrur',
        state: 'Haryana',
        potentialCustomers: 11,
        notes: 'Neighbouring market, weekend trips.',
      ),
      AreaInfo(
        id: 'AREA-105',
        name: 'Patiala Rural',
        city: 'Patiala',
        district: 'Patiala',
        state: 'Punjab',
        salespersonId: 'SAL-04',
        potentialCustomers: 6,
        status: AreaStatus.assigned,
      ),
      AreaInfo(
        id: 'AREA-106',
        name: 'Hoshiarpur Hills',
        city: 'Hoshiarpur',
        district: 'Hoshiarpur',
        state: 'Punjab',
        potentialCustomers: 8,
        notes: 'Seasonal demand, good for tour plans.',
      ),
    ]);

    tours.addAll([
      TourPlan(
        id: 'TOUR-101',
        salespersonId: 'SAL-01',
        date: d(10),
        area: 'Ludhiana City',
        notes: 'Monthly review visits',
        visits: [
          TourVisit(
            id: 'VST-1011',
            customerId: 'CUS-1001',
            customerName: 'Gupta Steel Traders',
            city: 'Ludhiana',
            purpose: 'Payment follow-up',
            sequence: 1,
            status: VisitStatus.completed,
            actualTime: d(10),
            notes: 'Promise for balance by Friday.',
          ),
          TourVisit(
            id: 'VST-1012',
            customerId: 'CUS-1006',
            customerName: 'Chawla Engineering Co',
            city: 'Ludhiana',
            purpose: 'New order discussion',
            sequence: 2,
          ),
          TourVisit(
            id: 'VST-1013',
            customerId: 'CUS-1004',
            customerName: 'Khanna Sheet Metal',
            city: 'Khanna',
            purpose: 'Stock check',
            sequence: 3,
          ),
        ],
      ),
      TourPlan(
        id: 'TOUR-102',
        salespersonId: 'SAL-02',
        date: d(11),
        area: 'Jalandhar + Khanna',
        visits: [
          TourVisit(
            id: 'VST-1021',
            customerId: 'CUS-1002',
            customerName: 'Bansal Iron & Pipes',
            city: 'Jalandhar',
            purpose: 'Balance collection',
            sequence: 1,
          ),
          TourVisit(
            id: 'VST-1022',
            customerId: 'CUS-1008',
            customerName: 'Brar Traders',
            city: 'Bathinda',
            purpose: 'Onboarding',
            sequence: 2,
            status: VisitStatus.missed,
            notes: 'Shut for maintenance.',
          ),
        ],
      ),
      TourPlan(
        id: 'TOUR-103',
        salespersonId: 'SAL-03',
        date: d(13),
        area: 'Amritsar + Tarn Taran',
        visits: [
          TourVisit(
            id: 'VST-1031',
            customerId: 'CUS-1003',
            customerName: 'Sharma Roofing Works',
            city: 'Amritsar',
            purpose: 'Order handover',
            sequence: 1,
          ),
          TourVisit(
            id: 'VST-1032',
            customerId: 'CUS-1007',
            customerName: 'Nakra Fabricators',
            city: 'Amritsar',
            purpose: 'Payment follow-up',
            sequence: 2,
          ),
        ],
      ),
      TourPlan(
        id: 'TOUR-104',
        salespersonId: 'SAL-04',
        date: d(4, monthOffset: -1),
        area: 'Patiala Rural',
        visits: [
          TourVisit(
            id: 'VST-1041',
            customerId: 'CUS-1005',
            customerName: 'Patiala Buildmart',
            city: 'Patiala',
            purpose: 'First meeting',
            sequence: 1,
            status: VisitStatus.missed,
          ),
        ],
      ),
    ]);

    tasks.addAll([
      WorkTask(
        id: 'TSK-101',
        title: 'Collect balance from Gupta Steel Traders',
        description: 'Follow up on ₹2.44L part-payment promise.',
        assignedEmployeeId: 'SAL-01',
        dueAt: DateTime(now.year, now.month, now.day, 11, 30),
        priority: TaskPriority.high,
        requiresPhoto: false,
      ),
      WorkTask(
        id: 'TSK-102',
        title: 'Upload dispatch photos for DS-2601',
        description: 'Capture loaded goods before release.',
        assignedEmployeeId: 'OPS-01',
        dueAt: DateTime(now.year, now.month, now.day, 14, 0),
        priority: TaskPriority.normal,
        requiresPhoto: true,
      ),
      WorkTask(
        id: 'TSK-103',
        title: 'Send weekly target report',
        assignedEmployeeId: 'SAL-01',
        dueAt: d(9, monthOffset: 0),
        priority: TaskPriority.normal,
        status: TaskStatus.completed,
        completedAt: d(9),
      ),
      WorkTask(
        id: 'TSK-104',
        title: 'Visit Brar Traders for onboarding papers',
        assignedEmployeeId: 'SAL-02',
        dueAt: d(7),
        description: 'Pending approval — verify GST and shop photo.',
        requiresPhoto: true,
      ),
      WorkTask(
        id: 'TSK-105',
        title: 'Prepare samples for Sharma Roofing Works',
        assignedEmployeeId: 'SAL-03',
        dueAt: d(12),
        priority: TaskPriority.low,
      ),
      WorkTask(
        id: 'TSK-106',
        title: 'Check stock of UPVC sheets',
        assignedEmployeeId: 'OPS-02',
        dueAt: d(8),
        status: TaskStatus.completed,
        completedAt: d(8),
        completionNotes: 'Stock verified against sheet.',
      ),
    ]);

    debtors.addAll([
      DebtorItem(
        id: 'DEBTOR-001',
        name: 'KALRA TRADERS/ STEEL DERABASSI',
        state: 'Haryana',
        city: 'Dera Bassi',
        district: 'Mohali',
        salesperson: 'Mozi Ram',
        balance: 0.0,
      ),
      DebtorItem(
        id: 'DEBTOR-002',
        name: 'DOORKRM SIRSA ENTERPRISES SIRSA',
        state: 'Haryana',
        city: 'Sirsa',
        district: 'SIRSA',
        salesperson: 'AJAY JI',
        balance: 0.0,
      ),
      DebtorItem(
        id: 'DEBTOR-003',
        name: 'BANSAL POLES JHAJJAR',
        state: 'Haryana',
        city: 'Jhajjar',
        district: 'JHAJJAR',
        salesperson: 'PANKAJ JI',
        balance: 0.0,
      ),
      DebtorItem(
        id: 'DEBTOR-004',
        name: 'GURU KIRPA INDUSTRY BARNALA',
        state: 'Punjab',
        city: 'Barnala',
        district: 'Barnala',
        salesperson: 'Pankaj Goyal',
        balance: 0.0,
      ),
      DebtorItem(
        id: 'DEBTOR-005',
        name: 'BHAGWATI INDUSTRIES TARB TARAN',
        state: 'Punjab',
        city: 'Tarn Taran',
        district: 'Tarn Taran',
        salesperson: 'Jagdeep Singh',
        balance: 0.0,
      ),
      DebtorItem(
        id: 'DEBTOR-006',
        name: 'SAGGU STEEL FEROZPUR',
        state: 'Punjab',
        city: 'FEROZPUR',
        district: 'FEROZPUR',
        salesperson: 'Pankaj Goyal',
        balance: 0.0,
      ),
      DebtorItem(
        id: 'DEBTOR-007',
        name: 'J P INDUSTRIAL JAGRAON',
        state: 'Punjab',
        city: 'Jagraon',
        district: 'Ludhiana',
        salesperson: 'Sandeep Mahajan',
        balance: 0.0,
      ),
      DebtorItem(
        id: 'DEBTOR-008',
        name: 'SANDEEP RAMPURA',
        state: 'Punjab',
        city: 'Rampura',
        district: 'Bathinda',
        salesperson: 'Suresh Jindal',
        balance: 0.0,
      ),
      DebtorItem(
        id: 'DEBTOR-009',
        name: 'SHIV IRON STORE PHAGWARA',
        state: 'Punjab',
        city: 'Phagwara',
        district: 'Kapurthala',
        salesperson: 'Sandeep Mahajan',
        balance: 0.0,
      ),
      DebtorItem(
        id: 'DEBTOR-010',
        name: 'CHINTPURNI TRADING CO. HOSHIARPUR',
        state: 'Punjab',
        city: 'Hoshiarpur',
        district: 'Hoshiarpur',
        salesperson: 'JAGDEEP 2/ Aakash Kumar',
        balance: 0.0,
      ),
    ]);

    salesTargets.addAll([
      SalesTargetItem(
        id: 'TGT-HR-001',
        state: 'Haryana',
        partyName: 'KALRA TRADERS/ STEEL DERABASSI',
        station: 'Dera Bassi',
        district: 'Mohali',
        salesperson: 'Mozi Ram',
        targetMt: '50.000',
        dispatchedMt: '28.395',
        pendingMt: '21.605',
      ),
      SalesTargetItem(
        id: 'TGT-HR-002',
        state: 'Haryana',
        partyName: 'DOORKRM SIRSA ENTERPRISES SIRSA',
        station: 'Sirsa',
        district: 'SIRSA',
        salesperson: 'AJAY JI',
        targetMt: '60.000',
        dispatchedMt: '32.140',
        pendingMt: '27.860',
      ),
      SalesTargetItem(
        id: 'TGT-HR-003',
        state: 'Haryana',
        partyName: 'BANSAL POLES JHAJJAR',
        station: 'Jhajjar',
        district: 'JHAJJAR',
        salesperson: 'PANKAJ JI',
        targetMt: '45.000',
        dispatchedMt: '18.250',
        pendingMt: '26.750',
      ),
      SalesTargetItem(
        id: 'TGT-PB-001',
        state: 'Punjab',
        partyName: 'GURU KIRPA INDUSTRY BARNALA',
        station: 'Barnala',
        district: 'Barnala',
        salesperson: 'Pankaj Goyal',
        targetMt: '30.000',
        dispatchedMt: '25.000',
        pendingMt: '5.000',
      ),
      SalesTargetItem(
        id: 'TGT-PB-002',
        state: 'Punjab',
        partyName: 'BHAGWATI INDUSTRIES TARB TARAN',
        station: 'Tarn Taran',
        district: 'Tarn Taran',
        salesperson: 'Jagdeep Singh',
        targetMt: '30.000',
        dispatchedMt: '13.715',
        pendingMt: '16.285',
      ),
      SalesTargetItem(
        id: 'TGT-PB-003',
        state: 'Punjab',
        partyName: 'SAGGU STEEL FEROZPUR',
        station: 'FEROZPUR',
        district: 'FEROZPUR',
        salesperson: 'Pankaj Goyal',
        targetMt: '15.000',
        dispatchedMt: '10.345',
        pendingMt: '4.655',
      ),
      SalesTargetItem(
        id: 'TGT-PB-004',
        state: 'Punjab',
        partyName: 'J P INDUSTRIAL JAGRAON',
        station: 'Jagraon',
        district: 'Ludhiana',
        salesperson: 'Sandeep Mahajan',
        targetMt: '25.000',
        dispatchedMt: '16.315',
        pendingMt: '8.685',
      ),
      SalesTargetItem(
        id: 'TGT-PB-005',
        state: 'Punjab',
        partyName: 'SANDEEP RAMPURA',
        station: 'Rampura',
        district: 'Bathinda',
        salesperson: 'Suresh Jindal',
        targetMt: '10.000',
        dispatchedMt: '7.884',
        pendingMt: '2.116',
      ),
      SalesTargetItem(
        id: 'TGT-PB-006',
        state: 'Punjab',
        partyName: 'SHIV IRON STORE PHAGWARA',
        station: 'Phagwara',
        district: 'Kapurthala',
        salesperson: 'Sandeep Mahajan',
        targetMt: '15.000',
        dispatchedMt: '14.151',
        pendingMt: '0.849',
      ),
      SalesTargetItem(
        id: 'TGT-PB-007',
        state: 'Punjab',
        partyName: 'CHINTPURNI TRADING CO. HOSHIARPUR',
        station: 'Hoshiarpur',
        district: 'Hoshiarpur',
        salesperson: 'JAGDEEP 2/ Aakash Kumar',
        targetMt: '20.000',
        dispatchedMt: '17.230',
        pendingMt: '2.770',
      ),
    ]);

    notifications.addAll([
      AppNotification(
        id: 'NTF-9001',
        title: 'Overdue alert',
        body: 'DS-2591 (Gupta Steel Traders) balance is past due date.',
        time: d(9),
      ),
      AppNotification(
        id: 'NTF-9002',
        title: 'Pending approval',
        body: 'Brar Traders customer record is waiting for approval.',
        time: d(9),
      ),
      AppNotification(
        id: 'NTF-9003',
        title: 'Dispatch reminder',
        body: 'DS-2603 expected dispatch date is near.',
        time: d(10),
      ),
    ]);
  }
}

String rupeesPlain(num amount) {
  final rounded = amount.round();
  final raw = rounded.toString();
  if (raw.length <= 3) return '₹$raw';
  final lastThree = raw.substring(raw.length - 3);
  var prefix = raw.substring(0, raw.length - 3);
  final chunks = <String>[];
  while (prefix.length > 2) {
    chunks.insert(0, prefix.substring(prefix.length - 2));
    prefix = prefix.substring(0, prefix.length - 2);
  }
  if (prefix.isNotEmpty) chunks.insert(0, prefix);
  return '₹${chunks.join(',')},$lastThree';
}

double _positive(double v) => v > 0 ? v : 0;

class SalesMetrics {
  const SalesMetrics({
    required this.targetQty,
    required this.achievedQty,
    required this.pendingTargetQty,
    required this.ordersReceived,
    required this.ordersPendingCount,
    required this.pendingDispatchQty,
    required this.paymentReceived,
    required this.paymentBalance,
    required this.overdueBalance,
    required this.achievementPercent,
    required this.month,
    required this.asOf,
  });
  final double targetQty;
  final double achievedQty;
  final double pendingTargetQty;
  final int ordersReceived;
  final int ordersPendingCount;
  final double pendingDispatchQty;
  final double paymentReceived;
  final double paymentBalance;
  final double overdueBalance;
  final double achievementPercent;
  final DateTime month;
  final DateTime asOf;
}
