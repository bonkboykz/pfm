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
  final PayoffComparison? comparison;
  final int extraMonthlyCents;
  final bool simulating;
  final String? error;
  final bool unauthorized;

  const PayoffState({
    this.status = PayoffStatus.initial,
    this.loans = const [],
    this.comparison,
    this.extraMonthlyCents = 0,
    this.simulating = false,
    this.error,
    this.unauthorized = false,
  });

  PayoffState copyWith({
    PayoffStatus? status,
    List<Loan>? loans,
    PayoffComparison? comparison,
    int? extraMonthlyCents,
    bool? simulating,
    String? error,
    bool? unauthorized,
  }) =>
      PayoffState(
        status: status ?? this.status,
        loans: loans ?? this.loans,
        comparison: comparison ?? this.comparison,
        extraMonthlyCents: extraMonthlyCents ?? this.extraMonthlyCents,
        simulating: simulating ?? this.simulating,
        error: error,
        unauthorized: unauthorized ?? this.unauthorized,
      );

  @override
  List<Object?> get props => [
        status,
        loans,
        comparison,
        extraMonthlyCents,
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
}

class PayoffCubit extends Cubit<PayoffState> {
  final PayoffRepository _repo;

  PayoffCubit(this._repo) : super(const PayoffState());

  Future<void> load() async {
    emit(state.copyWith(status: PayoffStatus.loading));
    try {
      final loans = await _repo.loans();
      emit(state.copyWith(status: PayoffStatus.ready, loans: loans));
      if (state.eligible.isNotEmpty) await simulate();
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

  void setExtra(int cents) => emit(state.copyWith(extraMonthlyCents: cents));

  Future<String?> simulate() async {
    if (state.eligible.isEmpty) return 'Нет кредитов для расчёта';
    emit(state.copyWith(simulating: true));
    try {
      final comparison = await _repo.compare(
        loans: state.loans,
        extraMonthlyCents: state.extraMonthlyCents,
      );
      emit(state.copyWith(comparison: comparison, simulating: false));
      return null;
    } on ApiException catch (e) {
      emit(state.copyWith(simulating: false));
      return humanizeApiError(e);
    } catch (e) {
      emit(state.copyWith(simulating: false));
      return e.toString();
    }
  }
}
