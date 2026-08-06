import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:lucide_icons/lucide_icons.dart';

import '../../../app/theme.dart';
import '../../../core/dates/months.dart';
import '../../../core/di/di.dart';
import '../../../core/money/money.dart';
import '../../../core/network/api_client.dart';
import '../../../core/widgets/states.dart';
import '../cubit/loans_cubit.dart';
import '../data/loans_models.dart';
import '../data/loans_repository.dart';

class LoanSchedulePage extends StatelessWidget {
  const LoanSchedulePage({super.key, required this.loanId});

  final String loanId;

  @override
  Widget build(BuildContext context) => BlocProvider(
        create: (_) =>
            LoanScheduleCubit(LoansRepository(sl<ApiClient>()), loanId)..load(),
        child: const _ScheduleView(),
      );
}

class _ScheduleView extends StatelessWidget {
  const _ScheduleView();

  @override
  Widget build(BuildContext context) =>
      BlocBuilder<LoanScheduleCubit, LoanScheduleState>(
        builder: (context, state) => Scaffold(
          body: SafeArea(
            bottom: false,
            child: Column(
              children: [
                DomainAppBar(title: state.loan?.name ?? 'Кредит'),
                Expanded(
                  child: switch (state.status) {
                    ScheduleStatus.initial ||
                    ScheduleStatus.loading =>
                      const Center(child: CircularProgressIndicator()),
                    ScheduleStatus.error => ErrorStateView(
                        unauthorized: state.unauthorized,
                        error: state.error,
                        title: 'Не удалось загрузить график',
                        onRetry: () =>
                            context.read<LoanScheduleCubit>().load(),
                      ),
                    ScheduleStatus.ready =>
                      _Content(loan: state.loan!, schedule: state.schedule!),
                  },
                ),
              ],
            ),
          ),
        ),
      );
}

class _Content extends StatelessWidget {
  const _Content({required this.loan, required this.schedule});

  final Loan loan;
  final LoanSchedule schedule;

  @override
  Widget build(BuildContext context) => RefreshIndicator(
        onRefresh: () => context.read<LoanScheduleCubit>().load(),
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
          children: [
            _SummaryCard(loan: loan, schedule: schedule),
            const SizedBox(height: 16),
            if (schedule.rows.isEmpty)
              const EmptyStateView(
                icon: LucideIcons.calendarX,
                text: 'График пуст',
                hint: 'Кредит уже погашен либо у него нулевой остаток.',
              )
            else ...[
              _BalanceChart(schedule: schedule),
              const SizedBox(height: 16),
              _ScheduleTable(schedule: schedule),
            ],
          ],
        ),
      );
}

class _SummaryCard extends StatelessWidget {
  const _SummaryCard({required this.loan, required this.schedule});

  final Loan loan;
  final LoanSchedule schedule;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    Widget cell(String label, String value, Color color) => Expanded(
          child: Column(
            children: [
              Text(label,
                  style: theme.textTheme.bodySmall
                      ?.copyWith(fontSize: 11, color: AppColors.textMuted)),
              const SizedBox(height: 4),
              Text(
                value,
                style: theme.textTheme.titleMedium?.copyWith(
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                  fontFeatures: kTabularFigures,
                  color: color,
                ),
              ),
            ],
          ),
        );

    const divider = SizedBox(
      height: 34,
      child: VerticalDivider(width: 1, thickness: 1, color: AppColors.border),
    );

    return SurfaceCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Остаток долга',
                      style: theme.textTheme.bodyMedium?.copyWith(
                        fontSize: 13,
                        fontWeight: FontWeight.w500,
                        color: AppColors.textSecondary,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      formatMoneySmart(loan.currentDebtCents),
                      style: theme.textTheme.headlineMedium?.copyWith(
                        fontSize: 32,
                        fontWeight: FontWeight.w800,
                        fontFeatures: kTabularFigures,
                        color: AppColors.negative,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 10),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
                decoration: BoxDecoration(
                  color: AppColors.accentSoft,
                  borderRadius: BorderRadius.circular(AppRadii.pill),
                ),
                child: Text(
                  loanTypeLabel(loan.type),
                  style: theme.textTheme.bodySmall?.copyWith(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: AppColors.accent,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              cell(
                'Ставка',
                loan.isInterestFree
                    ? 'без %'
                    : '${(loan.aprBps / 100).toStringAsFixed(2)}%',
                AppColors.textPrimary,
              ),
              divider,
              cell('Платёж', formatMoneySmart(loan.monthlyPaymentCents),
                  AppColors.textPrimary),
              divider,
              cell(
                'Переплата',
                formatMoneySmart(schedule.totalInterestCents),
                schedule.totalInterestCents > 0
                    ? AppColors.warning
                    : AppColors.positive,
              ),
            ],
          ),
          const SizedBox(height: 12),
          InfoNote(
            text: 'Осталось платежей: ${schedule.rows.length}, '
                'последний — ${schedule.rows.isEmpty ? "—" : formatMonthInline(schedule.rows.last.date)}. '
                'Платёж ${loan.paymentDay}-го числа.',
          ),
        ],
      ),
    );
  }
}

/// Remaining balance over time, drawn as bars — the schedule is short enough
/// (single-digit to a few dozen rows) that a full chart library adds nothing.
class _BalanceChart extends StatelessWidget {
  const _BalanceChart({required this.schedule});

  final LoanSchedule schedule;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final peak = schedule.peakBalanceCents;
    final rows = schedule.rows;
    final step = (rows.length / 24).ceil().clamp(1, 12);
    final shown = [
      for (var i = 0; i < rows.length; i += step) rows[i],
    ];

    return SurfaceCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Как тает долг',
            style: theme.textTheme.bodyMedium
                ?.copyWith(fontSize: 14, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 14),
          SizedBox(
            height: 110,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                for (final row in shown)
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 1.5),
                      child: Container(
                        height: peak <= 0
                            ? 2
                            : (row.endBalanceCents / peak * 110)
                                .clamp(2.0, 110.0),
                        decoration: BoxDecoration(
                          color: AppColors.accent,
                          borderRadius: const BorderRadius.vertical(
                              top: Radius.circular(3)),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                rows.isEmpty ? '' : formatMonthInline(rows.first.date),
                style: theme.textTheme.bodySmall
                    ?.copyWith(fontSize: 10, color: AppColors.textMuted),
              ),
              Text(
                rows.isEmpty ? '' : formatMonthInline(rows.last.date),
                style: theme.textTheme.bodySmall
                    ?.copyWith(fontSize: 10, color: AppColors.textMuted),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ScheduleTable extends StatelessWidget {
  const _ScheduleTable({required this.schedule});

  final LoanSchedule schedule;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    final headerStyle = theme.textTheme.bodySmall
        ?.copyWith(fontSize: 11, color: AppColors.textMuted);
    final cellStyle = theme.textTheme.bodySmall?.copyWith(
      fontSize: 12,
      fontWeight: FontWeight.w600,
      fontFeatures: kTabularFigures,
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
          child: Text(
            'График платежей',
            style: theme.textTheme.bodySmall?.copyWith(
              fontSize: 13,
              fontWeight: FontWeight.w700,
              color: AppColors.textSecondary,
            ),
          ),
        ),
        const SizedBox(height: 8),
        SurfaceCard(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
          child: Column(
            children: [
              Row(
                children: [
                  SizedBox(
                      width: 62, child: Text('Месяц', style: headerStyle)),
                  Expanded(
                    child: Text('Основной',
                        textAlign: TextAlign.right, style: headerStyle),
                  ),
                  Expanded(
                    child: Text('Проценты',
                        textAlign: TextAlign.right, style: headerStyle),
                  ),
                  Expanded(
                    child: Text('Остаток',
                        textAlign: TextAlign.right, style: headerStyle),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              const Divider(height: 1),
              for (final row in schedule.rows) ...[
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 9),
                  child: Row(
                    children: [
                      SizedBox(
                        width: 62,
                        child: Text(
                          formatMonthInline(row.date).split(' ').first,
                          style: theme.textTheme.bodySmall?.copyWith(
                              fontSize: 12, color: AppColors.textSecondary),
                        ),
                      ),
                      Expanded(
                        child: Text(formatMoneySmart(row.principalCents),
                            textAlign: TextAlign.right, style: cellStyle),
                      ),
                      Expanded(
                        child: Text(
                          formatMoneySmart(row.interestCents),
                          textAlign: TextAlign.right,
                          style: cellStyle?.copyWith(
                            color: row.interestCents > 0
                                ? AppColors.warning
                                : AppColors.textMuted,
                          ),
                        ),
                      ),
                      Expanded(
                        child: Text(formatMoneySmart(row.endBalanceCents),
                            textAlign: TextAlign.right, style: cellStyle),
                      ),
                    ],
                  ),
                ),
                if (row != schedule.rows.last) const Divider(height: 1),
              ],
            ],
          ),
        ),
      ],
    );
  }
}
