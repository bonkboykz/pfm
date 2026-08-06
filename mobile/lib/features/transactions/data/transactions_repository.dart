import '../../../core/network/api_client.dart';
import 'transactions_models.dart';

class TransactionsRepository {
  final ApiClient _api;
  TransactionsRepository(this._api);

  /// `GET /transactions` supports only `limit` — there is no offset or cursor,
  /// and rows are ordered by date DESC without a tie-breaker.
  Future<List<Transaction>> list({
    String? accountId,
    String? categoryId,
    String? since,
    String? until,
    int limit = 50,
  }) async {
    final query = <String, dynamic>{'limit': limit};
    if (accountId != null) query['accountId'] = accountId;
    if (categoryId != null) query['categoryId'] = categoryId;
    if (since != null) query['since'] = since;
    if (until != null) query['until'] = until;

    final json = await _api.get('/api/v1/transactions', query: query);
    return ((json as List?) ?? const [])
        .whereType<Map>()
        .map((t) => Transaction.fromJson(t.cast<String, dynamic>()))
        .toList();
  }

  Future<CategoryCatalog> categories() async {
    final json = await _api.get('/api/v1/categories');
    return CategoryCatalog.fromJson((json as List?) ?? const []);
  }
}
