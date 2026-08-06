import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:lucide_icons/lucide_icons.dart';

import '../../../app/theme.dart';
import '../../../core/dates/months.dart';
import '../../../core/di/di.dart';
import '../../../core/money/money.dart';
import '../../../core/network/api_client.dart';
import '../../../core/widgets/states.dart';
import '../cubit/deposits_cubit.dart';
import '../data/deposits_models.dart';
import '../data/deposits_repository.dart';

class DepositSchedulePage extends StatelessWidget {
  const DepositSchedulePage({super.key, required this.depositId});

  final String depositId;

  @override
  Widget build(BuildContext context) => BlocProvider(
        create: (_) => DepositScheduleCubit(
          DepositsRepository(sl<ApiClient>()),
          depositId,
        )..load(),
        child: const _View(),
      );
}

class _View extends StatelessWidget {
  const _View();

  @override
  Widget build(BuildContext context) =>
      BlocBuilder<DepositScheduleCubit, DepositScheduleState>(
        builder: (context, state) => Scaffold(
          body: SafeArea(
            bottom: false,
            child: Column(
              children: [
                DomainAppBar(title: state.deposit?.name ?? 'Вклад'),
                Expanded(
                  child: switch (state.status) {
                    DepositScheduleStatus.initial ||
                    DepositScheduleStatus.loading =>
                      const Center(child: CircularProgressIndicator()),
                    DepositScheduleStatus.error => ErrorStateView(
                        unauthorized: state.unauthorized,
                        error: state.error,
                        title: 'Не удалось загрузить график',
                        onRetry: () =>
                            context.read<DepositScheduleCubit>().load(),
                      ),
                    DepositScheduleStatus.ready => _Content(
                        deposit: state.deposit!,
                        schedule: state.schedule!,
                      ),
                  },
                ),
              ],
            ),
          ),
        ),
      );
}

class _Content extends StatelessWidget {
  const _Content({required this.deposit, required this.schedule});

  final Deposit deposit;
  final DepositSchedule schedule;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final currency = deposit.currency;

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

    final cellStyle = theme.textTheme.bodySmall?.copyWith(
      fontSize: 12,
      fontWeight: FontWeight.w600,
      fontFeatures: kTabularFigures,
    );
    final headerStyle = theme.textTheme.bodySmall
        ?.copyWith(fontSize: 11, color: AppColors.textMuted);

    return RefreshIndicator(
      onRefresh: () => context.read<DepositScheduleCubit>().load(),
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
        children: [
          SurfaceCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Сейчас на вкладе',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                    color: AppColors.textSecondary,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  formatMoneySmart(deposit.currentBalanceCents,
                      currency: currency),
                  style: theme.textTheme.headlineMedium?.copyWith(
                    fontSize: 32,
                    fontWeight: FontWeight.w800,
                    fontFeatures: kTabularFigures,
                  ),
                ),
                const SizedBox(height: 14),
                Row(
                  children: [
                    cell(
                      'Ставка',
                      '${(deposit.annualRateBps / 100).toStringAsFixed(2)}%',
                      AppColors.textPrimary,
                    ),
                    divider,
                    cell('Срок', '${deposit.termMonths} мес.',
                        AppColors.textPrimary),
                    divider,
                    cell(
                      'Проценты',
                      formatMoneySmart(deposit.projectedInterestCents,
                          currency: currency),
                      AppColors.positive,
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                InfoNote(
                  text: '${deposit.bankName} · '
                      '${depositTypeLabel(deposit.type).toLowerCase()} · '
                      '${capitalizationLabel(deposit.capitalization)}'
                      '${deposit.isWithdrawable ? " · со снятием" : ""}'
                      '${deposit.isReplenishable ? " · с пополнением" : ""}',
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          if (schedule.rows.isEmpty)
            const EmptyStateView(
              icon: LucideIcons.calendarX,
              text: 'График пуст',
              hint: 'У вклада нулевой срок или нулевая сумма.',
            )
          else ...[
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
              child: Text(
                'Как растут проценты',
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
                        child: Text('Проценты',
                            textAlign: TextAlign.right, style: headerStyle),
                      ),
                      Expanded(
                        child: Text('Накоплено',
                            textAlign: TextAlign.right, style: headerStyle),
                      ),
                      Expanded(
                        child: Text('Баланс',
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
                                  fontSize: 12,
                                  color: AppColors.textSecondary),
                            ),
                          ),
                          Expanded(
                            child: Text(
                              formatMoneySmart(row.interestCents,
                                  currency: currency),
                              textAlign: TextAlign.right,
                              style: cellStyle?.copyWith(
                                  color: AppColors.positive),
                            ),
                          ),
                          Expanded(
                            child: Text(
                              formatMoneySmart(row.cumulativeInterestCents,
                                  currency: currency),
                              textAlign: TextAlign.right,
                              style: cellStyle,
                            ),
                          ),
                          Expanded(
                            child: Text(
                              formatMoneySmart(row.endBalanceCents,
                                  currency: currency),
                              textAlign: TextAlign.right,
                              style: cellStyle,
                            ),
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
        ],
      ),
    );
  }
}
