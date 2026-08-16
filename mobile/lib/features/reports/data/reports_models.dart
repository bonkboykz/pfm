/// Reports are computed on the client — the API exposes no reporting routes.
///
/// They are derived from `GET /transactions` rather than from the budget's
/// `activityCents`, because the engine sums every transaction's cents into a
/// category regardless of the account's currency: 619 CNY tiyn land in a tenge
/// category as 619 ₸. Aggregating here lets non-KZT accounts be excluded
/// instead of silently corrupting the totals.
library;

class MonthFlow {
  final String month; // YYYY-MM
  final int incomeCents;
  final int expenseCents; // positive magnitude

  const MonthFlow({
    required this.month,
    required this.incomeCents,
    required this.expenseCents,
  });

  int get netCents => incomeCents - expenseCents;
  bool get isEmpty => incomeCents == 0 && expenseCents == 0;
}

class CategorySpend {
  final String? categoryId;
  final String name;
  final int cents; // positive magnitude

  const CategorySpend({
    required this.categoryId,
    required this.name,
    required this.cents,
  });
}

class PayeeSpend {
  final String name;
  final int count;
  final int cents; // positive magnitude

  const PayeeSpend({
    required this.name,
    required this.count,
    required this.cents,
  });
}

class ReportsData {
  final int months;
  final String since;
  final String until;
  final List<MonthFlow> monthly;
  final List<CategorySpend> categories;
  final List<PayeeSpend> payees;

  /// Приход по источникам. Группировка по плательщику, а не по категории:
  /// почти весь доход падает в системную «Ready to Assign», и разбивка по
  /// категориям дала бы один сектор.
  final List<PayeeSpend> incomeSources;
  final int incomeCents;
  final int expenseCents;

  /// Rows dropped because their account is not in KZT. Surfaced in the UI so
  /// the numbers never look more complete than they are.
  final int excludedCount;

  const ReportsData({
    required this.months,
    required this.since,
    required this.until,
    required this.monthly,
    required this.categories,
    required this.payees,
    this.incomeSources = const [],
    required this.incomeCents,
    required this.expenseCents,
    required this.excludedCount,
  });

  int get netCents => incomeCents - expenseCents;

  bool get isEmpty => incomeCents == 0 && expenseCents == 0;

  /// Largest single bar in the chart, used to scale it.
  int get peakCents {
    var peak = 0;
    for (final m in monthly) {
      if (m.incomeCents > peak) peak = m.incomeCents;
      if (m.expenseCents > peak) peak = m.expenseCents;
    }
    return peak;
  }

  /// Top [limit] categories, with everything else folded into one bucket.
  List<CategorySpend> topCategories(int limit) {
    if (categories.length <= limit) return categories;
    final head = categories.take(limit - 1).toList();
    final tailCents =
        categories.skip(limit - 1).fold<int>(0, (acc, c) => acc + c.cents);
    return [
      ...head,
      CategorySpend(categoryId: null, name: 'Прочее', cents: tailCents),
    ];
  }

  double shareOf(CategorySpend category) =>
      expenseCents == 0 ? 0 : category.cents / expenseCents;

  /// Топ источников дохода: хвост сверх лимита сворачивается в «Прочее», как
  /// и у категорий расхода.
  List<PayeeSpend> topIncomeSources(int limit) {
    if (incomeSources.length <= limit) return incomeSources;
    final head = incomeSources.take(limit - 1).toList();
    final tailCents =
        incomeSources.skip(limit - 1).fold<int>(0, (acc, p) => acc + p.cents);
    final tailCount =
        incomeSources.skip(limit - 1).fold<int>(0, (acc, p) => acc + p.count);
    return [
      ...head,
      PayeeSpend(name: 'Прочее', count: tailCount, cents: tailCents),
    ];
  }

  double shareOfIncome(PayeeSpend source) =>
      incomeCents == 0 ? 0 : source.cents / incomeCents;
}
