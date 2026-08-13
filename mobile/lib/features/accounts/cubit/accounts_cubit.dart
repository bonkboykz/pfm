import 'dart:async';

import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/events/data_bus.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_errors.dart';
import '../data/accounts_models.dart';
import '../data/accounts_repository.dart';

enum AccountsStatus { initial, loading, ready, error }

class AccountsState extends Equatable {
  final AccountsStatus status;
  final AccountsData? data;
  final String? error;
  final bool unauthorized;

  const AccountsState({
    this.status = AccountsStatus.initial,
    this.data,
    this.error,
    this.unauthorized = false,
  });

  AccountsState copyWith({
    AccountsStatus? status,
    AccountsData? data,
    String? error,
    bool? unauthorized,
  }) =>
      AccountsState(
        status: status ?? this.status,
        data: data ?? this.data,
        error: error,
        unauthorized: unauthorized ?? this.unauthorized,
      );

  @override
  List<Object?> get props => [status, data, error, unauthorized];
}

class AccountsCubit extends Cubit<AccountsState> {
  final AccountsRepository _repo;
  final DataBus? _bus;
  StreamSubscription<DataChange>? _sub;

  AccountsCubit(this._repo, {DataBus? bus})
      : _bus = bus,
        super(const AccountsState()) {
    _sub = bus?.stream.listen(_onExternalChange);
  }

  /// Балансы считаются из операций, поэтому запись на вкладке «Операции»
  /// меняет и этот экран. На собственные события не подписываемся.
  void _onExternalChange(DataChange change) {
    if (isClosed) return;
    if (change == DataChange.transactions) load();
  }

  @override
  Future<void> close() {
    _sub?.cancel();
    return super.close();
  }

  Future<void> load() async {
    // Загрузку может начать чужое событие, а вкладку успевают закрыть посреди
    // запроса — emit после close роняет bloc.
    if (isClosed) return;
    emit(state.copyWith(status: AccountsStatus.loading));
    try {
      final data = await _repo.list();
      if (isClosed) return;
      emit(state.copyWith(status: AccountsStatus.ready, data: data));
    } on ApiException catch (e) {
      if (isClosed) return;
      emit(state.copyWith(
        status: AccountsStatus.error,
        error: humanizeApiError(e),
        unauthorized: e.isUnauthorized,
      ));
    } catch (e) {
      if (isClosed) return;
      emit(state.copyWith(status: AccountsStatus.error, error: e.toString()));
    }
  }

  /// Returns null on success, a human-readable message on failure.
  Future<String?> create({
    required String name,
    required String type,
    required String currency,
    required bool onBudget,
  }) async {
    try {
      await _repo.create(
        name: name,
        type: type,
        currency: currency,
        onBudget: onBudget,
      );
      // POST returns the raw row without balances — refetch instead of patching.
      await load();
      _bus?.emit(DataChange.accounts);
      return null;
    } on ApiException catch (e) {
      return humanizeApiError(e);
    } catch (e) {
      return e.toString();
    }
  }
}
