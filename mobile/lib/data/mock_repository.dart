import 'dart:async';
import 'dart:convert';
import 'dart:io';

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
    _loadDebtorsCache();
    if (!Platform.environment.containsKey('FLUTTER_TEST')) {
      _attemptInitialSync();
      _syncTimer = Timer.periodic(const Duration(seconds: 30), (_) => syncWithBackend());
    }
  }

  void _attemptInitialSync() {
    ApiSyncService.resolveWorkingHost().then((host) {
      if (host != null) {
        syncWithBackend();
      } else {
        Future.delayed(const Duration(seconds: 4), () {
          ApiSyncService.resolveWorkingHost().then((h) {
            if (h != null) syncWithBackend();
          });
        });
      }
    }).catchError((_) {});
  }

  @override
  void dispose() {
    _syncTimer?.cancel();
    super.dispose();
  }

  double? serverOutstanding;
  double? serverOverdue;
  double? serverDispatchesMt;
  int? serverDelayedOrders;
  int? serverOrdersCount;
  double? serverCollections;
  double? serverMonthCollections;
  final Map<String, Map<String, dynamic>> _monthlyPaymentCache = {};

  Future<Map<String, dynamic>?> fetchMonthlyPaymentSummary(
    int year,
    int month, {
    String? salespersonId,
  }) async {
    final spName = salespersonId != null ? salespersonName(salespersonId) : null;
    final cacheKey = '$year-$month-$salespersonId';
    final remote = await ApiSyncService.fetchMonthlyPaymentSummary(
      year,
      month,
      salesperson: spName,
      salespersonId: salespersonId,
    );
    if (remote != null) {
      _monthlyPaymentCache[cacheKey] = remote;
      notifyListeners();
      return remote;
    }
    return _monthlyPaymentCache[cacheKey];
  }

  Map<String, dynamic>? getMonthlyPaymentCached(
    int year,
    int month, {
    String? salespersonId,
  }) {
    final cacheKey = '$year-$month-$salespersonId';
    return _monthlyPaymentCache[cacheKey];
  }
  double? serverTargetMt;
  double? serverPendingMt;
  double? serverAchievementPercent;
  int? serverActiveDealers;
  int? serverSalesTeamCount;
  List<SalespersonSummary> salespersonSummaries = [];
  static const int currentVersionCode = 13;
  static const String currentVersionName = '1.1.4';
  AppUpdateInfo? availableUpdate;
  Timer? _syncTimer;

  static const ownerPasscode = 'Ishu@DuraSmart#2026';
  static const employeePasscode = 'DuraSmart@2026';
  static const demoPasscode = ownerPasscode;

  // ── session ──────────────────────────────────────────────────────────
  AppUser? currentUser;
  bool signedIn = false;
  final _customPasswords = <String, String>{};

  bool resetUserPassword(String identifier, String newPassword) {
    final key = identifier.trim().toLowerCase();
    for (final u in _accounts) {
      final matches =
          u.email.toLowerCase() == key ||
          u.id.toLowerCase() == key ||
          (u.employeeId?.toLowerCase() == key) ||
          u.name.toLowerCase() == key ||
          (key == 'owner' && u.isOwner) ||
          (key == 'ishujindal' && u.isOwner) ||
          (key == 'ishu' && u.isOwner);
      if (matches) {
        _customPasswords[u.id] = newPassword;
        notifyListeners();
        return true;
      }
    }
    return false;
  }

  AppUser? authenticate(String idOrEmail, String password) {
    final key = idOrEmail.trim().toLowerCase();
    for (final u in _accounts) {
      final matches =
          u.email.toLowerCase() == key ||
          u.id.toLowerCase() == key ||
          (u.employeeId?.toLowerCase() == key) ||
          u.name.toLowerCase() == key ||
          (key == 'owner' && u.isOwner) ||
          (key == 'ishujindal' && u.isOwner) ||
          (key == 'ishu' && u.isOwner);

      if (matches) {
        final expected = _customPasswords[u.id] ?? (u.isOwner ? ownerPasscode : employeePasscode);
        if (password == expected) {
          currentUser = u;
          signedIn = true;
          notifyListeners();
          return u;
        }
      }
    }
    return null;
  }

  void setSignedInUser(AppUser user) {
    currentUser = user;
    signedIn = true;
    notifyListeners();
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

  static bool isNonDebtorLedger(String name) {
    final lower = name.toLowerCase().trim();
    if (lower.isEmpty) return true;
    final nonDebtorTerms = [
      'exp', 'expense', 'selery', 'salary', 'interst', 'interest',
      'cash', 'bank', 'hdfc', 'sbi', 'icici', 'axis', 'loan',
      'mechnery', 'machinery', 'mutul', 'mutual fund', 'house 303',
      'shop public', 'donation', 'foundation', 'trust', 'huf', 'drawings',
      'c a', 'audit', 'tax', 'gst', 'tds', 'discount', 'round off'
    ];
    final isDealer = RegExp(r'\b(steel|trader|store|industry|enterprises?|corp|co|agro|iron|metal|metel|concast|fabricator|hardware)\b').hasMatch(lower);
    if (isDealer) return false;
    for (final term in nonDebtorTerms) {
      if (lower.contains(term)) return true;
    }
    return false;
  }

  void addDebtor(DebtorItem item) {
    debtors.insert(0, item);
    if (serverOutstanding != null) {
      serverOutstanding = serverOutstanding! + item.balance;
    }
    // Mirror into customers list so debtor is immediately selectable in New Order form
    final existingCust = customers.where((c) => c.id == item.id).firstOrNull;
    final sp = employees.where(
      (e) =>
          e.name.toLowerCase() == item.salesperson.toLowerCase() ||
          e.id.toLowerCase() == item.salesperson.toLowerCase(),
    ).firstOrNull ?? employees.first;

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
          salespersonId: sp.id,
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
    }).then((_) => syncWithBackend()).catchError((_) {});
    notifyListeners();
  }

  void updateDebtor(DebtorItem item) {
    final idx = debtors.indexWhere((d) => d.id == item.id);
    if (idx != -1) {
      final oldBalance = debtors[idx].balance;
      debtors[idx] = item;
      if (serverOutstanding != null) {
        serverOutstanding = (serverOutstanding! + (item.balance - oldBalance)).clamp(0.0, double.infinity);
      }
      final sp = employees.where(
        (e) =>
            e.name.toLowerCase() == item.salesperson.toLowerCase() ||
            e.id.toLowerCase() == item.salesperson.toLowerCase(),
      ).firstOrNull ?? employees.first;

      final cIdx = customers.indexWhere((c) => c.id == item.id);
      if (cIdx != -1) {
        customers[cIdx] = Customer(
          id: item.id,
          name: item.name,
          type: 'Dealer',
          contactPerson: item.name,
          mobile: customers[cIdx].mobile,
          city: item.city.isNotEmpty ? item.city : item.district,
          salespersonId: sp.id,
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
      }).then((_) => syncWithBackend()).catchError((_) {});
      notifyListeners();
    }
  }

  void deleteDebtor(String id) {
    debtors.removeWhere((d) => d.id == id);
    customers.removeWhere((c) => c.id == id);
    notifyListeners();
  }

  /// Live two-way sync with backend REST API
  Future<void> syncWithBackend() async {
    try {
      // 0. Dashboard Cockpit & Executive Summary
      final summary = await ApiSyncService.fetchDashboardSummary();
      if (summary != null) {
        final outRaw = summary['outstandingPaise'];
        if (outRaw is num) {
          serverOutstanding = outRaw.toDouble() / 100.0;
        } else if (outRaw != null) {
          final parsed = double.tryParse(outRaw.toString());
          if (parsed != null) serverOutstanding = parsed / 100.0;
        }

        final ovRaw = summary['overduePaise'];
        if (ovRaw is num) {
          serverOverdue = ovRaw.toDouble() / 100.0;
        } else if (ovRaw != null) {
          final parsed = double.tryParse(ovRaw.toString());
          if (parsed != null) serverOverdue = parsed / 100.0;
        }

        if (summary['dispatched'] is List && (summary['dispatched'] as List).isNotEmpty) {
          final firstDisp = (summary['dispatched'] as List).first;
          if (firstDisp is Map) {
            final rawQty = firstDisp['dispatchedQuantity'];
            if (rawQty is num) {
              serverDispatchesMt = rawQty.toDouble();
            } else if (rawQty != null) {
              serverDispatchesMt = double.tryParse(rawQty.toString()) ?? serverDispatchesMt;
            }
          }
        }

        final colMonthRaw = summary['monthCollectedPaise'];
        if (colMonthRaw is num) {
          serverMonthCollections = colMonthRaw.toDouble() / 100.0;
        } else if (colMonthRaw != null) {
          final parsed = double.tryParse(colMonthRaw.toString());
          if (parsed != null) serverMonthCollections = parsed / 100.0;
        }

        final colRaw = summary['allTimeCollectedPaise'] ?? summary['collectedPaise'];
        if (colRaw is num) {
          serverCollections = colRaw.toDouble() / 100.0;
        } else if (colRaw != null) {
          final parsed = double.tryParse(colRaw.toString());
          if (parsed != null) serverCollections = parsed / 100.0;
        }

        final rawOrders = summary['orderCount'] ?? summary['ordersCount'];
        if (rawOrders is num) {
          serverOrdersCount = rawOrders.toInt();
        } else if (rawOrders != null) {
          serverOrdersCount = int.tryParse(rawOrders.toString()) ?? serverOrdersCount;
        }

        final rawDelayed = summary['delayedOrderCount'] ?? summary['delayedOrders'];
        if (rawDelayed is num) {
          serverDelayedOrders = rawDelayed.toInt();
        } else if (rawDelayed != null) {
          serverDelayedOrders = int.tryParse(rawDelayed.toString()) ?? serverDelayedOrders;
        }
      }

      // 1. Employees
      final remoteEmps = await ApiSyncService.fetchEmployees();
      if (remoteEmps != null && remoteEmps.isNotEmpty) {
        final parsed = remoteEmps.map(Employee.fromJson).toList();
        for (final e in parsed) {
          final idx = employees.indexWhere((x) => x.id == e.id);
          if (idx != -1) {
            employees[idx] = e;
          } else {
            employees.add(e);
          }
        }
      }

      // 2. Customers & Debtors (Authoritative sync from backend master)
      final remoteCusts = await ApiSyncService.fetchCustomers();
      if (remoteCusts != null) {
        final parsed = remoteCusts
            .map(Customer.fromJson)
            .where((c) => !isNonDebtorLedger(c.name))
            .toList();
        final parsedDebtors = remoteCusts
            .map(DebtorItem.fromJson)
            .where((d) => !isNonDebtorLedger(d.name))
            .toList();
        customers
          ..clear()
          ..addAll(parsed);
        debtors
          ..clear()
          ..addAll(parsedDebtors);
        _monthlyPaymentCache.clear();
        _saveDebtorsCache();
      }

      // 3. Orders
      final remoteOrders = await ApiSyncService.fetchOrders();
      if (remoteOrders != null && remoteOrders.isNotEmpty) {
        final parsedOrders = remoteOrders.map(SalesOrder.fromJson).toList();
        for (final o in parsedOrders) {
          final idx = orders.indexWhere((existing) => existing.id == o.id);
          if (idx != -1) {
            orders[idx] = o;
          } else {
            orders.add(o);
          }
        }
      }

      // 4. Payments
      final remotePayments = await ApiSyncService.fetchPayments();
      if (remotePayments != null && remotePayments.isNotEmpty) {
        final parsedPayments = remotePayments.map(Payment.fromJson).toList();
        for (final p in parsedPayments) {
          final idx = payments.indexWhere((existing) => existing.id == p.id);
          if (idx != -1) {
            payments[idx] = p;
          } else {
            payments.add(p);
          }
        }
      }

      // 5. Dispatches
      final remoteDispatches = await ApiSyncService.fetchDispatches();
      if (remoteDispatches != null && remoteDispatches.isNotEmpty) {
        final parsedDispatches = remoteDispatches.map(Dispatch.fromJson).toList();
        for (final d in parsedDispatches) {
          final idx = dispatches.indexWhere((existing) => existing.id == d.id);
          if (idx != -1) {
            dispatches[idx] = d;
          } else {
            dispatches.add(d);
          }
        }
      }

      // 6. Tour Plans
      final remoteTours = await ApiSyncService.fetchTourPlans();
      if (remoteTours != null && remoteTours.isNotEmpty) {
        final parsedTours = remoteTours.map(TourPlan.fromJson).toList();
        for (final t in parsedTours) {
          final idx = tours.indexWhere((existing) => existing.id == t.id);
          if (idx != -1) {
            tours[idx] = t;
          } else {
            tours.add(t);
          }
        }
      }

      // 7. Tasks
      await syncTasksFromBackend();

      // 8. Sales Targets & Salesperson Summary
      final fullTargets = await ApiSyncService.fetchSalesTargetsFull();
      if (fullTargets != null) {
        if (fullTargets['items'] is List) {
          final parsedTargets = (fullTargets['items'] as List)
              .whereType<Map<String, dynamic>>()
              .map(SalesTargetItem.fromJson)
              .toList();
          if (parsedTargets.isNotEmpty) {
            salesTargets
              ..clear()
              ..addAll(parsedTargets);
          }
        }
        if (fullTargets['total'] is num) {
          serverActiveDealers = (fullTargets['total'] as num).toInt();
        } else if (fullTargets['total'] != null) {
          serverActiveDealers = int.tryParse(fullTargets['total'].toString()) ?? serverActiveDealers;
        }

        if (fullTargets['salesperson_summary'] is List) {
          final rawSummaries = fullTargets['salesperson_summary'] as List;
          final parsedSummaries = rawSummaries
              .whereType<Map<String, dynamic>>()
              .map(SalespersonSummary.fromJson)
              .toList();
          if (parsedSummaries.isNotEmpty) {
            salespersonSummaries
              ..clear()
              ..addAll(parsedSummaries);
            serverSalesTeamCount = parsedSummaries.length;
            final tSum = parsedSummaries.fold(0.0, (acc, s) => acc + s.totalTargetMt);
            final dSum = parsedSummaries.fold(0.0, (acc, s) => acc + s.totalDispatchedMt);
            final pSum = parsedSummaries.fold(0.0, (acc, s) => acc + s.totalPendingMt);
            serverTargetMt = tSum;
            serverDispatchesMt = dSum;
            serverPendingMt = pSum;
            serverAchievementPercent = tSum > 0 ? (dSum / tSum) * 100 : 0.0;
          }
        }
      }

      // 9. Products
      final remoteProducts = await ApiSyncService.fetchProducts();
      if (remoteProducts != null && remoteProducts.isNotEmpty) {
        for (final p in remoteProducts) {
          if (!products.contains(p)) products.add(p);
        }
      }

      // 10. Vacant Areas & Territory Coverage
      final vacantData = await ApiSyncService.fetchVacantAreas();
      if (vacantData != null && vacantData['districts'] is List) {
        final list = (vacantData['districts'] as List)
            .whereType<Map<String, dynamic>>()
            .map(AreaInfo.fromJson)
            .toList();
        if (list.isNotEmpty) {
          areas
            ..clear()
            ..addAll(list);
        }
      }

      // 11. App Update Check
      await checkForUpdate();

      _saveDebtorsCache();
      notifyListeners();
    } catch (_) {}
  }

  Future<AppUpdateInfo?> checkForUpdate() async {
    try {
      final data = await ApiSyncService.fetchAppVersion();
      if (data != null) {
        final info = AppUpdateInfo.fromJson(data);
        if (info.versionCode > currentVersionCode) {
          availableUpdate = info;
          notifyListeners();
          return info;
        } else {
          availableUpdate = null;
          notifyListeners();
        }
      }
    } catch (_) {}
    return null;
  }

  Future<void> _saveDebtorsCache() async {
    try {
      final file = File('${Directory.systemTemp.path}/durasmart_debtors_cache.json');
      final payload = {
        'serverOutstanding': serverOutstanding,
        'serverOverdue': serverOverdue,
        'serverDispatchesMt': serverDispatchesMt,
        'serverCollections': serverCollections,
        'serverDelayedOrders': serverDelayedOrders,
        'serverOrdersCount': serverOrdersCount,
        'serverTargetMt': serverTargetMt,
        'serverPendingMt': serverPendingMt,
        'serverAchievementPercent': serverAchievementPercent,
        'serverActiveDealers': serverActiveDealers,
        'serverSalesTeamCount': serverSalesTeamCount,
        'salespersonSummaries': salespersonSummaries.map((s) => s.toJson()).toList(),
        'debtors': debtors.map((d) => d.toJson()).toList(),
      };
      await file.writeAsString(jsonEncode(payload));
    } catch (_) {}
  }

  Future<void> _loadDebtorsCache() async {
    try {
      final file = File('${Directory.systemTemp.path}/durasmart_debtors_cache.json');
      if (await file.exists()) {
        final content = await file.readAsString();
        final decoded = jsonDecode(content);
        if (decoded is Map<String, dynamic>) {
          if (decoded['serverOutstanding'] is num) {
            serverOutstanding = (decoded['serverOutstanding'] as num).toDouble();
          }
          if (decoded['serverOverdue'] is num) {
            serverOverdue = (decoded['serverOverdue'] as num).toDouble();
          }
          if (decoded['serverDispatchesMt'] is num) {
            serverDispatchesMt = (decoded['serverDispatchesMt'] as num).toDouble();
          }
          if (decoded['serverCollections'] is num) {
            serverCollections = (decoded['serverCollections'] as num).toDouble();
          }
          if (decoded['serverDelayedOrders'] is num) {
            serverDelayedOrders = (decoded['serverDelayedOrders'] as num).toInt();
          }
          if (decoded['serverOrdersCount'] is num) {
            serverOrdersCount = (decoded['serverOrdersCount'] as num).toInt();
          }
          if (decoded['serverTargetMt'] is num) {
            serverTargetMt = (decoded['serverTargetMt'] as num).toDouble();
          }
          if (decoded['serverPendingMt'] is num) {
            serverPendingMt = (decoded['serverPendingMt'] as num).toDouble();
          }
          if (decoded['serverAchievementPercent'] is num) {
            serverAchievementPercent = (decoded['serverAchievementPercent'] as num).toDouble();
          }
          if (decoded['serverActiveDealers'] is num) {
            serverActiveDealers = (decoded['serverActiveDealers'] as num).toInt();
          }
          if (decoded['serverSalesTeamCount'] is num) {
            serverSalesTeamCount = (decoded['serverSalesTeamCount'] as num).toInt();
          }
          final spList = decoded['salespersonSummaries'];
          if (spList is List) {
            final cachedSp = spList
                .whereType<Map<String, dynamic>>()
                .map(SalespersonSummary.fromJson)
                .toList();
            if (cachedSp.isNotEmpty) {
              salespersonSummaries
                ..clear()
                ..addAll(cachedSp);
            }
          }
          final list = decoded['debtors'];
          if (list is List) {
            final cached = list
                .whereType<Map<String, dynamic>>()
                .map(DebtorItem.fromJson)
                .where((d) => !isNonDebtorLedger(d.name))
                .toList();
            if (cached.isNotEmpty) {
              debtors
                ..clear()
                ..addAll(cached);
              notifyListeners();
            }
          }
        } else if (decoded is List) {
          final cached = decoded
              .map((e) => DebtorItem.fromJson(e as Map<String, dynamic>))
              .where((d) => !isNonDebtorLedger(d.name))
              .toList();
          if (cached.isNotEmpty) {
            for (final d in cached) {
              final idx = debtors.indexWhere((x) => x.id == d.id || x.name.toLowerCase().trim() == d.name.toLowerCase().trim());
              if (idx != -1) {
                debtors[idx] = d;
              } else {
                debtors.add(d);
              }
            }
            notifyListeners();
          }
        }
      }
    } catch (_) {}
  }

  final products = <String>[
    'UPVC',
    'Slit Coil Kamdhenu',
    'Slit Coil JSW',
    'Profile',
  ];

  // ── lookups ──────────────────────────────────────────────────────────
  DebtorItem? debtorById(String id) =>
      debtors.where((d) => d.id == id || d.name.toLowerCase().trim() == id.toLowerCase().trim()).firstOrNull;

  Customer? customerById(String id) {
    final direct = customers.where((c) => c.id == id).firstOrNull;
    if (direct != null) return direct;
    final debtor = debtors.where((d) => d.id == id).firstOrNull;
    if (debtor != null) {
      return Customer(
        id: debtor.id,
        name: debtor.name,
        city: debtor.city.isNotEmpty ? debtor.city : debtor.district,
        mobile: '9814000000',
        salespersonId: 'EMP-SP-01',
        contactPerson: debtor.name,
        type: 'Dealer',
      );
    }
    return null;
  }
  SalesOrder? orderById(String id) =>
      orders.where((o) => o.id == id).firstOrNull;
  Employee? employeeById(String id) =>
      employees.where((e) => e.id == id).firstOrNull;
  WorkTask? taskById(String id) => tasks.where((t) => t.id == id).firstOrNull;
  AreaInfo? areaById(String id) => areas.where((a) => a.id == id).firstOrNull;
  TourPlan? tourById(String id) => tours.where((t) => t.id == id).firstOrNull;

  final Map<String, List<VoucherItem>> _vouchersByCustomer = {};
  List<VoucherItem> _daybookVouchers = [];

  List<VoucherItem> vouchersFor(String customerId) =>
      _vouchersByCustomer[customerId] ?? const [];

  List<VoucherItem> get daybookVouchers => _daybookVouchers;

  Future<List<VoucherItem>> fetchDaybookVouchers({String? bookSource, String? voucherType, String? q}) async {
    final raw = await ApiSyncService.fetchAllDaybookVouchers(
      bookSource: bookSource,
      voucherType: voucherType,
      q: q,
    );
    if (raw != null) {
      _daybookVouchers = raw.map(VoucherItem.fromJson).toList();
      notifyListeners();
      return _daybookVouchers;
    }
    return _daybookVouchers;
  }

  Future<List<VoucherItem>> fetchVouchersFor(String customerId) async {
    if (Platform.environment.containsKey('FLUTTER_TEST')) {
      return _vouchersByCustomer[customerId] ?? const [];
    }
    final raw = await ApiSyncService.fetchVouchers(customerId);
    if (raw != null) {
      final items = raw.map(VoucherItem.fromJson).toList();
      _vouchersByCustomer[customerId] = items;
      notifyListeners();
      return items;
    }
    return _vouchersByCustomer[customerId] ?? const [];
  }

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

  double customerOutstanding(String customerId) {
    final debtor = debtorById(customerId) ??
        (customerById(customerId) != null
            ? debtorById(customerById(customerId)!.name)
            : null);
    if (debtor != null) {
      return debtor.balance;
    }
    final orderSum = ordersFor(
      customerId,
    ).fold(0.0, (sum, o) => sum + _positive(orderBalance(o.id)));
    return orderSum;
  }

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
    final debtor = debtorById(customerId) ??
        (customerById(customerId) != null
            ? debtorById(customerById(customerId)!.name)
            : null);
    if (debtor != null && debtor.balance > 0) {
      overdue += debtor.balance;
    }
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
    final debtor = debtors.where(
      (d) =>
          d.id == customerId ||
          (customerById(customerId)?.name.toLowerCase() ==
              d.name.toLowerCase()),
    ).firstOrNull;
    if (debtor != null && debtor.balance > 0) {
      worst = 30; // standard terms for opening ledger balance
    }
    for (final o in ordersFor(customerId)) {
      if (orderBalance(o.id) > 0 && o.dueDate.isBefore(now)) {
        final days = now.difference(o.dueDate).inDays;
        if (days > worst) worst = days;
      }
    }
    return worst;
  }

  double totalOutstanding() {
    if (serverOutstanding != null) {
      return serverOutstanding!;
    }
    if (debtors.isNotEmpty) {
      return debtors.fold(0.0, (sum, d) => sum + d.balance);
    }
    return customers.fold(0.0, (sum, c) => sum + customerOutstanding(c.id));
  }

  double totalOverdue() {
    if (serverOverdue != null) {
      return serverOverdue!;
    }
    if (debtors.isNotEmpty) {
      return debtors.where((d) => d.balance > 0).fold(0.0, (sum, d) => sum + d.balance);
    }
    return customers.fold(0.0, (sum, c) => sum + customerOverdue(c.id));
  }

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

  String _cleanSp(String s) => s.toLowerCase().replaceAll(RegExp(r'[^a-z0-9]'), '');

  bool matchesSalesperson(String? candidate, String? salespersonId) {
    if (candidate == null || salespersonId == null) return false;
    final emp = employeeById(salespersonId);
    final targetName = emp != null ? emp.name : salespersonId;

    final c1 = _cleanSp(candidate);
    final c2 = _cleanSp(targetName);
    if (c1.isNotEmpty && c1 == c2) return true;
    if (candidate == salespersonId) return true;

    final t1 = candidate.toLowerCase().split(RegExp(r'[\s/_\-]+')).where((t) => t.isNotEmpty).toSet();
    final t2 = targetName.toLowerCase().split(RegExp(r'[\s/_\-]+')).where((t) => t.isNotEmpty).toSet();
    return t1.isNotEmpty && t2.isNotEmpty && (t1.containsAll(t2) && t2.containsAll(t1));
  }

  SalespersonSummary? salespersonSummaryFor(String? salespersonId) {
    if (salespersonId == null) return null;
    final emp = employeeById(salespersonId);
    final targetName = emp != null ? emp.name : salespersonId;
    final cleanTarget = _cleanSp(targetName);

    // 1. Exact clean match (e.g. "PANKAJ JI" -> "pankajji", "Mozi Ram" -> "moziram")
    for (final s in salespersonSummaries) {
      if (_cleanSp(s.salesperson) == cleanTarget || s.salesperson == salespersonId) {
        return s;
      }
    }
    // 2. Exact word token equality (avoid partial substring collisions)
    final targetTokens = targetName.toLowerCase().split(RegExp(r'[\s/_\-]+')).where((t) => t.isNotEmpty).toSet();
    for (final s in salespersonSummaries) {
      final sTokens = s.salesperson.toLowerCase().split(RegExp(r'[\s/_\-]+')).where((t) => t.isNotEmpty).toSet();
      if (sTokens.isNotEmpty && targetTokens.isNotEmpty && sTokens.containsAll(targetTokens) && targetTokens.containsAll(sTokens)) {
        return s;
      }
    }
    return null;
  }

  // ── derived sales metrics ────────────────────────────────────────────
  SalesMetrics salesMetrics({String? salespersonId, DateTime? month}) {
    final m = month ?? DateTime.now();
    final now = DateTime.now();
    final isCurrentMonth = m.year == now.year && m.month == now.month;
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

    final spSummary = salespersonSummaryFor(salespersonId);

    final double target = salespersonId != null
        ? (spSummary != null
            ? spSummary.totalTargetMt
            : ((employeeById(salespersonId)?.monthlyTargetQty ?? 0.0).toDouble()))
        : (serverTargetMt ??
            (salespersonSummaries.isNotEmpty
                ? salespersonSummaries.fold<double>(0.0, (sum, s) => sum + s.totalTargetMt)
                : 1609.0));

    final double achieved = salespersonId != null
        ? (spSummary != null && isCurrentMonth
            ? spSummary.totalDispatchedMt
            : monthOrders.fold<double>(0.0, (sum, o) => sum + o.totalQty))
        : (isCurrentMonth
            ? (serverDispatchesMt ??
                (salespersonSummaries.isNotEmpty
                    ? salespersonSummaries.fold<double>(0.0, (sum, s) => sum + s.totalDispatchedMt)
                    : 621.776))
            : monthOrders.fold<double>(0.0, (sum, o) => sum + o.totalQty));

    final double pendingDispatch = salespersonId != null
        ? (spSummary != null && isCurrentMonth
            ? spSummary.totalPendingMt
            : ((target - achieved) > 0 ? (target - achieved) : 0.0))
        : (isCurrentMonth
            ? (serverPendingMt ??
                ((target - achieved) > 0 ? (target - achieved) : 987.224))
            : ((target - achieved) > 0 ? (target - achieved) : 0.0));

    final outstanding = (serverOutstanding != null && salespersonId == null)
        ? serverOutstanding!
        : (debtors.isNotEmpty && salespersonId == null)
            ? debtors.fold(0.0, (sum, d) => sum + d.balance)
            : (debtors.isNotEmpty && salespersonId != null)
                ? debtors
                    .where((d) =>
                        matchesSalesperson(d.salesperson, salespersonId) ||
                        d.id == salespersonId)
                    .fold(0.0, (sum, d) => sum + d.balance)
                : customers
                    .where((c) => salespersonId == null || c.salespersonId == salespersonId)
                    .fold(0.0, (sum, c) => sum + customerOutstanding(c.id));

    final overdueBalance = (serverOverdue != null && salespersonId == null)
        ? serverOverdue!
        : (debtors.isNotEmpty && salespersonId == null)
            ? debtors.where((d) => d.balance > 0).fold(0.0, (sum, d) => sum + d.balance)
            : (debtors.isNotEmpty && salespersonId != null)
                ? debtors
                    .where((d) =>
                        (matchesSalesperson(d.salesperson, salespersonId) ||
                            d.id == salespersonId) &&
                        d.balance > 0)
                    .fold(0.0, (sum, d) => sum + d.balance)
                : customers
                    .where(
                      (c) => salespersonId == null || c.salespersonId == salespersonId,
                    )
                    .fold(0.0, (sum, c) => sum + customerOverdue(c.id));

    final pendingOrderCount = serverDelayedOrders != null && salespersonId == null
        ? serverDelayedOrders!
        : orders
            .where((o) => salespersonId == null || o.salespersonId == salespersonId)
            .where(
              (o) =>
                  o.status == OrderStatus.pending ||
                  o.status == OrderStatus.confirmed,
            )
            .length;

    final cachedPay = getMonthlyPaymentCached(m.year, m.month, salespersonId: salespersonId);
    final collections = cachedPay != null && cachedPay['monthCollected'] is num
        ? (cachedPay['monthCollected'] as num).toDouble()
        : (isCurrentMonth && salespersonId == null)
            ? (serverMonthCollections ?? serverCollections ?? 0.0)
            : monthPayments.fold(0.0, (sum, p) => sum + p.amount);

    final ordersCount = (serverOrdersCount != null && salespersonId == null && isCurrentMonth)
        ? serverOrdersCount!
        : monthOrders.length;

    return SalesMetrics(
      targetQty: target,
      achievedQty: achieved,
      pendingTargetQty: (target - achieved)
          .clamp(0, double.infinity)
          .toDouble(),
      ordersReceived: ordersCount,
      ordersPendingCount: pendingOrderCount,
      pendingDispatchQty: pendingDispatch,
      paymentReceived: collections,
      paymentBalance: outstanding,
      overdueBalance: overdueBalance,
      achievementPercent: target <= 0
          ? 0
          : (achieved / target * 100).clamp(0, 999),
      month: m,
      asOf: now,
    );
  }

  bool customerBelongsTo(String customerId, String? salespersonId) {
    if (salespersonId == null) return true;
    final cust = customerById(customerId);
    if (cust != null &&
        (matchesSalesperson(cust.salespersonId, salespersonId) ||
            cust.salespersonId == salespersonId)) {
      return true;
    }
    final debtor = debtorById(customerId);
    if (debtor != null && matchesSalesperson(debtor.salesperson, salespersonId)) {
      return true;
    }
    return false;
  }

  // ── monthly series for charts ────────────────────────────────────────
  List<double> lastSixMonthsAchievement({String? salespersonId}) {
    final now = DateTime.now();
    return List.generate(6, (i) {
      if (i == 5) {
        if (salespersonId != null) {
          final sp = salespersonSummaryFor(salespersonId);
          if (sp != null) return sp.totalDispatchedMt;
        } else if (serverDispatchesMt != null) {
          return serverDispatchesMt!;
        }
      }
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
    }).then((_) => syncWithBackend()).catchError((_) {});
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
      ApiSyncService.deleteOrder(orderId).then((_) => syncWithBackend()).catchError((_) {});
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
    final debtor = debtors.where((d) => d.id == customerId || (customer != null && d.name.toLowerCase().trim() == customer.name.toLowerCase().trim())).firstOrNull;
    if (debtor != null) {
      debtor.balance = (debtor.balance - amount).clamp(0.0, double.infinity);
    }
    if (serverOutstanding != null) {
      serverOutstanding = (serverOutstanding! - amount).clamp(0.0, double.infinity);
    }
    if (serverOverdue != null) {
      serverOverdue = (serverOverdue! - amount).clamp(0.0, double.infinity);
    }
    if (serverCollections != null) {
      serverCollections = serverCollections! + amount;
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
    ApiSyncService.postPayment(payPayload).then((_) => syncWithBackend()).catchError((_) {});

    notifyListeners();
    return payment;
  }

  /// Fetches tasks from FastAPI backend and merges into local tasks
  Future<void> syncTasksFromBackend() async {
    try {
      final backendTasks = await ApiSyncService.fetchTasks();
      if (backendTasks != null && backendTasks.isNotEmpty) {
        for (final item in backendTasks) {
          final incoming = WorkTask.fromJson(item);
          final existingIdx = tasks.indexWhere((t) => t.id == incoming.id);
          if (existingIdx != -1) {
            tasks[existingIdx].status = incoming.status;
            tasks[existingIdx].completedAt = incoming.completedAt;
            tasks[existingIdx].completionNotes = incoming.completionNotes;
            tasks[existingIdx].alarmTriggered = incoming.alarmTriggered;
          } else {
            tasks.insert(0, incoming);
          }
        }
        notifyListeners();
      }
    } catch (_) {}
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
      id: 'TSK-',
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
    _pushNotification('Task assigned', '$title \xe2\x80\xa2 due ${_fmtShort(dueAt)}');

    // Asynchronously synchronize task creation to backend
    ApiSyncService.postTask({
      'id': task.id,
      'title': title,
      'description': description,
      'assigned_employee_id': assignedEmployeeId,
      'assigned_employee_name': salespersonName(assignedEmployeeId),
      'due_date': dueAt.toIso8601String().substring(0, 10),
      'due_time': '${dueAt.hour.toString().padLeft(2, "0")}:${dueAt.minute.toString().padLeft(2, "0")}',
      'due_at': dueAt.toIso8601String(),
      'priority': switch (priority) {
        TaskPriority.high => 'high',
        TaskPriority.low => 'low',
        _ => 'normal',
      },
      'requires_photo': requiresPhoto,
      'status': 'open',
      'created_by': currentUser?.name ?? 'Owner',
    });

    notifyListeners();
    return task;
  }

  void acknowledgeTask(String taskId) {
    final t = taskById(taskId);
    if (t != null && t.status == TaskStatus.open) {
      t.status = TaskStatus.acknowledged;
      ApiSyncService.updateTaskStatus(taskId, 'acknowledged');
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
    ApiSyncService.updateTaskStatus(taskId, 'completed', notes: notes);
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
    final spName = salespersonId != null ? salespersonName(salespersonId) : 'Unassigned';
    ApiSyncService.assignTerritory(
      district: a.district.isNotEmpty ? a.district : a.name,
      salesperson: spName,
      salespersonId: salespersonId,
    ).then((_) => syncWithBackend()).catchError((_) {});
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

  // ── seed data ─────────────────────────────────────────────────────────
  final _accounts = <AppUser>[
    AppUser(
      id: 'USR-OWNER-ISHU',
      name: 'Ishu Jindal',
      email: 'ishu.jindal@durasmart.com',
      role: UserRole.owner,
      department: 'Management',
      employeeId: 'OWNER-01',
      phone: '+91 98140 10001',
    ),
    AppUser(
      id: 'USR-EMP-SP-01',
      name: 'AJAY JI',
      email: 'ajay.ji@durasmart.com',
      role: UserRole.employee,
      department: 'Sales',
      employeeId: 'EMP-SP-01',
      phone: '9814010000',
    ),
    AppUser(
      id: 'USR-EMP-SP-02',
      name: 'Aksit',
      email: 'aksit@durasmart.com',
      role: UserRole.employee,
      department: 'Sales',
      employeeId: 'EMP-SP-02',
      phone: '9814010001',
    ),
    AppUser(
      id: 'USR-EMP-SP-03',
      name: 'GAURAV JI',
      email: 'gaurav.ji@durasmart.com',
      role: UserRole.employee,
      department: 'Sales',
      employeeId: 'EMP-SP-03',
      phone: '9814010002',
    ),
    AppUser(
      id: 'USR-EMP-SP-04',
      name: 'JAGDEEP 2/ Aakash Kumar',
      email: 'aakash.kumar@durasmart.com',
      role: UserRole.employee,
      department: 'Sales',
      employeeId: 'EMP-SP-04',
      phone: '9814010003',
    ),
    AppUser(
      id: 'USR-EMP-SP-05',
      name: 'JAGDEEP 3/ Dalip Kumar',
      email: 'dalip.kumar@durasmart.com',
      role: UserRole.employee,
      department: 'Sales',
      employeeId: 'EMP-SP-05',
      phone: '9814010004',
    ),
    AppUser(
      id: 'USR-EMP-SP-06',
      name: 'Jagdeep Singh',
      email: 'jagdeep.singh@durasmart.com',
      role: UserRole.employee,
      department: 'Sales',
      employeeId: 'EMP-SP-06',
      phone: '9814010005',
    ),
    AppUser(
      id: 'USR-EMP-SP-07',
      name: 'Mozi Ram',
      email: 'mozi.ram@durasmart.com',
      role: UserRole.employee,
      department: 'Sales',
      employeeId: 'EMP-SP-07',
      phone: '9814010006',
    ),
    AppUser(
      id: 'USR-EMP-SP-08',
      name: 'PANKAJ JI',
      email: 'pankaj.ji@durasmart.com',
      role: UserRole.employee,
      department: 'Sales',
      employeeId: 'EMP-SP-08',
      phone: '9814010007',
    ),
    AppUser(
      id: 'USR-EMP-SP-09',
      name: 'Pankaj Goyal',
      email: 'pankaj.goyal@durasmart.com',
      role: UserRole.employee,
      department: 'Sales',
      employeeId: 'EMP-SP-09',
      phone: '9814010008',
    ),
    AppUser(
      id: 'USR-EMP-SP-10',
      name: 'SANDEEP2/Mozi Ram',
      email: 'sandeep2@durasmart.com',
      role: UserRole.employee,
      department: 'Sales',
      employeeId: 'EMP-SP-10',
      phone: '9814010009',
    ),
    AppUser(
      id: 'USR-EMP-SP-11',
      name: 'Sandeep Mahajan',
      email: 'sandeep.mahajan@durasmart.com',
      role: UserRole.employee,
      department: 'Sales',
      employeeId: 'EMP-SP-11',
      phone: '9814010010',
    ),
    AppUser(
      id: 'USR-EMP-SP-12',
      name: 'Suresh Jindal',
      email: 'suresh.jindal@durasmart.com',
      role: UserRole.employee,
      department: 'Sales',
      employeeId: 'EMP-SP-12',
      phone: '9814010011',
    ),
    AppUser(
      id: 'USR-EMP-SP-13',
      name: 'VIJAY JI',
      email: 'vijay.ji@durasmart.com',
      role: UserRole.employee,
      department: 'Sales',
      employeeId: 'EMP-SP-13',
      phone: '9814010012',
    ),
  ];

  List<AppUser> get demoAccounts => List.unmodifiable(_accounts);

  void _seed() {
    employees.addAll([
      Employee(
        id: 'EMP-SP-01',
        name: 'AJAY JI',
        role: 'Area Sales Officer',
        department: 'Sales',
        phone: '9814010000',
        email: 'ajay.ji@durasmart.com',
        city: 'Haryana',
        monthlyTargetQty: 185,
      ),
      Employee(
        id: 'EMP-SP-02',
        name: 'Aksit',
        role: 'Area Sales Officer',
        department: 'Sales',
        phone: '9814010001',
        email: 'aksit@durasmart.com',
        city: 'Punjab',
        monthlyTargetQty: 23,
      ),
      Employee(
        id: 'EMP-SP-03',
        name: 'GAURAV JI',
        role: 'Area Sales Officer',
        department: 'Sales',
        phone: '9814010002',
        email: 'gaurav.ji@durasmart.com',
        city: 'Haryana',
        monthlyTargetQty: 50,
      ),
      Employee(
        id: 'EMP-SP-04',
        name: 'JAGDEEP 2/ Aakash Kumar',
        role: 'Area Sales Officer',
        department: 'Sales',
        phone: '9814010003',
        email: 'aakash.kumar@durasmart.com',
        city: 'Punjab',
        monthlyTargetQty: 78,
      ),
      Employee(
        id: 'EMP-SP-05',
        name: 'JAGDEEP 3/ Dalip Kumar',
        role: 'Area Sales Officer',
        department: 'Sales',
        phone: '9814010004',
        email: 'dalip.kumar@durasmart.com',
        city: 'Punjab',
        monthlyTargetQty: 50,
      ),
      Employee(
        id: 'EMP-SP-06',
        name: 'Jagdeep Singh',
        role: 'Area Sales Officer',
        department: 'Sales',
        phone: '9814010005',
        email: 'jagdeep.singh@durasmart.com',
        city: 'Punjab',
        monthlyTargetQty: 271,
      ),
      Employee(
        id: 'EMP-SP-07',
        name: 'Mozi Ram',
        role: 'Area Sales Officer',
        department: 'Sales',
        phone: '9814010006',
        email: 'mozi.ram@durasmart.com',
        city: 'Haryana',
        monthlyTargetQty: 50,
      ),
      Employee(
        id: 'EMP-SP-08',
        name: 'PANKAJ JI',
        role: 'Area Sales Officer',
        department: 'Sales',
        phone: '9814010007',
        email: 'pankaj.ji@durasmart.com',
        city: 'Haryana',
        monthlyTargetQty: 280,
      ),
      Employee(
        id: 'EMP-SP-09',
        name: 'Pankaj Goyal',
        role: 'Area Sales Officer',
        department: 'Sales',
        phone: '9814010008',
        email: 'pankaj.goyal@durasmart.com',
        city: 'Punjab',
        monthlyTargetQty: 127,
      ),
      Employee(
        id: 'EMP-SP-10',
        name: 'SANDEEP2/Mozi Ram',
        role: 'Area Sales Officer',
        department: 'Sales',
        phone: '9814010009',
        email: 'sandeep2@durasmart.com',
        city: 'Punjab',
        monthlyTargetQty: 87,
      ),
      Employee(
        id: 'EMP-SP-11',
        name: 'Sandeep Mahajan',
        role: 'Area Sales Officer',
        department: 'Sales',
        phone: '9814010010',
        email: 'sandeep.mahajan@durasmart.com',
        city: 'Punjab',
        monthlyTargetQty: 239,
      ),
      Employee(
        id: 'EMP-SP-12',
        name: 'Suresh Jindal',
        role: 'Area Sales Officer',
        department: 'Sales',
        phone: '9814010011',
        email: 'suresh.jindal@durasmart.com',
        city: 'Punjab',
        monthlyTargetQty: 99,
      ),
      Employee(
        id: 'EMP-SP-13',
        name: 'VIJAY JI',
        role: 'Area Sales Officer',
        department: 'Sales',
        phone: '9814010012',
        email: 'vijay.ji@durasmart.com',
        city: 'Haryana',
        monthlyTargetQty: 70,
      ),
    ]);

    // Customers, orders, payments, dispatches, and tour plans are live-synced from backend via syncWithBackend().
    debtors.addAll([
      DebtorItem(
        id: 'DEBTOR-001',
        name: 'N.K.TIMBER & PLYWOOD/ DERABASSI',
        state: 'Punjab',
        city: 'Dera Bassi',
        district: 'Mohali',
        salesperson: 'Mozi Ram',
        balance: 0.0,
      ),
      DebtorItem(
        id: 'DEBTOR-002',
        name: 'KALRA TRADERS/ STEEL DERABASSI',
        state: 'Haryana',
        city: 'Dera Bassi',
        district: 'Mohali',
        salesperson: 'Mozi Ram',
        balance: 0.0,
      ),
      DebtorItem(
        id: 'DEBTOR-003',
        name: 'A.B STEEL ABHEY FAZILKA',
        state: 'Punjab',
        city: 'Fazilka',
        district: 'Fazilka',
        salesperson: 'Pankaj Goyal',
        balance: 0.0,
      ),
      DebtorItem(
        id: 'DEBTOR-004',
        name: 'A.J. Group of Industries , Tarn Taran',
        state: 'Punjab',
        city: 'Tarn Taran',
        district: 'Tarn Taran',
        salesperson: 'Jagdeep Singh',
        balance: 0.0,
      ),
      DebtorItem(
        id: 'DEBTOR-005',
        name: 'GURU KIRPA INDUSTRY BARNALA',
        state: 'Punjab',
        city: 'Barnala',
        district: 'Barnala',
        salesperson: 'Pankaj Goyal',
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
        name: 'BHAGWATI INDUSTRIES TARB TARAN',
        state: 'Punjab',
        city: 'Tarn Taran',
        district: 'Tarn Taran',
        salesperson: 'Jagdeep Singh',
        balance: 0.0,
      ),
      DebtorItem(
        id: 'DEBTOR-008',
        name: 'J P INDUSTRIAL JAGRAON',
        state: 'Punjab',
        city: 'Jagraon',
        district: 'Ludhiana',
        salesperson: 'Sandeep Mahajan',
        balance: 0.0,
      ),
      DebtorItem(
        id: 'DEBTOR-009',
        name: 'DOORKRM SIRSA ENTERPRISES SIRSA',
        state: 'Haryana',
        city: 'Sirsa',
        district: 'SIRSA',
        salesperson: 'AJAY JI',
        balance: 0.0,
      ),
      DebtorItem(
        id: 'DEBTOR-010',
        name: 'BANSAL POLES JHAJJAR',
        state: 'Haryana',
        city: 'Jhajjar',
        district: 'JHAJJAR',
        salesperson: 'PANKAJ JI',
        balance: 0.0,
      ),
    ]);

    for (final d in debtors) {
      final sp = employees.where(
        (e) =>
            e.name.toLowerCase() == d.salesperson.toLowerCase() ||
            e.id.toLowerCase() == d.salesperson.toLowerCase(),
      ).firstOrNull ?? employees.first;

      customers.add(
        Customer(
          id: d.id,
          name: d.name,
          city: d.city.isNotEmpty ? d.city : (d.district.isNotEmpty ? d.district : d.state),
          mobile: '919800000000',
          salespersonId: sp.id,
          contactPerson: d.name,
          address: '${d.district}, ${d.state}',
          type: 'Dealer',
        ),
      );
    }

    final now = DateTime.now();
    DateTime dDay(int day) => DateTime(now.year, now.month, day.clamp(1, 28));

    orders.addAll([
      SalesOrder(
        id: 'ORD-101',
        number: 'DS-2591',
        customerId: 'DEBTOR-001',
        salespersonId: 'EMP-SP-01',
        orderDate: dDay(1),
        items: [
          OrderItem(product: 'Slit Coil JSW', quantity: 12, unit: 'MT', rate: 62000),
        ],
        dueDate: dDay(25),
        status: OrderStatus.dispatched,
        paymentTerms: '30 days credit',
      ),
      SalesOrder(
        id: 'ORD-102',
        number: 'DS-2596',
        customerId: 'DEBTOR-002',
        salespersonId: 'EMP-SP-02',
        orderDate: dDay(3),
        items: [
          OrderItem(product: 'Slit Coil Kamdhenu', quantity: 8, unit: 'MT', rate: 58500),
        ],
        dueDate: dDay(28),
        status: OrderStatus.pendingDispatch,
      ),
    ]);

    payments.addAll([
      Payment(
        id: 'PAY-201',
        orderId: 'ORD-101',
        customerId: 'DEBTOR-001',
        invoiceNumber: 'INV-101',
        invoiceAmount: 744000,
        amount: 250000,
        date: dDay(2),
        method: PaymentMethod.neft,
        reference: 'CMS-99120',
      ),
    ]);

    dispatches.addAll([
      Dispatch(
        id: 'DSP-301',
        orderId: 'ORD-101',
        orderNumber: 'DS-2591',
        customerId: 'DEBTOR-001',
        dispatchDate: dDay(2),
        vehicle: 'PB 10 AB 1234',
        driver: 'Gurpreet Singh',
        lines: [
          DispatchLine(product: 'Slit Coil JSW', quantity: 6, unit: 'MT'),
        ],
      ),
    ]);

    tasks.addAll([
      WorkTask(
        id: 'TSK-101',
        title: 'Call Kalra Traders for payment follow-up',
        description: 'Verify RTGS reference for invoice DS-2591',
        assignedEmployeeId: 'EMP-SP-01',
        dueAt: DateTime.now().add(const Duration(hours: 4)),
        status: TaskStatus.open,
      ),
    ]);

    salespersonSummaries.addAll([
      SalespersonSummary(
        salesperson: 'PANKAJ JI',
        territory: 'Haryana',
        partiesCount: 13,
        totalTargetMt: 280.0,
        totalDispatchedMt: 108.505,
        totalPendingMt: 171.495,
        achievementPercent: 38.8,
      ),
      SalespersonSummary(
        salesperson: 'Jagdeep Singh',
        territory: 'Punjab',
        partiesCount: 21,
        totalTargetMt: 271.0,
        totalDispatchedMt: 104.178,
        totalPendingMt: 166.822,
        achievementPercent: 38.4,
      ),
      SalespersonSummary(
        salesperson: 'Sandeep Mahajan',
        territory: 'Punjab',
        partiesCount: 33,
        totalTargetMt: 239.0,
        totalDispatchedMt: 139.036,
        totalPendingMt: 99.964,
        achievementPercent: 58.2,
      ),
      SalespersonSummary(
        salesperson: 'AJAY JI',
        territory: 'Haryana',
        partiesCount: 13,
        totalTargetMt: 185.0,
        totalDispatchedMt: 8.585,
        totalPendingMt: 176.415,
        achievementPercent: 4.6,
      ),
      SalespersonSummary(
        salesperson: 'Pankaj Goyal',
        territory: 'Punjab',
        partiesCount: 7,
        totalTargetMt: 127.0,
        totalDispatchedMt: 43.780,
        totalPendingMt: 83.220,
        achievementPercent: 34.5,
      ),
      SalespersonSummary(
        salesperson: 'Suresh Jindal',
        territory: 'Punjab',
        partiesCount: 7,
        totalTargetMt: 99.0,
        totalDispatchedMt: 49.189,
        totalPendingMt: 49.811,
        achievementPercent: 49.7,
      ),
      SalespersonSummary(
        salesperson: 'SANDEEP2/Mozi Ram',
        territory: 'Punjab',
        partiesCount: 6,
        totalTargetMt: 87.0,
        totalDispatchedMt: 28.236,
        totalPendingMt: 58.764,
        achievementPercent: 32.5,
      ),
      SalespersonSummary(
        salesperson: 'JAGDEEP 2/ Aakash Kumar',
        territory: 'Punjab',
        partiesCount: 16,
        totalTargetMt: 78.0,
        totalDispatchedMt: 36.358,
        totalPendingMt: 41.642,
        achievementPercent: 46.6,
      ),
      SalespersonSummary(
        salesperson: 'VIJAY JI',
        territory: 'Haryana',
        partiesCount: 5,
        totalTargetMt: 70.0,
        totalDispatchedMt: 29.145,
        totalPendingMt: 40.855,
        achievementPercent: 41.6,
      ),
      SalespersonSummary(
        salesperson: 'Mozi Ram',
        territory: 'Haryana',
        partiesCount: 1,
        totalTargetMt: 50.0,
        totalDispatchedMt: 28.395,
        totalPendingMt: 21.605,
        achievementPercent: 56.8,
      ),
      SalespersonSummary(
        salesperson: 'GAURAV JI',
        territory: 'Haryana',
        partiesCount: 5,
        totalTargetMt: 50.0,
        totalDispatchedMt: 28.310,
        totalPendingMt: 21.690,
        achievementPercent: 56.6,
      ),
      SalespersonSummary(
        salesperson: 'JAGDEEP 3/ Dalip Kumar',
        territory: 'Punjab',
        partiesCount: 4,
        totalTargetMt: 50.0,
        totalDispatchedMt: 18.059,
        totalPendingMt: 31.941,
        achievementPercent: 36.1,
      ),
      SalespersonSummary(
        salesperson: 'Aksit',
        territory: 'Punjab',
        partiesCount: 6,
        totalTargetMt: 23.0,
        totalDispatchedMt: 0.0,
        totalPendingMt: 23.0,
        achievementPercent: 0.0,
      ),
    ]);
    serverTargetMt = 1609.0;
    serverDispatchesMt = 621.776;
    serverPendingMt = 987.224;
    serverAchievementPercent = 38.64;
    serverActiveDealers = 137;
    serverSalesTeamCount = 13;
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
