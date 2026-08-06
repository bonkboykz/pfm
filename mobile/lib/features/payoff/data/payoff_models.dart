/// Manual parsing of `POST /api/v1/simulate/compare`.
///
/// The route is stateless and never touches the database — the debts are sent
/// from the client, built out of the user's loans.
library;

/// Один месяц симуляции: сколько долга осталось к концу и кто закрылся.
class MonthSnapshot {
  final int month;
  final String date; // YYYY-MM
  final int totalRemainingCents;
  final List<String> paidOffIds;

  const MonthSnapshot({
    required this.month,
    required this.date,
    required this.totalRemainingCents,
    required this.paidOffIds,
  });

  factory MonthSnapshot.fromJson(Map<String, dynamic> json) => MonthSnapshot(
        month: (json['month'] as num?)?.toInt() ?? 0,
        date: (json['date'] ?? '').toString(),
        totalRemainingCents:
            (json['totalRemainingCents'] as num?)?.toInt() ?? 0,
        paidOffIds: ((json['debtStates'] as List?) ?? const [])
            .whereType<Map>()
            .where((d) => d['isPaidOff'] == true)
            .map((d) => (d['debtId'] ?? '').toString())
            .toList(),
      );
}

class StrategyResult {
  final String strategy;
  final String strategyDescription;
  final int monthsToPayoff;
  final String debtFreeDate;
  final int totalPaidCents;
  final int totalInterestCents;
  final List<String> payoffOrder;
  final List<MonthSnapshot> schedule;

  const StrategyResult({
    required this.strategy,
    required this.strategyDescription,
    required this.monthsToPayoff,
    required this.debtFreeDate,
    required this.totalPaidCents,
    required this.totalInterestCents,
    required this.payoffOrder,
    this.schedule = const [],
  });

  factory StrategyResult.fromJson(Map<String, dynamic> json) => StrategyResult(
        strategy: (json['strategy'] ?? '').toString(),
        strategyDescription: (json['strategyDescription'] ?? '').toString(),
        monthsToPayoff: (json['monthsToPayoff'] as num?)?.toInt() ?? 0,
        debtFreeDate: (json['debtFreeDate'] ?? '').toString(),
        totalPaidCents: (json['totalPaidCents'] as num?)?.toInt() ?? 0,
        totalInterestCents: (json['totalInterestCents'] as num?)?.toInt() ?? 0,
        payoffOrder: ((json['payoffOrder'] as List?) ?? const [])
            .map((e) => e.toString())
            .toList(),
        schedule: ((json['schedule'] as List?) ?? const [])
            .whereType<Map>()
            .map((m) => MonthSnapshot.fromJson(m.cast<String, dynamic>()))
            .toList(),
      );

  /// Долг → месяц, в котором он закрывается. Берётся первый месяц с флагом
  /// `isPaidOff`, потому что дальше долг из графика просто исчезает.
  Map<String, String> get payoffMonths {
    final months = <String, String>{};
    for (final snapshot in schedule) {
      for (final id in snapshot.paidOffIds) {
        months.putIfAbsent(id, () => snapshot.date);
      }
    }
    return months;
  }
}

const strategyNames = <String, String>{
  'snowball': 'Снежный ком',
  'avalanche': 'Лавина',
  'highest_monthly_interest': 'Дороже всего в месяц',
  'cash_flow_index': 'Индекс денежного потока',
};

const strategyHints = <String, String>{
  'snowball': 'Сначала мелкие долги — быстрые победы',
  'avalanche': 'Сначала самая высокая ставка — меньше переплата',
  'highest_monthly_interest': 'Сначала то, что дороже всего обходится в месяц',
  'cash_flow_index': 'Сначала то, что сильнее душит бюджет',
};

String strategyName(String key) => strategyNames[key] ?? key;
String strategyHint(String key) => strategyHints[key] ?? '';

class PayoffComparison {
  final List<StrategyResult> strategies;
  final String recommended;
  final int savingsVsWorstCents;

  const PayoffComparison({
    required this.strategies,
    required this.recommended,
    required this.savingsVsWorstCents,
  });

  factory PayoffComparison.fromJson(Map<String, dynamic> json) =>
      PayoffComparison(
        strategies: ((json['strategies'] as List?) ?? const [])
            .whereType<Map>()
            .map((s) => StrategyResult.fromJson(s.cast<String, dynamic>()))
            .toList(),
        recommended: (json['recommended'] ?? '').toString(),
        savingsVsWorstCents:
            (json['savingsVsWorstCents'] as num?)?.toInt() ?? 0,
      );

  StrategyResult? get best {
    for (final s in strategies) {
      if (s.strategy == recommended) return s;
    }
    return strategies.isEmpty ? null : strategies.first;
  }

  /// Strategies ordered cheapest-first by total interest.
  List<StrategyResult> get ranked {
    final sorted = [...strategies]
      ..sort((a, b) => a.totalInterestCents.compareTo(b.totalInterestCents));
    return sorted;
  }
}
