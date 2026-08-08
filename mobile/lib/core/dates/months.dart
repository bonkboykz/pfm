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

/// "2026-08" → "август 2026". Именительный падеж: `LLLL` в русском даёт
/// самостоятельную форму месяца. Годится там, где месяц стоит сам по себе
/// или после предлога с винительным («на август 2026»).
String formatMonthInline(String month) =>
    DateFormat('LLLL yyyy', 'ru').format(_monthDate(month));

/// "2026-08" → "августа 2026". Родительный падеж: `MMMM` в русском — та самая
/// форма, что и в «28 августа». Нужен после «из», «до», «с».
String formatMonthGenitive(String month) =>
    DateFormat('MMMM yyyy', 'ru').format(_monthDate(month));

/// "2026-02-28" → "28 февраля" (year appended when it is not the current one)
String formatDayLabel(String date) {
  final parsed = DateTime.tryParse(date);
  if (parsed == null) return date;
  final pattern = parsed.year == DateTime.now().year ? 'd MMMM' : 'd MMMM yyyy';
  return DateFormat(pattern, 'ru').format(parsed);
}
