import '../../../core/network/api_client.dart';
import 'deposits_models.dart';

class DepositsRepository {
  final ApiClient _api;
  DepositsRepository(this._api);

  Future<DepositsData> load() async {
    final depositsJson = await _api.get('/api/v1/deposits');
    final deposits = ((depositsJson as List?) ?? const [])
        .whereType<Map>()
        .map((d) => Deposit.fromJson(d.cast<String, dynamic>()))
        .toList();

    // KDIF exposure is a nicety — a failure there must not hide the deposits.
    List<KdifBank> kdif;
    try {
      final kdifJson = await _api.get('/api/v1/deposits/kdif');
      kdif = ((kdifJson as List?) ?? const [])
          .whereType<Map>()
          .map((b) => KdifBank.fromJson(b.cast<String, dynamic>()))
          .toList();
    } catch (_) {
      kdif = const [];
    }

    return DepositsData(deposits: deposits, kdif: kdif);
  }

  Future<Deposit> byId(String id) async {
    final json = await _api.get('/api/v1/deposits/$id');
    return Deposit.fromJson((json as Map).cast<String, dynamic>());
  }

  Future<DepositSchedule> schedule(String id) async {
    final json = await _api.get('/api/v1/deposits/$id/schedule');
    return DepositSchedule.fromJson((json as Map).cast<String, dynamic>());
  }
}
