import 'dart:async';
import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:intl/intl.dart';

import '../../../core/events/data_bus.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_errors.dart';
import '../../accounts/data/accounts_models.dart';
import '../../accounts/data/accounts_repository.dart';
import '../data/transactions_models.dart';
import '../data/transactions_repository.dart';

enum TransactionsStatus { initial, loading, ready, error }

/// Live data stops in March while "today" is August, so defaulting to the
/// current month would open an empty screen. [all] is the default.
enum TxPeriod { all, thisMonth, last30 }

const _pageSize = 50;

class TransactionsState extends Equatable {
  final TransactionsStatus status;
  final List<Transaction> transactions;
  final List<Account> accounts;
  final CategoryCatalog? categories;
  final TxPeriod period;
  final String query;
  final String? accountFilterId;
  final bool hasMore;
  final bool loadingMore;
  final String? error;
  final bool unauthorized;

  const TransactionsState({
    this.status = TransactionsStatus.initial,
    this.transactions = const [],
    this.accounts = const [],
    this.categories,
    this.period = TxPeriod.all,
    this.query = '',
    this.accountFilterId,
    this.hasMore = false,
    this.loadingMore = false,
    this.error,
    this.unauthorized = false,
  });

  TransactionsState copyWith({
    TransactionsStatus? status,
    List<Transaction>? transactions,
    List<Account>? accounts,
    CategoryCatalog? categories,
    TxPeriod? period,
    String? query,
    String? accountFilterId,
    bool clearAccountFilter = false,
    bool? hasMore,
    bool? loadingMore,
    String? error,
    bool? unauthorized,
  }) =>
      TransactionsState(
        status: status ?? this.status,
        transactions: transactions ?? this.transactions,
        accounts: accounts ?? this.accounts,
        categories: categories ?? this.categories,
        period: period ?? this.period,
        query: query ?? this.query,
        accountFilterId:
            clearAccountFilter ? null : (accountFilterId ?? this.accountFilterId),
        hasMore: hasMore ?? this.hasMore,
        loadingMore: loadingMore ?? this.loadingMore,
        error: error,
        unauthorized: unauthorized ?? this.unauthorized,
      );

  @override
  List<Object?> get props => [
        status,
        transactions,
        accounts,
        categories,
        period,
        query,
        accountFilterId,
        hasMore,
        loadingMore,
        error,
        unauthorized,
      ];

  Account? accountOf(String id) {
    for (final a in accounts) {
      if (a.id == id) return a;
    }
    return null;
  }

  String currencyOf(String accountId) => accountOf(accountId)?.currency ?? 'KZT';

  /// Search runs on the client — the API has no text filter.
  List<Transaction> get visible {
    final q = query.trim().toLowerCase();
    if (q.isEmpty) return transactions;
    return transactions.where((t) {
      final payee = (t.payeeName ?? '').toLowerCase();
      final memo = (t.memo ?? '').toLowerCase();
      return payee.contains(q) || memo.contains(q);
    }).toList();
  }

  List<MapEntry<String, List<Transaction>>> get byDay {
    final buckets = <String, List<Transaction>>{};
    for (final t in visible) {
      buckets.putIfAbsent(t.date, () => []).add(t);
    }
    final days = buckets.keys.toList()..sort((a, b) => b.compareTo(a));
    return [for (final d in days) MapEntry(d, buckets[d]!)];
  }

  /// A day total only makes sense when every row shares one currency.
  String? dayCurrency(List<Transaction> day) {
    final currencies = day.map((t) => currencyOf(t.accountId)).toSet();
    return currencies.length == 1 ? currencies.first : null;
  }
}

class TransactionsCubit extends Cubit<TransactionsState> {
  final TransactionsRepository _repo;
  final AccountsRepository _accounts;
  final DataBus? _bus;

  StreamSubscription<DataChange>? _sub;

  TransactionsCubit(this._repo, this._accounts, {DataBus? bus})
      : _bus = bus,
        super(const TransactionsState()) {
    _sub = bus?.stream.listen(_onExternalChange);
  }

  /// На чужие записи операций этот экран не подписан намеренно: он их сам и
  /// делает, а результат приходит в ответе мутации. А вот смена подключения
  /// его касается — до неё данные было не достать, и экран так и остался бы
  /// на «нужен ключ» до перезапуска.
  void _onExternalChange(DataChange change) {
    if (isClosed) return;
    if (change == DataChange.connection) load();
  }

  @override
  Future<void> close() {
    _sub?.cancel();
    return super.close();
  }

  static String _fmt(DateTime d) => DateFormat('yyyy-MM-dd').format(d);

  ({String? since, String? until}) _range(TxPeriod period) {
    final now = DateTime.now();
    return switch (period) {
      TxPeriod.all => (since: null, until: null),
      TxPeriod.thisMonth => (
          since: _fmt(DateTime(now.year, now.month, 1)),
          until: null,
        ),
      TxPeriod.last30 => (
          since: _fmt(now.subtract(const Duration(days: 30))),
          until: null,
        ),
    };
  }

  Future<void> load() async {
    emit(state.copyWith(status: TransactionsStatus.loading));
    try {
      final range = _range(state.period);
      final transactions = await _repo.list(
        accountId: state.accountFilterId,
        since: range.since,
        until: range.until,
        limit: _pageSize,
      );

      // Accounts are needed for names and currencies; categories for subtitles.
      final accounts = (await _accounts.list()).accounts;
      CategoryCatalog? categories;
      try {
        categories = await _repo.categories();
      } catch (_) {
        categories = null;
      }

      emit(state.copyWith(
        status: TransactionsStatus.ready,
        transactions: transactions,
        accounts: accounts,
        categories: categories,
        hasMore: transactions.length >= _pageSize,
      ));
    } on ApiException catch (e) {
      emit(state.copyWith(
        status: TransactionsStatus.error,
        error: humanizeApiError(e),
        unauthorized: e.isUnauthorized,
      ));
    } catch (e) {
      emit(state.copyWith(
          status: TransactionsStatus.error, error: e.toString()));
    }
  }

  Future<void> setPeriod(TxPeriod period) async {
    if (period == state.period) return;
    emit(state.copyWith(period: period, transactions: const [], hasMore: false));
    await load();
  }

  Future<void> setAccountFilter(String? accountId) async {
    emit(state.copyWith(
      accountFilterId: accountId,
      clearAccountFilter: accountId == null,
      transactions: const [],
      hasMore: false,
    ));
    await load();
  }

  void setQuery(String query) => emit(state.copyWith(query: query));

  /// There is no offset or cursor on GET /transactions, so the next page is
  /// fetched with `until` = the oldest date already loaded and then deduped by
  /// id. If a page brings nothing new (e.g. one day holds more rows than the
  /// page size) paging stops rather than looping forever.
  Future<void> loadMore() async {
    if (state.loadingMore || !state.hasMore || state.transactions.isEmpty) {
      return;
    }
    emit(state.copyWith(loadingMore: true));

    final oldest = state.transactions
        .map((t) => t.date)
        .reduce((a, b) => a.compareTo(b) <= 0 ? a : b);

    try {
      final range = _range(state.period);
      final page = await _repo.list(
        accountId: state.accountFilterId,
        since: range.since,
        until: oldest,
        limit: _pageSize,
      );

      final seen = state.transactions.map((t) => t.id).toSet();
      final fresh = page.where((t) => !seen.contains(t.id)).toList();

      emit(state.copyWith(
        transactions: [...state.transactions, ...fresh],
        hasMore: fresh.isNotEmpty && page.length >= _pageSize,
        loadingMore: false,
      ));
    } on ApiException catch (e) {
      emit(state.copyWith(loadingMore: false, error: humanizeApiError(e)));
    } catch (_) {
      emit(state.copyWith(loadingMore: false));
    }
  }

  Future<String?> create({
    required String accountId,
    required String date,
    required int amountCents,
    String? payeeName,
    String? categoryId,
    String? transferAccountId,
    String? memo,
    required bool cleared,
  }) async {
    try {
      await _repo.create(
        accountId: accountId,
        date: date,
        amountCents: amountCents,
        payeeName: payeeName,
        categoryId: categoryId,
        transferAccountId: transferAccountId,
        memo: memo,
        cleared: cleared ? 'cleared' : 'uncleared',
      );
      await load();
      _bus?.emit(DataChange.transactions);
      return null;
    } on ApiException catch (e) {
      return humanizeApiError(e);
    } catch (e) {
      return e.toString();
    }
  }

  Future<String?> update(
    String id, {
    required String date,
    required int amountCents,
    String? payeeName,
    String? categoryId,
    bool clearCategory = false,
    String? memo,
    required bool cleared,
    bool? isEstimated,
  }) async {
    try {
      await _repo.update(
        id,
        date: date,
        amountCents: amountCents,
        payeeName: payeeName,
        categoryId: categoryId,
        clearCategory: clearCategory,
        memo: memo,
        cleared: cleared ? 'cleared' : 'uncleared',
        isEstimated: isEstimated,
      );
      await load();
      _bus?.emit(DataChange.transactions);
      return null;
    } on ApiException catch (e) {
      return humanizeApiError(e);
    } catch (e) {
      return e.toString();
    }
  }

  Future<String?> delete(String id) async {
    try {
      await _repo.delete(id);
      await load();
      _bus?.emit(DataChange.transactions);
      return null;
    } on ApiException catch (e) {
      return humanizeApiError(e);
    } catch (e) {
      return e.toString();
    }
  }
}
