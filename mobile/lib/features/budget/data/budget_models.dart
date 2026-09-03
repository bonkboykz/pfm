/// Manual parsing of `GET /api/v1/budget/*`.
///
/// Money arrives as integer cents plus a server-rendered `*Formatted` twin.
/// Budget has no currency column, so the server strings are always KZT and can
/// be shown as-is; anything computed on the client goes through formatMoney().
library;

/// Системная категория движка. В списке месяца её нет — `getBudgetMonth`
/// отдаёт только несистемные, — но в шторке источников она нужна строкой.
const kReadyToAssignId = 'ready-to-assign';

class CategoryBudget {
  /// Месяц, на который цель отложена; null — не отложена.
  final String? targetSnoozedMonth;

  final String categoryId;
  final String categoryName;
  final int assignedCents;
  final String assignedFormatted;
  final int activityCents;
  final String activityFormatted;
  final int availableCents;
  final String availableFormatted;
  final int? targetAmountCents;
  final String? targetType;
  final String? targetDate;

  /// Сколько ещё надо назначить в этом месяце, чтобы цель осталась на треке.
  /// Считает движок: у каждого `targetType` своя формула, и повторить её на
  /// клиенте значит завести вторую метрику под тем же словом.
  final int underfundedCents;
  final bool isUnderfunded;
  final bool isOverspent;

  const CategoryBudget({
    required this.categoryId,
    required this.categoryName,
    required this.assignedCents,
    required this.assignedFormatted,
    required this.activityCents,
    required this.activityFormatted,
    required this.availableCents,
    required this.availableFormatted,
    required this.targetAmountCents,
    required this.targetType,
    required this.targetDate,
    this.targetSnoozedMonth,
    required this.underfundedCents,
    required this.isUnderfunded,
    required this.isOverspent,
  });

  factory CategoryBudget.fromJson(Map<String, dynamic> json) => CategoryBudget(
        categoryId: (json['categoryId'] ?? '').toString(),
        categoryName: (json['categoryName'] ?? '').toString(),
        assignedCents: (json['assignedCents'] as num?)?.toInt() ?? 0,
        assignedFormatted: (json['assignedFormatted'] ?? '').toString(),
        activityCents: (json['activityCents'] as num?)?.toInt() ?? 0,
        activityFormatted: (json['activityFormatted'] ?? '').toString(),
        availableCents: (json['availableCents'] as num?)?.toInt() ?? 0,
        availableFormatted: (json['availableFormatted'] ?? '').toString(),
        targetAmountCents: (json['targetAmountCents'] as num?)?.toInt(),
        targetType: json['targetType']?.toString(),
        targetDate: json['targetDate']?.toString(),
        targetSnoozedMonth: json['targetSnoozedMonth']?.toString(),
        underfundedCents: (json['underfundedCents'] as num?)?.toInt() ?? 0,
        isUnderfunded: json['isUnderfunded'] == true,
        isOverspent: json['isOverspent'] == true,
      );

  /// Синтетическая строка «Готово к распределению» для списка источников.
  ///
  /// Настоящей категорией не является: движок отказывает системным категориям
  /// в перемещении (`Cannot move from/to system category`), поэтому выбор этой
  /// строки обязан уходить в назначение, а не в `move`.
  factory CategoryBudget.readyToAssign(int cents) => CategoryBudget(
        categoryId: kReadyToAssignId,
        categoryName: 'Готово к распределению',
        assignedCents: 0,
        assignedFormatted: '',
        activityCents: 0,
        activityFormatted: '',
        availableCents: cents,
        availableFormatted: '',
        targetAmountCents: null,
        targetType: null,
        targetDate: null,
        underfundedCents: 0,
        isUnderfunded: false,
        isOverspent: false,
      );

  bool get isReadyToAssign => categoryId == kReadyToAssignId;

  bool get hasTarget =>
      targetAmountCents != null && targetType != null && targetType != 'none';

  /// Amount that has to arrive here to bring `available` back to zero.
  int get overspentCents => availableCents < 0 ? -availableCents : 0;
}

class BudgetGroup {
  final String groupId;
  final String groupName;
  final List<CategoryBudget> categories;

  const BudgetGroup({
    required this.groupId,
    required this.groupName,
    required this.categories,
  });

  factory BudgetGroup.fromJson(Map<String, dynamic> json) => BudgetGroup(
        groupId: (json['groupId'] ?? '').toString(),
        groupName: (json['groupName'] ?? '').toString(),
        categories: ((json['categories'] as List?) ?? const [])
            .whereType<Map>()
            .map((c) => CategoryBudget.fromJson(c.cast<String, dynamic>()))
            .toList(),
      );

  // The API gives no group subtotals — they are summed here.
  int get assignedCents => _sum((c) => c.assignedCents);
  int get activityCents => _sum((c) => c.activityCents);
  int get availableCents => _sum((c) => c.availableCents);

  int _sum(int Function(CategoryBudget) pick) =>
      categories.fold(0, (acc, c) => acc + pick(c));
}

class BudgetMonth {
  final String month;
  final int readyToAssignCents;
  final String readyToAssignFormatted;
  final int totalAssignedCents;
  final String totalAssignedFormatted;
  final int totalActivityCents;
  final String totalActivityFormatted;
  final int totalAvailableCents;
  final String totalAvailableFormatted;
  final int overspentCents;
  final String overspentFormatted;
  final int totalUnderfundedCents;
  final String totalUnderfundedFormatted;
  final List<BudgetGroup> groups;

  const BudgetMonth({
    required this.month,
    required this.readyToAssignCents,
    required this.readyToAssignFormatted,
    required this.totalAssignedCents,
    required this.totalAssignedFormatted,
    required this.totalActivityCents,
    required this.totalActivityFormatted,
    required this.totalAvailableCents,
    required this.totalAvailableFormatted,
    required this.overspentCents,
    required this.overspentFormatted,
    required this.totalUnderfundedCents,
    required this.totalUnderfundedFormatted,
    required this.groups,
  });

  factory BudgetMonth.fromJson(Map<String, dynamic> json) => BudgetMonth(
        month: (json['month'] ?? '').toString(),
        readyToAssignCents: (json['readyToAssignCents'] as num?)?.toInt() ?? 0,
        readyToAssignFormatted:
            (json['readyToAssignFormatted'] ?? '').toString(),
        totalAssignedCents: (json['totalAssignedCents'] as num?)?.toInt() ?? 0,
        totalAssignedFormatted:
            (json['totalAssignedFormatted'] ?? '').toString(),
        totalActivityCents: (json['totalActivityCents'] as num?)?.toInt() ?? 0,
        totalActivityFormatted:
            (json['totalActivityFormatted'] ?? '').toString(),
        totalAvailableCents: (json['totalAvailableCents'] as num?)?.toInt() ?? 0,
        totalAvailableFormatted:
            (json['totalAvailableFormatted'] ?? '').toString(),
        overspentCents: (json['overspentCents'] as num?)?.toInt() ?? 0,
        overspentFormatted: (json['overspentFormatted'] ?? '').toString(),
        totalUnderfundedCents:
            (json['totalUnderfundedCents'] as num?)?.toInt() ?? 0,
        totalUnderfundedFormatted:
            (json['totalUnderfundedFormatted'] ?? '').toString(),
        groups: ((json['groups'] as List?) ?? const [])
            .whereType<Map>()
            .map((g) => BudgetGroup.fromJson(g.cast<String, dynamic>()))
            .toList(),
      );

  List<CategoryBudget> get allCategories =>
      [for (final g in groups) ...g.categories];

  List<CategoryBudget> get underfunded =>
      allCategories.where((c) => c.underfundedCents > 0).toList();

  List<CategoryBudget> get overspent =>
      allCategories.where((c) => c.overspentCents > 0).toList();

  String? groupNameOf(String categoryId) {
    for (final g in groups) {
      if (g.categories.any((c) => c.categoryId == categoryId)) return g.groupName;
    }
    return null;
  }
}

/// Итог `POST /budget/:month/assign-targets`.
class AssignTargetsResult {
  final int totalAddedCents;
  final int remainingUnderfundedCents;

  /// Деньги кончились раньше целей — часть категорий осталась без финансирования.
  final bool stoppedAtZeroRta;
  final BudgetMonth month;

  const AssignTargetsResult({
    required this.totalAddedCents,
    required this.remainingUnderfundedCents,
    required this.stoppedAtZeroRta,
    required this.month,
  });

  factory AssignTargetsResult.fromJson(Map<String, dynamic> json) =>
      AssignTargetsResult(
        totalAddedCents: (json['totalAddedCents'] as num?)?.toInt() ?? 0,
        remainingUnderfundedCents:
            (json['remainingUnderfundedCents'] as num?)?.toInt() ?? 0,
        stoppedAtZeroRta: json['stoppedAtZeroRta'] == true,
        month: BudgetMonth.fromJson(
          ((json['budget'] as Map?) ?? const {}).cast<String, dynamic>(),
        ),
      );
}

/// Итог `POST /budget/:month/copy-from`.
class CopyMonthResult {
  final int changedCount;

  /// Сколько категорий обнулено, потому что в источнике им не назначали.
  final int clearedCount;

  /// В источнике не назначено ничего — копирование не выполнялось.
  final bool sourceEmpty;
  final BudgetMonth month;

  const CopyMonthResult({
    required this.changedCount,
    required this.clearedCount,
    required this.sourceEmpty,
    required this.month,
  });

  factory CopyMonthResult.fromJson(Map<String, dynamic> json) => CopyMonthResult(
        changedCount: ((json['applied'] as List?) ?? const []).length,
        clearedCount: (json['clearedCount'] as num?)?.toInt() ?? 0,
        sourceEmpty: json['sourceEmpty'] == true,
        month: BudgetMonth.fromJson(
          ((json['budget'] as Map?) ?? const {}).cast<String, dynamic>(),
        ),
      );
}

class RtaMonth {
  final String month;
  final int readyToAssignCents;
  final String readyToAssignFormatted;

  const RtaMonth({
    required this.month,
    required this.readyToAssignCents,
    required this.readyToAssignFormatted,
  });

  factory RtaMonth.fromJson(Map<String, dynamic> json) => RtaMonth(
        month: (json['month'] ?? '').toString(),
        readyToAssignCents: (json['readyToAssignCents'] as num?)?.toInt() ?? 0,
        readyToAssignFormatted:
            (json['readyToAssignFormatted'] ?? '').toString(),
      );
}

/// `GET /budget/rta-overview`. `minReadyToAssignCents` is the genuinely
/// spendable amount: a single month's RTA ignores assignments made in later
/// months and therefore overstates what is free.
class RtaOverview {
  final String from;
  final String to;
  final List<RtaMonth> months;
  final int minReadyToAssignCents;
  final String minReadyToAssignFormatted;
  final String minMonth;

  const RtaOverview({
    required this.from,
    required this.to,
    required this.months,
    required this.minReadyToAssignCents,
    required this.minReadyToAssignFormatted,
    required this.minMonth,
  });

  factory RtaOverview.fromJson(Map<String, dynamic> json) => RtaOverview(
        from: (json['from'] ?? '').toString(),
        to: (json['to'] ?? '').toString(),
        months: ((json['months'] as List?) ?? const [])
            .whereType<Map>()
            .map((m) => RtaMonth.fromJson(m.cast<String, dynamic>()))
            .toList(),
        minReadyToAssignCents:
            (json['minReadyToAssignCents'] as num?)?.toInt() ?? 0,
        minReadyToAssignFormatted:
            (json['minReadyToAssignFormatted'] ?? '').toString(),
        minMonth: (json['minMonth'] ?? '').toString(),
      );
}

/// Возраст денег — четвёртое правило YNAB.
///
/// [days] равен null, когда мерить нечего. Показывать в этом случае ноль
/// нельзя: ноль читается как «трачу ровно с колёс», то есть утверждение о
/// финансах, а не о пробеле в данных.
class AgeOfMoney {
  final int? days;
  final int sampleSize;

  const AgeOfMoney({required this.days, required this.sampleSize});

  factory AgeOfMoney.fromJson(Map<String, dynamic> json) => AgeOfMoney(
        days: (json['days'] as num?)?.toInt(),
        sampleSize: (json['sampleSize'] as num?)?.toInt() ?? 0,
      );

  /// Больше тридцати — месяц живётся на прошлый доход.
  bool get isMature => (days ?? 0) >= 30;
}

class BudgetData {
  final BudgetMonth month;
  final RtaOverview? overview;
  final AgeOfMoney? age;

  const BudgetData({required this.month, this.overview, this.age});

  BudgetData copyWith({BudgetMonth? month, RtaOverview? overview, AgeOfMoney? age}) =>
      BudgetData(
        month: month ?? this.month,
        overview: overview ?? this.overview,
        age: age ?? this.age,
      );

  /// Only worth surfacing when a later month is tighter than the one on screen.
  bool get hasFutureSqueeze {
    final o = overview;
    if (o == null || o.months.length < 2) return false;
    return o.minReadyToAssignCents < month.readyToAssignCents;
  }
}
