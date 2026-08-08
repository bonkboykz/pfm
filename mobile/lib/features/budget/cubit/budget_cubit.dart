import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/dates/months.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_errors.dart';
import '../data/budget_models.dart';
import '../data/budget_repository.dart';

enum BudgetStatus { initial, loading, ready, error }

/// Чем закончилась раздача по целям — этого достаточно, чтобы сказать
/// пользователю правду, включая «денег хватило не на всех».
class AssignTargetsOutcome {
  final String? error;
  final int addedCents;
  final int remainingCents;
  final bool stoppedAtZeroRta;

  const AssignTargetsOutcome({
    this.error,
    this.addedCents = 0,
    this.remainingCents = 0,
    this.stoppedAtZeroRta = false,
  });
}

class BudgetState extends Equatable {
  final BudgetStatus status;
  final String month;
  final BudgetData? data;
  final String? error;
  final bool unauthorized;

  /// True while a write is in flight — the screen stays interactive but
  /// buttons lock so a double tap can't fire two assigns.
  final bool busy;

  const BudgetState({
    this.status = BudgetStatus.initial,
    required this.month,
    this.data,
    this.error,
    this.unauthorized = false,
    this.busy = false,
  });

  BudgetState copyWith({
    BudgetStatus? status,
    String? month,
    BudgetData? data,
    String? error,
    bool? unauthorized,
    bool? busy,
  }) =>
      BudgetState(
        status: status ?? this.status,
        month: month ?? this.month,
        data: data ?? this.data,
        error: error, // deliberately not `?? this.error` — clears on success
        unauthorized: unauthorized ?? this.unauthorized,
        busy: busy ?? this.busy,
      );

  @override
  List<Object?> get props => [status, month, data, error, unauthorized, busy];
}

class BudgetCubit extends Cubit<BudgetState> {
  final BudgetRepository _repo;

  BudgetCubit(this._repo) : super(BudgetState(month: currentMonth()));

  Future<void> load() async {
    emit(state.copyWith(status: BudgetStatus.loading));
    try {
      final data = await _repo.load(state.month);
      emit(state.copyWith(status: BudgetStatus.ready, data: data));
    } on ApiException catch (e) {
      emit(state.copyWith(
        status: BudgetStatus.error,
        error: humanizeApiError(e),
        unauthorized: e.isUnauthorized,
      ));
    } catch (e) {
      emit(state.copyWith(status: BudgetStatus.error, error: e.toString()));
    }
  }

  Future<void> selectMonth(String month) async {
    if (month == state.month) return;
    emit(BudgetState(status: BudgetStatus.loading, month: month));
    await load();
  }

  Future<void> shiftSelectedMonth(int delta) =>
      selectMonth(shiftMonth(state.month, delta));

  /// Sets the category's assignment for the selected month.
  /// Returns null on success, a human-readable message on failure.
  Future<String?> assign(String categoryId, int amountCents) =>
      _mutate(() => _repo.assign(state.month, categoryId, amountCents));

  Future<String?> move(String fromId, String toId, int amountCents) =>
      _mutate(() => _repo.move(state.month, fromId, toId, amountCents));

  /// Дофинансирует цели и останавливается на нуле Ready to Assign.
  ///
  /// Суммы, порядок и сам останов считает движок: у каждого типа цели своя
  /// формула, а раздача без оглядки на RTA уводила его в минус. Клиенту
  /// остаётся показать итог.
  Future<AssignTargetsOutcome> assignUnderfunded() async {
    final budget = state.data?.month;
    if (budget == null || budget.underfunded.isEmpty) {
      return const AssignTargetsOutcome();
    }

    emit(state.copyWith(busy: true));
    try {
      final result = await _repo.assignTargets(state.month);
      _emitMonth(result.month);
      emit(state.copyWith(busy: false));
      await _refreshOverview();
      return AssignTargetsOutcome(
        addedCents: result.totalAddedCents,
        remainingCents: result.remainingUnderfundedCents,
        stoppedAtZeroRta: result.stoppedAtZeroRta,
      );
    } on ApiException catch (e) {
      emit(state.copyWith(busy: false));
      return AssignTargetsOutcome(error: humanizeApiError(e));
    } catch (e) {
      emit(state.copyWith(busy: false));
      return AssignTargetsOutcome(error: e.toString());
    }
  }

  /// Replays the previous month's assignments onto the selected month.
  Future<String?> copyPreviousMonth() async {
    emit(state.copyWith(busy: true));
    try {
      final previous = await _repo.monthOnly(shiftMonth(state.month, -1));
      final sources =
          previous.allCategories.where((c) => c.assignedCents != 0).toList();
      if (sources.isEmpty) {
        emit(state.copyWith(busy: false));
        return 'В прошлом месяце ничего не назначено';
      }
      emit(state.copyWith(busy: false));
      return _mutateMany([
        for (final c in sources)
          () => _repo.assign(state.month, c.categoryId, c.assignedCents),
      ]);
    } on ApiException catch (e) {
      emit(state.copyWith(busy: false));
      return humanizeApiError(e);
    } catch (e) {
      emit(state.copyWith(busy: false));
      return e.toString();
    }
  }

  Future<String?> _mutate(Future<BudgetMonth> Function() call) =>
      _mutateMany([call]);

  /// Runs writes sequentially — the engine recomputes cumulative availability
  /// after each one, so firing them in parallel would race.
  Future<String?> _mutateMany(
    List<Future<BudgetMonth> Function()> calls,
  ) async {
    emit(state.copyWith(busy: true));
    BudgetMonth? latest;
    try {
      for (final call in calls) {
        latest = await call();
      }
    } on ApiException catch (e) {
      if (latest != null) _emitMonth(latest);
      emit(state.copyWith(busy: false));
      return humanizeApiError(e);
    } catch (e) {
      if (latest != null) _emitMonth(latest);
      emit(state.copyWith(busy: false));
      return e.toString();
    }

    if (latest != null) _emitMonth(latest);
    emit(state.copyWith(busy: false));
    await _refreshOverview();
    return null;
  }

  void _emitMonth(BudgetMonth month) {
    final previous = state.data;
    emit(state.copyWith(
      status: BudgetStatus.ready,
      data: previous == null
          ? BudgetData(month: month)
          : BudgetData(month: month, overview: previous.overview),
    ));
  }

  /// The mutation endpoints return the month but not the cross-month overview,
  /// so the "future months" warning has to be refetched separately.
  Future<void> _refreshOverview() async {
    final data = state.data;
    if (data == null) return;
    try {
      final overview = await _repo.overview(state.month);
      emit(state.copyWith(data: BudgetData(month: data.month, overview: overview)));
    } catch (_) {
      // Keep the stale warning rather than losing the screen over it.
    }
  }
}
