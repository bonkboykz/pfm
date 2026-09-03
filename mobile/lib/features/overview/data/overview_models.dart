/// Сводка месяца: один ответ на вопрос «что делать».
///
/// Раньше эта картина собиралась из пяти запросов и складывалась арифметикой
/// на клиенте. Считает её сервер — здесь только разбор.
library;

class OverviewLine {
  final String categoryId;
  final String categoryName;
  final int amountCents;
  final String amountFormatted;

  const OverviewLine({
    required this.categoryId,
    required this.categoryName,
    required this.amountCents,
    required this.amountFormatted,
  });

  factory OverviewLine.fromJson(Map<String, dynamic> json) => OverviewLine(
        categoryId: (json['categoryId'] ?? '').toString(),
        categoryName: (json['categoryName'] ?? '').toString(),
        amountCents: (json['amountCents'] as num?)?.toInt() ?? 0,
        amountFormatted: (json['amountFormatted'] ?? '').toString(),
      );
}

class UpcomingPayment {
  final String scheduledId;
  final String? payeeName;
  final String nextDate;
  final int amountCents;
  final String amountFormatted;

  /// Правило-напоминание: операцию по нему надо завести руками.
  final bool autoPost;

  const UpcomingPayment({
    required this.scheduledId,
    required this.payeeName,
    required this.nextDate,
    required this.amountCents,
    required this.amountFormatted,
    required this.autoPost,
  });

  factory UpcomingPayment.fromJson(Map<String, dynamic> json) => UpcomingPayment(
        scheduledId: (json['scheduledId'] ?? '').toString(),
        payeeName: json['payeeName']?.toString(),
        nextDate: (json['nextDate'] ?? '').toString(),
        amountCents: (json['amountCents'] as num?)?.toInt() ?? 0,
        amountFormatted: (json['amountFormatted'] ?? '').toString(),
        autoPost: json['autoPost'] != false,
      );
}

/// Рекомендованное действие: что сделать и почему.
///
/// Сервер предлагает только то, на что есть деньги, поэтому пустой список
/// значит «делать нечего», а не «не удалось посчитать».
class OverviewAction {
  final String tool;
  final String why;
  final Map<String, dynamic> arguments;

  const OverviewAction({
    required this.tool,
    required this.why,
    required this.arguments,
  });

  factory OverviewAction.fromJson(Map<String, dynamic> json) => OverviewAction(
        tool: (json['tool'] ?? '').toString(),
        why: (json['why'] ?? '').toString(),
        arguments:
            ((json['arguments'] as Map?) ?? const {}).cast<String, dynamic>(),
      );
}

class MonthOverview {
  final String month;
  final int readyToAssignCents;
  final String readyToAssignFormatted;
  final bool isOverAssigned;
  final int overspentCents;
  final List<OverviewLine> overspent;
  final int underfundedCents;
  final List<OverviewLine> underfunded;
  final List<UpcomingPayment> upcoming;
  final List<OverviewAction> actions;

  const MonthOverview({
    required this.month,
    required this.readyToAssignCents,
    required this.readyToAssignFormatted,
    required this.isOverAssigned,
    required this.overspentCents,
    required this.overspent,
    required this.underfundedCents,
    required this.underfunded,
    required this.upcoming,
    required this.actions,
  });

  factory MonthOverview.fromJson(Map<String, dynamic> json) => MonthOverview(
        month: (json['month'] ?? '').toString(),
        readyToAssignCents: (json['readyToAssignCents'] as num?)?.toInt() ?? 0,
        readyToAssignFormatted:
            (json['readyToAssignFormatted'] ?? '').toString(),
        isOverAssigned: json['isOverAssigned'] == true,
        overspentCents: (json['overspentCents'] as num?)?.toInt() ?? 0,
        overspent: _lines(json['overspent']),
        underfundedCents: (json['underfundedCents'] as num?)?.toInt() ?? 0,
        underfunded: _lines(json['underfunded']),
        upcoming: ((json['upcoming'] as List?) ?? const [])
            .whereType<Map>()
            .map((e) => UpcomingPayment.fromJson(e.cast<String, dynamic>()))
            .toList(),
        actions: ((json['actions'] as List?) ?? const [])
            .whereType<Map>()
            .map((e) => OverviewAction.fromJson(e.cast<String, dynamic>()))
            .toList(),
      );

  static List<OverviewLine> _lines(Object? raw) =>
      ((raw as List?) ?? const [])
          .whereType<Map>()
          .map((e) => OverviewLine.fromJson(e.cast<String, dynamic>()))
          .toList();

  /// Ближайшие платежи, которые сами себя не проведут.
  List<UpcomingPayment> get reminders =>
      upcoming.where((u) => !u.autoPost).toList();

  bool get isCalm => overspent.isEmpty && !isOverAssigned;
}
