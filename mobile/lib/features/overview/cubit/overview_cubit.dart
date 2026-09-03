import 'dart:async';

import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/dates/months.dart';
import '../../../core/network/api_errors.dart';
import '../../../core/events/data_bus.dart';
import '../../../core/network/api_client.dart';
import '../data/overview_models.dart';
import '../data/overview_repository.dart';

enum OverviewStatus { initial, loading, ready, error }

class OverviewState extends Equatable {
  final OverviewStatus status;
  final String month;
  final MonthOverview? data;
  final String? error;
  final bool unauthorized;

  const OverviewState({
    this.status = OverviewStatus.initial,
    required this.month,
    this.data,
    this.error,
    this.unauthorized = false,
  });

  OverviewState copyWith({
    OverviewStatus? status,
    String? month,
    MonthOverview? data,
    String? error,
    bool? unauthorized,
  }) =>
      OverviewState(
        status: status ?? this.status,
        month: month ?? this.month,
        data: data ?? this.data,
        error: error,
        unauthorized: unauthorized ?? this.unauthorized,
      );

  @override
  List<Object?> get props => [status, month, data, error, unauthorized];
}

class OverviewCubit extends Cubit<OverviewState> {
  final OverviewRepository _repo;
  StreamSubscription<DataChange>? _sub;

  OverviewCubit(this._repo, {DataBus? bus})
      : super(OverviewState(month: currentMonth())) {
    _sub = bus?.stream.listen(_onExternalChange);
  }

  /// Сводка — производная от всего сразу, поэтому обновляется на любое
  /// изменение данных, включая собственные назначения: их здесь никто не
  /// делает, петли не будет.
  void _onExternalChange(DataChange change) {
    if (isClosed) return;
    load();
  }

  @override
  Future<void> close() {
    _sub?.cancel();
    return super.close();
  }

  Future<void> load() async {
    if (isClosed) return;
    emit(state.copyWith(status: OverviewStatus.loading));
    try {
      final data = await _repo.load(state.month);
      if (isClosed) return;
      emit(state.copyWith(status: OverviewStatus.ready, data: data));
    } on ApiException catch (e) {
      if (isClosed) return;
      emit(state.copyWith(
        status: OverviewStatus.error,
        error: humanizeApiError(e),
        unauthorized: e.isUnauthorized,
      ));
    } catch (e) {
      if (isClosed) return;
      emit(state.copyWith(status: OverviewStatus.error, error: e.toString()));
    }
  }
}
