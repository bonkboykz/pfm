import '../../../core/network/api_client.dart';
import '../../loans/data/loans_models.dart';
import '../../loans/data/loans_repository.dart';
import 'payoff_models.dart';

class PayoffRepository {
  final ApiClient _api;
  final LoansRepository _loans;

  PayoffRepository(ApiClient api)
      : _api = api,
        _loans = LoansRepository(api);

  Future<List<Loan>> loans() async => (await _loans.list()).loans;

  /// The simulator takes at most 20 debts and requires a positive balance and
  /// a positive minimum payment, so paid-off and zero-payment loans are
  /// filtered out before the call rather than letting the server 400.
  Future<PayoffComparison> compare({
    required List<Loan> loans,
    required int extraMonthlyCents,
    String? startDate,
  }) async {
    final debts = [
      for (final l in loans.where(
          (l) => l.currentDebtCents > 0 && l.monthlyPaymentCents > 0))
        {
          'id': l.id,
          'name': l.name,
          'type': _debtType(l.type),
          'balanceCents': l.currentDebtCents,
          'aprBps': l.aprBps,
          'minPaymentCents': l.monthlyPaymentCents,
        }
    ].take(20).toList();

    final json = await _api.post('/api/v1/simulate/compare', body: {
      'debts': debts,
      'extraMonthlyCents': extraMonthlyCents,
      'startDate': ?startDate,
    });
    return PayoffComparison.fromJson((json as Map).cast<String, dynamic>());
  }

  /// The simulator's debt type enum is narrower than the loan type enum.
  static String _debtType(String loanType) => switch (loanType) {
        'installment' => 'installment',
        'credit_line' => 'credit_card',
        _ => 'loan',
      };
}
