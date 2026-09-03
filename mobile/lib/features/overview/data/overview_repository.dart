import '../../../core/network/api_client.dart';
import 'overview_models.dart';

class OverviewRepository {
  final ApiClient _api;
  OverviewRepository(this._api);

  Future<MonthOverview> load(String month) async {
    final json = await _api.get('/api/v1/budget/$month/overview');
    return MonthOverview.fromJson((json as Map).cast<String, dynamic>());
  }
}
