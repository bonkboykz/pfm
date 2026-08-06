import 'package:flutter_test/flutter_test.dart';
import 'package:pfm_mobile/core/text/plural.dart';

/// Русское склонение по числу: форма зависит от последней цифры, кроме
/// «подросткового» диапазона 11–14, который всегда берёт форму множества.
void main() {
  group('plural', () {
    String rules(int n) => plural(n, 'правило', 'правила', 'правил');

    test('единственное число на 1, кроме 11', () {
      expect(rules(1), 'правило');
      expect(rules(21), 'правило');
      expect(rules(101), 'правило');
      expect(rules(11), 'правил');
    });

    test('форма «правила» на 2–4, кроме 12–14', () {
      expect(rules(2), 'правила');
      expect(rules(3), 'правила');
      expect(rules(4), 'правила');
      expect(rules(22), 'правила');
      expect(rules(12), 'правил');
      expect(rules(13), 'правил');
      expect(rules(14), 'правил');
    });

    test('форма «правил» на 0, 5–20 и на 25', () {
      expect(rules(0), 'правил');
      expect(rules(5), 'правил');
      expect(rules(9), 'правил');
      expect(rules(20), 'правил');
      expect(rules(25), 'правил');
      expect(rules(111), 'правил');
    });

    test('работает с любым набором форм', () {
      expect(plural(1, 'операция', 'операции', 'операций'), 'операция');
      expect(plural(3, 'операция', 'операции', 'операций'), 'операции');
      expect(plural(7, 'операция', 'операции', 'операций'), 'операций');
    });
  });
}
