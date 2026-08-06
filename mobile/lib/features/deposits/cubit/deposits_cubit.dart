import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_client.dart';
import '../../../core/network/api_errors.dart';
import '../data/deposits_models.dart';
import '../data/deposits_repository.dart';

enum DepositsStatus { initial, loading, ready, error }

class DepositsState extends Equatable {
  final DepositsStatus status;
  final DepositsData? data;
  final String? error;
  final bool unauthorized;

  const DepositsState({
    this.status = DepositsStatus.initial,
    this.data,
    this.error,
    this.unauthorized = false,
  });

  DepositsState copyWith({
    DepositsStatus? status,
    DepositsData? data,
    String? error,
    bool? unauthorized,
  }) =>
      DepositsState(
        status: status ?? this.status,
        data: data ?? this.data,
        error: error,
        unauthorized: unauthorized ?? this.unauthorized,
      );

  @override
  List<Object?> get props => [status, data, error, unauthorized];
}

class DepositsCubit extends Cubit<DepositsState> {
  final DepositsRepository _repo;
  DepositsCubit(this._repo) : super(const DepositsState());

  Future<void> load() async {
    emit(state.copyWith(status: DepositsStatus.loading));
    try {
      emit(state.copyWith(
          status: DepositsStatus.ready, data: await _repo.load()));
    } on ApiException catch (e) {
      emit(state.copyWith(
        status: DepositsStatus.error,
        error: humanizeApiError(e),
        unauthorized: e.isUnauthorized,
      ));
    } catch (e) {
      emit(state.copyWith(status: DepositsStatus.error, error: e.toString()));
    }
  }
}

enum DepositScheduleStatus { initial, loading, ready, error }

class DepositScheduleState extends Equatable {
  final DepositScheduleStatus status;
  final Deposit? deposit;
  final DepositSchedule? schedule;
  final String? error;
  final bool unauthorized;

  const DepositScheduleState({
    this.status = DepositScheduleStatus.initial,
    this.deposit,
    this.schedule,
    this.error,
    this.unauthorized = false,
  });

  DepositScheduleState copyWith({
    DepositScheduleStatus? status,
    Deposit? deposit,
    DepositSchedule? schedule,
    String? error,
    bool? unauthorized,
  }) =>
      DepositScheduleState(
        status: status ?? this.status,
        deposit: deposit ?? this.deposit,
        schedule: schedule ?? this.schedule,
        error: error,
        unauthorized: unauthorized ?? this.unauthorized,
      );

  @override
  List<Object?> get props => [status, deposit, schedule, error, unauthorized];
}

class DepositScheduleCubit extends Cubit<DepositScheduleState> {
  final DepositsRepository _repo;
  final String depositId;

  DepositScheduleCubit(this._repo, this.depositId)
      : super(const DepositScheduleState());

  Future<void> load() async {
    emit(state.copyWith(status: DepositScheduleStatus.loading));
    try {
      final deposit = await _repo.byId(depositId);
      final schedule = await _repo.schedule(depositId);
      emit(state.copyWith(
        status: DepositScheduleStatus.ready,
        deposit: deposit,
        schedule: schedule,
      ));
    } on ApiException catch (e) {
      emit(state.copyWith(
        status: DepositScheduleStatus.error,
        error: humanizeApiError(e),
        unauthorized: e.isUnauthorized,
      ));
    } catch (e) {
      emit(state.copyWith(
          status: DepositScheduleStatus.error, error: e.toString()));
    }
  }
}
