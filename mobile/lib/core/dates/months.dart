import 'package:intl/intl.dart';

/// Budget months are `YYYY-MM` strings everywhere in the API.

String currentMonth() => DateFormat('yyyy-MM').format(DateTime.now());

String shiftMonth(String month, int delta) {
  final parts = month.split('-');
  final year = int.parse(parts[0]);
  final m = int.parse(parts[1]);
  final shifted = DateTime(year, m + delta);
  return DateFormat('yyyy-MM').format(shifted);
}

DateTime _monthDate(String month) {
  final parts = month.split('-');
  return DateTime(int.parse(parts[0]), int.parse(parts[1]));
}

/// "2026-08" → "Август 2026"
String formatMonthLabel(String month) {
  final label = DateFormat('LLLL yyyy', 'ru').format(_monthDate(month));
  return label[0].toUpperCase() + label.substring(1);
}

/// "2026-08" → "августе 2026" (for use inside a sentence)
String formatMonthInline(String month) =>
    DateFormat('LLLL yyyy', 'ru').format(_monthDate(month));
