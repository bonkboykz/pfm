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
  static List<Map<String, Object>> _debts(List<Loan> loans) => [
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

  Future<PayoffComparison> compare({
    required List<Loan> loans,
    required int extraMonthlyCents,
    String? startDate,
  }) async {
    final json = await _api.post('/api/v1/simulate/compare', body: {
      'debts': _debts(loans),
      'extraMonthlyCents': extraMonthlyCents,
      'startDate': ?startDate,
    });
    return PayoffComparison.fromJson((json as Map).cast<String, dynamic>());
  }

  /// One strategy at a time — this is what the slider re-runs. `compare` would
  /// simulate all four on every drag, and only the selected one is on screen.
  Future<StrategyResult> simulate({
    required List<Loan> loans,
    required String strategy,
    required int extraMonthlyCents,
    String? startDate,
  }) async {
    final json = await _api.post('/api/v1/simulate/payoff', body: {
      'debts': _debts(loans),
      'strategy': strategy,
      'extraMonthlyCents': extraMonthlyCents,
      'startDate': ?startDate,
    });
    return StrategyResult.fromJson((json as Map).cast<String, dynamic>());
  }

  /// The simulator's debt type enum is narrower than the loan type enum.
  static String _debtType(String loanType) => switch (loanType) {
        'installment' => 'installment',
        'credit_line' => 'credit_card',
        _ => 'loan',
      };
}
