import '../../../core/network/api_client.dart';
import 'accounts_models.dart';

class AccountsRepository {
  final ApiClient _api;
  AccountsRepository(this._api);

  Future<AccountsData> list() async {
    final json = await _api.get('/api/v1/accounts');
    final accounts = ((json as List?) ?? const [])
        .whereType<Map>()
        .map((a) => Account.fromJson(a.cast<String, dynamic>()))
        .toList();
    return AccountsData(accounts);
  }

  Future<Account> byId(String id) async {
    final json = await _api.get('/api/v1/accounts/$id');
    return Account.fromJson((json as Map).cast<String, dynamic>());
  }

  /// POST echoes the raw DB row — no computed balances, no `*Formatted` — so
  /// callers must refetch the list rather than trusting the response.
  Future<void> create({
    required String name,
    required String type,
    required String currency,
    required bool onBudget,
  }) async {
    await _api.post('/api/v1/accounts', body: {
      'name': name,
      'type': type,
      'currency': currency,
      // The server forces onBudget=false for tracking accounts anyway.
      'onBudget': type == 'tracking' ? false : onBudget,
    });
  }
}
