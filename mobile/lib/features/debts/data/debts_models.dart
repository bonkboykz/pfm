/// Manual parsing of `GET /api/v1/debts`, which answers `{debts, summary}`.
///
/// Per-row `amountFormatted` honours the row's own currency here, but the
/// summary totals do not — they are summed across currencies server-side, so
/// the UI recomputes them per currency instead.
library;

class PersonalDebt {
  final String id;
  final String personName;
  final String direction; // owe | owed
  final int amountCents;
  final String currency;
  final String? dueDate;
  final String? note;
  final bool isSettled;
  final String? settledDate;

  const PersonalDebt({
    required this.id,
    required this.personName,
    required this.direction,
    required this.amountCents,
    required this.currency,
    required this.dueDate,
    required this.note,
    required this.isSettled,
    required this.settledDate,
  });

  factory PersonalDebt.fromJson(Map<String, dynamic> json) => PersonalDebt(
        id: (json['id'] ?? '').toString(),
        personName: (json['personName'] ?? '').toString(),
        direction: (json['direction'] ?? 'owe').toString(),
        amountCents: (json['amountCents'] as num?)?.toInt() ?? 0,
        currency: (json['currency'] ?? 'KZT').toString(),
        dueDate: json['dueDate']?.toString(),
        note: json['note']?.toString(),
        isSettled: json['isSettled'] == true,
        settledDate: json['settledDate']?.toString(),
      );

  bool get iOwe => direction == 'owe';

  bool isOverdue(DateTime now) {
    final due = dueDate;
    if (due == null || isSettled) return false;
    final parsed = DateTime.tryParse(due);
    return parsed != null && parsed.isBefore(DateTime(now.year, now.month, now.day));
  }
}

class DebtsData {
  final List<PersonalDebt> debts;

  const DebtsData(this.debts);

  List<PersonalDebt> get active => debts.where((d) => !d.isSettled).toList();
  List<PersonalDebt> get settled => debts.where((d) => d.isSettled).toList();

  /// Totals recomputed per currency; the server's `summary` block mixes them.
  Map<String, int> get netByCurrency {
    final totals = <String, int>{};
    for (final d in active) {
      final signed = d.iOwe ? -d.amountCents : d.amountCents;
      totals[d.currency] = (totals[d.currency] ?? 0) + signed;
    }
    return totals;
  }

  Map<String, int> get oweByCurrency => _sum((d) => d.iOwe);
  Map<String, int> get owedByCurrency => _sum((d) => !d.iOwe);

  Map<String, int> _sum(bool Function(PersonalDebt) test) {
    final totals = <String, int>{};
    for (final d in active.where(test)) {
      totals[d.currency] = (totals[d.currency] ?? 0) + d.amountCents;
    }
    return totals;
  }

  bool get isMultiCurrency =>
      active.map((d) => d.currency).toSet().length > 1;
}
