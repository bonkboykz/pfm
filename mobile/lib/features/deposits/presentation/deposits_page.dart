import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons/lucide_icons.dart';

import '../../../app/theme.dart';
import '../../../core/di/di.dart';
import '../../../core/money/money.dart';
import '../../../core/network/api_client.dart';
import '../../../core/widgets/states.dart';
import '../cubit/deposits_cubit.dart';
import '../data/deposits_models.dart';
import '../data/deposits_repository.dart';

class DepositsPage extends StatelessWidget {
  const DepositsPage({super.key});

  @override
  Widget build(BuildContext context) => BlocProvider(
        create: (_) =>
            DepositsCubit(DepositsRepository(sl<ApiClient>()))..load(),
        child: const _DepositsView(),
      );
}

class _DepositsView extends StatelessWidget {
  const _DepositsView();

  @override
  Widget build(BuildContext context) => Scaffold(
        body: SafeArea(
          bottom: false,
          child: Column(
            children: [
              const DomainAppBar(title: 'Вклады'),
              Expanded(
                child: BlocBuilder<DepositsCubit, DepositsState>(
                  builder: (context, state) => switch (state.status) {
                    DepositsStatus.initial ||
                    DepositsStatus.loading =>
                      const Center(child: CircularProgressIndicator()),
                    DepositsStatus.error => ErrorStateView(
                        unauthorized: state.unauthorized,
                        error: state.error,
                        title: 'Не удалось загрузить вклады',
                        onRetry: () => context.read<DepositsCubit>().load(),
                      ),
                    DepositsStatus.ready => _Content(data: state.data!),
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

  final DepositsData data;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return RefreshIndicator(
      onRefresh: () => context.read<DepositsCubit>().load(),
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
        children: [
          if (data.deposits.isEmpty)
            const EmptyStateView(
              icon: LucideIcons.piggyBank,
              text: 'Вкладов нет',
            )
          else ...[
            SurfaceCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'На вкладах',
                    style: theme.textTheme.bodyMedium?.copyWith(
                      fontSize: 13,
                      fontWeight: FontWeight.w500,
                      color: AppColors.textSecondary,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    formatMoneySmart(data.totalBalanceCents),
                    style: theme.textTheme.headlineMedium?.copyWith(
                      fontSize: 32,
                      fontWeight: FontWeight.w800,
                      fontFeatures: kTabularFigures,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Проценты за срок: '
                    '${formatMoneySmart(data.totalProjectedInterestCents)}',
                    style: theme.textTheme.bodySmall
                        ?.copyWith(color: AppColors.positive),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            RowsCard(children: [
              for (final deposit in data.deposits)
                _DepositRow(deposit: deposit),
            ]),
            if (data.kdif.isNotEmpty) ...[
              const SizedBox(height: 20),
              _KdifSection(banks: data.kdif),
            ],
          ],
        ],
      ),
    );
  }
}

class _DepositRow extends StatelessWidget {
  const _DepositRow({required this.deposit});

  final Deposit deposit;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return InkWell(
      onTap: () => context.push('/more/deposits/${deposit.id}'),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
        child: Row(
          children: [
            Container(
              width: 38,
              height: 38,
              decoration: BoxDecoration(
                color: AppColors.positiveSoft,
                borderRadius: BorderRadius.circular(12),
              ),
              child: const Icon(LucideIcons.piggyBank,
                  size: 18, color: AppColors.positive),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    deposit.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodyLarge
                        ?.copyWith(fontSize: 15, fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    '${deposit.bankName} · '
                    '${(deposit.annualRateBps / 100).toStringAsFixed(2)}% · '
                    '${deposit.termMonths} мес.',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodySmall
                        ?.copyWith(fontSize: 12, color: AppColors.textMuted),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 12),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  formatMoneySmart(deposit.currentBalanceCents,
                      currency: deposit.currency),
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    fontFeatures: kTabularFigures,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  '+${formatMoneySmart(deposit.projectedInterestCents, currency: deposit.currency)}',
                  style: theme.textTheme.bodySmall?.copyWith(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: AppColors.positive,
                  ),
                ),
              ],
            ),
            const SizedBox(width: 6),
            const Icon(LucideIcons.chevronRight,
                size: 16, color: AppColors.textMuted),
          ],
        ),
      ),
    );
  }
}

/// Kazakhstan deposit insurance: 15 000 000 ₸ guaranteed per bank. The limit is
/// a hardcoded constant in the engine, not a per-request setting.
class _KdifSection extends StatelessWidget {
  const _KdifSection({required this.banks});

  final List<KdifBank> banks;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4),
          child: Text(
            'Страховка KDIF по банкам',
            style: theme.textTheme.bodySmall?.copyWith(
              fontSize: 13,
              fontWeight: FontWeight.w700,
              color: AppColors.textSecondary,
            ),
          ),
        ),
        const SizedBox(height: 10),
        for (final bank in banks) ...[
          SurfaceCard(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        bank.bankName,
                        style: theme.textTheme.bodyMedium?.copyWith(
                            fontSize: 14, fontWeight: FontWeight.w700),
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 10, vertical: 5),
                      decoration: BoxDecoration(
                        color: bank.isOverInsured
                            ? AppColors.negativeSoft
                            : AppColors.positiveSoft,
                        borderRadius: BorderRadius.circular(AppRadii.pill),
                      ),
                      child: Text(
                        bank.isOverInsured ? 'сверх лимита' : 'в пределах',
                        style: theme.textTheme.bodySmall?.copyWith(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: bank.isOverInsured
                              ? AppColors.negative
                              : AppColors.positive,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                ClipRRect(
                  borderRadius: BorderRadius.circular(AppRadii.pill),
                  child: LinearProgressIndicator(
                    value: bank.usage,
                    minHeight: 6,
                    backgroundColor: AppColors.neutralSoft,
                    valueColor: AlwaysStoppedAnimation(
                      bank.isOverInsured
                          ? AppColors.negative
                          : AppColors.positive,
                    ),
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  '${formatMoneySmart(bank.totalDepositsCents)} из '
                  '${formatMoneySmart(bank.guaranteeLimitCents)} · '
                  'вкладов: ${bank.depositCount}',
                  style: theme.textTheme.bodySmall
                      ?.copyWith(fontSize: 11, color: AppColors.textMuted),
                ),
                if (bank.isOverInsured) ...[
                  const SizedBox(height: 10),
                  InfoNote(
                    icon: LucideIcons.alertTriangle,
                    background: AppColors.negativeSoft,
                    foreground: AppColors.negative,
                    text: 'Не застраховано '
                        '${formatMoneySmart(bank.excessCents)} — часть суммы '
                        'стоит перевести в другой банк.',
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 12),
        ],
      ],
    );
  }
}
