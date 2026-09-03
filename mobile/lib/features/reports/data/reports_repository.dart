import 'package:intl/intl.dart';

import '../../../core/network/api_client.dart';
import '../../accounts/data/accounts_repository.dart';
import '../../transactions/data/transactions_models.dart';
import '../../transactions/data/transactions_repository.dart';
import 'reports_models.dart';

class ReportsRepository {
  final TransactionsRepository _transactions;
  final AccountsRepository _accounts;

  ReportsRepository(ApiClient api)
      : _transactions = TransactionsRepository(api),
        _accounts = AccountsRepository(api);

  static const _reportingCurrency = 'KZT';

  Future<ReportsData> load(int months) async {
    final now = DateTime.now();
    final start = DateTime(now.year, now.month - (months - 1), 1);
    final since = DateFormat('yyyy-MM-dd').format(start);
    final until = DateFormat('yyyy-MM-dd').format(now);

    final accounts = (await _accounts.list()).accounts;
    final currencyByAccount = {for (final a in accounts) a.id: a.currency};

    // One wide page: the window is months long and the API has no aggregation.
    const pageLimit = 2000;
    final transactions = await _transactions.list(
      since: since,
      until: until,
      limit: pageLimit,
    );
    // Ровно столько, сколько просили, — значит могло быть и больше.
    final truncated = transactions.length >= pageLimit;

    // Справочник не заворачивается в try: недоступность сети — это ошибка,
    // а не данные. Раньше `catch (_) { catalog = null }` превращал сбой
    // связи в отчёт, где все категории названы «Категория удалена».
    final catalog = await _transactions.categories();

    return _aggregate(
      months: months,
      since: since,
      until: until,
      start: start,
      transactions: transactions,
      currencyByAccount: currencyByAccount,
      catalog: catalog,
      truncated: truncated,
    );
  }

  ReportsData _aggregate({
    required int months,
    required String since,
    required String until,
    required DateTime start,
    required List<Transaction> transactions,
    required bool truncated,
    required Map<String, String> currencyByAccount,
    required CategoryCatalog? catalog,
  }) {
    final flows = <String, MonthFlow>{};
    for (var i = 0; i < months; i++) {
      final month =
          DateFormat('yyyy-MM').format(DateTime(start.year, start.month + i));
      flows[month] = MonthFlow(month: month, incomeCents: 0, expenseCents: 0);
    }

    final categoryTotals = <String?, int>{};
    final payeeTotals = <String, int>{};
    final payeeCounts = <String, int>{};
    final incomeTotals = <String, int>{};
    final incomeCounts = <String, int>{};
    var income = 0;
    var expense = 0;
    var excluded = 0;

    for (final t in transactions) {
      // Transfers move money between own accounts — not income or spending.
      if (t.isTransfer) continue;

      if (currencyByAccount[t.accountId] != _reportingCurrency) {
        excluded++;
        continue;
      }

      final month = t.date.length >= 7 ? t.date.substring(0, 7) : '';
      final flow = flows[month];

      if (t.amountCents > 0) {
        income += t.amountCents;
        final source = (t.payeeName?.trim().isNotEmpty ?? false)
            ? t.payeeName!.trim()
            : 'Без источника';
        incomeTotals[source] = (incomeTotals[source] ?? 0) + t.amountCents;
        incomeCounts[source] = (incomeCounts[source] ?? 0) + 1;
        if (flow != null) {
          flows[month] = MonthFlow(
            month: month,
            incomeCents: flow.incomeCents + t.amountCents,
            expenseCents: flow.expenseCents,
          );
        }
      } else if (t.amountCents < 0) {
        final magnitude = -t.amountCents;
        expense += magnitude;
        if (flow != null) {
          flows[month] = MonthFlow(
            month: month,
            incomeCents: flow.incomeCents,
            expenseCents: flow.expenseCents + magnitude,
          );
        }
        categoryTotals[t.categoryId] =
            (categoryTotals[t.categoryId] ?? 0) + magnitude;

        final payee = (t.payeeName?.trim().isNotEmpty ?? false)
            ? t.payeeName!.trim()
            : 'Без получателя';
        payeeTotals[payee] = (payeeTotals[payee] ?? 0) + magnitude;
        payeeCounts[payee] = (payeeCounts[payee] ?? 0) + 1;
      }
    }

    final categories = categoryTotals.entries
        .map((e) => CategorySpend(
              categoryId: e.key,
              name: catalog?.nameOf(e.key) ??
                  (e.key == null ? 'Без категории' : 'Категория удалена'),
              cents: e.value,
            ))
        .toList()
      ..sort((a, b) => b.cents.compareTo(a.cents));

    final payees = payeeTotals.entries
        .map((e) => PayeeSpend(
              name: e.key,
              count: payeeCounts[e.key] ?? 0,
              cents: e.value,
            ))
        .toList()
      ..sort((a, b) => b.cents.compareTo(a.cents));

    final incomeSources = incomeTotals.entries
        .map((e) => PayeeSpend(
              name: e.key,
              count: incomeCounts[e.key] ?? 0,
              cents: e.value,
            ))
        .toList()
      ..sort((a, b) => b.cents.compareTo(a.cents));

    final monthly = flows.values.toList()
      ..sort((a, b) => a.month.compareTo(b.month));

    return ReportsData(
      months: months,
      since: since,
      until: until,
      monthly: monthly,
      categories: categories,
      payees: payees,
      incomeSources: incomeSources,
      incomeCents: income,
      expenseCents: expense,
      excludedCount: excluded,
          truncated: truncated,
    );
  }
}
