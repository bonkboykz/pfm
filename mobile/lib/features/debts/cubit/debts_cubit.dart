import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_client.dart';
import '../../../core/network/api_errors.dart';
import '../data/debts_models.dart';
import '../data/debts_repository.dart';

enum DebtsStatus { initial, loading, ready, error }

class DebtsState extends Equatable {
  final DebtsStatus status;
  final DebtsData? data;
  final bool includeSettled;
  final String? error;
  final bool unauthorized;

  const DebtsState({
    this.status = DebtsStatus.initial,
    this.data,
    this.includeSettled = false,
    this.error,
    this.unauthorized = false,
  });

  DebtsState copyWith({
    DebtsStatus? status,
    DebtsData? data,
    bool? includeSettled,
    String? error,
    bool? unauthorized,
  }) =>
      DebtsState(
        status: status ?? this.status,
        data: data ?? this.data,
        includeSettled: includeSettled ?? this.includeSettled,
        error: error,
        unauthorized: unauthorized ?? this.unauthorized,
      );

  @override
  List<Object?> get props =>
      [status, data, includeSettled, error, unauthorized];
}

class DebtsCubit extends Cubit<DebtsState> {
  final DebtsRepository _repo;
  DebtsCubit(this._repo) : super(const DebtsState());

  Future<void> load() async {
    emit(state.copyWith(status: DebtsStatus.loading));
    try {
      final data = await _repo.list(includeSettled: state.includeSettled);
      emit(state.copyWith(status: DebtsStatus.ready, data: data));
    } on ApiException catch (e) {
      emit(state.copyWith(
        status: DebtsStatus.error,
        error: humanizeApiError(e),
        unauthorized: e.isUnauthorized,
      ));
    } catch (e) {
      emit(state.copyWith(status: DebtsStatus.error, error: e.toString()));
    }
  }

  Future<void> toggleSettled(bool value) async {
    emit(state.copyWith(includeSettled: value));
    await load();
  }

  Future<String?> create({
    required String personName,
    required String direction,
    required int amountCents,
    required String currency,
    String? dueDate,
    String? note,
  }) =>
      _run(() => _repo.create(
            personName: personName,
            direction: direction,
            amountCents: amountCents,
            currency: currency,
            dueDate: dueDate,
            note: note,
          ));

  Future<String?> settle(String id) => _run(() => _repo.settle(id));

  Future<String?> delete(String id) => _run(() => _repo.delete(id));

  Future<String?> _run(Future<void> Function() action) async {
    try {
      await action();
      await load();
      return null;
    } on ApiException catch (e) {
      return humanizeApiError(e);
    } catch (e) {
      return e.toString();
    }
  }
}
