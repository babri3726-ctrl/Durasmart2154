import 'dart:typed_data';

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
    this.status = 'active',
  });

  final String id;
  String name;
  String state;
  String city;
  String district;
  String salesperson;
  double balance;
  String status;

  String get balanceFormatted => '₹';

  factory DebtorItem.fromJson(Map<String, dynamic> json) {
    return DebtorItem(
      id: json['id']?.toString() ?? json['customerId']?.toString() ?? '',
      name: json['name']?.toString() ?? json['customerName']?.toString() ?? '',
      state: json['state']?.toString() ?? 'Punjab',
      city: json['city']?.toString() ?? '',
      district: json['district']?.toString() ?? '',
      salesperson: json['salesperson']?.toString() ?? 'Unassigned',
      balance: (json['balance'] is num)
          ? (json['balance'] as num).toDouble()
          : (double.tryParse(json['balance']?.toString() ?? '0') ?? 0.0),
      status: json['status']?.toString() ?? 'active',
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
    'status': status,
  };
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
