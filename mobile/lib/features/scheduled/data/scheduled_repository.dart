import '../../../core/network/api_client.dart';
import 'scheduled_models.dart';

class ScheduledRepository {
  final ApiClient _api;
  ScheduledRepository(this._api);

  /// `upcoming` filters on `next_date <= today + N`, so overdue rules are
  /// always included. Omitting it lists everything active.
  Future<ScheduledData> list() async {
    final json = await _api.get('/api/v1/scheduled');
    final map = (json as Map).cast<String, dynamic>();
    return ScheduledData(((map['scheduled'] as List?) ?? const [])
        .whereType<Map>()
        .map((s) => ScheduledTransaction.fromJson(s.cast<String, dynamic>()))
        .toList());
  }

  /// Materialises every due occurrence and advances `nextDate`. This writes
  /// real transactions — never call it without an explicit confirmation.
  Future<ProcessResult> process() async {
    final json = await _api.post('/api/v1/scheduled/process');
    return ProcessResult.fromJson((json as Map).cast<String, dynamic>());
  }

  Future<void> delete(String id) => _api.delete('/api/v1/scheduled/$id');
}
