import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:intl/intl.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../../app/theme.dart';
import '../../../core/dates/months.dart';
import '../../../core/di/di.dart';
import '../../../core/money/money.dart';
import '../../../core/network/api_client.dart';
import '../../../core/widgets/states.dart';
import '../cubit/debts_cubit.dart';
import '../data/debts_models.dart';
import '../data/debts_repository.dart';
import 'widgets/add_debt_sheet.dart';

class DebtsPage extends StatelessWidget {
  const DebtsPage({super.key});

  @override
  Widget build(BuildContext context) => BlocProvider(
        create: (_) => DebtsCubit(DebtsRepository(sl<ApiClient>()))..load(),
        child: const _DebtsView(),
      );
}

class _DebtsView extends StatelessWidget {
  const _DebtsView();

  @override
  Widget build(BuildContext context) =>
      BlocBuilder<DebtsCubit, DebtsState>(
        builder: (context, state) => Scaffold(
          floatingActionButton: state.status == DebtsStatus.ready
              ? FloatingActionButton(
                  onPressed: () =>
                      showAddDebtSheet(context, context.read<DebtsCubit>()),
                  child: const Icon(LucideIcons.plus, size: 24),
                )
              : null,
          body: SafeArea(
            bottom: false,
            child: Column(
              children: [
                const DomainAppBar(title: 'Личные долги'),
                Expanded(
                  child: switch (state.status) {
                    DebtsStatus.initial ||
                    DebtsStatus.loading =>
                      const Center(child: CircularProgressIndicator()),
                    DebtsStatus.error => ErrorStateView(
                        unauthorized: state.unauthorized,
                        error: state.error,
                        title: 'Не удалось загрузить долги',
                        onRetry: () => context.read<DebtsCubit>().load(),
                      ),
                    DebtsStatus.ready => _Content(state: state),
                  },
                ),
              ],
            ),
          ),
        ),
      );
}

class _Content extends StatelessWidget {
  const _Content({required this.state});

  final DebtsState state;

  @override
  Widget build(BuildContext context) {
    final data = state.data!;
    final cubit = context.read<DebtsCubit>();

    return RefreshIndicator(
      onRefresh: cubit.load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 96),
        children: [
          _SummaryCard(data: data),
          const SizedBox(height: 12),
          SwitchListTile(
            contentPadding: const EdgeInsets.symmetric(horizontal: 4),
            value: state.includeSettled,
            onChanged: cubit.toggleSettled,
            title: Text(
              'Показывать погашенные',
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ),
          const SizedBox(height: 4),
          if (data.debts.isEmpty)
            const EmptyStateView(
              icon: LucideIcons.users,
              text: 'Личных долгов нет',
              hint: 'Добавьте, кому должны вы или кто должен вам.',
            )
          else
            RowsCard(
              children: [
                for (final debt in data.debts) _DebtRow(debt: debt),
              ],
            ),
        ],
      ),
    );
  }
}

class _SummaryCard extends StatelessWidget {
  const _SummaryCard({required this.data});

  final DebtsData data;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final net = data.netByCurrency;
    final owe = data.oweByCurrency;
    final owed = data.owedByCurrency;

    String render(Map<String, int> totals) {
      if (totals.isEmpty) return formatMoneySmart(0);
      return totals.entries
          .map((e) => formatMoneySmart(e.value, currency: e.key))
          .join(' · ');
    }

    final netTotal = net.values.fold<int>(0, (a, b) => a + b);

    Widget cell(String label, String value, Color color) => Expanded(
          child: Column(
            children: [
              Text(label,
                  style: theme.textTheme.bodySmall
                      ?.copyWith(fontSize: 11, color: AppColors.textMuted)),
              const SizedBox(height: 4),
              Text(
                value,
                textAlign: TextAlign.center,
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
          Text(
            netTotal >= 0 ? 'Вам должны больше' : 'Вы должны больше',
            style: theme.textTheme.bodyMedium?.copyWith(
              fontSize: 13,
              fontWeight: FontWeight.w500,
              color: AppColors.textSecondary,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            render(net.map((k, v) => MapEntry(k, v))),
            style: theme.textTheme.headlineMedium?.copyWith(
              fontSize: 30,
              fontWeight: FontWeight.w800,
              fontFeatures: kTabularFigures,
              color: netTotal >= 0 ? AppColors.positive : AppColors.negative,
            ),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              cell('Должен я', render(owe), AppColors.negative),
              divider,
              cell('Должны мне', render(owed), AppColors.positive),
            ],
          ),
          if (data.isMultiCurrency) ...[
            const SizedBox(height: 12),
            const InfoNote(
              text: 'Валюты показаны раздельно — сводка от сервера складывает '
                  'их в одну сумму, поэтому здесь пересчитано.',
            ),
          ],
        ],
      ),
    );
  }
}

class _DebtRow extends StatelessWidget {
  const _DebtRow({required this.debt});

  final PersonalDebt debt;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cubit = context.read<DebtsCubit>();
    final overdue = debt.isOverdue(DateTime.now());

    final subtitle = [
      debt.iOwe ? 'Я должен' : 'Мне должны',
      if (debt.dueDate != null) 'до ${formatDayLabel(debt.dueDate!)}',
      if (debt.isSettled && debt.settledDate != null)
        'погашен ${formatDayLabel(debt.settledDate!)}',
      if (debt.note?.isNotEmpty ?? false) debt.note!,
    ].join(' · ');

    Future<void> run(Future<String?> Function() action, String okMessage) async {
      final error = await action();
      if (!context.mounted) return;
      showToast(context, error ?? okMessage, isError: error != null);
    }

    return Opacity(
      opacity: debt.isSettled ? 0.55 : 1,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 6, 12),
        child: Row(
          children: [
            Container(
              width: 34,
              height: 34,
              decoration: BoxDecoration(
                color: debt.iOwe
                    ? AppColors.negativeSoft
                    : AppColors.positiveSoft,
                borderRadius: BorderRadius.circular(AppRadii.pill),
              ),
              child: Icon(
                debt.iOwe ? LucideIcons.arrowUpRight : LucideIcons.arrowDownLeft,
                size: 16,
                color: debt.iOwe ? AppColors.negative : AppColors.positive,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Flexible(
                        child: Text(
                          debt.personName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: theme.textTheme.bodyLarge?.copyWith(
                              fontSize: 15, fontWeight: FontWeight.w600),
                        ),
                      ),
                      if (overdue) ...[
                        const SizedBox(width: 6),
                        const Icon(LucideIcons.alertTriangle,
                            size: 13, color: AppColors.warning),
                      ],
                    ],
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
            const SizedBox(width: 8),
            Text(
              formatMoneySmart(debt.amountCents, currency: debt.currency),
              style: theme.textTheme.titleMedium?.copyWith(
                fontSize: 15,
                fontWeight: FontWeight.w700,
                fontFeatures: kTabularFigures,
                color: debt.iOwe ? AppColors.negative : AppColors.positive,
              ),
            ),
            PopupMenuButton<String>(
              icon: const Icon(LucideIcons.moreVertical,
                  size: 18, color: AppColors.textMuted),
              onSelected: (value) async {
                if (value == 'settle') {
                  final ok = await confirmAction(
                    context,
                    title: 'Отметить погашенным?',
                    body: '${debt.personName} — '
                        '${formatMoneySmart(debt.amountCents, currency: debt.currency)}. '
                        'Дата погашения проставится сегодняшняя.',
                    action: 'Погасить',
                  );
                  if (ok) await run(() => cubit.settle(debt.id), 'Долг погашен');
                } else if (value == 'delete') {
                  final ok = await confirmAction(
                    context,
                    title: 'Удалить долг?',
                    body: 'Это единственное место в API, где удаление '
                        'физическое — восстановить запись будет нельзя.',
                    action: 'Удалить',
                    destructive: true,
                  );
                  if (ok) await run(() => cubit.delete(debt.id), 'Долг удалён');
                }
              },
              itemBuilder: (context) => [
                if (!debt.isSettled)
                  const PopupMenuItem(
                    value: 'settle',
                    child: Text('Отметить погашенным'),
                  ),
                const PopupMenuItem(
                  value: 'delete',
                  child: Text('Удалить', style: TextStyle(color: AppColors.negative)),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Exposed for the add sheet, which needs the same date format.
String formatIsoDate(DateTime date) => DateFormat('yyyy-MM-dd').format(date);
