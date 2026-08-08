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

  /// Sets many assignments in one SQLite transaction. The server validates
  /// every category id before writing anything, so this cannot leave the month
  /// half-assigned the way a loop of `assign` calls can.
  Future<BudgetMonth> bulkAssign(
    String month,
    List<({String categoryId, int amountCents})> assignments,
  ) async {
    final json = await _api.post(
      '/api/v1/budget/$month/bulk-assign',
      body: {
        'assignments': [
          for (final a in assignments)
            {'categoryId': a.categoryId, 'amountCents': a.amountCents},
        ],
      },
    );
    return BudgetMonth.fromJson((json as Map).cast<String, dynamic>());
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
