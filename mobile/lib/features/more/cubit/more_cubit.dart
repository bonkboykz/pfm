import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_client.dart';
import '../../../core/network/api_errors.dart';
import '../../debts/data/debts_models.dart';
import '../../debts/data/debts_repository.dart';
import '../../deposits/data/deposits_models.dart';
import '../../deposits/data/deposits_repository.dart';
import '../../loans/data/loans_models.dart';
import '../../loans/data/loans_repository.dart';
import '../../scheduled/data/scheduled_models.dart';
import '../../scheduled/data/scheduled_repository.dart';

enum MoreStatus { initial, loading, ready, error }

/// The hub only needs headline numbers, and one dead domain should not blank
/// the whole screen — each section is loaded independently and may be null.
class MoreState extends Equatable {
  final MoreStatus status;
  final LoansData? loans;
  final DebtsData? debts;
  final DepositsData? deposits;
  final ScheduledData? scheduled;
  final String? error;
  final bool unauthorized;

  const MoreState({
    this.status = MoreStatus.initial,
    this.loans,
    this.debts,
    this.deposits,
    this.scheduled,
    this.error,
    this.unauthorized = false,
  });

  MoreState copyWith({
    MoreStatus? status,
    LoansData? loans,
    DebtsData? debts,
    DepositsData? deposits,
    ScheduledData? scheduled,
    String? error,
    bool? unauthorized,
  }) =>
      MoreState(
        status: status ?? this.status,
        loans: loans ?? this.loans,
        debts: debts ?? this.debts,
        deposits: deposits ?? this.deposits,
        scheduled: scheduled ?? this.scheduled,
        error: error,
        unauthorized: unauthorized ?? this.unauthorized,
      );

  @override
  List<Object?> get props =>
      [status, loans, debts, deposits, scheduled, error, unauthorized];

  /// Loans and what you owe people, minus what people owe you and deposits.
  int get netObligationsCents {
    final loanDebt = loans?.totalDebtCents ?? 0;
    final personalNet =
        debts?.netByCurrency.entries.where((e) => e.key == 'KZT').fold<int>(
                  0,
                  (acc, e) => acc + e.value,
                ) ??
            0;
    final saved = deposits?.totalBalanceCents ?? 0;
    return -loanDebt + personalNet + saved;
  }
}

class MoreCubit extends Cubit<MoreState> {
  final LoansRepository _loans;
  final DebtsRepository _debts;
  final DepositsRepository _deposits;
  final ScheduledRepository _scheduled;

  MoreCubit(ApiClient api)
      : _loans = LoansRepository(api),
        _debts = DebtsRepository(api),
        _deposits = DepositsRepository(api),
        _scheduled = ScheduledRepository(api),
        super(const MoreState());

  Future<void> load() async {
    emit(state.copyWith(status: MoreStatus.loading));

    ApiException? firstFailure;
    Future<T?> attempt<T>(Future<T> Function() call) async {
      try {
        return await call();
      } on ApiException catch (e) {
        firstFailure ??= e;
        return null;
      } catch (_) {
        return null;
      }
    }

    final results = await Future.wait([
      attempt(_loans.list),
      attempt(() => _debts.list()),
      attempt(_deposits.load),
      attempt(_scheduled.list),
    ]);

    final loans = results[0] as LoansData?;
    final debts = results[1] as DebtsData?;
    final deposits = results[2] as DepositsData?;
    final scheduled = results[3] as ScheduledData?;

    // Only a total blackout is an error state; a partial answer still helps.
    if (loans == null &&
        debts == null &&
        deposits == null &&
        scheduled == null) {
      final failure = firstFailure;
      emit(state.copyWith(
        status: MoreStatus.error,
        error: failure == null ? 'Не удалось загрузить данные' : humanizeApiError(failure),
        unauthorized: failure?.isUnauthorized ?? false,
      ));
      return;
    }

    emit(state.copyWith(
      status: MoreStatus.ready,
      loans: loans,
      debts: debts,
      deposits: deposits,
      scheduled: scheduled,
    ));
  }
}
