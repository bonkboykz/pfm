/// Manual parsing of `GET /api/v1/transactions` and `/categories`.
///
/// С PFM-47 сервер форматирует `amountFormatted` в валюте счёта операции, так
/// что строке можно верить. Экраны всё равно считают часть чисел сами —
/// итоги по дню, например, — и для них форматирование локальное.
library;

import '../../../core/money/money.dart';

class Transaction {
  final String id;
  final String accountId;
  final String date; // YYYY-MM-DD
  final int amountCents;
  final String? payeeId;
  final String? payeeName;
  final String? categoryId;
  final String? transferAccountId;
  final String? transferTransactionId;
  final String? memo;
  final String cleared; // uncleared | cleared | reconciled
  final bool approved;

  /// Что было в чеке, если покупка номинирована не в валюте счёта: сумма в
  /// минорных единицах своей валюты, сама валюта и курс, по которому записали
  /// (тиыны за единицу, 464,02 ₸/$ → 46402).
  final int? originalAmountCents;
  final String? originalCurrency;
  final int? quotedRateCents;

  /// Тенговая сумма пока оценочная и ждёт подтверждения выпиской.
  final bool isEstimated;

  const Transaction({
    required this.id,
    required this.accountId,
    required this.date,
    required this.amountCents,
    required this.payeeId,
    required this.payeeName,
    required this.categoryId,
    required this.transferAccountId,
    required this.transferTransactionId,
    required this.memo,
    required this.cleared,
    required this.approved,
    this.originalAmountCents,
    this.originalCurrency,
    this.quotedRateCents,
    this.isEstimated = false,
  });

  factory Transaction.fromJson(Map<String, dynamic> json) => Transaction(
        id: (json['id'] ?? '').toString(),
        accountId: (json['accountId'] ?? '').toString(),
        date: (json['date'] ?? '').toString(),
        amountCents: (json['amountCents'] as num?)?.toInt() ?? 0,
        payeeId: json['payeeId']?.toString(),
        payeeName: json['payeeName']?.toString(),
        categoryId: json['categoryId']?.toString(),
        transferAccountId: json['transferAccountId']?.toString(),
        transferTransactionId: json['transferTransactionId']?.toString(),
        memo: json['memo']?.toString(),
        cleared: (json['cleared'] ?? 'uncleared').toString(),
        approved: json['approved'] == true,
        originalAmountCents: (json['originalAmountCents'] as num?)?.toInt(),
        originalCurrency: json['originalCurrency']?.toString(),
        quotedRateCents: (json['quotedRateCents'] as num?)?.toInt(),
        isEstimated: json['isEstimated'] == true,
      );

  bool get isTransfer => transferAccountId != null;
  bool get isInflow => amountCents > 0;
  bool get isCleared => cleared == 'cleared' || cleared == 'reconciled';

  /// Income is modelled as an inflow categorised to the system RTA category.
  bool get isIncome => categoryId == 'ready-to-assign';

  bool get hasForeignOrigin =>
      originalAmountCents != null && originalCurrency != null;

  /// «10,59 $ по курсу 464,02» — то, что стояло в чеке, и по чему записали.
  String? get originText {
    if (!hasForeignOrigin) return null;
    final amount = formatMoneySmart(originalAmountCents!.abs(),
        currency: originalCurrency!);
    final rate = quotedRateCents;
    return rate == null
        ? amount
        : '$amount по курсу ${formatMoneySmart(rate)}';
  }
}

class CategoryRef {
  final String id;
  final String name;
  final String groupId;
  final String groupName;

  const CategoryRef({
    required this.id,
    required this.name,
    required this.groupId,
    required this.groupName,
  });
}

/// Flattened `GET /categories` (groups → categories) with a name lookup, since
/// transactions only carry `categoryId`.
class CategoryCatalog {
  final List<CategoryRef> categories;
  final Map<String, String> _namesById;

  CategoryCatalog(this.categories)
      : _namesById = {for (final c in categories) c.id: c.name};

  static const empty = <CategoryRef>[];

  factory CategoryCatalog.fromJson(List<dynamic> json) {
    final result = <CategoryRef>[];
    for (final group in json.whereType<Map>()) {
      final g = group.cast<String, dynamic>();
      final groupId = (g['id'] ?? '').toString();
      final groupName = (g['name'] ?? '').toString();
      for (final category in ((g['categories'] as List?) ?? const [])
          .whereType<Map>()) {
        final c = category.cast<String, dynamic>();
        result.add(CategoryRef(
          id: (c['id'] ?? '').toString(),
          name: (c['name'] ?? '').toString(),
          groupId: groupId,
          groupName: groupName,
        ));
      }
    }
    return CategoryCatalog(result);
  }

  String? nameOf(String? categoryId) =>
      categoryId == null ? null : _namesById[categoryId];

  List<CategoryRef> get sortedByGroup => categories;
}
