import 'dart:async';

import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/events/data_bus.dart';
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
    // Экран отвечает на вопрос «что у меня в этом месяце», поэтому окно —
    // текущий месяц. Год стоял здесь не по замыслу: живые данные тогда
    // заканчивались в марте, а на дворе был август, и короткое окно
    // открывалось пустым. Данные догнали календарь, а дефолт остался.
    this.months = 1,
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
  StreamSubscription<DataChange>? _sub;

  ReportsCubit(this._repo, {DataBus? bus}) : super(const ReportsState()) {
    _sub = bus?.stream.listen(_onExternalChange);
  }

  /// Отчёт — это агрегат операций, поэтому запись на соседней вкладке делает
  /// его неверным ровно так же, как бюджет и счета.
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
    if (isClosed) return;
    emit(state.copyWith(status: ReportsStatus.loading));
    try {
      final data = await _repo.load(state.months);
      if (isClosed) return;
      emit(state.copyWith(status: ReportsStatus.ready, data: data));
    } on ApiException catch (e) {
      if (isClosed) return;
      emit(state.copyWith(
        status: ReportsStatus.error,
        error: humanizeApiError(e),
        unauthorized: e.isUnauthorized,
      ));
    } catch (e) {
      if (isClosed) return;
      emit(state.copyWith(status: ReportsStatus.error, error: e.toString()));
    }
  }

  Future<void> setMonths(int months) async {
    if (months == state.months) return;
    emit(state.copyWith(months: months));
    await load();
  }
}
