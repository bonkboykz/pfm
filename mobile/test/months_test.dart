import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:pfm_mobile/core/dates/months.dart';

/// В русском у месяца две формы, и intl отдаёт их разными паттернами:
/// `LLLL` — именительный, `MMMM` — родительный. Диалог «Как в прошлом» писал
/// «из июль 2026», пока брал не ту.
void main() {
  setUpAll(() => initializeDateFormatting('ru'));

  test('formatMonthInline даёт именительный падеж', () {
    expect(formatMonthInline('2026-07'), 'июль 2026');
    expect(formatMonthInline('2026-08'), 'август 2026');
  });

  test('formatMonthGenitive даёт родительный — тот, что нужен после «из»', () {
    expect(formatMonthGenitive('2026-07'), 'июля 2026');
    expect(formatMonthGenitive('2026-08'), 'августа 2026');
    expect(formatMonthGenitive('2026-03'), 'марта 2026');
  });

  test('shiftMonth переходит через границу года', () {
    expect(shiftMonth('2026-01', -1), '2025-12');
    expect(shiftMonth('2026-12', 1), '2027-01');
  });
}
