/// Manual parsing of `GET /api/v1/budget/*`.
///
/// Money arrives as integer cents plus a server-rendered `*Formatted` twin.
/// Budget has no currency column, so the server strings are always KZT and can
/// be shown as-is; anything computed on the client goes through formatMoney().
library;

class CategoryBudget {
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
        isUnderfunded: json['isUnderfunded'] == true,
        isOverspent: json['isOverspent'] == true,
      );

  bool get hasTarget =>
      targetAmountCents != null && targetType != null && targetType != 'none';

  /// How much more this month would need to reach its target.
  int get underfundedCents {
    if (!hasTarget) return 0;
    final gap = targetAmountCents! - assignedCents;
    return gap > 0 ? gap : 0;
  }

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

  int get totalUnderfundedCents =>
      underfunded.fold(0, (acc, c) => acc + c.underfundedCents);

  String? groupNameOf(String categoryId) {
    for (final g in groups) {
      if (g.categories.any((c) => c.categoryId == categoryId)) return g.groupName;
    }
    return null;
  }
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

class BudgetData {
  final BudgetMonth month;
  final RtaOverview? overview;

  const BudgetData({required this.month, this.overview});

  BudgetData copyWith({BudgetMonth? month, RtaOverview? overview}) =>
      BudgetData(month: month ?? this.month, overview: overview ?? this.overview);

  /// Only worth surfacing when a later month is tighter than the one on screen.
  bool get hasFutureSqueeze {
    final o = overview;
    if (o == null || o.months.length < 2) return false;
    return o.minReadyToAssignCents < month.readyToAssignCents;
  }
}
