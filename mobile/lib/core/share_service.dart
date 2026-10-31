import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../data/models.dart';
import 'formatters.dart';
import 'theme.dart';

/// Builds a prefilled, human-readable WhatsApp message and opens WhatsApp (or
/// the system share sheet). The user always reviews the message before it is
/// sent — this app never sends anything silently.
Future<void> shareWhatsAppText(
  BuildContext context, {
  required String phone,
  required String message,
}) async {
  final cleaned = phone.replaceAll(RegExp(r'[^0-9]'), '');
  final encoded = Uri.encodeComponent(message);
  final uri = cleaned.isEmpty
      ? Uri.parse('https://wa.me/?text=$encoded')
      : Uri.parse('https://wa.me/$cleaned?text=$encoded');
  var opened = false;
  try {
    opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
  } catch (_) {
    opened = false;
  }
  if (!opened && context.mounted) {
    await _showFallback(context, message, photos: const []);
  }
}

/// Shares message text plus photo attachments through the system share sheet.
Future<void> sharePhotos(
  BuildContext context, {
  required String message,
  required List<DemoPhoto> photos,
}) async {
  try {
    final files = photos
        .map(
          (p) => XFile.fromData(p.bytes, name: p.name, mimeType: 'image/jpeg'),
        )
        .toList();
    await SharePlus.instance.share(ShareParams(text: message, files: files));
  } catch (_) {
    if (context.mounted) await _showFallback(context, message, photos: photos);
  }
}

Future<void> _showFallback(
  BuildContext context,
  String message, {
  required List<DemoPhoto> photos,
}) async {
  final choice = await showModalBottomSheet<String>(
    context: context,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
    ),
    builder: (sheetContext) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(20, 18, 20, 6),
            child: Text(
              'WhatsApp is not available on this device',
              style: TextStyle(fontWeight: FontWeight.w900),
            ),
          ),
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 20),
            child: Text(
              'Copy the message and paste it into any chat app, or use the system share sheet.',
              style: TextStyle(color: AppColors.muted, fontSize: 12),
            ),
          ),
          const SizedBox(height: 12),
          ListTile(
            leading: const Icon(Icons.copy_rounded, color: AppColors.purple),
            title: const Text('Copy message to clipboard'),
            onTap: () => Navigator.pop(sheetContext, 'copy'),
          ),
          if (photos.isNotEmpty)
            ListTile(
              leading: const Icon(Icons.share_rounded, color: AppColors.blue),
              title: const Text('Share photos with system share'),
              onTap: () => Navigator.pop(sheetContext, 'share'),
            ),
          ListTile(
            leading: const Icon(Icons.close_rounded, color: AppColors.muted),
            title: const Text('Close'),
            onTap: () => Navigator.pop(sheetContext),
          ),
        ],
      ),
    ),
  );
  if (choice == 'copy') {
    await Clipboard.setData(ClipboardData(text: message));
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Message copied. Paste it into WhatsApp manually.'),
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
  } else if (choice == 'share') {
    try {
      final files = photos
          .map(
            (p) =>
                XFile.fromData(p.bytes, name: p.name, mimeType: 'image/jpeg'),
          )
          .toList();
      await SharePlus.instance.share(ShareParams(text: message, files: files));
    } catch (_) {
      if (context.mounted) {
        showDemoSnack(context, 'Sharing is not available in this environment.');
      }
    }
  }
}

void showDemoSnack(BuildContext context, String message) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(content: Text(message), behavior: SnackBarBehavior.floating),
    );
}

String customerWhatsAppSummary(
  String name,
  double outstanding,
  double overdue,
  int overdueDays,
) {
  final buffer = StringBuffer(
    'Hello $name,\n\nPayment summary from Dura Smart:\n',
  );
  buffer.writeln('Outstanding balance: ${rupees(outstanding)}');
  if (overdue > 0) {
    buffer.writeln(
      'Overdue amount: ${rupees(overdue)} ($overdueDays days past due date)',
    );
  } else {
    buffer.writeln('No overdue balance on record.');
  }
  buffer.write('\nPlease contact our sales team for any clarification.');
  return buffer.toString();
}
