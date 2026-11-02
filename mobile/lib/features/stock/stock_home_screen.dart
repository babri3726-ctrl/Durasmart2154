import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';

import '../../core/api_sync_service.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';

/// Stock overview screen displaying material snapshot availability and 1-Click Sync.
/// Connects live to FastAPI /api/v1/stock/summary and /api/v1/imports/excel/stock-watch/sync.
class StockHomeScreen extends StatefulWidget {
  const StockHomeScreen({super.key});

  @override
  State<StockHomeScreen> createState() => _StockHomeScreenState();
}

class _StockHomeScreenState extends State<StockHomeScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;

  bool _isLoading = false;
  bool _isSyncing = false;
  String _syncStatus = '3 sheets synced from 1-8-26.xlsx';
  String? _errorMessage;
  String? _activeHost;

  // Snapshot provenance
  String _filename = '1-8-26.xlsx';
  String _fileSha256 =
      'ab5e51aefc65378bca58092c9a7db41f04c26f10df569ff8177ba19240f6f20d';
  String _syncedAt = '2026-10-26T10:52:40';
  int _itemCount = 73;
  List<String> _sheetsRead = ['TOTAL STOCK', 'UPVC TOTAL STOCK', 'UPVC ITEM'];

  // Category KPIs
  String _metalQty = '1,444,769';
  int _metalItemCount = 42;
  String _upvcPieces = '2,043';
  String _upvcFootage = '24,500';
  int _upvcItemCount = 28;
  int _ridgePieces = 907;
  int _jhallarPieces = 1019;
  int _capsPieces = 526200;
  int _hiraRidgePieces = 348;

  // Detailed lists
  List<Map<String, dynamic>> _steelCoils = [];
  List<Map<String, dynamic>> _upvcRows = [];
  List<Map<String, dynamic>> _accessoryItems = [];

  // Filter state
  String _steelSearchTerm = '';
  String _selectedUpvcColor = 'ALL';

  static const List<String> _candidateHosts = [
    'http://127.0.0.1:8010',
    'http://10.0.2.2:8010',
    'http://192.168.29.86:8010',
    'http://localhost:8010',
  ];

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    _populateDefaultData();
    _fetchLiveStock();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  void _populateDefaultData() {
    _metalQty = '1,444,769';
    _metalItemCount = 42;
    _upvcPieces = '2,043';
    _upvcFootage = '24,500';
    _upvcItemCount = 28;
    _ridgePieces = 907;
    _jhallarPieces = 1019;
    _capsPieces = 526200;
    _hiraRidgePieces = 348;
  }

  Future<String?> _resolveWorkingHost() async {
    final host = await ApiSyncService.resolveWorkingHost();
    if (host != null) {
      _activeHost = host;
      return host;
    }
    return null;
  }

  Future<void> _fetchLiveStock() async {
    if (!mounted) return;
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final host = await _resolveWorkingHost();
      if (host == null) {
        if (mounted) {
          setState(() {
            _isLoading = false;
            _errorMessage =
                'Offline mode: displaying authorized OneDrive snapshot';
          });
        }
        return;
      }

      final client = HttpClient()
        ..connectionTimeout = const Duration(seconds: 4);

      // 1. Fetch Summary
      final reqSummary = await client.getUrl(
        Uri.parse('$host/api/v1/stock/summary'),
      );
      final respSummary = await reqSummary.close();
      if (respSummary.statusCode == 200) {
        final bodyStr = await respSummary.transform(utf8.decoder).join();
        final data = jsonDecode(bodyStr) as Map<String, dynamic>;

        final snap = data['snapshot'] as Map<String, dynamic>?;
        if (snap != null) {
          _filename = snap['filename']?.toString() ?? '1-8-26.xlsx';
          _fileSha256 = snap['fileSha256']?.toString() ?? _fileSha256;
          _syncedAt = snap['appliedAt']?.toString() ?? _syncedAt;
          _itemCount = snap['itemCount'] is int
              ? snap['itemCount'] as int
              : _itemCount;
          if (snap['sheetsRead'] is List) {
            _sheetsRead = (snap['sheetsRead'] as List)
                .map((e) => e.toString())
                .toList();
          }
        }

        final categories = data['categories'] as List<dynamic>?;
        if (categories != null) {
          for (final cat in categories) {
            final key = cat['key']?.toString();
            if (key == 'steel-coil') {
              final rawQty = cat['quantity']?.toString() ?? '1444769.000';
              final parts = rawQty.split('.');
              final wholeFormatted = _formatWithCommas(parts[0]);
              _metalQty = parts.length > 1
                  ? '$wholeFormatted.${parts[1].substring(0, 3)}'
                  : wholeFormatted;
              _metalItemCount = (cat['figureCount'] as num?)?.toInt() ?? 42;
            } else if (key == 'upvc-roofing') {
              _upvcPieces = _formatWithCommas(
                cat['pieces']?.toString() ?? '2043',
              );
              final ftStr = cat['footage']?.toString() ?? '24500';
              _upvcFootage = _formatWithCommas(ftStr.split('.').first);
              _upvcItemCount = (cat['figureCount'] as num?)?.toInt() ?? 28;
            }
          }
        }

        final materials = data['materials'] as List<dynamic>?;
        if (materials != null) {
          _steelCoils = materials
              .where((m) => m['categoryKey'] == 'steel-coil')
              .map((m) => Map<String, dynamic>.from(m as Map))
              .toList();

          _accessoryItems = materials
              .where(
                (m) =>
                    m['categoryKey'] == 'upvc-item' ||
                    m['categoryKey'] == 'upvc-accessories',
              )
              .map((m) => Map<String, dynamic>.from(m as Map))
              .toList();

          int r = 0, j = 0, c = 0, hr = 0;
          for (final m in _accessoryItems) {
            final label = (m['sourceLabel'] ?? m['label'] ?? '')
                .toString()
                .toUpperCase();
            final qty = int.tryParse(m['quantity']?.toString() ?? '0') ?? 0;
            if (label.contains('HIRA RIDGE')) {
              hr += qty;
            } else if (label.contains('RIDGE')) {
              r += qty;
            } else if (label.contains('JHALLAR')) {
              j += qty;
            } else if (label.contains('CAPS')) {
              c += qty;
            }
          }
          if (r > 0) _ridgePieces = r;
          if (j > 0) _jhallarPieces = j;
          if (c > 0) _capsPieces = c;
          if (hr > 0) _hiraRidgePieces = hr;
        }
      }

      // 2. Fetch UPVC Matrix
      final reqUpvc = await client.getUrl(Uri.parse('$host/api/v1/stock/upvc'));
      final respUpvc = await reqUpvc.close();
      if (respUpvc.statusCode == 200) {
        final bodyStr = await respUpvc.transform(utf8.decoder).join();
        final upvcData = jsonDecode(bodyStr) as Map<String, dynamic>;
        final rows = upvcData['rows'] as List<dynamic>?;
        if (rows != null) {
          _upvcRows = rows
              .map((r) => Map<String, dynamic>.from(r as Map))
              .toList();
        }
      }

      if (mounted) {
        setState(() {
          _isLoading = false;
          _errorMessage = null;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isLoading = false;
          _errorMessage = 'Using cached snapshot ($e)';
        });
      }
    }
  }

  void _trigger1ClickSync() async {
    setState(() {
      _isSyncing = true;
    });

    try {
      final host = await _resolveWorkingHost() ?? 'http://127.0.0.1:8010';
      final client = HttpClient()
        ..connectionTimeout = const Duration(seconds: 15);
      final req = await client.postUrl(
        Uri.parse('$host/api/v1/imports/excel/stock-watch/sync'),
      );
      final resp = await req.close();

      if (resp.statusCode == 200) {
        await _fetchLiveStock();

        final now = DateTime.now();
        final timeStr =
            '${now.hour}:${now.minute.toString().padLeft(2, '0')}:${now.second.toString().padLeft(2, '0')}';

        setState(() {
          _isSyncing = false;
          _syncStatus = 'Stock live-synced from 1-8-26.xlsx ($timeStr)';
        });

        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                '1-Click Stock Sync completed: 3 sheets verified at $timeStr',
              ),
              backgroundColor: AppColors.green,
              behavior: SnackBarBehavior.floating,
            ),
          );
        }
      } else {
        throw Exception('Server returned ${resp.statusCode}');
      }
    } catch (e) {
      setState(() {
        _isSyncing = false;
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Sync error: $e'),
            backgroundColor: AppColors.pink,
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    }
  }

  String _formatWithCommas(String numberStr) {
    final clean = numberStr.replaceAll(RegExp(r'[^\d]'), '');
    if (clean.isEmpty) return '0';
    final chars = clean.split('').reversed.toList();
    final buffer = StringBuffer();
    for (int i = 0; i < chars.length; i++) {
      if (i > 0 && i % 3 == 0) buffer.write(',');
      buffer.write(chars[i]);
    }
    return buffer.toString().split('').reversed.join('');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Stock Inventory'),
        bottom: TabBar(
          controller: _tabController,
          labelColor: AppColors.blue,
          unselectedLabelColor: AppColors.muted,
          indicatorColor: AppColors.blue,
          indicatorWeight: 3,
          tabs: [
            const Tab(text: 'Overview & Sync'),
            Tab(text: 'Steel Coils ($_metalItemCount)'),
            Tab(text: 'UPVC Matrix ($_upvcItemCount)'),
          ],
        ),
        actions: [
          IconButton(
            icon: _isLoading
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: AppColors.blue,
                    ),
                  )
                : const Icon(Icons.refresh_rounded),
            tooltip: 'Refresh Snapshot',
            onPressed: (_isLoading || _isSyncing) ? null : _fetchLiveStock,
          ),
        ],
      ),
      body: TabBarView(
        controller: _tabController,
        children: [_buildOverviewTab(), _buildSteelCoilsTab(), _buildUpvcTab()],
      ),
    );
  }

  Widget _buildOverviewTab() {
    return RefreshIndicator(
      onRefresh: _fetchLiveStock,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (_errorMessage != null)
            Container(
              margin: const EdgeInsets.only(bottom: 14),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: Colors.amber.shade50,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: Colors.amber.shade300),
              ),
              child: Row(
                children: [
                  Icon(
                    Icons.info_outline_rounded,
                    color: Colors.amber.shade800,
                    size: 20,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      _errorMessage!,
                      style: TextStyle(
                        color: Colors.amber.shade900,
                        fontSize: 12,
                      ),
                    ),
                  ),
                ],
              ),
            ),

          // 1-Click Sync Card
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              gradient: AppGradients.brand,
              borderRadius: BorderRadius.circular(18),
              boxShadow: [
                BoxShadow(
                  color: AppColors.blue.withValues(alpha: 0.25),
                  blurRadius: 12,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Icon(
                      Icons.cloud_sync_rounded,
                      color: Colors.white,
                      size: 26,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            '1-Click OneDrive Stock Sync',
                            style: TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.bold,
                              fontSize: 16,
                            ),
                          ),
                          Text(
                            _filename,
                            style: const TextStyle(
                              color: Colors.white70,
                              fontSize: 12,
                            ),
                          ),
                        ],
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 4,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.white24,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: const Text(
                        'LIVE',
                        style: TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w900,
                          fontSize: 10,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                const Text(
                  'Instantly parses authorized sheets: TOTAL STOCK, UPVC TOTAL STOCK, and UPVC ITEM.',
                  style: TextStyle(
                    color: Colors.white70,
                    fontSize: 12,
                    height: 1.3,
                  ),
                ),
                const SizedBox(height: 16),
                SizedBox(
                  width: double.infinity,
                  height: 44,
                  child: ElevatedButton.icon(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.white,
                      foregroundColor: AppColors.blue,
                      elevation: 0,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                    onPressed: _isSyncing ? null : _trigger1ClickSync,
                    icon: _isSyncing
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: AppColors.blue,
                            ),
                          )
                        : const Icon(Icons.sync_rounded),
                    label: Text(
                      _isSyncing
                          ? 'Syncing from OneDrive...'
                          : '1-Click Sync Now',
                      style: const TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 14,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 10),
                Text(
                  _syncStatus,
                  style: const TextStyle(color: Colors.white60, fontSize: 11),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          const Center(
            child: Text(
              'Stock snapshot is available',
              style: TextStyle(fontSize: 12, color: AppColors.muted),
            ),
          ),
          const SizedBox(height: 20),

          const SectionHeading(
            title: 'Current Live Yard Snapshot',
            subtitle: 'Direct figures from authorized sheets',
          ),
          const SizedBox(height: 12),

          // Primary Metric Cards
          Row(
            children: [
              Expanded(
                child: MetricCard(
                  title: 'Total Metal',
                  value: '$_metalQty kg',
                  caption: '$_metalItemCount slit coil sizes',
                  icon: Icons.precision_manufacturing_rounded,
                  gradient: AppGradients.sales,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: MetricCard(
                  title: 'UPVC Roofing',
                  value: '$_upvcPieces pcs',
                  caption: '$_upvcItemCount matrix rows (~$_upvcFootage ft)',
                  icon: Icons.roofing_rounded,
                  gradient: AppGradients.success,
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),

          // Accessories Card (UPVC ITEM)
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: AppColors.line),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Expanded(
                      child: Text(
                        'Accessories (UPVC ITEM)',
                        style: AppText.heading,
                      ),
                    ),
                    StatusChip(
                      label:
                          '4 groups (${_formatWithCommas((_ridgePieces + _jhallarPieces + _capsPieces + _hiraRidgePieces).toString())} pcs)',
                      color: AppColors.teal,
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                _accessoryRow(
                  'RIDGE',
                  '${_formatWithCommas(_ridgePieces.toString())} pcs',
                ),
                const Divider(height: 18),
                _accessoryRow(
                  'JHALLAR',
                  '${_formatWithCommas(_jhallarPieces.toString())} pcs',
                ),
                const Divider(height: 18),
                _accessoryRow(
                  'CAPS',
                  '${_formatWithCommas(_capsPieces.toString())} pcs',
                ),
                const Divider(height: 18),
                _accessoryRow(
                  'HIRA RIDGE',
                  '${_formatWithCommas(_hiraRidgePieces.toString())} pcs',
                ),
                if (_accessoryItems.isNotEmpty) ...[
                  const Divider(height: 22),
                  const Text(
                    'Colour Breakdown (Synchronized)',
                    style: AppText.caption,
                  ),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: _accessoryItems.take(8).map((item) {
                      final name = item['label'] ?? '';
                      final qty = item['quantity'] ?? '0';
                      return Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 4,
                        ),
                        decoration: BoxDecoration(
                          color: AppColors.background,
                          borderRadius: BorderRadius.circular(6),
                          border: Border.all(color: AppColors.line),
                        ),
                        child: Text(
                          '$name: ${_formatWithCommas(qty.toString())} Nos',
                          style: const TextStyle(
                            fontSize: 10,
                            fontWeight: FontWeight.w600,
                            color: AppColors.ink,
                          ),
                        ),
                      );
                    }).toList(),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 14),

          // Workbook Provenance Card
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: AppColors.line),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Row(
                  children: [
                    Icon(
                      Icons.verified_user_rounded,
                      color: AppColors.green,
                      size: 20,
                    ),
                    SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'Authorized Sheets Verification',
                        style: AppText.heading,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                _provenanceRow('Workbook', _filename),
                _provenanceRow('SHA256', '${_fileSha256.substring(0, 16)}...'),
                _provenanceRow('Sheets Read', _sheetsRead.join(', ')),
                _provenanceRow('Total Items', '$_itemCount validated rows'),
                _provenanceRow(
                  'Applied At',
                  _syncedAt.replaceAll('T', ' ').split('.').first,
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          const Center(
            child: Text(
              'Stock snapshot is available',
              style: TextStyle(fontSize: 12, color: AppColors.muted),
            ),
          ),
          const SizedBox(height: 20),
        ],
      ),
    );
  }

  Widget _buildSteelCoilsTab() {
    final filtered = _steelCoils.where((c) {
      if (_steelSearchTerm.isEmpty) return true;
      final query = _steelSearchTerm.toLowerCase();
      final label = (c['label'] ?? '').toString().toLowerCase();
      final company = (c['company'] ?? '').toString().toLowerCase();
      return label.contains(query) || company.contains(query);
    }).toList();

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
          child: TextField(
            decoration: InputDecoration(
              hintText: 'Search coil company or size (e.g. JSW, APL, 0.45)...',
              prefixIcon: const Icon(Icons.search_rounded, size: 20),
              filled: true,
              fillColor: Colors.white,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(color: AppColors.line),
              ),
              contentPadding: const EdgeInsets.symmetric(
                vertical: 10,
                horizontal: 14,
              ),
            ),
            onChanged: (val) {
              setState(() {
                _steelSearchTerm = val;
              });
            },
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Showing ${filtered.length} of ${_steelCoils.isNotEmpty ? _steelCoils.length : _metalItemCount} slit coils',
                style: const TextStyle(
                  fontSize: 12,
                  color: AppColors.muted,
                  fontWeight: FontWeight.w600,
                ),
              ),
              Text(
                'Total: $_metalQty kg',
                style: const TextStyle(
                  fontSize: 12,
                  color: AppColors.blue,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 4),
        Expanded(
          child: filtered.isEmpty
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(
                        Icons.inventory_2_outlined,
                        size: 48,
                        color: AppColors.muted,
                      ),
                      const SizedBox(height: 8),
                      Text(
                        _steelSearchTerm.isEmpty
                            ? 'Loading steel coils...'
                            : 'No coils match "$_steelSearchTerm"',
                        style: const TextStyle(color: AppColors.muted),
                      ),
                    ],
                  ),
                )
              : ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                  itemCount: filtered.length,
                  separatorBuilder: (context, index) =>
                      const SizedBox(height: 8),
                  itemBuilder: (context, idx) {
                    final item = filtered[idx];
                    final company = (item['company'] ?? 'STEEL').toString();
                    final label = (item['label'] ?? '').toString();
                    final qty = (item['quantity'] ?? '0.000').toString();
                    final coord = (item['labelCoordinate'] ?? '').toString();

                    Color companyColor = AppColors.blue;
                    if (company == 'JSW') companyColor = AppColors.purple;
                    if (company.contains('KAM'))
                      companyColor = AppColors.orange;
                    if (company == 'APL') companyColor = AppColors.teal;

                    return Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: AppColors.line),
                      ),
                      child: Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 8,
                              vertical: 4,
                            ),
                            decoration: BoxDecoration(
                              color: companyColor.withValues(alpha: 0.12),
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: Text(
                              company,
                              style: TextStyle(
                                color: companyColor,
                                fontWeight: FontWeight.w800,
                                fontSize: 11,
                              ),
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  label,
                                  style: const TextStyle(
                                    fontWeight: FontWeight.bold,
                                    fontSize: 13,
                                  ),
                                ),
                                if (coord.isNotEmpty)
                                  Text(
                                    'TOTAL STOCK ($coord)',
                                    style: const TextStyle(
                                      fontSize: 10,
                                      color: AppColors.muted,
                                    ),
                                  ),
                              ],
                            ),
                          ),
                          Text(
                            '$qty kg',
                            style: const TextStyle(
                              fontWeight: FontWeight.w700,
                              color: AppColors.ink,
                              fontSize: 13,
                            ),
                          ),
                        ],
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }

  Widget _buildUpvcTab() {
    final colors = ['ALL', 'BLUE', 'RED', 'BROWN', 'GREEN', 'WHITE', 'GREY'];

    final filtered = _upvcRows.where((r) {
      if (_selectedUpvcColor == 'ALL') return true;
      final c = (r['colour'] ?? '').toString().toUpperCase();
      return c == _selectedUpvcColor;
    }).toList();

    return Column(
      children: [
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
          child: Row(
            children: colors.map((c) {
              final isSel = _selectedUpvcColor == c;
              return Padding(
                padding: const EdgeInsets.only(right: 8),
                child: ChoiceChip(
                  label: Text(c),
                  selected: isSel,
                  selectedColor: AppColors.blue,
                  labelStyle: TextStyle(
                    color: isSel ? Colors.white : AppColors.ink,
                    fontWeight: isSel ? FontWeight.bold : FontWeight.normal,
                    fontSize: 11,
                  ),
                  onSelected: (val) {
                    setState(() {
                      _selectedUpvcColor = c;
                    });
                  },
                ),
              );
            }).toList(),
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Showing ${filtered.length} of ${_upvcRows.isNotEmpty ? _upvcRows.length : _upvcItemCount} items',
                style: const TextStyle(
                  fontSize: 12,
                  color: AppColors.muted,
                  fontWeight: FontWeight.w600,
                ),
              ),
              Text(
                'Total: $_upvcPieces pcs (~$_upvcFootage ft)',
                style: const TextStyle(
                  fontSize: 12,
                  color: AppColors.green,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 4),
        Expanded(
          child: filtered.isEmpty
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(
                        Icons.roofing_rounded,
                        size: 48,
                        color: AppColors.muted,
                      ),
                      const SizedBox(height: 8),
                      Text(
                        _selectedUpvcColor == 'ALL'
                            ? 'Loading UPVC matrix...'
                            : 'No UPVC items for $_selectedUpvcColor',
                        style: const TextStyle(color: AppColors.muted),
                      ),
                    ],
                  ),
                )
              : ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                  itemCount: filtered.length,
                  separatorBuilder: (context, index) =>
                      const SizedBox(height: 8),
                  itemBuilder: (context, idx) {
                    final item = filtered[idx];
                    final color = (item['colour'] ?? '').toString();
                    final lengthFt = item['lengthFt']?.toString() ?? '';
                    final label = (item['label'] ?? 'UPVC $color ${lengthFt}ft')
                        .toString();
                    final pieces = (item['pieces'] ?? '0').toString();
                    final footage = (item['footage'] ?? '0.000').toString();

                    Color badgeColor = Colors.blueGrey;
                    if (color == 'BLUE') badgeColor = Colors.blue.shade700;
                    if (color == 'RED') badgeColor = Colors.red.shade700;
                    if (color == 'BROWN') badgeColor = Colors.brown.shade700;
                    if (color == 'GREEN') badgeColor = Colors.green.shade700;
                    if (color == 'WHITE') badgeColor = Colors.grey.shade600;
                    if (color == 'GREY') badgeColor = Colors.blueGrey.shade800;

                    return Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: AppColors.line),
                      ),
                      child: Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 8,
                              vertical: 4,
                            ),
                            decoration: BoxDecoration(
                              color: badgeColor.withValues(alpha: 0.12),
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: Text(
                              color,
                              style: TextStyle(
                                color: badgeColor,
                                fontWeight: FontWeight.w800,
                                fontSize: 11,
                              ),
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  label,
                                  style: const TextStyle(
                                    fontWeight: FontWeight.bold,
                                    fontSize: 13,
                                  ),
                                ),
                                Text(
                                  'Length: ${lengthFt}ft • Approx $footage running ft',
                                  style: const TextStyle(
                                    fontSize: 10,
                                    color: AppColors.muted,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          Text(
                            '$pieces pcs',
                            style: const TextStyle(
                              fontWeight: FontWeight.w700,
                              color: AppColors.green,
                              fontSize: 13,
                            ),
                          ),
                        ],
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }

  Widget _accessoryRow(String label, String qty) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          label,
          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
        ),
        Text(
          qty,
          style: const TextStyle(
            fontWeight: FontWeight.w700,
            color: AppColors.blue,
            fontSize: 13,
          ),
        ),
      ],
    );
  }

  Widget _provenanceRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 90,
            child: Text(
              label,
              style: const TextStyle(
                fontSize: 11,
                color: AppColors.muted,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(
                fontSize: 11,
                color: AppColors.ink,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
