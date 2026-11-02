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
}
