import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons/lucide_icons.dart';

import '../../../app/theme.dart';
import '../../../core/di/di.dart';
import '../../../core/money/money.dart';
import '../../../core/network/api_client.dart';
import '../../../core/widgets/states.dart';
import '../cubit/more_cubit.dart';

class MorePage extends StatelessWidget {
  const MorePage({super.key});

  @override
  Widget build(BuildContext context) => BlocProvider(
        create: (_) => MoreCubit(sl<ApiClient>())..load(),
        child: const _MoreView(),
      );
}

class _MoreView extends StatelessWidget {
  const _MoreView();

  @override
  Widget build(BuildContext context) => Scaffold(
        body: SafeArea(
          bottom: false,
          child: Column(
            children: [
              const _Header(),
              Expanded(
                child: BlocBuilder<MoreCubit, MoreState>(
                  builder: (context, state) => switch (state.status) {
                    MoreStatus.initial ||
                    MoreStatus.loading =>
                      const Center(child: CircularProgressIndicator()),
                    MoreStatus.error => ErrorStateView(
                        unauthorized: state.unauthorized,
                        error: state.error,
                        title: 'Не удалось загрузить',
                        onRetry: () => context.read<MoreCubit>().load(),
                      ),
                    MoreStatus.ready => _Content(state: state),
                  },
                ),
              ),
            ],
          ),
        ),
      );
}

class _Header extends StatelessWidget {
  const _Header();

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(20, 8, 12, 4),
        child: Row(
          children: [
            Expanded(
              child: Text(
                'Ещё',
                style: Theme.of(context)
                    .textTheme
                    .headlineMedium
                    ?.copyWith(fontSize: 30),
              ),
            ),
            IconButton(
              icon: const Icon(LucideIcons.settings,
                  size: 20, color: AppColors.textSecondary),
              onPressed: () => context.push('/settings'),
            ),
          ],
        ),
      );
}

class _Content extends StatelessWidget {
  const _Content({required this.state});

  final MoreState state;

  @override
  Widget build(BuildContext context) {
    final loans = state.loans;
    final debts = state.debts;
    final deposits = state.deposits;
    final scheduled = state.scheduled;
    final now = DateTime.now();
    final due = scheduled?.due(now).length ?? 0;

    final debtNet = debts?.netByCurrency['KZT'] ?? 0;

    return RefreshIndicator(
      onRefresh: () => context.read<MoreCubit>().load(),
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
        children: [
          _ObligationsCard(state: state),
          const SizedBox(height: 16),
          RowsCard(
            children: [
              _MoreRow(
                icon: LucideIcons.creditCard,
                title: 'Кредиты',
                subtitle: loans == null
                    ? 'не загрузились'
                    : '${loans.loans.length} шт. · платежи '
                        '${formatMoneySmart(loans.monthlyPaymentCents)}/мес.',
                value: loans == null
                    ? null
                    : formatMoneySmart(loans.totalDebtCents),
                valueColor: AppColors.negative,
                route: '/more/loans',
              ),
              _MoreRow(
                icon: LucideIcons.users,
                title: 'Личные долги',
                subtitle: debts == null
                    ? 'не загрузились'
                    : (debtNet >= 0
                        ? 'Вам должны больше, чем вы'
                        : 'Вы должны больше, чем вам'),
                value: debts == null ? null : formatMoneySigned(debtNet),
                valueColor:
                    debtNet >= 0 ? AppColors.positive : AppColors.negative,
                route: '/more/debts',
              ),
              _MoreRow(
                icon: LucideIcons.piggyBank,
                title: 'Вклады',
                subtitle: deposits == null
                    ? 'не загрузились'
                    : '${deposits.deposits.length} шт. · '
                        '${deposits.hasOverInsured ? "есть превышение KDIF" : "KDIF в норме"}',
                value: deposits == null
                    ? null
                    : formatMoneySmart(deposits.totalBalanceCents),
                valueColor: AppColors.textPrimary,
                warn: deposits?.hasOverInsured ?? false,
                route: '/more/deposits',
              ),
              _MoreRow(
                icon: due > 0 ? LucideIcons.alarmClock : LucideIcons.repeat,
                title: 'Регулярные платежи',
                subtitle: scheduled == null
                    ? 'не загрузились'
                    : '${scheduled.items.length} правил'
                        '${due > 0 ? " · наступило $due" : ""}',
                value: due > 0 ? '$due' : null,
                valueColor: AppColors.warning,
                warn: due > 0,
                route: '/more/scheduled',
              ),
              const _MoreRow(
                icon: LucideIcons.calculator,
                title: 'Симулятор погашения',
                subtitle: 'Сравнить 4 стратегии на своих кредитах',
                value: null,
                valueColor: AppColors.textMuted,
                route: '/more/payoff',
              ),
            ],
          ),
          const SizedBox(height: 20),
          Center(
            child: Text(
              'PFM 1.0.0 · ${Uri.parse(sl<ApiClient>().baseUrl).host}',
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(fontSize: 11, color: AppColors.textMuted),
            ),
          ),
        ],
      ),
    );
  }
}

class _ObligationsCard extends StatelessWidget {
  const _ObligationsCard({required this.state});

  final MoreState state;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final net = state.netObligationsCents;

    Widget cell(String label, String value, Color color) => Expanded(
          child: Column(
            children: [
              Text(label,
                  style: theme.textTheme.bodySmall
                      ?.copyWith(fontSize: 11, color: AppColors.textMuted)),
              const SizedBox(height: 3),
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
      height: 32,
      child: VerticalDivider(width: 1, thickness: 1, color: AppColors.border),
    );

    return SurfaceCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            net >= 0 ? 'Активы минус долги' : 'Долги минус активы',
            style: theme.textTheme.bodyMedium?.copyWith(
              fontSize: 13,
              fontWeight: FontWeight.w500,
              color: AppColors.textSecondary,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            formatMoneySmart(net),
            style: theme.textTheme.headlineMedium?.copyWith(
              fontSize: 32,
              fontWeight: FontWeight.w800,
              fontFeatures: kTabularFigures,
              color: net >= 0 ? AppColors.positive : AppColors.negative,
            ),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              cell(
                'Кредиты',
                state.loans == null
                    ? '—'
                    : formatMoneySmart(state.loans!.totalDebtCents),
                AppColors.negative,
              ),
              divider,
              cell(
                'Личные',
                state.debts == null
                    ? '—'
                    : formatMoneySigned(state.debts!.netByCurrency['KZT'] ?? 0),
                (state.debts?.netByCurrency['KZT'] ?? 0) >= 0
                    ? AppColors.positive
                    : AppColors.negative,
              ),
              divider,
              cell(
                'Вклады',
                state.deposits == null
                    ? '—'
                    : formatMoneySmart(state.deposits!.totalBalanceCents),
                AppColors.textPrimary,
              ),
            ],
          ),
          const SizedBox(height: 12),
          const InfoNote(
            text: 'Только тенговая часть: счета в других валютах и долги в них '
                'сюда не входят — курса в API нет.',
          ),
        ],
      ),
    );
  }
}

class _MoreRow extends StatelessWidget {
  const _MoreRow({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.value,
    required this.valueColor,
    required this.route,
    this.warn = false,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final String? value;
  final Color valueColor;
  final String route;
  final bool warn;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return InkWell(
      onTap: () => context.push(route),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        child: Row(
          children: [
            Container(
              width: 38,
              height: 38,
              decoration: BoxDecoration(
                color: warn ? AppColors.warningSoft : AppColors.accentSoft,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(icon,
                  size: 18,
                  color: warn ? AppColors.warning : AppColors.accent),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: theme.textTheme.bodyLarge
                        ?.copyWith(fontSize: 15, fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    subtitle,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodySmall
                        ?.copyWith(fontSize: 12, color: AppColors.textMuted),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 10),
            if (value != null)
              Text(
                value!,
                style: theme.textTheme.titleMedium?.copyWith(
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                  fontFeatures: kTabularFigures,
                  color: valueColor,
                ),
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
