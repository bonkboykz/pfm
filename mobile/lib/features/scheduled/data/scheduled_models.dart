/// Manual parsing of `GET /api/v1/scheduled`, which answers `{scheduled: []}`.
///
/// This is the only list in the API that resolves names for you — account,
/// category and transfer target all arrive already joined.
library;

class ScheduledTransaction {
  final String id;
  final String accountId;
  final String accountName;
  final String frequency; // weekly | biweekly | monthly | yearly
  final String nextDate; // YYYY-MM-DD
  final int amountCents;
  final String? payeeName;
  final String? categoryId;
  final String? categoryName;
  final String? transferAccountId;
  final String? transferAccountName;
  final String? memo;

  /// Создаётся ли операция при «Провести». Выключено — правило работает
  /// напоминанием: сумма списания не равна тому, что оно гасит (платёж по
  /// кредиту), либо счёт мог быть оплачен раньше вручную.
  final bool autoPost;
  final bool isActive;

  const ScheduledTransaction({
    required this.id,
    required this.accountId,
    required this.accountName,
    required this.frequency,
    required this.nextDate,
    required this.amountCents,
    required this.payeeName,
    required this.categoryId,
    required this.categoryName,
    required this.transferAccountId,
    required this.transferAccountName,
    required this.memo,
    required this.autoPost,
    required this.isActive,
  });

  factory ScheduledTransaction.fromJson(Map<String, dynamic> json) =>
      ScheduledTransaction(
        id: (json['id'] ?? '').toString(),
        accountId: (json['accountId'] ?? '').toString(),
        accountName: (json['accountName'] ?? '').toString(),
        frequency: (json['frequency'] ?? 'monthly').toString(),
        nextDate: (json['nextDate'] ?? '').toString(),
        amountCents: (json['amountCents'] as num?)?.toInt() ?? 0,
        payeeName: json['payeeName']?.toString(),
        categoryId: json['categoryId']?.toString(),
        categoryName: json['categoryName']?.toString(),
        transferAccountId: json['transferAccountId']?.toString(),
        transferAccountName: json['transferAccountName']?.toString(),
        memo: json['memo']?.toString(),
        // Старый сервер поля не отдаёт — там автопроведение было единственным
        // поведением, поэтому умолчание true.
        autoPost: json['autoPost'] != false,
        isActive: json['isActive'] == true,
      );

  bool get isTransfer => transferAccountId != null;
  bool get isInflow => amountCents > 0;

  bool isDue(DateTime now) {
    final parsed = DateTime.tryParse(nextDate);
    if (parsed == null) return false;
    return !parsed.isAfter(DateTime(now.year, now.month, now.day));
  }

  int daysUntil(DateTime now) {
    final parsed = DateTime.tryParse(nextDate);
    if (parsed == null) return 0;
    return parsed.difference(DateTime(now.year, now.month, now.day)).inDays;
  }
}

const frequencies = <String, String>{
  'weekly': 'еженедельно',
  'biweekly': 'раз в две недели',
  'monthly': 'ежемесячно',
  'yearly': 'ежегодно',
};

String frequencyLabel(String value) => frequencies[value] ?? value;

class ScheduledData {
  final List<ScheduledTransaction> items;

  const ScheduledData(this.items);

  List<ScheduledTransaction> due(DateTime now) =>
      items.where((s) => s.isDue(now)).toList();

  List<ScheduledTransaction> upcoming(DateTime now) =>
      items.where((s) => !s.isDue(now)).toList();

  /// Наступившие правила, которые «Провести» действительно проведёт.
  List<ScheduledTransaction> duePosting(DateTime now) =>
      due(now).where((s) => s.autoPost).toList();

  int monthlyOutflowCents(DateTime now) => items
      .where((s) => s.amountCents < 0)
      .fold(0, (acc, s) => acc + -s.amountCents);
}

class ProcessResult {
  final int created;

  /// Наступившие правила-напоминания: не проведены и ждут ручной операции.
  final int reminders;

  /// Вхождения, операция по которым уже была заведена руками. Ничего не
  /// создано, дата сдвинута — платёж действительно состоялся.
  final int matched;
  final List<String> errors;

  const ProcessResult({
    required this.created,
    required this.reminders,
    required this.matched,
    required this.errors,
  });

  factory ProcessResult.fromJson(Map<String, dynamic> json) => ProcessResult(
        created: (json['created'] as num?)?.toInt() ?? 0,
        reminders: ((json['reminders'] as List?) ?? const []).length,
        matched: ((json['matched'] as List?) ?? const []).length,
        errors: ((json['errors'] as List?) ?? const [])
            .whereType<Map>()
            .map((e) => (e['message'] ?? '').toString())
            .where((m) => m.isNotEmpty)
            .toList(),
      );
}
