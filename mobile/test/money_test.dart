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
