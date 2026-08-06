import '../../../core/network/api_client.dart';
import 'loans_models.dart';

class LoansRepository {
  final ApiClient _api;
  LoansRepository(this._api);

  Future<LoansData> list() async {
    final json = await _api.get('/api/v1/loans');
    return LoansData(((json as List?) ?? const [])
        .whereType<Map>()
        .map((l) => Loan.fromJson(l.cast<String, dynamic>()))
        .toList());
  }

  Future<Loan> byId(String id) async {
    final json = await _api.get('/api/v1/loans/$id');
    return Loan.fromJson((json as Map).cast<String, dynamic>());
  }

  /// Always the full remaining term — the route takes no query parameters and
  /// stops early once the balance reaches zero.
  Future<LoanSchedule> schedule(String id) async {
    final json = await _api.get('/api/v1/loans/$id/schedule');
    return LoanSchedule.fromJson((json as Map).cast<String, dynamic>());
  }
}
