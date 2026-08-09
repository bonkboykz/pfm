import 'package:flutter_test/flutter_test.dart';
import 'package:pfm_mobile/core/money/money.dart';

/// The client formatter must agree byte-for-byte with the engine's
/// `formatMoney` (packages/engine/src/math/money.ts) — the two are mixed in the
/// same screens, so any drift shows up as inconsistent spacing or symbols.
void main() {
  group('formatMoney', () {
    test('groups thousands and suffixes KZT', () {
      expect(formatMoney(0), '0 ₸');
      expect(formatMoney(52800), '528 ₸');
      expect(formatMoney(2610600), '26 106 ₸');
      expect(formatMoney(100966200), '1 009 662 ₸');
    });

    test('truncates toward zero instead of rounding', () {
      expect(formatMoney(199), '1 ₸');
      expect(formatMoney(-199), '-1 ₸');
    });

    test('places prefix currencies before the digits', () {
      expect(formatMoney(31100, currency: 'CNY'), '¥311');
      expect(formatMoney(-31100, currency: 'CNY'), '-¥311');
      expect(formatMoney(123456, currency: 'USD'), r'$1 234');
    });

    test('falls back to the ISO code for unknown currencies', () {
      expect(formatMoney(123456, currency: 'XXX'), '1 234 XXX');
    });
  });

  group('formatMoneySmart', () {
    test('keeps sub-unit amounts visible instead of collapsing to zero', () {
      // Real case: "📱 Связь/интернет" was overspent by 93 tiyn, which the
      // engine renders as "0 ₸" while still flagging isOverspent.
      expect(formatMoney(-93), '0 ₸');
      expect(formatMoneySmart(-93), '-0,93 ₸');
      expect(formatMoneySmart(7), '0,07 ₸');
    });

    test('показывает тиыны у любой суммы, где они есть', () {
      // Раньше дробная часть выживала только у сумм меньше тенге, и
      // «192 034,65 ₸» на экране превращалось в «192 034 ₸».
      expect(formatMoneySmart(19203465), '192 034,65 ₸');
      expect(formatMoneySmart(-123456), '-1 234,56 ₸');
      expect(formatMoneySmart(1031507), '10 315,07 ₸');
    });

    test('круглые суммы остаются без запятой', () {
      expect(formatMoneySmart(0), '0 ₸');
      expect(formatMoneySmart(100), '1 ₸');
      expect(formatMoneySmart(2500000), '25 000 ₸');
      expect(formatMoneySmart(-2000000), '-20 000 ₸');
    });

    test('дробная часть не теряет ведущий ноль', () {
      expect(formatMoneySmart(100005), '1 000,05 ₸');
      expect(formatMoneySmart(-100005), '-1 000,05 ₸');
    });

    test('работает с другими валютами', () {
      expect(formatMoneySmart(-50, currency: 'CNY'), '-¥0,50');
      expect(formatMoneySmart(123456, currency: 'USD'), r'$1 234,56');
      expect(formatMoneySmart(123400, currency: 'USD'), r'$1 234');
    });

    test('итог не расходится со слагаемыми на экране', () {
      // Класс ошибки, из-за которого сумма платежей по кредитам сходилась
      // то в 192 034 ₸, то в 192 035 ₸: усечённые строки не складываются.
      // С видимыми тиынами читатель может сложить их сам и получить то же.
      const parts = [3115400, 6523500, 13664865, 2547800, 1890200, 1461700];
      final total = parts.reduce((a, b) => a + b);

      expect(parts.map(formatMoneySmart).toList(), [
        '31 154 ₸',
        '65 235 ₸',
        '136 648,65 ₸',
        '25 478 ₸',
        '18 902 ₸',
        '14 617 ₸',
      ]);
      expect(formatMoneySmart(total), '292 034,65 ₸');
    });
  });

  group('formatMoneyInput', () {
    test('keeps kopecks so prefilling a field cannot silently drop them', () {
      // "📱 Связь/интернет" really is assigned 1031507 cents; a truncated
      // prefill would rewrite it to 10 315,00 on the next save.
      expect(formatMoneyInput(1031507), '10 315,07');
      expect(parseMoneyToCents(formatMoneyInput(1031507)), 1031507);
      expect(formatMoneyInput(93), '0,93');
      expect(parseMoneyToCents(formatMoneyInput(93)), 93);
    });

    test('drops the fraction when there is none', () {
      expect(formatMoneyInput(0), '0');
      expect(formatMoneyInput(1250000), '12 500');
      expect(formatMoneyInput(-120075), '-1 200,75');
    });
  });

  group('parseMoneyToCents', () {
    test('accepts grouped and decimal input', () {
      expect(parseMoneyToCents('12 500'), 1250000);
      expect(parseMoneyToCents('12500,50'), 1250050);
      expect(parseMoneyToCents('-1 200.75'), -120075);
      expect(parseMoneyToCents('0'), 0);
    });

    test('pads a single decimal digit', () {
      expect(parseMoneyToCents('5,5'), 550);
    });

    test('rejects input without digits', () {
      expect(parseMoneyToCents(''), isNull);
      expect(parseMoneyToCents('abc'), isNull);
      expect(parseMoneyToCents('-'), isNull);
    });
  });
}
