import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../../app/theme.dart';
import '../../../core/di/di.dart';
import '../../../core/money/money.dart';
import '../../../core/network/api_client.dart';
import '../../../core/widgets/states.dart';
import '../cubit/loans_cubit.dart';
import '../data/loans_models.dart';
import '../data/loans_repository.dart';

class LoansPage extends StatelessWidget {
  const LoansPage({super.key});

  @override
  Widget build(BuildContext context) => BlocProvider(
        create: (_) => LoansCubit(LoansRepository(sl<ApiClient>()))..load(),
        child: const _LoansView(),
      );
}

class _LoansView extends StatelessWidget {
  const _LoansView();

  @override
  Widget build(BuildContext context) => Scaffold(
        body: SafeArea(
          bottom: false,
          child: Column(
            children: [
              const DomainAppBar(title: 'Кредиты'),
              Expanded(
                child: BlocBuilder<LoansCubit, LoansState>(
                  builder: (context, state) => switch (state.status) {
                    LoansStatus.initial ||
                    LoansStatus.loading =>
                      const Center(child: CircularProgressIndicator()),
                    LoansStatus.error => ErrorStateView(
                        unauthorized: state.unauthorized,
                        error: state.error,
                        title: 'Не удалось загрузить кредиты',
                        onRetry: () => context.read<LoansCubit>().load(),
                      ),
                    LoansStatus.ready => _Content(data: state.data!),
                  },
                ),
              ),
            ],
          ),
        ),
      );
}

class _Content extends StatelessWidget {
  const _Content({required this.data});

  final LoansData data;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return RefreshIndicator(
      onRefresh: () => context.read<LoansCubit>().load(),
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
        children: [
          if (data.loans.isEmpty)
            const EmptyStateView(
              icon: LucideIcons.creditCard,
              text: 'Кредитов нет',
            )
          else ...[
            SurfaceCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Всего долг по кредитам',
                    style: theme.textTheme.bodyMedium?.copyWith(
                      fontSize: 13,
                      fontWeight: FontWeight.w500,
                      color: AppColors.textSecondary,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    formatMoneySmart(data.totalDebtCents),
                    style: theme.textTheme.headlineMedium?.copyWith(
                      fontSize: 32,
                      fontWeight: FontWeight.w800,
                      fontFeatures: kTabularFigures,
                      color: AppColors.negative,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Платежей в месяц: '
                    '${formatMoneySmart(data.monthlyPaymentCents)}',
                    style: theme.textTheme.bodySmall
                        ?.copyWith(color: AppColors.textSecondary),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            RowsCard(
              children: [for (final loan in data.loans) _LoanRow(loan: loan)],
            ),
          ],
        ],
      ),
    );
  }
}

class _LoanRow extends StatelessWidget {
  const _LoanRow({required this.loan});

  final Loan loan;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    final subtitle = [
      loanTypeLabel(loan.type),
      loan.isInterestFree ? 'без %' : '${(loan.aprBps / 100).toStringAsFixed(2)}%',
      '${formatMoneySmart(loan.monthlyPaymentCents)} до ${loan.paymentDay}-го',
    ].join(' · ');

    return InkWell(
      onTap: () => context.push('/more/loans/${loan.id}'),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
        child: Column(
          children: [
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        loan.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.bodyLarge?.copyWith(
                            fontSize: 15, fontWeight: FontWeight.w600),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        subtitle,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.bodySmall
                            ?.copyWith(fontSize: 12, color: AppColors.textMuted),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 12),
                Text(
                  formatMoneySmart(loan.currentDebtCents),
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    fontFeatures: kTabularFigures,
                    color: loan.isPaidOff
                        ? AppColors.positive
                        : AppColors.textPrimary,
                  ),
                ),
                const SizedBox(width: 6),
                const Icon(LucideIcons.chevronRight,
                    size: 16, color: AppColors.textMuted),
              ],
            ),
            const SizedBox(height: 10),
            ClipRRect(
              borderRadius: BorderRadius.circular(AppRadii.pill),
              child: LinearProgressIndicator(
                value: loan.progress,
                minHeight: 5,
                backgroundColor: AppColors.neutralSoft,
                valueColor: AlwaysStoppedAnimation(
                  loan.isPaidOff ? AppColors.positive : AppColors.accent,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
