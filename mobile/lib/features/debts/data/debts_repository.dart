import '../../../core/network/api_client.dart';
import 'debts_models.dart';

class DebtsRepository {
  final ApiClient _api;
  DebtsRepository(this._api);

  Future<DebtsData> list({bool includeSettled = false}) async {
    final json = await _api.get(
      '/api/v1/debts',
      query: includeSettled ? {'includeSettled': 'true'} : null,
    );
    final map = (json as Map).cast<String, dynamic>();
    return DebtsData(((map['debts'] as List?) ?? const [])
        .whereType<Map>()
        .map((d) => PersonalDebt.fromJson(d.cast<String, dynamic>()))
        .toList());
  }

  Future<void> create({
    required String personName,
    required String direction,
    required int amountCents,
    required String currency,
    String? dueDate,
    String? note,
  }) async {
    await _api.post('/api/v1/debts', body: {
      'personName': personName,
      'direction': direction,
      'amountCents': amountCents,
      'currency': currency,
      if (dueDate != null && dueDate.isNotEmpty) 'dueDate': dueDate,
      if (note != null && note.isNotEmpty) 'note': note,
    });
  }

  /// Marks settled with today's date. Calling it twice returns 400.
  Future<void> settle(String id) => _api.post('/api/v1/debts/$id/settle');

  /// The only physical delete in the whole API — there is no soft flag to undo.
  Future<void> delete(String id) => _api.delete('/api/v1/debts/$id');
}
