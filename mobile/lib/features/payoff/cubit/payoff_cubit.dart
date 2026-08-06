import 'dart:async';

import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_client.dart';
import '../../../core/network/api_errors.dart';
import '../../loans/data/loans_models.dart';
import '../data/payoff_models.dart';
import '../data/payoff_repository.dart';

enum PayoffStatus { initial, loading, ready, error }

class PayoffState extends Equatable {
  final PayoffStatus status;
  final List<Loan> loans;

  /// Сравнение на нулевой добавке: даёт рекомендованную стратегию, список всех
  /// и базовый сценарий, с которым сравнивается добавка.
  final PayoffComparison? comparison;
  final String strategy;
  final int extraMonthlyCents;

  /// Результат для выбранной стратегии с текущей добавкой.
  final StrategyResult? scenario;
  final bool simulating;
  final String? error;
  final bool unauthorized;

  const PayoffState({
    this.status = PayoffStatus.initial,
    this.loans = const [],
    this.comparison,
    this.strategy = '',
    this.extraMonthlyCents = 0,
    this.scenario,
    this.simulating = false,
    this.error,
    this.unauthorized = false,
  });

  PayoffState copyWith({
    PayoffStatus? status,
    List<Loan>? loans,
    PayoffComparison? comparison,
    String? strategy,
    int? extraMonthlyCents,
    StrategyResult? scenario,
    bool? simulating,
    String? error,
    bool? unauthorized,
  }) =>
      PayoffState(
        status: status ?? this.status,
        loans: loans ?? this.loans,
        comparison: comparison ?? this.comparison,
        strategy: strategy ?? this.strategy,
        extraMonthlyCents: extraMonthlyCents ?? this.extraMonthlyCents,
        scenario: scenario ?? this.scenario,
        simulating: simulating ?? this.simulating,
        error: error,
        unauthorized: unauthorized ?? this.unauthorized,
      );

  @override
  List<Object?> get props => [
        status,
        loans,
        comparison,
        strategy,
        extraMonthlyCents,
        scenario,
        simulating,
        error,
        unauthorized,
      ];

  List<Loan> get eligible => loans
      .where((l) => l.currentDebtCents > 0 && l.monthlyPaymentCents > 0)
      .toList();

  int get totalDebtCents =>
      eligible.fold(0, (acc, l) => acc + l.currentDebtCents);

  int get minPaymentCents =>
      eligible.fold(0, (acc, l) => acc + l.monthlyPaymentCents);

  /// Сценарий без добавки для выбранной стратегии.
  StrategyResult? get baseline {
    final all = comparison?.strategies ?? const <StrategyResult>[];
    for (final s in all) {
      if (s.strategy == strategy) return s;
    }
    return comparison?.best;
  }

  int get monthsSaved {
    final b = baseline, s = scenario;
    if (b == null || s == null) return 0;
    return b.monthsToPayoff - s.monthsToPayoff;
  }

  int get interestSavedCents {
    final b = baseline, s = scenario;
    if (b == null || s == null) return 0;
    return b.totalInterestCents - s.totalInterestCents;
  }

  /// Потолок ползунка — минимальные платежи, округлённые вверх до 50 000 ₸.
  /// Добавить больше, чем платишь сейчас, всё равно почти не у кого.
  int get maxExtraCents {
    const step = 5000000;
    if (minPaymentCents <= 0) return step * 10;
    return ((minPaymentCents / step).ceil()) * step;
  }

  int get sliderDivisions => (maxExtraCents / 500000).round();
}

class PayoffCubit extends Cubit<PayoffState> {
  final PayoffRepository _repo;
  Timer? _debounce;

  PayoffCubit(this._repo) : super(const PayoffState());

  static const _debounceDelay = Duration(milliseconds: 350);

  Future<void> load() async {
    emit(state.copyWith(status: PayoffStatus.loading));
    try {
      final loans = await _repo.loans();
      emit(state.copyWith(status: PayoffStatus.ready, loans: loans));
      if (state.eligible.isEmpty) return;

      final comparison = await _repo.compare(
        loans: loans,
        extraMonthlyCents: 0,
      );
      emit(state.copyWith(
        comparison: comparison,
        strategy: comparison.recommended,
        scenario: comparison.best,
      ));
    } on ApiException catch (e) {
      emit(state.copyWith(
        status: PayoffStatus.error,
        error: humanizeApiError(e),
        unauthorized: e.isUnauthorized,
      ));
    } catch (e) {
      emit(state.copyWith(status: PayoffStatus.error, error: e.toString()));
    }
  }

  /// Значение ползунка применяется сразу, чтобы цифра под пальцем не отставала,
  /// а запрос уходит только когда перетаскивание улеглось.
  void setExtra(int cents) {
    emit(state.copyWith(extraMonthlyCents: cents, simulating: true));
    _debounce?.cancel();
    _debounce = Timer(_debounceDelay, _runScenario);
  }

  void setStrategy(String key) {
    if (key == state.strategy) return;
    emit(state.copyWith(strategy: key, simulating: true));
    _debounce?.cancel();
    _debounce = Timer(_debounceDelay, _runScenario);
  }

  Future<void> _runScenario() async {
    if (state.eligible.isEmpty) return;

    // На нулевой добавке сценарий совпадает с базовым — он уже посчитан.
    if (state.extraMonthlyCents == 0) {
      emit(state.copyWith(scenario: state.baseline, simulating: false));
      return;
    }

    try {
      final result = await _repo.simulate(
        loans: state.loans,
        strategy: state.strategy,
        extraMonthlyCents: state.extraMonthlyCents,
      );
      emit(state.copyWith(scenario: result, simulating: false));
    } on ApiException catch (e) {
      emit(state.copyWith(simulating: false, error: humanizeApiError(e)));
    } catch (e) {
      emit(state.copyWith(simulating: false, error: e.toString()));
    }
  }

  @override
  Future<void> close() {
    _debounce?.cancel();
    return super.close();
  }
}
