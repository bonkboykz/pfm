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

  /// Returns the created rows. A transfer produces a mirrored pair, so the
  /// endpoint answers with an array of two; everything else with one object.
  Future<List<Transaction>> create({
    required String accountId,
    required String date,
    required int amountCents,
    String? payeeName,
    String? categoryId,
    String? transferAccountId,
    String? memo,
    String cleared = 'uncleared',
  }) async {
    final body = <String, dynamic>{
      'accountId': accountId,
      'date': date,
      'amountCents': amountCents,
      'cleared': cleared,
    };
    if (transferAccountId != null) {
      // payeeName/categoryId are ignored by the server in transfer mode.
      body['transferAccountId'] = transferAccountId;
    } else {
      if (payeeName != null && payeeName.isNotEmpty) {
        body['payeeName'] = payeeName;
      }
      if (categoryId != null) body['categoryId'] = categoryId;
    }
    if (memo != null && memo.isNotEmpty) body['memo'] = memo;

    final json = await _api.post('/api/v1/transactions', body: body);
    if (json is List) {
      return json
          .whereType<Map>()
          .map((t) => Transaction.fromJson(t.cast<String, dynamic>()))
          .toList();
    }
    return [Transaction.fromJson((json as Map).cast<String, dynamic>())];
  }

  /// `accountId` and `transferAccountId` are not patchable. For a transfer the
  /// server mirrors `date` and the negated amount onto the paired row.
  Future<Transaction> update(
    String id, {
    String? date,
    int? amountCents,
    String? payeeName,
    String? categoryId,
    bool clearCategory = false,
    String? memo,
    String? cleared,
  }) async {
    final body = <String, dynamic>{};
    if (date != null) body['date'] = date;
    if (amountCents != null) body['amountCents'] = amountCents;
    if (payeeName != null) body['payeeName'] = payeeName;
    if (clearCategory) {
      body['categoryId'] = null;
    } else if (categoryId != null) {
      body['categoryId'] = categoryId;
    }
    if (memo != null) body['memo'] = memo;
    if (cleared != null) body['cleared'] = cleared;

    final json = await _api.patch('/api/v1/transactions/$id', body: body);
    return Transaction.fromJson((json as Map).cast<String, dynamic>());
  }

  /// Soft delete; the paired side of a transfer goes with it.
  Future<void> delete(String id) => _api.delete('/api/v1/transactions/$id');
}
