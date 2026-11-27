import 'dart:io';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import 'package:share_plus/share_plus.dart';

class StatementVoucherRow {
  final String date;
  final String type;
  final String vchNo;
  final String particulars;
  final double debit;
  final double credit;
  final double balance;

  const StatementVoucherRow({
    required this.date,
    required this.type,
    required this.vchNo,
    required this.particulars,
    required this.debit,
    required this.credit,
    required this.balance,
  });
}

class StatementPdfData {
  final String partyName;
  final String partyId;
  final String city;
  final String state;
  final String mobile;
  final double openingBalance;
  final double totalDebits;
  final double totalCredits;
  final double closingBalance;
  final double bucket0_30;
  final double bucket31_60;
  final double bucket61_90;
  final double bucket90Plus;
  final List<StatementVoucherRow> vouchers;

  const StatementPdfData({
    required this.partyName,
    required this.partyId,
    required this.city,
    required this.state,
    required this.mobile,
    required this.openingBalance,
    required this.totalDebits,
    required this.totalCredits,
    required this.closingBalance,
    required this.bucket0_30,
    required this.bucket31_60,
    required this.bucket61_90,
    required this.bucket90Plus,
    required this.vouchers,
  });
}

class StatementPdfService {
  static String _formatRupees(double val) {
    final abs = val.abs();
    final parts = abs.toStringAsFixed(2).split('.');
    String intPart = parts[0];
    final decPart = parts[1];

    if (intPart.length > 3) {
      final last3 = intPart.substring(intPart.length - 3);
      final rest = intPart.substring(0, intPart.length - 3);
      final buffer = StringBuffer();
      for (int i = 0; i < rest.length; i++) {
        if (i > 0 && (rest.length - i) % 2 == 0) {
          buffer.write(',');
        }
        buffer.write(rest[i]);
      }
      buffer.write(',');
      buffer.write(last3);
      intPart = buffer.toString();
    }
    return 'Rs. $intPart.$decPart';
  }

  static Future<Uint8List> generatePdfBytes(StatementPdfData data) async {
    final pdf = pw.Document();

    final todayStr = DateTime.now().toString().substring(0, 10);
    final closingDrCr = data.closingBalance >= 0 ? 'Dr' : 'Cr';
    final openingDrCr = data.openingBalance >= 0 ? 'Dr' : 'Cr';

    final tableData = <List<String>>[
      for (final v in data.vouchers)
        [
          v.date,
          v.type.toUpperCase(),
          v.vchNo.isNotEmpty ? v.vchNo : '—',
          v.particulars.isNotEmpty ? v.particulars : 'Tally Entry',
          v.debit > 0 ? _formatRupees(v.debit) : '—',
          v.credit > 0 ? _formatRupees(v.credit) : '—',
          '${_formatRupees(v.balance)} ${v.balance >= 0 ? 'Dr' : 'Cr'}',
        ],
    ];

    pdf.addPage(
      pw.MultiPage(
        pageFormat: PdfPageFormat.a4,
        margin: const pw.EdgeInsets.all(24),
        header: (context) {
          return pw.Column(
            crossAxisAlignment: pw.CrossAxisAlignment.start,
            children: [
              // Company Header Banner
              pw.Container(
                decoration: const pw.BoxDecoration(
                  color: PdfColor.fromInt(0xFF1E293B), // slate-800
                  borderRadius: pw.BorderRadius.all(pw.Radius.circular(4)),
                ),
                padding: const pw.EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                child: pw.Row(
                  mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
                  children: [
                    pw.Column(
                      crossAxisAlignment: pw.CrossAxisAlignment.start,
                      children: [
                        pw.Text(
                          'DURA SMART DOORS & WINDOWS',
                          style: pw.TextStyle(
                            color: PdfColors.white,
                            fontWeight: pw.FontWeight.bold,
                            fontSize: 14,
                          ),
                        ),
                        pw.SizedBox(height: 2),
                        pw.Text(
                          'Enterprise Operations Suite · Industrial Area, Ludhiana, Punjab',
                          style: const pw.TextStyle(
                            color: PdfColor.fromInt(0xFFCBD5E1),
                            fontSize: 8,
                          ),
                        ),
                        pw.Text(
                          'Official Customer Ledger Statement',
                          style: const pw.TextStyle(
                            color: PdfColor.fromInt(0xFF94A3B8),
                            fontSize: 8,
                          ),
                        ),
                      ],
                    ),
                    pw.Column(
                      crossAxisAlignment: pw.CrossAxisAlignment.end,
                      children: [
                        pw.Text(
                          'Date: $todayStr',
                          style: const pw.TextStyle(color: PdfColors.white, fontSize: 8),
                        ),
                        pw.SizedBox(height: 2),
                        pw.Text(
                          'Page ${context.pageNumber} of ${context.pagesCount}',
                          style: const pw.TextStyle(color: PdfColor.fromInt(0xFFCBD5E1), fontSize: 8),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              pw.SizedBox(height: 10),

              // Account & Party Info (only on first page)
              if (context.pageNumber == 1) ...[
                pw.Container(
                  decoration: pw.BoxDecoration(
                    color: const PdfColor.fromInt(0xFFF8FAFC),
                    border: pw.Border.all(color: const PdfColor.fromInt(0xFFE2E8F0)),
                    borderRadius: const pw.BorderRadius.all(pw.Radius.circular(4)),
                  ),
                  padding: const pw.EdgeInsets.all(10),
                  child: pw.Row(
                    mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
                    children: [
                      pw.Column(
                        crossAxisAlignment: pw.CrossAxisAlignment.start,
                        children: [
                          pw.Text(
                            data.partyName.toUpperCase(),
                            style: pw.TextStyle(
                              fontWeight: pw.FontWeight.bold,
                              fontSize: 12,
                              color: const PdfColor.fromInt(0xFF0F172A),
                            ),
                          ),
                          pw.SizedBox(height: 3),
                          pw.Text(
                            'Account ID: ${data.partyId}',
                            style: const pw.TextStyle(color: PdfColor.fromInt(0xFF64748B), fontSize: 8.5),
                          ),
                          pw.Text(
                            'Station / City: ${data.city.isNotEmpty ? data.city : (data.state.isNotEmpty ? data.state : 'Punjab')}',
                            style: const pw.TextStyle(color: PdfColor.fromInt(0xFF64748B), fontSize: 8.5),
                          ),
                        ],
                      ),
                      pw.Column(
                        crossAxisAlignment: pw.CrossAxisAlignment.end,
                        children: [
                          pw.Text(
                            data.mobile.isNotEmpty ? 'Mobile: +91 ${data.mobile}' : 'Mobile: Unassigned',
                            style: pw.TextStyle(
                              fontWeight: pw.FontWeight.bold,
                              fontSize: 8.5,
                              color: data.mobile.isNotEmpty
                                  ? const PdfColor.fromInt(0xFF059669)
                                  : const PdfColor.fromInt(0xFFD97706),
                            ),
                          ),
                          pw.SizedBox(height: 3),
                          pw.Text(
                            'Period: Up to $todayStr',
                            style: const pw.TextStyle(color: PdfColor.fromInt(0xFF64748B), fontSize: 8.5),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                pw.SizedBox(height: 8),

                // 4 Financial Summary KPI Cards
                pw.Row(
                  children: [
                    _kpiCard('OPENING BALANCE', '${_formatRupees(data.openingBalance)} $openingDrCr', const PdfColor.fromInt(0xFF64748B)),
                    pw.SizedBox(width: 6),
                    _kpiCard('TOTAL DEBITS', _formatRupees(data.totalDebits), const PdfColor.fromInt(0xFF2563EB)),
                    pw.SizedBox(width: 6),
                    _kpiCard('TOTAL CREDITS', _formatRupees(data.totalCredits), const PdfColor.fromInt(0xFF10B981)),
                    pw.SizedBox(width: 6),
                    _kpiCard('CURRENT OUTSTANDING', '${_formatRupees(data.closingBalance)} $closingDrCr', const PdfColor.fromInt(0xFFE11D48)),
                  ],
                ),
                pw.SizedBox(height: 8),

                // Aging analysis row
                pw.Container(
                  decoration: pw.BoxDecoration(
                    color: const PdfColor.fromInt(0xFFF1F5F9),
                    borderRadius: const pw.BorderRadius.all(pw.Radius.circular(3)),
                  ),
                  padding: const pw.EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                  child: pw.Row(
                    mainAxisAlignment: pw.MainAxisAlignment.spaceAround,
                    children: [
                      pw.Text('0-30 Days: ${_formatRupees(data.bucket0_30)}', style: const pw.TextStyle(fontSize: 7.5, color: PdfColor.fromInt(0xFF334155))),
                      pw.Text('31-60 Days: ${_formatRupees(data.bucket31_60)}', style: const pw.TextStyle(fontSize: 7.5, color: PdfColor.fromInt(0xFF334155))),
                      pw.Text('61-90 Days: ${_formatRupees(data.bucket61_90)}', style: const pw.TextStyle(fontSize: 7.5, color: PdfColor.fromInt(0xFF334155))),
                      pw.Text('90+ Days: ${_formatRupees(data.bucket90Plus)}', style: pw.TextStyle(fontSize: 7.5, fontWeight: pw.FontWeight.bold, color: const PdfColor.fromInt(0xFFE11D48))),
                    ],
                  ),
                ),
                pw.SizedBox(height: 10),
              ],
            ],
          );
        },
        footer: (context) {
          return pw.Container(
            padding: const pw.EdgeInsets.only(top: 8),
            decoration: const pw.BoxDecoration(
              border: pw.Border(top: pw.BorderSide(color: PdfColor.fromInt(0xFFE2E8F0))),
            ),
            child: pw.Row(
              mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
              children: [
                pw.Text(
                  'Dura Smart Doors & Windows · Computer-Generated Official Statement',
                  style: const pw.TextStyle(fontSize: 7.5, color: PdfColor.fromInt(0xFF94A3B8)),
                ),
                pw.Text(
                  'Page ${context.pageNumber} of ${context.pagesCount}',
                  style: const pw.TextStyle(fontSize: 7.5, color: PdfColor.fromInt(0xFF94A3B8)),
                ),
              ],
            ),
          );
        },
        build: (context) => [
          pw.TableHelper.fromTextArray(
            headers: const ['Date', 'Type', 'Vch No', 'Particulars (Account)', 'Debit (+)', 'Credit (-)', 'Balance'],
            data: tableData,
            border: pw.TableBorder.all(color: const PdfColor.fromInt(0xFFE2E8F0), width: 0.5),
            headerStyle: pw.TextStyle(
              color: PdfColors.white,
              fontWeight: pw.FontWeight.bold,
              fontSize: 7.5,
            ),
            headerDecoration: const pw.BoxDecoration(
              color: PdfColor.fromInt(0xFF1E293B), // slate-800
            ),
            rowDecoration: const pw.BoxDecoration(
              color: PdfColors.white,
            ),
            cellAlignment: pw.Alignment.centerLeft,
            cellAlignments: {
              0: pw.Alignment.centerLeft,
              1: pw.Alignment.centerLeft,
              2: pw.Alignment.centerLeft,
              3: pw.Alignment.centerLeft,
              4: pw.Alignment.centerRight,
              5: pw.Alignment.centerRight,
              6: pw.Alignment.centerRight,
            },
            cellStyle: const pw.TextStyle(
              fontSize: 7,
              color: PdfColor.fromInt(0xFF1E293B),
            ),
            cellPadding: const pw.EdgeInsets.symmetric(horizontal: 4, vertical: 3),
          ),
        ],
      ),
    );

    return pdf.save();
  }

  static pw.Widget _kpiCard(String label, String value, PdfColor color) {
    return pw.Expanded(
      child: pw.Container(
        decoration: pw.BoxDecoration(
          color: const PdfColor.fromInt(0xFFF8FAFC),
          border: pw.Border.all(color: const PdfColor.fromInt(0xFFE2E8F0)),
          borderRadius: const pw.BorderRadius.all(pw.Radius.circular(3)),
        ),
        padding: const pw.EdgeInsets.all(5),
        child: pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            pw.Text(
              label,
              style: pw.TextStyle(fontSize: 6, fontWeight: pw.FontWeight.bold, color: color),
            ),
            pw.SizedBox(height: 2),
            pw.Text(
              value,
              style: pw.TextStyle(fontSize: 7.5, fontWeight: pw.FontWeight.bold, color: const PdfColor.fromInt(0xFF0F172A)),
            ),
          ],
        ),
      ),
    );
  }

  /// Downloads or saves statement PDF to device Downloads/Documents, and presents Print / Share sheet
  static Future<File> saveStatementPdfLocally(StatementPdfData data) async {
    final bytes = await generatePdfBytes(data);
    final safeName = data.partyName.replaceAll(RegExp(r'[^a-zA-Z0-9_-]'), '_');
    final filename = 'Statement_$safeName.pdf';

    Directory dir;
    if (Platform.isAndroid) {
      final ext = await getExternalStorageDirectory();
      dir = ext ?? await getApplicationDocumentsDirectory();
    } else {
      dir = await getApplicationDocumentsDirectory();
    }

    final file = File('${dir.path}/$filename');
    await file.writeAsBytes(bytes, flush: true);
    return file;
  }

  /// Direct print layout dialog
  static Future<void> printStatementPdf(StatementPdfData data) async {
    final safeName = data.partyName.replaceAll(RegExp(r'[^a-zA-Z0-9_-]'), '_');
    await Printing.layoutPdf(
      name: 'Statement_$safeName',
      onLayout: (format) async => generatePdfBytes(data),
    );
  }

  /// Share statement PDF via ShareSheet / WhatsApp
  static Future<void> shareStatementPdf(StatementPdfData data, {String? text}) async {
    final file = await saveStatementPdfLocally(data);
    await Share.shareXFiles(
      [XFile(file.path, mimeType: 'application/pdf', name: file.uri.pathSegments.last)],
      text: text,
      subject: 'Statement of Account - ${data.partyName}',
    );
  }
}
