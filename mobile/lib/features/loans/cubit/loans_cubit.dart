import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_client.dart';
import '../../../core/network/api_errors.dart';
import '../data/loans_models.dart';
import '../data/loans_repository.dart';

enum LoansStatus { initial, loading, ready, error }

class LoansState extends Equatable {
  final LoansStatus status;
  final LoansData? data;
  final String? error;
  final bool unauthorized;

  const LoansState({
    this.status = LoansStatus.initial,
    this.data,
    this.error,
    this.unauthorized = false,
  });

  LoansState copyWith({
    LoansStatus? status,
    LoansData? data,
    String? error,
    bool? unauthorized,
  }) =>
      LoansState(
        status: status ?? this.status,
        data: data ?? this.data,
        error: error,
        unauthorized: unauthorized ?? this.unauthorized,
      );

  @override
  List<Object?> get props => [status, data, error, unauthorized];
}

class LoansCubit extends Cubit<LoansState> {
  final LoansRepository _repo;
  LoansCubit(this._repo) : super(const LoansState());

  Future<void> load() async {
    emit(state.copyWith(status: LoansStatus.loading));
    try {
      emit(state.copyWith(status: LoansStatus.ready, data: await _repo.list()));
    } on ApiException catch (e) {
      emit(state.copyWith(
        status: LoansStatus.error,
        error: humanizeApiError(e),
        unauthorized: e.isUnauthorized,
      ));
    } catch (e) {
      emit(state.copyWith(status: LoansStatus.error, error: e.toString()));
    }
  }
}

enum ScheduleStatus { initial, loading, ready, error }

class LoanScheduleState extends Equatable {
  final ScheduleStatus status;
  final Loan? loan;
  final LoanSchedule? schedule;
  final String? error;
  final bool unauthorized;

  const LoanScheduleState({
    this.status = ScheduleStatus.initial,
    this.loan,
    this.schedule,
    this.error,
    this.unauthorized = false,
  });

  LoanScheduleState copyWith({
    ScheduleStatus? status,
    Loan? loan,
    LoanSchedule? schedule,
    String? error,
    bool? unauthorized,
  }) =>
      LoanScheduleState(
        status: status ?? this.status,
        loan: loan ?? this.loan,
        schedule: schedule ?? this.schedule,
        error: error,
        unauthorized: unauthorized ?? this.unauthorized,
      );

  @override
  List<Object?> get props => [status, loan, schedule, error, unauthorized];
}

class LoanScheduleCubit extends Cubit<LoanScheduleState> {
  final LoansRepository _repo;
  final String loanId;

  LoanScheduleCubit(this._repo, this.loanId) : super(const LoanScheduleState());

  Future<void> load() async {
    emit(state.copyWith(status: ScheduleStatus.loading));
    try {
      final loan = await _repo.byId(loanId);
      final schedule = await _repo.schedule(loanId);
      emit(state.copyWith(
        status: ScheduleStatus.ready,
        loan: loan,
        schedule: schedule,
      ));
    } on ApiException catch (e) {
      emit(state.copyWith(
        status: ScheduleStatus.error,
        error: humanizeApiError(e),
        unauthorized: e.isUnauthorized,
      ));
    } catch (e) {
      emit(state.copyWith(status: ScheduleStatus.error, error: e.toString()));
    }
  }
}
