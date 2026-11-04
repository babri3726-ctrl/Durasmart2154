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
          ..connectionTimeout = const Duration(milliseconds: 1000);
        final req = await client.getUrl(
          Uri.parse('$_cachedWorkingHost/api/v1/stock/summary'),
        );
        final resp = await req.close();
        if (resp.statusCode == 200) return _cachedWorkingHost;
      } catch (_) {}
    }

    for (final host in candidateHosts) {
      try {
        final client = HttpClient()
          ..connectionTimeout = const Duration(milliseconds: 1200);
        final req = await client.getUrl(
          Uri.parse('$host/api/v1/stock/summary'),
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
          authToken = data['accessToken'] as String;
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
          authToken = data['accessToken'] as String;
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
}
