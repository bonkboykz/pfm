import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_client.dart';
import '../../../core/network/api_errors.dart';
import '../../transactions/data/transactions_models.dart';
import '../../transactions/data/transactions_repository.dart';
import '../data/accounts_models.dart';
import '../data/accounts_repository.dart';

enum RegisterStatus { initial, loading, ready, error }

class AccountRegisterState extends Equatable {
  final RegisterStatus status;
  final Account? account;
  final List<Transaction> transactions;
  final CategoryCatalog? categories;
  final String? error;
  final bool unauthorized;

  const AccountRegisterState({
    this.status = RegisterStatus.initial,
    this.account,
    this.transactions = const [],
    this.categories,
    this.error,
    this.unauthorized = false,
  });

  AccountRegisterState copyWith({
    RegisterStatus? status,
    Account? account,
    List<Transaction>? transactions,
    CategoryCatalog? categories,
    String? error,
    bool? unauthorized,
  }) =>
      AccountRegisterState(
        status: status ?? this.status,
        account: account ?? this.account,
        transactions: transactions ?? this.transactions,
        categories: categories ?? this.categories,
        error: error,
        unauthorized: unauthorized ?? this.unauthorized,
      );

  @override
  List<Object?> get props =>
      [status, account, transactions, categories, error, unauthorized];

  /// Transactions bucketed by day, newest day first. The API sorts by date DESC
  /// but has no secondary sort, so intra-day order is whatever SQLite returns.
  List<MapEntry<String, List<Transaction>>> get byDay {
    final buckets = <String, List<Transaction>>{};
    for (final t in transactions) {
      buckets.putIfAbsent(t.date, () => []).add(t);
    }
    final days = buckets.keys.toList()..sort((a, b) => b.compareTo(a));
    return [for (final d in days) MapEntry(d, buckets[d]!)];
  }
}

class AccountRegisterCubit extends Cubit<AccountRegisterState> {
  final AccountsRepository _accounts;
  final TransactionsRepository _transactions;
  final String accountId;

  AccountRegisterCubit(this._accounts, this._transactions, this.accountId)
      : super(const AccountRegisterState());

  Future<void> load() async {
    emit(state.copyWith(status: RegisterStatus.loading));
    try {
      final account = await _accounts.byId(accountId);
      final transactions =
          await _transactions.list(accountId: accountId, limit: 200);

      // Category names are a nicety — a failure here must not blank the list.
      CategoryCatalog? categories;
      try {
        categories = await _transactions.categories();
      } catch (_) {
        categories = null;
      }

      emit(state.copyWith(
        status: RegisterStatus.ready,
        account: account,
        transactions: transactions,
        categories: categories,
      ));
    } on ApiException catch (e) {
      emit(state.copyWith(
        status: RegisterStatus.error,
        error: humanizeApiError(e),
        unauthorized: e.isUnauthorized,
      ));
    } catch (e) {
      emit(state.copyWith(status: RegisterStatus.error, error: e.toString()));
    }
  }
}
