import 'package:flutter_test/flutter_test.dart';
import 'package:pfm_mobile/features/payoff/data/payoff_models.dart';

/// Сервер отдаёт помесячный график в `schedule`, но раньше клиент его выбрасывал.
/// График «как тает долг» и даты закрытия кредитов держатся именно на нём.
Map<String, dynamic> _response() => {
      'strategy': 'avalanche',
      'strategyDescription': 'Highest interest rate first.',
      'monthsToPayoff': 3,
      'debtFreeDate': '2026-11',
      'totalPaidCents': 100000,
      'totalInterestCents': 5000,
      'payoffOrder': ['forte', 'kaspi'],
      'schedule': [
        {
          'month': 1,
          'date': '2026-09',
          'totalRemainingCents': 500000,
          'debtStates': [
            {'debtId': 'forte', 'isPaidOff': false},
            {'debtId': 'kaspi', 'isPaidOff': false},
          ],
        },
        {
          'month': 2,
          'date': '2026-10',
          'totalRemainingCents': 200000,
          'debtStates': [
            {'debtId': 'forte', 'isPaidOff': true},
            {'debtId': 'kaspi', 'isPaidOff': false},
          ],
        },
        {
          'month': 3,
          'date': '2026-11',
          'totalRemainingCents': 0,
          'debtStates': [
            {'debtId': 'kaspi', 'isPaidOff': true},
          ],
        },
      ],
    };

void main() {
  group('StrategyResult.schedule', () {
    test('разбирает помесячный остаток долга', () {
      final result = StrategyResult.fromJson(_response());

      expect(result.schedule.length, 3);
      expect(result.schedule.first.date, '2026-09');
      expect(result.schedule.first.totalRemainingCents, 500000);
      expect(result.schedule.last.totalRemainingCents, 0);
    });

    test('месяц закрытия — первый, где долг помечен погашенным', () {
      final result = StrategyResult.fromJson(_response());

      expect(result.payoffMonths['forte'], '2026-10');
      expect(result.payoffMonths['kaspi'], '2026-11');
    });

    test('ответ без schedule не роняет разбор', () {
      final json = _response()..remove('schedule');

      final result = StrategyResult.fromJson(json);

      expect(result.schedule, isEmpty);
      expect(result.payoffMonths, isEmpty);
      expect(result.monthsToPayoff, 3);
    });
  });
}
