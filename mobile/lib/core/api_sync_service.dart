import 'dart:convert';
import 'dart:io';

/// Handles transparent HTTP sync between the Flutter Mobile app and the FastAPI backend.
class ApiSyncService {
  /// Allows injecting a backend host at compile time via:
  /// flutter build apk --dart-define=BACKEND_URL=http://100.x.y.z:8010
  static const String envBackendUrl = String.fromEnvironment(
    'BACKEND_URL',
    defaultValue: '',
  );

  /// Runtime custom host entered by the user (e.g. Tailscale IP, Cloudflare Tunnel, or LAN IP)
  static String? userCustomHost;

  /// Ordered list of candidate hosts to probe for live connectivity
  static List<String> get candidateHosts => [
    if (userCustomHost != null && userCustomHost!.trim().isNotEmpty)
      userCustomHost!.trim(),
    if (envBackendUrl.isNotEmpty) envBackendUrl.trim(),
    'https://durasmart2154.onrender.com', // Permanent 24/7 Cloud Backend (Render.com)
    'http://100.95.241.124:8010', // Tailscale Mesh IP
    'http://192.168.29.86:8010', // Local WiFi LAN IP
    'http://10.0.2.2:8010', // Android Emulator Host Loopback
    'http://127.0.0.1:8010', // Localhost
    'http://localhost:8010',
  ];

  static String? _cachedWorkingHost;

  /// Sets or clears the user-specified server endpoint
  static void setCustomHost(String? host) {
    if (host == null || host.trim().isEmpty) {
      userCustomHost = null;
    } else {
      String clean = host.trim();
      if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
        clean = 'http://$clean';
      }
      userCustomHost = clean.replaceAll(RegExp(r'/+$'), '');
    }
    _cachedWorkingHost = null; // force re-probe on next request
  }

  /// The host currently in use
  static String? get currentHost =>
      _cachedWorkingHost ??
      userCustomHost ??
      (envBackendUrl.isNotEmpty ? envBackendUrl : null);

  /// Discovers which host is currently reachable.
  static Future<String?> resolveWorkingHost() async {
    if (_cachedWorkingHost != null) {
      try {
        final client = HttpClient()
          ..connectionTimeout = const Duration(milliseconds: 3000);
        final req = await client.getUrl(
          Uri.parse('$_cachedWorkingHost/health'),
        );
        final resp = await req.close();
        if (resp.statusCode == 200) return _cachedWorkingHost;
      } catch (_) {}
    }

    for (final host in candidateHosts) {
      try {
        final client = HttpClient()
          ..connectionTimeout = const Duration(milliseconds: 4000);
        final req = await client.getUrl(
          Uri.parse('$host/health'),
        );
        final resp = await req.close();
        if (resp.statusCode == 200) {
          _cachedWorkingHost = host;
          return host;
        }
      } catch (_) {}
    }
    return null;
  }

  /// Synchronizes an order to the backend /api/v1/orders
  static Future<bool> postOrder(Map<String, dynamic> orderPayload) async {
    try {
      final host = await resolveWorkingHost();
      if (host == null) return false;
      final client = HttpClient()
        ..connectionTimeout = const Duration(seconds: 4);
      final req = await client.postUrl(Uri.parse('$host/api/v1/orders'));
      req.headers.contentType = ContentType.json;
      req.write(jsonEncode(orderPayload));
      final resp = await req.close();
      return resp.statusCode == 200 || resp.statusCode == 201;
    } catch (_) {
      return false;
    }
  }

  /// Synchronizes a debtor to the backend /api/v1/debtors
  static Future<bool> postDebtor(Map<String, dynamic> debtorPayload) async {
    try {
      final host = await resolveWorkingHost();
      if (host == null) return false;
      final client = HttpClient()
        ..connectionTimeout = const Duration(seconds: 4);
      final req = await client.postUrl(Uri.parse('$host/api/v1/debtors'));
      req.headers.contentType = ContentType.json;
      req.write(jsonEncode(debtorPayload));
      final resp = await req.close();
      return resp.statusCode == 200 || resp.statusCode == 201;
    } catch (_) {
      return false;
    }
  }

  /// Synchronizes a payment to the backend /api/v1/payments
  static Future<bool> postPayment(Map<String, dynamic> paymentPayload) async {
    try {
      final host = await resolveWorkingHost();
      if (host == null) return false;
      final client = HttpClient()
        ..connectionTimeout = const Duration(seconds: 4);
      final req = await client.postUrl(Uri.parse('$host/api/v1/payments'));
      req.headers.contentType = ContentType.json;
      req.write(jsonEncode(paymentPayload));
      final resp = await req.close();
      return resp.statusCode == 200 || resp.statusCode == 201;
    } catch (_) {
      return false;
    }
  }

  /// Fetches tasks from backend
  static Future<List<Map<String, dynamic>>?> fetchTasks({
    String? employeeId,
    String? status,
    String? priority,
  }) async {
    final host = await resolveWorkingHost();
    if (host == null) return null;
    try {
      final client = HttpClient()..connectionTimeout = const Duration(seconds: 4);
      final params = <String>[];
      if (employeeId != null && employeeId.isNotEmpty) {
        params.add('employeeId=${Uri.encodeComponent(employeeId)}');
      }
      if (status != null && status.isNotEmpty) {
        params.add('status=${Uri.encodeComponent(status)}');
      }
      if (priority != null && priority.isNotEmpty) {
        params.add('priority=${Uri.encodeComponent(priority)}');
      }
      final query = params.isEmpty ? '' : '?${params.join('&')}';
      final req = await client.getUrl(Uri.parse('$host/api/v1/tasks$query'));
      final resp = await req.close();
      if (resp.statusCode == 200) {
        final body = await resp.transform(utf8.decoder).join();
        final data = jsonDecode(body) as Map<String, dynamic>;
        final items = data['items'] as List<dynamic>? ?? [];
        return items.map((e) => e as Map<String, dynamic>).toList();
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  /// Fetches tasks whose alarms are due now or overdue
  static Future<List<Map<String, dynamic>>?> fetchDueAlarms({
    String? employeeId,
  }) async {
    final host = await resolveWorkingHost();
    if (host == null) return null;
    try {
      final client = HttpClient()..connectionTimeout = const Duration(seconds: 4);
      final query = (employeeId != null && employeeId.isNotEmpty)
          ? '?employeeId=${Uri.encodeComponent(employeeId)}'
          : '';
      final req = await client.getUrl(Uri.parse('$host/api/v1/tasks/due-alarms$query'));
      final resp = await req.close();
      if (resp.statusCode == 200) {
        final body = await resp.transform(utf8.decoder).join();
        final data = jsonDecode(body) as Map<String, dynamic>;
        final items = data['items'] as List<dynamic>? ?? [];
        return items.map((e) => e as Map<String, dynamic>).toList();
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  /// Updates task status (e.g. acknowledged, completed) on backend
  static Future<bool> updateTaskStatus(
    String taskId,
    String status, {
    String? notes,
    String? photoUrl,
  }) async {
    final host = await resolveWorkingHost();
    if (host == null) return false;
    try {
      final client = HttpClient()..connectionTimeout = const Duration(seconds: 4);
      final req = await client.postUrl(Uri.parse('$host/api/v1/tasks/$taskId/status'));
      req.headers.contentType = ContentType.json;
      req.write(jsonEncode({
        'status': status,
        if (notes != null) 'notes': notes,
        if (photoUrl != null) 'photoUrl': photoUrl,
      }));
      final resp = await req.close();
      return resp.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  /// Creates a new task on backend
  static Future<Map<String, dynamic>?> postTask(Map<String, dynamic> taskPayload) async {
    final host = await resolveWorkingHost();
    if (host == null) return null;
    try {
      final client = HttpClient()..connectionTimeout = const Duration(seconds: 4);
      final req = await client.postUrl(Uri.parse('$host/api/v1/tasks'));
      req.headers.contentType = ContentType.json;
      req.write(jsonEncode(taskPayload));
      final resp = await req.close();
      if (resp.statusCode == 200 || resp.statusCode == 201) {
        final body = await resp.transform(utf8.decoder).join();
        return jsonDecode(body) as Map<String, dynamic>;
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  /// Synchronizes a dispatch to the backend /api/v1/dispatches
  static Future<bool> postDispatch(Map<String, dynamic> dispatchPayload) async {
    final host = await resolveWorkingHost();
    if (host == null) return false;
    try {
      final client = HttpClient()
        ..connectionTimeout = const Duration(seconds: 4);
      final req = await client.postUrl(Uri.parse('$host/api/v1/dispatches'));
      req.headers.contentType = ContentType.json;
      req.write(jsonEncode(dispatchPayload));
      final resp = await req.close();
      return resp.statusCode == 200 || resp.statusCode == 201;
    } catch (_) {
      return false;
    }
  }

  /// Updates an order on the backend /api/v1/orders/$orderId
  static Future<bool> patchOrder(String orderId, Map<String, dynamic> payload) async {
    final host = await resolveWorkingHost();
    if (host == null) return false;
    try {
      final client = HttpClient()
        ..connectionTimeout = const Duration(seconds: 4);
      final req = await client.patchUrl(Uri.parse('$host/api/v1/orders/$orderId'));
      req.headers.contentType = ContentType.json;
      req.write(jsonEncode(payload));
      final resp = await req.close();
      return resp.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  /// Deletes an order on the backend /api/v1/orders/$orderId
  static Future<bool> deleteOrder(String orderId) async {
    final host = await resolveWorkingHost();
    if (host == null) return false;
    try {
      final client = HttpClient()
        ..connectionTimeout = const Duration(seconds: 4);
      final req = await client.deleteUrl(Uri.parse('$host/api/v1/orders/$orderId'));
      final resp = await req.close();
      return resp.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  /// Updates order status on the backend /api/v1/orders/$orderId/status
  static Future<bool> postOrderStatus(
    String orderId,
    String toStatus, {
    String? reason,
  }) async {
    final host = await resolveWorkingHost();
    if (host == null) return false;
    try {
      final client = HttpClient()
        ..connectionTimeout = const Duration(seconds: 4);
      final req = await client.postUrl(
        Uri.parse('$host/api/v1/orders/$orderId/status'),
      );
      req.headers.contentType = ContentType.json;
      req.write(
        jsonEncode({'to': toStatus, if (reason != null) 'reason': reason}),
      );
      final resp = await req.close();
      return resp.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  /// Quick dispatches order on the backend /api/v1/orders/$orderId/quick-dispatch
  static Future<bool> quickDispatchOrder(
    String orderId, {
    String vehicleNo = 'PB 10 CT 4421',
    String notes = 'Quick dispatch',
  }) async {
    final host = await resolveWorkingHost();
    if (host == null) return false;
    try {
      final client = HttpClient()
        ..connectionTimeout = const Duration(seconds: 4);
      final req = await client.postUrl(
        Uri.parse('$host/api/v1/orders/$orderId/quick-dispatch'),
      );
      req.headers.contentType = ContentType.json;
      req.write(jsonEncode({'vehicleNo': vehicleNo, 'notes': notes}));
      final resp = await req.close();
      return resp.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  /// Stored active JWT bearer token
  static String? authToken;

  static File get _tokenFile => File('${Directory.systemTemp.path}/durasmart_auth.json');

  static void setAuthToken(String? token) {
    authToken = token;
    try {
      if (token != null) {
        _tokenFile.writeAsStringSync(jsonEncode({'token': token}));
      } else if (_tokenFile.existsSync()) {
        _tokenFile.deleteSync();
      }
    } catch (_) {}
  }

  static String? initAuthToken() {
    if (authToken != null) return authToken;
    try {
      if (_tokenFile.existsSync()) {
        final content = _tokenFile.readAsStringSync();
        final map = jsonDecode(content) as Map<String, dynamic>;
        authToken = map['token'] as String?;
      }
    } catch (_) {}
    return authToken;
  }

  /// Fetches tour plans from backend /api/v1/tours
  static Future<List<Map<String, dynamic>>?> fetchTourPlans({
    String? salespersonId,
    String? date,
    String? status,
  }) async {
    final host = await resolveWorkingHost();
    if (host == null) return null;
    try {
      final client = HttpClient()..connectionTimeout = const Duration(seconds: 4);
      final params = <String>[];
      if (salespersonId != null && salespersonId.isNotEmpty) {
        params.add('salespersonId=${Uri.encodeComponent(salespersonId)}');
      }
      if (date != null && date.isNotEmpty) {
        params.add('date=${Uri.encodeComponent(date)}');
      }
      if (status != null && status.isNotEmpty) {
        params.add('status=${Uri.encodeComponent(status)}');
      }
      final query = params.isEmpty ? '' : '?${params.join('&')}';
      final req = await client.getUrl(Uri.parse('$host/api/v1/tours$query'));
      if (authToken != null) {
        req.headers.set('Authorization', 'Bearer $authToken');
      }
      final resp = await req.close();
      if (resp.statusCode == 200) {
        final body = await resp.transform(utf8.decoder).join();
        final data = jsonDecode(body);
        if (data is List) {
          return data.map((e) => e as Map<String, dynamic>).toList();
        }
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  /// Fetches vacant areas and district coverage from backend
  static Future<Map<String, dynamic>?> fetchVacantAreas() async {
    final host = await resolveWorkingHost();
    if (host == null) return null;
    try {
      final client = HttpClient()..connectionTimeout = const Duration(seconds: 4);
      final req = await client.getUrl(Uri.parse('$host/api/v1/territories/vacant-areas'));
      if (authToken != null) {
        req.headers.set('Authorization', 'Bearer $authToken');
      }
      final resp = await req.close();
      if (resp.statusCode == 200) {
        final body = await resp.transform(utf8.decoder).join();
        return jsonDecode(body) as Map<String, dynamic>;
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  /// Fetches orders from backend /api/v1/orders
  static Future<List<Map<String, dynamic>>?> fetchOrders({
    String? q,
    String? salespersonId,
    String? status,
  }) async {
    final host = await resolveWorkingHost();
    if (host == null) return null;
    try {
      final client = HttpClient()..connectionTimeout = const Duration(seconds: 4);
      final params = <String>[];
      if (q != null && q.isNotEmpty) params.add('q=${Uri.encodeComponent(q)}');
      if (salespersonId != null && salespersonId.isNotEmpty) {
        params.add('salespersonId=${Uri.encodeComponent(salespersonId)}');
      }
      if (status != null && status.isNotEmpty) {
        params.add('status=${Uri.encodeComponent(status)}');
      }
      params.add('pageSize=100');
      final query = '?${params.join('&')}';
      final req = await client.getUrl(Uri.parse('$host/api/v1/orders$query'));
      if (authToken != null) {
        req.headers.set('Authorization', 'Bearer $authToken');
      }
      final resp = await req.close();
      if (resp.statusCode == 200) {
        final body = await resp.transform(utf8.decoder).join();
        final data = jsonDecode(body);
        if (data is Map && data['items'] is List) {
          return (data['items'] as List).map((e) => e as Map<String, dynamic>).toList();
        }
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  /// Fetches customers / dealers from backend /api/v1/customers
  static Future<List<Map<String, dynamic>>?> fetchCustomers({
    String? q,
    String? salespersonId,
  }) async {
    final host = await resolveWorkingHost();
    if (host == null) return null;
    try {
      final client = HttpClient()..connectionTimeout = const Duration(seconds: 4);
      final params = <String>[];
      if (q != null && q.isNotEmpty) params.add('q=${Uri.encodeComponent(q)}');
      if (salespersonId != null && salespersonId.isNotEmpty) {
        params.add('salespersonId=${Uri.encodeComponent(salespersonId)}');
      }
      params.add('pageSize=2000');
      final query = '?${params.join('&')}';
      // Query /api/v1/debtors first as authoritative master with live balances, fallback to /api/v1/customers
      var req = await client.getUrl(Uri.parse('$host/api/v1/debtors$query'));
      if (authToken != null) {
        req.headers.set('Authorization', 'Bearer $authToken');
      }
      var resp = await req.close();
      if (resp.statusCode != 200) {
        req = await client.getUrl(Uri.parse('$host/api/v1/customers$query'));
        if (authToken != null) {
          req.headers.set('Authorization', 'Bearer $authToken');
        }
        resp = await req.close();
      }
      if (resp.statusCode == 200) {
        final body = await resp.transform(utf8.decoder).join();
        final data = jsonDecode(body);
        if (data is Map && data['items'] is List) {
          return (data['items'] as List).map((e) => e as Map<String, dynamic>).toList();
        }
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  /// Fetches vouchers for a specific party from backend /api/v1/vouchers
  static Future<List<Map<String, dynamic>>?> fetchVouchers(String partyId) async {
    final host = await resolveWorkingHost();
    if (host == null) return null;
    try {
      final client = HttpClient()..connectionTimeout = const Duration(seconds: 5);
      final req = await client.getUrl(
        Uri.parse('$host/api/v1/vouchers?partyId=${Uri.encodeComponent(partyId)}&limit=5000'),
      );
      if (authToken != null) {
        req.headers.set('Authorization', 'Bearer $authToken');
      }
      final resp = await req.close();
      if (resp.statusCode == 200) {
        final body = await resp.transform(utf8.decoder).join();
        final data = jsonDecode(body);
        if (data is List) {
          return data.map((e) => e as Map<String, dynamic>).toList();
        } else if (data is Map && data['items'] is List) {
          return (data['items'] as List).map((e) => e as Map<String, dynamic>).toList();
        }
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  /// Fetches company-wide Day Book vouchers from backend /api/v1/vouchers
  static Future<List<Map<String, dynamic>>?> fetchAllDaybookVouchers({
    String? bookSource,
    String? voucherType,
    String? q,
  }) async {
    final host = await resolveWorkingHost();
    if (host == null) return null;
    try {
      final client = HttpClient()..connectionTimeout = const Duration(seconds: 5);
      final query = <String>['limit=5000'];
      if (bookSource != null && bookSource.isNotEmpty) {
        query.add('bookSource=${Uri.encodeComponent(bookSource)}');
      }
      if (voucherType != null && voucherType.isNotEmpty) {
        query.add('voucherType=${Uri.encodeComponent(voucherType)}');
      }
      if (q != null && q.isNotEmpty) {
        query.add('q=${Uri.encodeComponent(q)}');
      }
      final req = await client.getUrl(
        Uri.parse('$host/api/v1/vouchers?${query.join('&')}'),
      );
      if (authToken != null) {
        req.headers.set('Authorization', 'Bearer $authToken');
      }
      final resp = await req.close();
      if (resp.statusCode == 200) {
        final body = await resp.transform(utf8.decoder).join();
        final data = jsonDecode(body);
        if (data is List) {
          return data.map((e) => e as Map<String, dynamic>).toList();
        } else if (data is Map && data['items'] is List) {
          return (data['items'] as List).map((e) => e as Map<String, dynamic>).toList();
        }
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  /// Fetches payments from backend /api/v1/payments
  static Future<List<Map<String, dynamic>>?> fetchPayments({
    String? q,
  }) async {
    final host = await resolveWorkingHost();
    if (host == null) return null;
    try {
      final client = HttpClient()..connectionTimeout = const Duration(seconds: 4);
      final qParam = (q != null && q.isNotEmpty) ? '?q=${Uri.encodeComponent(q)}&pageSize=100' : '?pageSize=100';
      final req = await client.getUrl(Uri.parse('$host/api/v1/payments$qParam'));
      if (authToken != null) {
        req.headers.set('Authorization', 'Bearer $authToken');
      }
      final resp = await req.close();
      if (resp.statusCode == 200) {
        final body = await resp.transform(utf8.decoder).join();
        final data = jsonDecode(body);
        if (data is Map && data['items'] is List) {
          return (data['items'] as List).map((e) => e as Map<String, dynamic>).toList();
        }
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  /// Fetches dispatches from backend /api/v1/dispatches
  static Future<List<Map<String, dynamic>>?> fetchDispatches({
    String? orderId,
  }) async {
    final host = await resolveWorkingHost();
    if (host == null) return null;
    try {
      final client = HttpClient()..connectionTimeout = const Duration(seconds: 4);
      final qParam = (orderId != null && orderId.isNotEmpty) ? '?orderId=${Uri.encodeComponent(orderId)}&pageSize=100' : '?pageSize=100';
      final req = await client.getUrl(Uri.parse('$host/api/v1/dispatches$qParam'));
      if (authToken != null) {
        req.headers.set('Authorization', 'Bearer $authToken');
      }
      final resp = await req.close();
      if (resp.statusCode == 200) {
        final body = await resp.transform(utf8.decoder).join();
        final data = jsonDecode(body);
        if (data is Map && data['items'] is List) {
          return (data['items'] as List).map((e) => e as Map<String, dynamic>).toList();
        }
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  /// Fetches sales targets from backend /api/v1/sales/targets
  static Future<List<Map<String, dynamic>>?> fetchSalesTargets() async {
    final host = await resolveWorkingHost();
    if (host == null) return null;
    try {
      final client = HttpClient()..connectionTimeout = const Duration(seconds: 4);
      final req = await client.getUrl(Uri.parse('$host/api/v1/sales/targets'));
      if (authToken != null) {
        req.headers.set('Authorization', 'Bearer $authToken');
      }
      final resp = await req.close();
      if (resp.statusCode == 200) {
        final body = await resp.transform(utf8.decoder).join();
        final data = jsonDecode(body);
        if (data is Map && data['items'] is List) {
          return (data['items'] as List).map((e) => e as Map<String, dynamic>).toList();
        }
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  /// Fetches employees from backend /api/v1/employees
  static Future<List<Map<String, dynamic>>?> fetchEmployees() async {
    final host = await resolveWorkingHost();
    if (host == null) return null;
    try {
      final client = HttpClient()..connectionTimeout = const Duration(seconds: 4);
      final req = await client.getUrl(Uri.parse('$host/api/v1/employees?pageSize=200'));
      if (authToken != null) {
        req.headers.set('Authorization', 'Bearer $authToken');
      }
      final resp = await req.close();
      if (resp.statusCode == 200) {
        final body = await resp.transform(utf8.decoder).join();
        final data = jsonDecode(body);
        if (data is Map && data['items'] is List) {
          return (data['items'] as List).map((e) => e as Map<String, dynamic>).toList();
        }
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  /// Fetches products from backend /api/v1/products
  static Future<List<String>?> fetchProducts() async {
    final host = await resolveWorkingHost();
    if (host == null) return null;
    try {
      final client = HttpClient()..connectionTimeout = const Duration(seconds: 4);
      final req = await client.getUrl(Uri.parse('$host/api/v1/products'));
      if (authToken != null) {
        req.headers.set('Authorization', 'Bearer $authToken');
      }
      final resp = await req.close();
      if (resp.statusCode == 200) {
        final body = await resp.transform(utf8.decoder).join();
        final data = jsonDecode(body);
        if (data is Map && data['items'] is List) {
          return (data['items'] as List).map((e) => e.toString()).toList();
        }
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  /// Triggers 1-Click HR-PB Targets & Dealers Sync on backend
  static Future<Map<String, dynamic>?> syncHrPbTargets() async {
    final host = await resolveWorkingHost();
    if (host == null) return null;
    try {
      final client = HttpClient()..connectionTimeout = const Duration(seconds: 15);
      final req = await client.postUrl(Uri.parse('$host/api/v1/imports/excel/hr-pb/sync'));
      if (authToken != null) {
        req.headers.set('Authorization', 'Bearer $authToken');
      }
      final resp = await req.close();
      if (resp.statusCode == 200) {
        final body = await resp.transform(utf8.decoder).join();
        return jsonDecode(body) as Map<String, dynamic>;
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  /// Assigns territory to salesperson on backend
  static Future<bool> assignTerritory({
    required String district,
    required String salesperson,
    String? salespersonId,
  }) async {
    final host = await resolveWorkingHost();
    if (host == null) return false;
    try {
      final client = HttpClient()..connectionTimeout = const Duration(seconds: 4);
      final req = await client.postUrl(Uri.parse('$host/api/v1/territories/assign'));
      req.headers.contentType = ContentType.json;
      if (authToken != null) {
        req.headers.set('Authorization', 'Bearer $authToken');
      }
      req.write(jsonEncode({
        'district': district,
        'salesperson': salesperson,
        'salespersonId': salespersonId ?? 'EMP-SP-01',
      }));
      final resp = await req.close();
      return resp.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  /// Updates tour visit status on backend /api/v1/tours/$tourId/visits/$visitId/status
  static Future<bool> updateTourVisitStatus({
    required String tourId,
    required String visitId,
    required String status,
    String? notes,
  }) async {
    final host = await resolveWorkingHost();
    if (host == null) return false;
    try {
      final client = HttpClient()..connectionTimeout = const Duration(seconds: 4);
      final req = await client.postUrl(
        Uri.parse('$host/api/v1/tours/$tourId/visits/$visitId/status'),
      );
      req.headers.contentType = ContentType.json;
      if (authToken != null) {
        req.headers.set('Authorization', 'Bearer $authToken');
      }
      req.write(jsonEncode({
        'status': status,
        if (notes != null) 'notes': notes,
      }));
      final resp = await req.close();
      return resp.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  /// Verifies an invitation code against the backend
  static Future<Map<String, dynamic>?> verifyInviteCode(String code) async {
    final host = await resolveWorkingHost();
    if (host == null) return null;
    try {
      final client = HttpClient()
        ..connectionTimeout = const Duration(seconds: 4);
      final req = await client.postUrl(
        Uri.parse('$host/api/v1/auth/invitations/verify'),
      );
      req.headers.contentType = ContentType.json;
      req.write(jsonEncode({'code': code.trim().toUpperCase()}));
      final resp = await req.close();
      if (resp.statusCode == 200) {
        final body = await resp.transform(utf8.decoder).join();
        return jsonDecode(body) as Map<String, dynamic>;
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  /// Registers a new staff user with an invitation code
  static Future<Map<String, dynamic>?> signupUser({
    required String name,
    required String identifier,
    required String password,
    required String inviteCode,
    String? phone,
  }) async {
    final host = await resolveWorkingHost();
    if (host == null) return null;
    try {
      final client = HttpClient()
        ..connectionTimeout = const Duration(seconds: 5);
      final req = await client.postUrl(
        Uri.parse('$host/api/v1/auth/signup'),
      );
      req.headers.contentType = ContentType.json;
      req.write(
        jsonEncode({
          'name': name.trim(),
          'identifier': identifier.trim(),
          'password': password,
          'inviteCode': inviteCode.trim().toUpperCase(),
          if (phone != null && phone.trim().isNotEmpty) 'phone': phone.trim(),
        }),
      );
      final resp = await req.close();
      final body = await resp.transform(utf8.decoder).join();
      final data = jsonDecode(body) as Map<String, dynamic>;
      if (resp.statusCode == 200 || resp.statusCode == 201) {
        if (data['accessToken'] is String) {
          setAuthToken(data['accessToken'] as String);
        }
        return data;
      }
      return {'error': data['detail'] ?? 'Registration failed ($resp.statusCode)'};
    } catch (e) {
      return {'error': 'Could not connect to operations server ($e)'};
    }
  }

  /// Signs in against the backend /api/v1/auth/login
  static Future<Map<String, dynamic>?> loginUser(
    String identifier,
    String password,
  ) async {
    final host = await resolveWorkingHost();
    if (host == null) return null;
    try {
      final client = HttpClient()
        ..connectionTimeout = const Duration(seconds: 5);
      final req = await client.postUrl(
        Uri.parse('$host/api/v1/auth/login'),
      );
      req.headers.contentType = ContentType.json;
      req.write(
        jsonEncode({
          'identifier': identifier.trim(),
          'password': password,
        }),
      );
      final resp = await req.close();
      final body = await resp.transform(utf8.decoder).join();
      final data = jsonDecode(body) as Map<String, dynamic>;
      if (resp.statusCode == 200) {
        if (data['accessToken'] is String) {
          setAuthToken(data['accessToken'] as String);
        }
        return data;
      }
      return {'error': data['detail'] ?? 'Invalid credentials'};
    } catch (e) {
      return {'error': 'Cannot connect to server ($e)'};
    }
  }

  /// Fetches live user profile from /api/v1/auth/me
  static Future<Map<String, dynamic>?> getProfile() async {
    final host = await resolveWorkingHost();
    if (host == null) return null;
    try {
      final client = HttpClient()
        ..connectionTimeout = const Duration(seconds: 4);
      final req = await client.getUrl(Uri.parse('$host/api/v1/auth/me'));
      if (authToken != null) {
        req.headers.set('Authorization', 'Bearer $authToken');
      }
      final resp = await req.close();
      if (resp.statusCode == 200) {
        final body = await resp.transform(utf8.decoder).join();
        return jsonDecode(body) as Map<String, dynamic>;
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  /// Updates profile details (phone, name, password) on /api/v1/auth/me
  static Future<Map<String, dynamic>?> updateProfile({
    String? name,
    String? phone,
    String? currentPassword,
    String? newPassword,
  }) async {
    final host = await resolveWorkingHost();
    if (host == null) return null;
    try {
      final client = HttpClient()
        ..connectionTimeout = const Duration(seconds: 5);
      final req = await client.patchUrl(Uri.parse('$host/api/v1/auth/me'));
      req.headers.contentType = ContentType.json;
      if (authToken != null) {
        req.headers.set('Authorization', 'Bearer $authToken');
      }
      req.write(
        jsonEncode({
          if (name != null) 'name': name,
          if (phone != null) 'phone': phone,
          if (currentPassword != null) 'currentPassword': currentPassword,
          if (newPassword != null) 'newPassword': newPassword,
        }),
      );
      final resp = await req.close();
      final body = await resp.transform(utf8.decoder).join();
      final data = jsonDecode(body) as Map<String, dynamic>;
      if (resp.statusCode == 200) {
        return data;
      }
      return {'error': data['detail'] ?? 'Update failed'};
    } catch (e) {
      return {'error': 'Connection failed ($e)'};
    }
  }

  static Future<Map<String, dynamic>?> requestPasswordReset(String identifier) async {
    final host = await resolveWorkingHost();
    if (host == null) return null;
    try {
      final client = HttpClient()
        ..connectionTimeout = const Duration(seconds: 5);
      final req = await client.postUrl(Uri.parse('$host/api/v1/auth/forgot-password'));
      req.headers.contentType = ContentType.json;
      req.write(jsonEncode({'identifier': identifier}));
      final resp = await req.close();
      final body = await resp.transform(utf8.decoder).join();
      final data = jsonDecode(body) as Map<String, dynamic>;
      if (resp.statusCode == 200) {
        return data;
      }
      return {'error': data['detail'] ?? 'Account lookup failed'};
    } catch (e) {
      return {'error': 'Connection failed ($e)'};
    }
  }

  static Future<Map<String, dynamic>?> resetPassword({
    required String identifier,
    required String otp,
    required String newPassword,
    String? confirmPassword,
  }) async {
    final host = await resolveWorkingHost();
    if (host == null) return null;
    try {
      final client = HttpClient()
        ..connectionTimeout = const Duration(seconds: 5);
      final req = await client.postUrl(Uri.parse('$host/api/v1/auth/reset-password'));
      req.headers.contentType = ContentType.json;
      req.write(
        jsonEncode({
          'identifier': identifier,
          'otp': otp,
          'newPassword': newPassword,
          'confirmPassword': confirmPassword ?? newPassword,
        }),
      );
      final resp = await req.close();
      final body = await resp.transform(utf8.decoder).join();
      final data = jsonDecode(body) as Map<String, dynamic>;
      if (resp.statusCode == 200) {
        return data;
      }
      return {'error': data['detail'] ?? 'Password reset failed'};
    } catch (e) {
      return {'error': 'Connection failed ($e)'};
    }
  }

  /// Generates a staff invitation code (Owner only)
  static Future<Map<String, dynamic>?> createInvitation({
    String role = 'employee',
    String department = 'Sales',
    String? salesTerritory,
    double monthlyTargetQty = 100.0,
    bool mayDispatch = false,
    int expiresInDays = 7,
  }) async {
    final host = await resolveWorkingHost();
    if (host == null) return null;
    try {
      final client = HttpClient()..connectionTimeout = const Duration(seconds: 5);
      final req = await client.postUrl(Uri.parse('$host/api/v1/auth/invitations'));
      req.headers.contentType = ContentType.json;
      if (authToken != null) {
        req.headers.set('Authorization', 'Bearer $authToken');
      }
      req.headers.set('X-User-Role', 'owner');
      req.write(jsonEncode({
        'role': role,
        'department': department,
        'salesTerritory': salesTerritory,
        'monthlyTargetQty': monthlyTargetQty,
        'mayDispatch': mayDispatch,
        'expiresInDays': expiresInDays,
      }));
      final resp = await req.close();
      final body = await resp.transform(utf8.decoder).join();
      final data = jsonDecode(body) as Map<String, dynamic>;
      if (resp.statusCode == 200 || resp.statusCode == 201) {
        return data;
      }
      return {'error': data['detail'] ?? 'Failed to generate invitation'};
    } catch (e) {
      return {'error': 'Could not connect ($e)'};
    }
  }

  /// Lists invitation codes (Owner only)
  static Future<List<Map<String, dynamic>>?> listInvitations() async {
    final host = await resolveWorkingHost();
    if (host == null) return null;
    try {
      final client = HttpClient()..connectionTimeout = const Duration(seconds: 5);
      final req = await client.getUrl(Uri.parse('$host/api/v1/auth/invitations'));
      if (authToken != null) {
        req.headers.set('Authorization', 'Bearer $authToken');
      }
      req.headers.set('X-User-Role', 'owner');
      final resp = await req.close();
      if (resp.statusCode == 200) {
        final body = await resp.transform(utf8.decoder).join();
        final data = jsonDecode(body);
        if (data is List) {
          return data.whereType<Map<String, dynamic>>().toList();
        }
      }
      return null;
    } catch (_) {
      return null;
    }
  }
}
