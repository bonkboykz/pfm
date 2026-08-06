/// Manual parsing of `GET /api/v1/accounts`.
///
/// Note that `GET /accounts` and `GET /accounts/:id` return the same narrow
/// shape: `bankName`, `last4Digits`, `cardType` and `note` exist in the schema
/// but are only echoed back by POST/PATCH, never on a read. Nothing in the UI
/// can rely on them.
library;

class Account {
  final String id;
  final String name;
  final String type;
  final bool onBudget;
  final String currency;
  final int sortOrder;
  final int balanceCents;
  final int clearedCents;
  final int unclearedCents;

  const Account({
    required this.id,
    required this.name,
    required this.type,
    required this.onBudget,
    required this.currency,
    required this.sortOrder,
    required this.balanceCents,
    required this.clearedCents,
    required this.unclearedCents,
  });

  factory Account.fromJson(Map<String, dynamic> json) => Account(
        id: (json['id'] ?? '').toString(),
        name: (json['name'] ?? '').toString(),
        type: (json['type'] ?? '').toString(),
        onBudget: json['onBudget'] == true,
        currency: (json['currency'] ?? 'KZT').toString(),
        sortOrder: (json['sortOrder'] as num?)?.toInt() ?? 0,
        balanceCents: (json['balanceCents'] as num?)?.toInt() ?? 0,
        clearedCents: (json['clearedCents'] as num?)?.toInt() ?? 0,
        unclearedCents: (json['unclearedCents'] as num?)?.toInt() ?? 0,
      );

  bool get hasUncleared => unclearedCents != 0;
}

const accountTypes = <String, String>{
  'checking': 'Дебетовая',
  'savings': 'Накопительная',
  'credit_card': 'Кредитная карта',
  'cash': 'Наличные',
  'line_of_credit': 'Кредитная линия',
  'tracking': 'Отслеживаемый',
};

String accountTypeLabel(String type) => accountTypes[type] ?? type;

class AccountsData {
  final List<Account> accounts;

  const AccountsData(this.accounts);

  List<Account> get onBudget => accounts.where((a) => a.onBudget).toList();
  List<Account> get offBudget => accounts.where((a) => !a.onBudget).toList();

  /// Balances are never summed across currencies — a KZT total plus a CNY total
  /// is the honest answer; one "net worth" number would require an FX rate the
  /// API does not have.
  Map<String, int> get totalsByCurrency {
    final totals = <String, int>{};
    for (final a in accounts) {
      totals[a.currency] = (totals[a.currency] ?? 0) + a.balanceCents;
    }
    return totals;
  }

  bool get isMultiCurrency => totalsByCurrency.length > 1;
}
