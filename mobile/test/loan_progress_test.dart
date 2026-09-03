import 'package:flutter_test/flutter_test.dart';
import 'package:pfm_mobile/features/loans/data/loans_models.dart';

/// Полоса прогресса по кредиту.
///
/// Она годами показывала ноль, и виной была не формула: считает она
/// «(тело − остаток) / тело», то есть верно. Пустой она была потому, что
/// остаток никогда не уменьшался — платежи по кредитам нигде не проводились,
/// а `paidOffCents` заполнялся только вручную при заведении займа.
///
/// С появлением проведения платежей остаток пошёл вниз сам. Тест закрепляет,
/// что полоса опирается именно на остаток: считай она от `paidOffCents`,
/// проведённые платежи снова не были бы видны.
Loan _loan({
  required int principal,
  required int currentDebt,
  int paidOff = 0,
}) =>
    Loan.fromJson({
      'id': 'ln',
      'name': 'Кредит',
      'type': 'loan',
      'principalCents': principal,
      'currentDebtCents': currentDebt,
      'paidOffCents': paidOff,
      'aprBps': 0,
      'termMonths': 12,
      'startDate': '2026-01-01',
      'monthlyPaymentCents': 1000,
      'paymentDay': 3,
      'isActive': true,
    });

void main() {
  test('прогресс считается от остатка, а не от paidOffCents', () {
    // Живой случай: Kaspi Кредит Наличными, 100 515 → 67 886,13 после одного
    // платежа. paidOffCents при этом ноль — история началась в системе.
    final loan = _loan(principal: 10051500, currentDebt: 6788613);

    expect(loan.progress, closeTo(0.324, 0.001));
  });

  test('нетронутый кредит — ноль', () {
    expect(_loan(principal: 17499000, currentDebt: 17499000).progress, 0);
  });

  test('погашенный — единица, и не больше', () {
    // Переплата не должна давать полосу длиннее полной.
    expect(_loan(principal: 1000000, currentDebt: 0).progress, 1.0);
    expect(_loan(principal: 1000000, currentDebt: -50000).progress, 1.0);
  });

  test('кредит без тела не делит на ноль', () {
    expect(_loan(principal: 0, currentDebt: 0).progress, 0);
  });
}
