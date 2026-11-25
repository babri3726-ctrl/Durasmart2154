import 'dart:typed_data';

double parseDoubleSafe(dynamic val, [double fallback = 0.0]) {
  if (val == null) return fallback;
  if (val is num) return val.toDouble();
  final s = val.toString().replaceAll(',', '').trim();
  return double.tryParse(s) ?? fallback;
}

int parseIntSafe(dynamic val, [int fallback = 0]) {
  if (val == null) return fallback;
  if (val is num) return val.toInt();
  final s = val.toString().replaceAll(',', '').trim();
  return int.tryParse(s) ?? fallback;
}

/// Demo photo kept in memory for the session (path + bytes so previews work
/// even after the picker screen closes).
class DemoPhoto {
  DemoPhoto(this.id, this.name, this.bytes);
  final String id;
  final String name;
  final Uint8List bytes;
}

enum UserRole { owner, employee }

class AppUser {
  AppUser({
    required this.id,
    required this.name,
    required this.email,
    required this.role,
    required this.department,
    this.employeeId,
    this.phone = '',
  });
  final String id;
  final String name;
  final String email;
  final UserRole role;
  final String department;
  final String? employeeId;
  final String phone;

  bool get isOwner => role == UserRole.owner;
  bool get isDispatch =>
      department.toLowerCase() == 'dispatch' ||
      email.toLowerCase().contains('dispatch');
  bool get isSalesperson =>
      !isOwner && !isDispatch && department.toLowerCase() == 'sales';
  factory AppUser.fromJson(Map<String, dynamic> json) {
    final roleStr = (json['role'] as String? ?? 'employee').toLowerCase();
    final role = roleStr == 'owner' ? UserRole.owner : UserRole.employee;
    return AppUser(
      id: json['id'] as String? ?? 'usr-unknown',
      name: json['name'] as String? ?? 'Staff Member',
      email: json['email'] as String? ?? '',
      role: role,
      department: json['department'] as String? ?? 'Sales',
      employeeId: json['employeeId'] as String?,
      phone: json['phone'] as String? ?? '',
    );
  }

  String get initials {
    final parts = name.trim().split(RegExp(r'\s+'));
    return parts
        .map((p) => p.isNotEmpty ? p[0].toUpperCase() : '')
        .take(2)
        .join();
  }
}

class Employee {
  Employee({
    required this.id,
    required this.name,
    required this.role,
    required this.department,
    required this.phone,
    this.email = '',
    this.city = '',
    this.monthlyTargetQty = 0,
    this.active = true,
  });
  final String id;
  final String name;
  final String role;
  final String department;
  final String phone;
  final String email;
  final String city;
  double monthlyTargetQty;
  bool active;

  factory Employee.fromJson(Map<String, dynamic> json) {
    return Employee(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      role: json['role']?.toString() ?? 'Area Sales Officer',
      department: json['department']?.toString() ?? 'Sales',
      phone: json['phone']?.toString() ?? '',
      email: json['email']?.toString() ?? '',
      city: json['city']?.toString() ?? '',
      monthlyTargetQty: parseDoubleSafe(json['monthlyTargetQty']),
      active: json['active'] == null || json['active'] == true,
    );
  }
}

enum CustomerStatus { active, pendingApproval }

class Customer {
  Customer({
    required this.id,
    required this.name,
    required this.city,
    required this.mobile,
    required this.salespersonId,
    this.contactPerson = '',
    this.address = '',
    this.type = 'Dealer',
    this.notes = '',
    this.status = CustomerStatus.active,
    this.lastPaymentDate,
  });
  final String id;
  final String name;
  final String city;
  final String mobile;
  final String salespersonId;
  final String contactPerson;
  final String address;
  final String type;
  final String notes;
  CustomerStatus status;
  DateTime? lastPaymentDate;

  factory Customer.fromJson(Map<String, dynamic> json) {
    final rawSpId = json['salespersonId']?.toString() ?? json['salesperson_id']?.toString();
    final rawSpName = json['salesperson']?.toString();
    final spId = (rawSpId != null && rawSpId.isNotEmpty)
        ? rawSpId
        : ((rawSpName != null && rawSpName.isNotEmpty && rawSpName.toLowerCase() != 'unassigned')
            ? rawSpName
            : '');
    return Customer(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? 'Dealer',
      city: json['city']?.toString() ?? (json['district']?.toString() ?? 'Punjab'),
      mobile: json['mobile']?.toString() ?? json['phone']?.toString() ?? '919800000000',
      salespersonId: spId,
      contactPerson: json['contactPerson']?.toString() ?? json['name']?.toString() ?? '',
      address: json['address']?.toString() ?? json['state']?.toString() ?? '',
      type: json['type']?.toString() ?? 'Dealer',
      notes: json['notes']?.toString() ?? '',
      status: (json['status']?.toString().toLowerCase() == 'pending' ||
              json['status']?.toString().toLowerCase() == 'pendingapproval')
          ? CustomerStatus.pendingApproval
          : CustomerStatus.active,
      lastPaymentDate: json['lastPaymentDate'] != null
          ? DateTime.tryParse(json['lastPaymentDate'].toString())
          : null,
    );
  }
}

class OrderItem {
  OrderItem({
    required this.product,
    required this.quantity,
    required this.unit,
    required this.rate,
  });
  final String product;
  final double quantity;
  final String unit;
  final double rate;
  double get lineTotal => quantity * rate;
  String get quantityLabel =>
      '${quantity % 1 == 0 ? quantity.toInt() : quantity} $unit';

  factory OrderItem.fromJson(Map<String, dynamic> json) {
    final q = double.tryParse(json['orderedQuantity']?.toString() ??
            json['quantity']?.toString() ??
            '0') ??
        0.0;
    final rPaise = json['ratePaise'] is num
        ? (json['ratePaise'] as num).toDouble()
        : double.tryParse(json['ratePaise']?.toString() ?? '0') ?? 0.0;
    final rate = rPaise > 0
        ? rPaise / 100.0
        : (double.tryParse(json['rate']?.toString() ?? '0') ?? 0.0);
    return OrderItem(
      product: json['productName']?.toString() ??
          json['product']?.toString() ??
          'Steel Material',
      quantity: q,
      unit: json['unit']?.toString() ?? 'MT',
      rate: rate,
    );
  }
}

enum OrderStatus { pending, confirmed, pendingDispatch, dispatched }

String orderStatusLabel(OrderStatus s) => switch (s) {
  OrderStatus.pending => 'Order Pending',
  OrderStatus.confirmed => 'Confirmed',
  OrderStatus.pendingDispatch => 'Pending for Dispatch',
  OrderStatus.dispatched => 'Dispatched',
};

class SalesOrder {
  SalesOrder({
    required this.id,
    required this.number,
    required this.customerId,
    required this.salespersonId,
    required this.orderDate,
    required this.items,
    required this.dueDate,
    this.paymentTerms = '30 days credit',
    this.expectedDispatchDate,
    this.notes = '',
    this.status = OrderStatus.pending,
    this.orderPhotos = const [],
  });
  final String id;
  final String number;
  final String customerId;
  final String salespersonId;
  final DateTime orderDate;
  final List<OrderItem> items;
  final DateTime dueDate;
  final String paymentTerms;
  final DateTime? expectedDispatchDate;
  final String notes;
  OrderStatus status;
  List<DemoPhoto> orderPhotos;

  double get total => items.fold(0, (sum, i) => sum + i.lineTotal);
  double get totalQty => items.fold(0, (sum, i) => sum + i.quantity);
  String get unit => items.isNotEmpty ? items.first.unit : 'MT';

  /// Fully dispatched only when every item quantity has been dispatched.
  bool get fullyDispatched => status == OrderStatus.dispatched;

  factory SalesOrder.fromJson(Map<String, dynamic> json) {
    final rawLines = json['lines'] as List<dynamic>? ?? [];
    final items = rawLines
        .map((l) => OrderItem.fromJson(l as Map<String, dynamic>))
        .toList();
    final stStr = (json['status']?.toString() ?? 'pending').toLowerCase();
    final dStatus = (json['dispatchStatus']?.toString() ?? '').toLowerCase();
    final status = dStatus == 'dispatched'
        ? OrderStatus.dispatched
        : (dStatus == 'pending' && stStr == 'confirmed')
            ? OrderStatus.pendingDispatch
            : stStr == 'confirmed'
                ? OrderStatus.confirmed
                : OrderStatus.pending;

    return SalesOrder(
      id: json['id']?.toString() ?? '',
      number: json['number']?.toString() ?? json['id']?.toString() ?? 'DS-0000',
      customerId: json['customerId']?.toString() ?? '',
      salespersonId: json['salespersonId']?.toString() ?? 'EMP-SP-01',
      orderDate: DateTime.tryParse(json['orderDate']?.toString() ?? '') ??
          DateTime.now(),
      dueDate: DateTime.tryParse(json['dueDate']?.toString() ?? '') ??
          DateTime.now().add(const Duration(days: 15)),
      expectedDispatchDate: json['expectedDispatchDate'] != null
          ? DateTime.tryParse(json['expectedDispatchDate'].toString())
          : null,
      paymentTerms: json['paymentTerms']?.toString() ?? '30 days credit',
      notes: json['notes']?.toString() ?? '',
      status: status,
      items: items,
    );
  }
}

class DispatchLine {
  DispatchLine({
    required this.product,
    required this.quantity,
    required this.unit,
  });
  final String product;
  final double quantity;
  final String unit;

  factory DispatchLine.fromJson(Map<String, dynamic> json) {
    return DispatchLine(
      product: json['product']?.toString() ?? '',
      quantity: parseDoubleSafe(json['quantity']),
      unit: json['unit']?.toString() ?? 'MT',
    );
  }
}

class Dispatch {
  Dispatch({
    required this.id,
    required this.orderId,
    required this.orderNumber,
    required this.customerId,
    required this.dispatchDate,
    required this.lines,
    this.vehicle = '',
    this.driver = '',
    this.transportName = '',
    this.notes = '',
    this.photos = const [],
  });
  final String id;
  final String orderId;
  final String orderNumber;
  final String customerId;
  final DateTime dispatchDate;
  final List<DispatchLine> lines;
  final String vehicle;
  final String driver;
  final String transportName;
  final String notes;
  List<DemoPhoto> photos;

  double get totalQuantity => lines.fold(0, (sum, l) => sum + l.quantity);

  factory Dispatch.fromJson(Map<String, dynamic> json) {
    final rawLines = json['lines'] as List<dynamic>? ?? [];
    return Dispatch(
      id: json['id']?.toString() ?? '',
      orderId: json['orderId']?.toString() ?? '',
      orderNumber: json['orderNumber']?.toString() ?? '',
      customerId: json['customerId']?.toString() ?? '',
      dispatchDate: json['dispatchDate'] != null
          ? DateTime.tryParse(json['dispatchDate'].toString()) ?? DateTime.now()
          : (json['date'] != null ? DateTime.tryParse(json['date'].toString()) ?? DateTime.now() : DateTime.now()),
      lines: rawLines.map((l) => DispatchLine.fromJson(l as Map<String, dynamic>)).toList(),
      vehicle: json['vehicle']?.toString() ?? '',
      driver: json['driver']?.toString() ?? '',
      transportName: json['transportName']?.toString() ?? '',
      notes: json['notes']?.toString() ?? '',
    );
  }
}

enum PaymentMethod { cash, upi, neft, cheque, other }

String paymentMethodLabel(PaymentMethod m) => switch (m) {
  PaymentMethod.cash => 'Cash',
  PaymentMethod.upi => 'UPI',
  PaymentMethod.neft => 'NEFT / RTGS',
  PaymentMethod.cheque => 'Cheque',
  PaymentMethod.other => 'Other',
};

class Payment {
  Payment({
    required this.id,
    required this.customerId,
    required this.orderId,
    required this.invoiceNumber,
    required this.invoiceAmount,
    required this.amount,
    required this.date,
    required this.method,
    this.reference = '',
    this.notes = '',
  });
  final String id;
  final String customerId;
  final String orderId;
  final String invoiceNumber;
  final double invoiceAmount;
  final double amount;
  final DateTime date;
  final PaymentMethod method;
  final String reference;
  final String notes;

  factory Payment.fromJson(Map<String, dynamic> json) {
    final methStr = (json['method']?.toString() ?? 'neft').toLowerCase();
    final meth = methStr == 'cheque'
        ? PaymentMethod.cheque
        : methStr == 'cash'
            ? PaymentMethod.cash
            : methStr == 'upi'
                ? PaymentMethod.upi
                : PaymentMethod.neft;
    final amt = parseDoubleSafe(
      json['amount'],
      parseDoubleSafe(json['amountPaise']) / 100.0,
    );
    return Payment(
      id: json['id']?.toString() ?? '',
      customerId: json['customerId']?.toString() ?? '',
      orderId: json['orderId']?.toString() ?? '',
      invoiceNumber: json['invoiceNumber']?.toString() ?? '',
      invoiceAmount: parseDoubleSafe(json['invoiceAmount'], amt),
      amount: amt,
      date: json['paymentDate'] != null
          ? DateTime.tryParse(json['paymentDate'].toString()) ?? DateTime.now()
          : (json['date'] != null ? DateTime.tryParse(json['date'].toString()) ?? DateTime.now() : DateTime.now()),
      method: meth,
      reference: json['reference']?.toString() ?? '',
      notes: json['notes']?.toString() ?? '',
    );
  }
}

enum TaskPriority { low, normal, high }

String taskPriorityLabel(TaskPriority p) => switch (p) {
  TaskPriority.low => 'Low',
  TaskPriority.normal => 'Normal',
  TaskPriority.high => 'High',
};

enum TaskStatus { open, acknowledged, completed }

class WorkTask {
  WorkTask({
    required this.id,
    required this.title,
    required this.assignedEmployeeId,
    required this.dueAt,
    this.description = '',
    this.createdBy = 'Owner',
    this.createdAt,
    this.priority = TaskPriority.normal,
    this.requiresPhoto = false,
    this.status = TaskStatus.open,
    this.completedAt,
    this.completionNotes = '',
    this.completionPhoto,
    this.alarmTriggered = false,
  });
  final String id;
  final String title;
  final String description;
  final String assignedEmployeeId;
  final DateTime dueAt;
  final String createdBy;
  final DateTime? createdAt;
  final TaskPriority priority;
  final bool requiresPhoto;
  TaskStatus status;
  DateTime? completedAt;
  String completionNotes;
  DemoPhoto? completionPhoto;
  bool alarmTriggered;

  factory WorkTask.fromJson(Map<String, dynamic> json) {
    final pStr = (json['priority'] as String? ?? 'normal').toLowerCase();
    final p = switch (pStr) {
      'high' => TaskPriority.high,
      'low' => TaskPriority.low,
      _ => TaskPriority.normal,
    };
    final sStr = (json['status'] as String? ?? 'open').toLowerCase();
    final s = switch (sStr) {
      'completed' => TaskStatus.completed,
      'acknowledged' => TaskStatus.acknowledged,
      _ => TaskStatus.open,
    };
    final dueAtStr = json['dueAt'] as String? ?? json['due_at'] as String? ?? '';
    final dueAt = DateTime.tryParse(dueAtStr) ?? DateTime.now();
    final createdAtStr = json['createdAt'] as String? ?? json['created_at'] as String?;
    final createdAt = createdAtStr != null ? DateTime.tryParse(createdAtStr) : null;
    final completedAtStr = json['completedAt'] as String? ?? json['completed_at'] as String?;
    final completedAt = completedAtStr != null ? DateTime.tryParse(completedAtStr) : null;

    return WorkTask(
      id: json['id'] as String? ?? '',
      title: json['title'] as String? ?? 'Untitled Task',
      description: json['description'] as String? ?? '',
      assignedEmployeeId: json['assignedEmployeeId'] as String? ?? json['assigned_employee_id'] as String? ?? '',
      dueAt: dueAt,
      createdBy: json['createdBy'] as String? ?? json['created_by'] as String? ?? 'Owner',
      createdAt: createdAt,
      priority: p,
      requiresPhoto: json['requiresPhoto'] == true || json['requires_photo'] == 1 || json['requires_photo'] == true,
      status: s,
      completedAt: completedAt,
      completionNotes: json['completionNotes'] as String? ?? json['completion_notes'] as String? ?? '',
      alarmTriggered: json['alarmTriggered'] == true || json['alarm_triggered'] == 1,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'title': title,
      'description': description,
      'assignedEmployeeId': assignedEmployeeId,
      'dueAt': dueAt.toIso8601String(),
      'createdBy': createdBy,
      'createdAt': createdAt?.toIso8601String(),
      'priority': switch (priority) {
        TaskPriority.high => 'high',
        TaskPriority.low => 'low',
        _ => 'normal',
      },
      'requiresPhoto': requiresPhoto,
      'status': switch (status) {
        TaskStatus.completed => 'completed',
        TaskStatus.acknowledged => 'acknowledged',
        _ => 'open',
      },
      'completedAt': completedAt?.toIso8601String(),
      'completionNotes': completionNotes,
      'alarmTriggered': alarmTriggered,
    };
  }

  bool get overdue =>
      status != TaskStatus.completed && dueAt.isBefore(DateTime.now());
  bool get missingProof =>
      status == TaskStatus.completed &&
      requiresPhoto &&
      completionPhoto == null;
}

enum VisitStatus { planned, completed, missed }

String visitStatusLabel(VisitStatus s) => switch (s) {
  VisitStatus.planned => 'Planned',
  VisitStatus.completed => 'Completed',
  VisitStatus.missed => 'Missed',
};

class TourVisit {
  TourVisit({
    required this.id,
    required this.customerId,
    required this.customerName,
    required this.city,
    required this.purpose,
    required this.sequence,
    this.status = VisitStatus.planned,
    this.notes = '',
    this.actualTime,
    this.gpsLat,
    this.gpsLng,
    this.gpsVerified = false,
    this.photo,
  });
  final String id;
  final String customerId;
  final String customerName;
  final String city;
  final String purpose;
  int sequence;
  VisitStatus status;
  String notes;
  DateTime? actualTime;
  double? gpsLat;
  double? gpsLng;
  bool gpsVerified;
  DemoPhoto? photo;

  factory TourVisit.fromJson(Map<String, dynamic> json) {
    final stStr = (json['status']?.toString() ?? 'planned').toLowerCase();
    final st = stStr == 'completed'
        ? VisitStatus.completed
        : stStr == 'missed'
            ? VisitStatus.missed
            : VisitStatus.planned;
    return TourVisit(
      id: json['id']?.toString() ?? '',
      customerId: json['customerId']?.toString() ?? '',
      customerName: json['customerName']?.toString() ?? '',
      city: json['city']?.toString() ?? '',
      purpose: json['purpose']?.toString() ?? '',
      sequence: parseIntSafe(json['sequence'], 1),
      status: st,
      notes: json['notes']?.toString() ?? '',
    );
  }
}

class TourPlan {
  TourPlan({
    required this.id,
    required this.salespersonId,
    required this.date,
    required this.area,
    this.visits = const [],
    this.notes = '',
  });
  final String id;
  final String salespersonId;
  final DateTime date;
  final String area;
  final List<TourVisit> visits;
  final String notes;

  factory TourPlan.fromJson(Map<String, dynamic> json) {
    final rawVisits = json['visits'] as List<dynamic>? ?? [];
    return TourPlan(
      id: json['id']?.toString() ?? '',
      salespersonId: json['salespersonId']?.toString() ?? '',
      date: json['date'] != null
          ? DateTime.tryParse(json['date'].toString()) ?? DateTime.now()
          : DateTime.now(),
      area: json['area']?.toString() ?? '',
      visits: rawVisits
          .map((v) => TourVisit.fromJson(v as Map<String, dynamic>))
          .toList(),
      notes: json['notes']?.toString() ?? '',
    );
  }
}

enum AreaStatus { vacant, assigned, partial }

String areaStatusLabel(AreaStatus s) => switch (s) {
  AreaStatus.vacant => 'Vacant',
  AreaStatus.assigned => 'Assigned',
  AreaStatus.partial => 'Partly Covered',
};

class AreaInfo {
  AreaInfo({
    required this.id,
    required this.name,
    required this.city,
    required this.district,
    required this.state,
    this.salespersonId,
    this.potentialCustomers = 0,
    this.status = AreaStatus.vacant,
    this.notes = '',
  });
  final String id;
  String name;
  String city;
  String district;
  String state;
  String? salespersonId;
  int potentialCustomers;
  AreaStatus status;
  String notes;

  factory AreaInfo.fromJson(Map<String, dynamic> json) {
    final statusStr = (json['status'] ?? 'vacant').toString().toLowerCase();
    final status = switch (statusStr) {
      'assigned' => AreaStatus.assigned,
      'partial' => AreaStatus.partial,
      _ => AreaStatus.vacant,
    };
    final district = (json['district'] ?? '').toString();
    final cities = json['cities'];
    final city = (cities is List && cities.isNotEmpty)
        ? cities.first.toString()
        : district;
    return AreaInfo(
      id: json['id']?.toString() ?? 'AREA-$district',
      name: json['name']?.toString() ?? district,
      city: json['city']?.toString() ?? city,
      district: district,
      state: (json['state'] ?? 'Punjab').toString(),
      salespersonId: json['salespersonId']?.toString(),
      potentialCustomers: parseIntSafe(json['totalShops'], 0),
      status: status,
      notes: json['notes']?.toString() ?? '',
    );
  }
}

class AppNotification {
  AppNotification({
    required this.id,
    required this.title,
    required this.body,
    required this.time,
    this.read = false,
  });
  final String id;
  final String title;
  final String body;
  final DateTime time;
  bool read;
}

class DebtorItem {
  DebtorItem({
    required this.id,
    required this.name,
    this.state = 'Punjab',
    this.city = '',
    this.district = '',
    this.salesperson = 'Unassigned',
    this.balance = 0.0,
    this.openingBalance = 0.0,
    this.status = 'active',
    this.tallyStatus = 'unbenchmarked',
    this.tallyClosing,
    this.tallyDiff,
    this.hasAuthoritativeLedger = false,
  });

  final String id;
  String name;
  String state;
  String city;
  String district;
  String salesperson;
  double balance;
  double openingBalance;
  String status;
  String tallyStatus;
  double? tallyClosing;
  double? tallyDiff;
  bool hasAuthoritativeLedger;

  bool get isVerified => tallyStatus == 'verified';
  bool get isMismatch => tallyStatus == 'mismatch';
  bool get isUnbenchmarked => tallyStatus == 'unbenchmarked';

  String get balanceFormatted {
    if (balance == 0) return '₹0.00';
    final suffix = balance > 0 ? ' Dr.' : ' Cr.';
    return '₹${balance.abs().toStringAsFixed(2)}$suffix';
  }

  String get tallyClosingFormatted {
    if (tallyClosing == null) return '';
    final suffix = tallyClosing! > 0 ? ' Dr.' : tallyClosing! < 0 ? ' Cr.' : '';
    return '₹${tallyClosing!.abs().toStringAsFixed(2)}$suffix';
  }

  String get tallyDiffFormatted {
    if (tallyDiff == null) return '';
    final sign = tallyDiff! > 0 ? '+' : '';
    final suffix = tallyDiff! > 0 ? ' Dr.' : tallyDiff! < 0 ? ' Cr.' : '';
    return '$sign₹${tallyDiff!.abs().toStringAsFixed(2)}$suffix';
  }

  factory DebtorItem.fromJson(Map<String, dynamic> json) {
    double parsedBal = parseDoubleSafe(json['balance']);
    if (parsedBal == 0.0) {
      if (json['outstandingPaise'] != null) {
        parsedBal = parseDoubleSafe(json['outstandingPaise']) / 100.0;
      } else if (json['debitPaise'] != null) {
        parsedBal = parseDoubleSafe(json['debitPaise']) / 100.0;
      } else if (json['balance_paise'] != null) {
        parsedBal = parseDoubleSafe(json['balance_paise']) / 100.0;
      }
    }

    double parsedOpenBal = parseDoubleSafe(json['openingBalance']);
    if (parsedOpenBal == 0.0 && json['openingPaise'] != null) {
      parsedOpenBal = parseDoubleSafe(json['openingPaise']) / 100.0;
    }

    final tallyStatus = json['tallyStatus']?.toString() ?? 'unbenchmarked';
    final tallyClosing = json['tallyClosing'] != null
        ? parseDoubleSafe(json['tallyClosing'])
        : (json['tallyClosingPaise'] != null
            ? parseDoubleSafe(json['tallyClosingPaise']) / 100.0
            : null);
    final tallyDiff = json['tallyDiff'] != null
        ? parseDoubleSafe(json['tallyDiff'])
        : (json['tallyDiffPaise'] != null
            ? parseDoubleSafe(json['tallyDiffPaise']) / 100.0
            : null);
    final hasAuthLedger = json['hasAuthoritativeLedger'] == true;

    return DebtorItem(
      id: json['id']?.toString() ?? json['customerId']?.toString() ?? '',
      name: json['name']?.toString() ?? json['customerName']?.toString() ?? '',
      state: json['state']?.toString() ?? 'Punjab',
      city: json['city']?.toString() ?? '',
      district: json['district']?.toString() ?? '',
      salesperson: json['salesperson']?.toString() ?? 'Unassigned',
      balance: parsedBal,
      openingBalance: parsedOpenBal,
      status: json['status']?.toString() ?? 'active',
      tallyStatus: tallyStatus,
      tallyClosing: tallyClosing,
      tallyDiff: tallyDiff,
      hasAuthoritativeLedger: hasAuthLedger,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'state': state,
    'city': city,
    'district': district,
    'salesperson': salesperson,
    'balance': balance,
    'openingBalance': openingBalance,
    'status': status,
    'tallyStatus': tallyStatus,
    'tallyClosing': tallyClosing,
    'tallyDiff': tallyDiff,
    'hasAuthoritativeLedger': hasAuthoritativeLedger,
  };
}

class VoucherItem {
  VoucherItem({
    required this.id,
    required this.voucherNo,
    required this.voucherType,
    required this.voucherDate,
    required this.debitPaise,
    required this.creditPaise,
    this.partyName = '',
    this.narration = '',
    this.bookSource = '',
  });

  final String id;
  final String voucherNo;
  final String voucherType;
  final String voucherDate;
  final int debitPaise;
  final int creditPaise;
  final String partyName;
  final String narration;
  final String bookSource;

  String get voucherNumber => voucherNo;
  double get debit => debitPaise / 100.0;
  double get credit => creditPaise / 100.0;
  bool get isSales =>
      voucherType.toLowerCase() == 'sales' ||
      voucherType.toLowerCase().contains('debit note');
  bool get isReceipt => voucherType.toLowerCase() == 'receipt';
  bool get isCreditNote => voucherType.toLowerCase().contains('credit note');
  bool get isJournal => voucherType.toLowerCase() == 'journal';

  factory VoucherItem.fromJson(Map<String, dynamic> json) {
    return VoucherItem(
      id: json['id']?.toString() ?? '',
      voucherNo: json['voucher_no']?.toString() ??
          json['voucherNo']?.toString() ??
          '',
      voucherType: json['voucher_type']?.toString() ??
          json['voucherType']?.toString() ??
          'Sales',
      voucherDate: json['voucher_date']?.toString() ??
          json['voucherDate']?.toString() ??
          '',
      debitPaise: (json['debit_paise'] as num?)?.toInt() ??
          (json['debitPaise'] as num?)?.toInt() ??
          0,
      creditPaise: (json['credit_paise'] as num?)?.toInt() ??
          (json['creditPaise'] as num?)?.toInt() ??
          0,
      partyName: json['party_name']?.toString() ??
          json['partyName']?.toString() ??
          '',
      narration: json['narration']?.toString() ?? '',
      bookSource: json['book_source']?.toString() ??
          json['bookSource']?.toString() ??
          '',
    );
  }
}

class SalesTargetItem {
  SalesTargetItem({
    required this.id,
    required this.state,
    required this.partyName,
    this.station = '',
    this.district = '',
    this.salesperson = 'Unassigned',
    this.targetMt = '0.000',
    this.dispatchedMt = '0.000',
    this.pendingMt = '0.000',
  });

  final String id;
  final String state;
  final String partyName;
  final String station;
  final String district;
  final String salesperson;
  final String targetMt;
  final String dispatchedMt;
  final String pendingMt;

  factory SalesTargetItem.fromJson(Map<String, dynamic> json) {
    return SalesTargetItem(
      id: json['id']?.toString() ?? '',
      state: json['state']?.toString() ?? '',
      partyName:
          json['party_name']?.toString() ?? json['partyName']?.toString() ?? '',
      station: json['station']?.toString() ?? '',
      district: json['district']?.toString() ?? '',
      salesperson: json['salesperson']?.toString() ?? 'Unassigned',
      targetMt: json['target_mt']?.toString() ?? '0.000',
      dispatchedMt: json['dispatched_mt']?.toString() ?? '0.000',
      pendingMt: json['pending_mt']?.toString() ?? '0.000',
    );
  }
}

class SalespersonSummary {
  SalespersonSummary({
    required this.salesperson,
    required this.territory,
    required this.partiesCount,
    required this.totalTargetMt,
    required this.totalDispatchedMt,
    required this.totalPendingMt,
    required this.achievementPercent,
  });

  final String salesperson;
  final String territory;
  final int partiesCount;
  final double totalTargetMt;
  final double totalDispatchedMt;
  final double totalPendingMt;
  final double achievementPercent;

  factory SalespersonSummary.fromJson(Map<String, dynamic> json) {
    return SalespersonSummary(
      salesperson: json['salesperson']?.toString() ?? 'Unassigned',
      territory: json['territory']?.toString() ?? 'Punjab/Haryana',
      partiesCount: json['parties_count'] is num
          ? (json['parties_count'] as num).toInt()
          : int.tryParse(json['parties_count']?.toString() ?? '0') ?? 0,
      totalTargetMt: json['total_target_mt'] is num
          ? (json['total_target_mt'] as num).toDouble()
          : double.tryParse(json['total_target_mt']?.toString() ?? '0') ?? 0.0,
      totalDispatchedMt: json['total_dispatched_mt'] is num
          ? (json['total_dispatched_mt'] as num).toDouble()
          : double.tryParse(json['total_dispatched_mt']?.toString() ?? '0') ?? 0.0,
      totalPendingMt: json['total_pending_mt'] is num
          ? (json['total_pending_mt'] as num).toDouble()
          : double.tryParse(json['total_pending_mt']?.toString() ?? '0') ?? 0.0,
      achievementPercent: json['achievement_percent'] is num
          ? (json['achievement_percent'] as num).toDouble()
          : double.tryParse(json['achievement_percent']?.toString() ?? '0') ?? 0.0,
    );
  }

  Map<String, dynamic> toJson() => {
    'salesperson': salesperson,
    'territory': territory,
    'parties_count': partiesCount,
    'total_target_mt': totalTargetMt.toStringAsFixed(3),
    'total_dispatched_mt': totalDispatchedMt.toStringAsFixed(3),
    'total_pending_mt': totalPendingMt.toStringAsFixed(3),
    'achievement_percent': achievementPercent.toStringAsFixed(1),
  };
}

class AppUpdateInfo {
  AppUpdateInfo({
    required this.versionCode,
    required this.versionName,
    required this.downloadUrl,
    required this.releaseNotes,
    this.mandatory = false,
  });

  final int versionCode;
  final String versionName;
  final String downloadUrl;
  final String releaseNotes;
  final bool mandatory;

  factory AppUpdateInfo.fromJson(Map<String, dynamic> json) {
    return AppUpdateInfo(
      versionCode: json['version_code'] is num
          ? (json['version_code'] as num).toInt()
          : int.tryParse(json['version_code']?.toString() ?? '1') ?? 1,
      versionName: json['version_name']?.toString() ?? '1.0.0',
      downloadUrl: json['download_url']?.toString() ?? '/api/v1/app/latest-apk',
      releaseNotes: json['release_notes']?.toString() ?? 'General improvements and fixes.',
      mandatory: json['mandatory'] == true,
    );
  }
}
