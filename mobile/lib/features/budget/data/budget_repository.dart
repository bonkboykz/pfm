import '../../../core/network/api_client.dart';
import 'budget_models.dart';

class BudgetRepository {
  final ApiClient _api;
  BudgetRepository(this._api);

  Future<BudgetData> load(String month) async {
    final budget = await monthOnly(month);
    // The overview is a nice-to-have: a failure there must not blank the screen.
    RtaOverview? overview;
    try {
      overview = await this.overview(month);
    } catch (_) {
      overview = null;
    }
    return BudgetData(month: budget, overview: overview);
  }

  Future<BudgetMonth> monthOnly(String month) async {
    final json = await _api.get('/api/v1/budget/$month');
    return BudgetMonth.fromJson((json as Map).cast<String, dynamic>());
  }

  Future<RtaOverview> overview(String month) async {
    final json = await _api.get(
      '/api/v1/budget/rta-overview',
      query: {'from': month},
    );
    return RtaOverview.fromJson((json as Map).cast<String, dynamic>());
  }

  /// Sets (does not increment) the assignment for the category/month, and
  /// returns the whole recomputed budget.
  Future<BudgetMonth> assign(
    String month,
    String categoryId,
    int amountCents,
  ) async {
    final json = await _api.post(
      '/api/v1/budget/$month/assign',
      body: {'categoryId': categoryId, 'amountCents': amountCents},
    );
    return BudgetMonth.fromJson((json as Map).cast<String, dynamic>());
  }

  /// Делает месяц копией другого — заменой, а не слиянием: категория, которой
  /// в источнике не назначали, обнуляется. Пустой источник ничего не трогает.
  Future<CopyMonthResult> copyFrom(String month, String fromMonth) async {
    final json = await _api.post(
      '/api/v1/budget/$month/copy-from',
      body: {'fromMonth': fromMonth},
    );
    return CopyMonthResult.fromJson((json as Map).cast<String, dynamic>());
  }

  /// Раздаёт по целям и останавливается на нуле Ready to Assign.
  /// Суммы и порядок считает движок — клиенту остаётся показать итог.
  Future<AssignTargetsResult> assignTargets(String month) async {
    final json = await _api.post(
      '/api/v1/budget/$month/assign-targets',
      body: const {'allowNegativeRta': false},
    );
    return AssignTargetsResult.fromJson((json as Map).cast<String, dynamic>());
  }

  /// Цель живёт на категории, а не на месяце, поэтому это `PATCH /categories`,
  /// а не бюджетная ручка. После неё бюджет надо перечитать: недофинансирование
  /// считает движок, и оно меняется сразу для всех месяцев.
  ///
  /// Все три поля шлём всегда: снятие цели — это `none` плюс явные `null`, а не
  /// пропущенные ключи.
  Future<void> setTarget(
    String categoryId, {
    required String type,
    int? amountCents,
    String? date,
  }) async {
    await _api.patch(
      '/api/v1/categories/$categoryId',
      body: {
        'targetType': type,
        'targetAmountCents': amountCents,
        'targetDate': date,
      },
    );
  }

  Future<BudgetMonth> move(
    String month,
    String fromCategoryId,
    String toCategoryId,
    int amountCents,
  ) async {
    final json = await _api.post(
      '/api/v1/budget/$month/move',
      body: {
        'fromCategoryId': fromCategoryId,
        'toCategoryId': toCategoryId,
        'amountCents': amountCents,
      },
    );
    return BudgetMonth.fromJson((json as Map).cast<String, dynamic>());
  }
}
