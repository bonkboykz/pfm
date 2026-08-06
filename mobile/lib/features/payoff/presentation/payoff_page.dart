import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:lucide_icons/lucide_icons.dart';

import '../../../app/theme.dart';
import '../../../core/dates/months.dart';
import '../../../core/di/di.dart';
import '../../../core/money/money.dart';
import '../../../core/network/api_client.dart';
import '../../../core/widgets/states.dart';
import '../cubit/payoff_cubit.dart';
import '../data/payoff_models.dart';
import '../data/payoff_repository.dart';

class PayoffPage extends StatelessWidget {
  const PayoffPage({super.key});

  @override
  Widget build(BuildContext context) => BlocProvider(
        create: (_) => PayoffCubit(PayoffRepository(sl<ApiClient>()))..load(),
        child: const _PayoffView(),
      );
}

class _PayoffView extends StatelessWidget {
  const _PayoffView();

  @override
  Widget build(BuildContext context) => Scaffold(
        body: SafeArea(
          bottom: false,
          child: Column(
            children: [
              const DomainAppBar(title: 'Симулятор погашения'),
              Expanded(
                child: BlocBuilder<PayoffCubit, PayoffState>(
                  builder: (context, state) => switch (state.status) {
                    PayoffStatus.initial ||
                    PayoffStatus.loading =>
                      const Center(child: CircularProgressIndicator()),
                    PayoffStatus.error => ErrorStateView(
                        unauthorized: state.unauthorized,
                        error: state.error,
                        title: 'Не удалось посчитать',
                        onRetry: () => context.read<PayoffCubit>().load(),
                      ),
                    PayoffStatus.ready => _Content(state: state),
                  },
                ),
              ),
            ],
          ),
        ),
      );
}

class _Content extends StatefulWidget {
  const _Content({required this.state});

  final PayoffState state;

  @override
  State<_Content> createState() => _ContentState();
}

class _ContentState extends State<_Content> {
  late final TextEditingController _extra = TextEditingController(
    text: widget.state.extraMonthlyCents == 0
        ? ''
        : formatMoneyInput(widget.state.extraMonthlyCents),
  );

  @override
  void dispose() {
    _extra.dispose();
    super.dispose();
  }

  Future<void> _recalculate() async {
    final cubit = context.read<PayoffCubit>();
    cubit.setExtra(parseMoneyToCents(_extra.text) ?? 0);
    FocusScope.of(context).unfocus();
    final error = await cubit.simulate();
    if (!mounted || error == null) return;
    showToast(context, error, isError: true);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final state = widget.state;

    if (state.eligible.isEmpty) {
      return const EmptyStateView(
        icon: LucideIcons.calculator,
        text: 'Нечего считать',
        hint: 'Симулятор берёт кредиты с положительным остатком и заданным '
            'минимальным платежом.',
      );
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
      children: [
        SurfaceCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Считаем по ${state.eligible.length} кредитам',
                style: theme.textTheme.bodyMedium?.copyWith(
                  fontSize: 13,
                  fontWeight: FontWeight.w500,
                  color: AppColors.textSecondary,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                formatMoneySmart(state.totalDebtCents),
                style: theme.textTheme.headlineMedium?.copyWith(
                  fontSize: 30,
                  fontWeight: FontWeight.w800,
                  fontFeatures: kTabularFigures,
                  color: AppColors.negative,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                'Минимальные платежи: '
                '${formatMoneySmart(state.minPaymentCents)}/мес.',
                style: theme.textTheme.bodySmall
                    ?.copyWith(color: AppColors.textSecondary),
              ),
              const SizedBox(height: 16),
              Text(
                'Сколько добавлять сверх минимума',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: AppColors.textSecondary,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _extra,
                      keyboardType: TextInputType.number,
                      onSubmitted: (_) => _recalculate(),
                      style: theme.textTheme.titleLarge?.copyWith(
                        fontSize: 20,
                        fontWeight: FontWeight.w800,
                        fontFeatures: kTabularFigures,
                      ),
                      decoration: const InputDecoration(
                        hintText: '0',
                        suffixText: '₸',
                        contentPadding: EdgeInsets.symmetric(
                            horizontal: 16, vertical: 14),
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  FilledButton(
                    onPressed: state.simulating ? null : _recalculate,
                    style: FilledButton.styleFrom(
                      minimumSize: const Size(110, 52),
                    ),
                    child: state.simulating
                        ? const SizedBox(
                            height: 18,
                            width: 18,
                            child: CircularProgressIndicator(
                                strokeWidth: 2, color: Colors.white),
                          )
                        : const Text('Считать'),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        if (state.comparison != null) ...[
          _RecommendationCard(comparison: state.comparison!),
          const SizedBox(height: 16),
          _StrategiesList(comparison: state.comparison!),
        ],
        const SizedBox(height: 16),
        const InfoNote(
          text: 'Расчёт ничего не меняет в данных — сервер считает сценарий на '
              'лету по переданным остаткам и ставкам.',
        ),
      ],
    );
  }
}

class _RecommendationCard extends StatelessWidget {
  const _RecommendationCard({required this.comparison});

  final PayoffComparison comparison;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final best = comparison.best;
    if (best == null) return const SizedBox.shrink();

    return SurfaceCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                decoration: BoxDecoration(
                  color: AppColors.positiveSoft,
                  borderRadius: BorderRadius.circular(AppRadii.pill),
                ),
                child: Text(
                  'рекомендация',
                  style: theme.textTheme.bodySmall?.copyWith(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: AppColors.positive,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            strategyName(best.strategy),
            style: theme.textTheme.titleLarge?.copyWith(fontSize: 20),
          ),
          const SizedBox(height: 4),
          Text(
            strategyHint(best.strategy),
            style: theme.textTheme.bodySmall
                ?.copyWith(color: AppColors.textSecondary),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: _Metric(
                  label: 'Свобода от долгов',
                  value: best.debtFreeDate.isEmpty
                      ? '—'
                      : formatMonthLabel(best.debtFreeDate),
                  color: AppColors.positive,
                ),
              ),
              Expanded(
                child: _Metric(
                  label: 'Месяцев',
                  value: '${best.monthsToPayoff}',
                  color: AppColors.textPrimary,
                ),
              ),
              Expanded(
                child: _Metric(
                  label: 'Переплата',
                  value: formatMoneySmart(best.totalInterestCents),
                  color: AppColors.warning,
                ),
              ),
            ],
          ),
          if (comparison.savingsVsWorstCents > 0) ...[
            const SizedBox(height: 12),
            InfoNote(
              icon: LucideIcons.trendingDown,
              background: AppColors.positiveSoft,
              foreground: AppColors.positive,
              text: 'Против самой невыгодной стратегии экономия '
                  '${formatMoneySmart(comparison.savingsVsWorstCents)}.',
            ),
          ],
        ],
      ),
    );
  }
}

class _Metric extends StatelessWidget {
  const _Metric({
    required this.label,
    required this.value,
    required this.color,
  });

  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
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
    );
  }
}

class _StrategiesList extends StatelessWidget {
  const _StrategiesList({required this.comparison});

  final PayoffComparison comparison;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final ranked = comparison.ranked;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
          child: Text(
            'Все стратегии',
            style: theme.textTheme.bodySmall?.copyWith(
              fontSize: 13,
              fontWeight: FontWeight.w700,
              color: AppColors.textSecondary,
            ),
          ),
        ),
        const SizedBox(height: 8),
        RowsCard(
          children: [
            for (final s in ranked)
              Padding(
                padding: const EdgeInsets.symmetric(
                    horizontal: 14, vertical: 12),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Flexible(
                                child: Text(
                                  strategyName(s.strategy),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: theme.textTheme.bodyLarge?.copyWith(
                                      fontSize: 15,
                                      fontWeight: FontWeight.w600),
                                ),
                              ),
                              if (s.strategy == comparison.recommended) ...[
                                const SizedBox(width: 6),
                                const Icon(LucideIcons.checkCircle2,
                                    size: 14, color: AppColors.positive),
                              ],
                            ],
                          ),
                          const SizedBox(height: 3),
                          Text(
                            '${s.monthsToPayoff} мес. · финиш '
                            '${s.debtFreeDate.isEmpty ? "—" : formatMonthInline(s.debtFreeDate)}',
                            style: theme.textTheme.bodySmall?.copyWith(
                                fontSize: 12, color: AppColors.textMuted),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 12),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Text(
                          formatMoneySmart(s.totalInterestCents),
                          style: theme.textTheme.bodyMedium?.copyWith(
                            fontSize: 14,
                            fontWeight: FontWeight.w700,
                            fontFeatures: kTabularFigures,
                            color: AppColors.warning,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          'переплата',
                          style: theme.textTheme.bodySmall?.copyWith(
                              fontSize: 10, color: AppColors.textMuted),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
          ],
        ),
      ],
    );
  }
}
