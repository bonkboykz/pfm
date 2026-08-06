import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_client.dart';
import '../../../core/network/api_errors.dart';
import '../data/reports_models.dart';
import '../data/reports_repository.dart';

enum ReportsStatus { initial, loading, ready, error }

class ReportsState extends Equatable {
  final ReportsStatus status;
  final int months;
  final ReportsData? data;
  final String? error;
  final bool unauthorized;

  const ReportsState({
    this.status = ReportsStatus.initial,
    // Live data ends in March while today is August, so a 3- or 6-month window
    // opens empty. A year is the default that actually shows something.
    this.months = 12,
    this.data,
    this.error,
    this.unauthorized = false,
  });

  ReportsState copyWith({
    ReportsStatus? status,
    int? months,
    ReportsData? data,
    String? error,
    bool? unauthorized,
  }) =>
      ReportsState(
        status: status ?? this.status,
        months: months ?? this.months,
        data: data ?? this.data,
        error: error,
        unauthorized: unauthorized ?? this.unauthorized,
      );

  @override
  List<Object?> get props => [status, months, data, error, unauthorized];
}

class ReportsCubit extends Cubit<ReportsState> {
  final ReportsRepository _repo;

  ReportsCubit(this._repo) : super(const ReportsState());

  Future<void> load() async {
    emit(state.copyWith(status: ReportsStatus.loading));
    try {
      final data = await _repo.load(state.months);
      emit(state.copyWith(status: ReportsStatus.ready, data: data));
    } on ApiException catch (e) {
      emit(state.copyWith(
        status: ReportsStatus.error,
        error: humanizeApiError(e),
        unauthorized: e.isUnauthorized,
      ));
    } catch (e) {
      emit(state.copyWith(status: ReportsStatus.error, error: e.toString()));
    }
  }

  Future<void> setMonths(int months) async {
    if (months == state.months) return;
    emit(state.copyWith(months: months));
    await load();
  }
}
