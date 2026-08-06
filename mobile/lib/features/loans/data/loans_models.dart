/// Manual parsing of `GET /api/v1/loans` and `/loans/:id/schedule`.
///
/// Loans have no currency column at all, so every amount here is KZT.
/// `penaltyRateBps` and `earlyRepaymentFeeCents` have no `*Formatted` twin.
library;

class Loan {
  final String id;
  final String name;
  final String type; // loan | installment | credit_line
  final String? accountId;
  final String? categoryId;
  final int principalCents;
  final int aprBps;
  final int termMonths;
  final String startDate;
  final int monthlyPaymentCents;
  final int paymentDay;
  final int penaltyRateBps;
  final int earlyRepaymentFeeCents;
  final int paidOffCents;
  final int currentDebtCents;
  final String? note;

  const Loan({
    required this.id,
    required this.name,
    required this.type,
    required this.accountId,
    required this.categoryId,
    required this.principalCents,
    required this.aprBps,
    required this.termMonths,
    required this.startDate,
    required this.monthlyPaymentCents,
    required this.paymentDay,
    required this.penaltyRateBps,
    required this.earlyRepaymentFeeCents,
    required this.paidOffCents,
    required this.currentDebtCents,
    required this.note,
  });

  factory Loan.fromJson(Map<String, dynamic> json) => Loan(
        id: (json['id'] ?? '').toString(),
        name: (json['name'] ?? '').toString(),
        type: (json['type'] ?? '').toString(),
        accountId: json['accountId']?.toString(),
        categoryId: json['categoryId']?.toString(),
        principalCents: (json['principalCents'] as num?)?.toInt() ?? 0,
        aprBps: (json['aprBps'] as num?)?.toInt() ?? 0,
        termMonths: (json['termMonths'] as num?)?.toInt() ?? 0,
        startDate: (json['startDate'] ?? '').toString(),
        monthlyPaymentCents:
            (json['monthlyPaymentCents'] as num?)?.toInt() ?? 0,
        paymentDay: (json['paymentDay'] as num?)?.toInt() ?? 1,
        penaltyRateBps: (json['penaltyRateBps'] as num?)?.toInt() ?? 0,
        earlyRepaymentFeeCents:
            (json['earlyRepaymentFeeCents'] as num?)?.toInt() ?? 0,
        paidOffCents: (json['paidOffCents'] as num?)?.toInt() ?? 0,
        currentDebtCents: (json['currentDebtCents'] as num?)?.toInt() ?? 0,
        note: json['note']?.toString(),
      );

  bool get isInterestFree => aprBps == 0;
  bool get isPaidOff => currentDebtCents <= 0;

  double get progress {
    if (principalCents <= 0) return 0;
    final repaid = principalCents - currentDebtCents;
    return (repaid / principalCents).clamp(0.0, 1.0);
  }
}

const loanTypes = <String, String>{
  'loan': 'Кредит',
  'installment': 'Рассрочка',
  'credit_line': 'Кредитная линия',
};

String loanTypeLabel(String type) => loanTypes[type] ?? type;

class LoanScheduleRow {
  final int month;
  final String date; // YYYY-MM
  final int startBalanceCents;
  final int principalCents;
  final int interestCents;
  final int paymentCents;
  final int endBalanceCents;

  const LoanScheduleRow({
    required this.month,
    required this.date,
    required this.startBalanceCents,
    required this.principalCents,
    required this.interestCents,
    required this.paymentCents,
    required this.endBalanceCents,
  });

  factory LoanScheduleRow.fromJson(Map<String, dynamic> json) =>
      LoanScheduleRow(
        month: (json['month'] as num?)?.toInt() ?? 0,
        date: (json['date'] ?? '').toString(),
        startBalanceCents: (json['startBalanceCents'] as num?)?.toInt() ?? 0,
        principalCents: (json['principalCents'] as num?)?.toInt() ?? 0,
        interestCents: (json['interestCents'] as num?)?.toInt() ?? 0,
        paymentCents: (json['paymentCents'] as num?)?.toInt() ?? 0,
        endBalanceCents: (json['endBalanceCents'] as num?)?.toInt() ?? 0,
      );
}

class LoanSchedule {
  final String loanId;
  final String loanName;
  final List<LoanScheduleRow> rows;

  const LoanSchedule({
    required this.loanId,
    required this.loanName,
    required this.rows,
  });

  factory LoanSchedule.fromJson(Map<String, dynamic> json) => LoanSchedule(
        loanId: (json['loanId'] ?? '').toString(),
        loanName: (json['loanName'] ?? '').toString(),
        rows: ((json['schedule'] as List?) ?? const [])
            .whereType<Map>()
            .map((r) => LoanScheduleRow.fromJson(r.cast<String, dynamic>()))
            .toList(),
      );

  int get totalInterestCents =>
      rows.fold(0, (acc, r) => acc + r.interestCents);

  int get totalPaymentCents => rows.fold(0, (acc, r) => acc + r.paymentCents);

  int get peakBalanceCents =>
      rows.fold(0, (acc, r) => r.startBalanceCents > acc ? r.startBalanceCents : acc);
}

class LoansData {
  final List<Loan> loans;

  const LoansData(this.loans);

  int get totalDebtCents =>
      loans.fold(0, (acc, l) => acc + l.currentDebtCents);

  int get monthlyPaymentCents =>
      loans.where((l) => !l.isPaidOff).fold(0, (acc, l) => acc + l.monthlyPaymentCents);
}
