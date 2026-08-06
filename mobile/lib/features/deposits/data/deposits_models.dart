/// Manual parsing of `GET /api/v1/deposits`, `/deposits/kdif` and
/// `/deposits/:id/schedule`.
///
/// Deposits carry a `currency` column but the server formats their amounts in
/// KZT regardless, so everything here is formatted client-side from cents.
/// `effectiveAnnualRateBps` exists on the engine's summary but the deposit
/// routes never return it — only `/simulate/deposit-compare` does.
library;

class Deposit {
  final String id;
  final String name;
  final String bankName;
  final String type; // term | savings | demand
  final String? accountId;
  final int initialAmountCents;
  final String currency;
  final int annualRateBps;
  final int earlyWithdrawalRateBps;
  final int termMonths;
  final String startDate;
  final String? endDate;
  final String capitalization;
  final bool isWithdrawable;
  final bool isReplenishable;
  final int topUpCents;
  final int currentBalanceCents;
  final int projectedInterestCents;
  final String? note;

  const Deposit({
    required this.id,
    required this.name,
    required this.bankName,
    required this.type,
    required this.accountId,
    required this.initialAmountCents,
    required this.currency,
    required this.annualRateBps,
    required this.earlyWithdrawalRateBps,
    required this.termMonths,
    required this.startDate,
    required this.endDate,
    required this.capitalization,
    required this.isWithdrawable,
    required this.isReplenishable,
    required this.topUpCents,
    required this.currentBalanceCents,
    required this.projectedInterestCents,
    required this.note,
  });

  factory Deposit.fromJson(Map<String, dynamic> json) => Deposit(
        id: (json['id'] ?? '').toString(),
        name: (json['name'] ?? '').toString(),
        bankName: (json['bankName'] ?? '').toString(),
        type: (json['type'] ?? '').toString(),
        accountId: json['accountId']?.toString(),
        initialAmountCents: (json['initialAmountCents'] as num?)?.toInt() ?? 0,
        currency: (json['currency'] ?? 'KZT').toString(),
        annualRateBps: (json['annualRateBps'] as num?)?.toInt() ?? 0,
        earlyWithdrawalRateBps:
            (json['earlyWithdrawalRateBps'] as num?)?.toInt() ?? 0,
        termMonths: (json['termMonths'] as num?)?.toInt() ?? 0,
        startDate: (json['startDate'] ?? '').toString(),
        endDate: json['endDate']?.toString(),
        capitalization: (json['capitalization'] ?? 'none').toString(),
        isWithdrawable: json['isWithdrawable'] == true,
        isReplenishable: json['isReplenishable'] == true,
        topUpCents: (json['topUpCents'] as num?)?.toInt() ?? 0,
        currentBalanceCents:
            (json['currentBalanceCents'] as num?)?.toInt() ?? 0,
        projectedInterestCents:
            (json['projectedInterestCents'] as num?)?.toInt() ?? 0,
        note: json['note']?.toString(),
      );
}

const depositTypes = <String, String>{
  'term': 'Срочный',
  'savings': 'Сберегательный',
  'demand': 'До востребования',
};

const capitalizationLabels = <String, String>{
  'monthly': 'ежемесячная капитализация',
  'quarterly': 'ежеквартальная капитализация',
  'at_end': 'проценты в конце срока',
  'none': 'без капитализации',
};

String depositTypeLabel(String type) => depositTypes[type] ?? type;
String capitalizationLabel(String value) =>
    capitalizationLabels[value] ?? value;

class KdifBank {
  final String bankName;
  final int totalDepositsCents;
  final int depositCount;
  final int guaranteeLimitCents;
  final bool isOverInsured;
  final int excessCents;

  const KdifBank({
    required this.bankName,
    required this.totalDepositsCents,
    required this.depositCount,
    required this.guaranteeLimitCents,
    required this.isOverInsured,
    required this.excessCents,
  });

  factory KdifBank.fromJson(Map<String, dynamic> json) => KdifBank(
        bankName: (json['bankName'] ?? '').toString(),
        totalDepositsCents: (json['totalDepositsCents'] as num?)?.toInt() ?? 0,
        depositCount: (json['depositCount'] as num?)?.toInt() ?? 0,
        guaranteeLimitCents:
            (json['guaranteeLimitCents'] as num?)?.toInt() ?? 0,
        isOverInsured: json['isOverInsured'] == true,
        excessCents: (json['excessCents'] as num?)?.toInt() ?? 0,
      );

  double get usage => guaranteeLimitCents <= 0
      ? 0
      : (totalDepositsCents / guaranteeLimitCents).clamp(0.0, 1.0);
}

class DepositScheduleRow {
  final int month;
  final String date;
  final int startBalanceCents;
  final int interestCents;
  final int capitalizedCents;
  final int endBalanceCents;
  final int cumulativeInterestCents;

  const DepositScheduleRow({
    required this.month,
    required this.date,
    required this.startBalanceCents,
    required this.interestCents,
    required this.capitalizedCents,
    required this.endBalanceCents,
    required this.cumulativeInterestCents,
  });

  factory DepositScheduleRow.fromJson(Map<String, dynamic> json) =>
      DepositScheduleRow(
        month: (json['month'] as num?)?.toInt() ?? 0,
        date: (json['date'] ?? '').toString(),
        startBalanceCents: (json['startBalanceCents'] as num?)?.toInt() ?? 0,
        interestCents: (json['interestCents'] as num?)?.toInt() ?? 0,
        capitalizedCents: (json['capitalizedCents'] as num?)?.toInt() ?? 0,
        endBalanceCents: (json['endBalanceCents'] as num?)?.toInt() ?? 0,
        cumulativeInterestCents:
            (json['cumulativeInterestCents'] as num?)?.toInt() ?? 0,
      );
}

class DepositSchedule {
  final String depositId;
  final String depositName;
  final List<DepositScheduleRow> rows;

  const DepositSchedule({
    required this.depositId,
    required this.depositName,
    required this.rows,
  });

  factory DepositSchedule.fromJson(Map<String, dynamic> json) =>
      DepositSchedule(
        depositId: (json['depositId'] ?? '').toString(),
        depositName: (json['depositName'] ?? '').toString(),
        rows: ((json['schedule'] as List?) ?? const [])
            .whereType<Map>()
            .map((r) => DepositScheduleRow.fromJson(r.cast<String, dynamic>()))
            .toList(),
      );

  int get peakBalanceCents =>
      rows.fold(0, (acc, r) => r.endBalanceCents > acc ? r.endBalanceCents : acc);
}

class DepositsData {
  final List<Deposit> deposits;
  final List<KdifBank> kdif;

  const DepositsData({required this.deposits, required this.kdif});

  int get totalBalanceCents =>
      deposits.fold(0, (acc, d) => acc + d.currentBalanceCents);

  int get totalProjectedInterestCents =>
      deposits.fold(0, (acc, d) => acc + d.projectedInterestCents);

  bool get hasOverInsured => kdif.any((b) => b.isOverInsured);
}
