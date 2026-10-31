String rupees(num amount) => rupeesFrom(amount);

String rupeesFrom(num amount) {
  final rounded = amount.round();
  final negative = rounded < 0;
  final raw = rounded.abs().toString();
  String grouped;
  if (raw.length <= 3) {
    grouped = raw;
  } else {
    final lastThree = raw.substring(raw.length - 3);
    var prefix = raw.substring(0, raw.length - 3);
    final chunks = <String>[];
    while (prefix.length > 2) {
      chunks.insert(0, prefix.substring(prefix.length - 2));
      prefix = prefix.substring(0, prefix.length - 2);
    }
    if (prefix.isNotEmpty) chunks.insert(0, prefix);
    grouped = '${chunks.join(',')},$lastThree';
  }
  return '${negative ? '-₹' : '₹'}$grouped';
}

/// Compact Indian amount used on tight cards: ₹1.2L / ₹8.5k.
String rupeesShort(num amount) {
  final n = amount.abs();
  final negative = amount < 0;
  final sign = negative ? '-' : '';
  if (n >= 10000000) return '$sign₹${(n / 10000000).toStringAsFixed(2)}Cr';
  if (n >= 100000) return '$sign₹${(n / 100000).toStringAsFixed(2)}L';
  if (n >= 1000) return '$sign₹${(n / 1000).toStringAsFixed(1)}k';
  return '$sign₹${n.round()}';
}

String qtyLabel(double value, String unit) =>
    '${value % 1 == 0 ? value.toInt() : value.toStringAsFixed(2)} $unit';

const _months = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

String dateLabel(DateTime d) => '${d.day} ${_months[d.month - 1]} ${d.year}';

String dayMonthLabel(DateTime d) => '${d.day} ${_months[d.month - 1]}';

String monthLabel(DateTime d) => '${_months[d.month - 1]} ${d.year}';

String dateTimeLabel(DateTime d) =>
    '${dateLabel(d)} • ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';

String timeLabel(DateTime d) =>
    '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';

String relativeDay(DateTime d) {
  final now = DateTime.now();
  final today = DateTime(now.year, now.month, now.day);
  final that = DateTime(d.year, d.month, d.day);
  final diff = that.difference(today).inDays;
  if (diff == 0) return 'Today';
  if (diff == 1) return 'Tomorrow';
  if (diff == -1) return 'Yesterday';
  return dateLabel(d);
}

class Validation {
  Validation._();

  static String? required(String? v, {String field = 'This field'}) =>
      (v == null || v.trim().isEmpty) ? '$field is required' : null;

  static String? mobile(String? v) {
    if (v == null || v.trim().isEmpty) return 'Mobile number is required';
    final digits = v.replaceAll(RegExp(r'[^0-9]'), '');
    if (digits.length < 10 || digits.length > 12) {
      return 'Enter a valid mobile number (10–12 digits)';
    }
    return null;
  }

  static String? positiveAmount(String? v, {String field = 'Amount'}) {
    final n = double.tryParse((v ?? '').trim());
    if (n == null || n <= 0) return 'Enter a valid $field';
    return null;
  }

  static String? positiveQty(String? v, {String field = 'Quantity'}) {
    final n = double.tryParse((v ?? '').trim());
    if (n == null || n <= 0) return 'Enter a valid $field (greater than 0)';
    return null;
  }
}
