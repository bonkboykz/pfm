import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../../app/theme.dart';
import '../../../core/dates/months.dart';
import '../../../core/di/di.dart';
import '../../../core/money/money.dart';
import '../../../core/network/api_client.dart';
import '../../../core/text/plural.dart';
import '../../../core/widgets/states.dart';
import '../cubit/scheduled_cubit.dart';
import '../data/scheduled_models.dart';
import '../data/scheduled_repository.dart';

class ScheduledPage extends StatelessWidget {
  const ScheduledPage({super.key});

  @override
  Widget build(BuildContext context) => BlocProvider(
        create: (_) =>
            ScheduledCubit(ScheduledRepository(sl<ApiClient>()))..load(),
        child: const _ScheduledView(),
      );
}

class _ScheduledView extends StatelessWidget {
  const _ScheduledView();

  @override
  Widget build(BuildContext context) => Scaffold(
        body: SafeArea(
          bottom: false,
          child: Column(
            children: [
              const DomainAppBar(title: 'Регулярные платежи'),
              Expanded(
                child: BlocBuilder<ScheduledCubit, ScheduledState>(
                  builder: (context, state) => switch (state.status) {
                    ScheduledStatus.initial ||
                    ScheduledStatus.loading =>
                      const Center(child: CircularProgressIndicator()),
                    ScheduledStatus.error => ErrorStateView(
                        unauthorized: state.unauthorized,
                        error: state.error,
                        title: 'Не удалось загрузить правила',
                        onRetry: () => context.read<ScheduledCubit>().load(),
                      ),
                    ScheduledStatus.ready => _Content(state: state),
                  },
                ),
              ),
            ],
          ),
        ),
      );
}

class _Content extends StatelessWidget {
  const _Content({required this.state});

  final ScheduledState state;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cubit = context.read<ScheduledCubit>();
    final data = state.data!;
    final now = DateTime.now();
    final due = data.due(now);
    final posting = data.duePosting(now);
    final reminders = due.length - posting.length;
    final upcoming = data.upcoming(now);

    Future<void> runProcess() async {
      final ok = await confirmAction(
        context,
        title: 'Провести наступившие?',
        body: 'Будут созданы реальные операции по ${posting.length} ${plural(posting.length, "правилу", "правилам", "правилам")}, '
            'а даты следующего платежа сдвинутся вперёд. Отменить это можно '
            'только вручную.'
            '${reminders == 0 ? "" : " Ещё $reminders — напоминания: они "
                "останутся как есть, операцию по ним нужно завести руками."}',
        action: 'Провести',
      );
      if (!ok) return;

      final outcome = await cubit.process();
      if (!context.mounted) return;
      if (outcome.error != null) {
        showToast(context, outcome.error!, isError: true);
        return;
      }
      final result = outcome.result!;
      final tail = result.reminders == 0
          ? ''
          : ', напоминаний без операции: ${result.reminders}';
      showToast(
        context,
        result.errors.isEmpty
            ? 'Создано операций: ${result.created}$tail'
            : 'Создано: ${result.created}, с ошибками: ${result.errors.length}$tail',
        isError: result.errors.isNotEmpty,
      );
    }

    return RefreshIndicator(
      onRefresh: cubit.load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
        children: [
          SurfaceCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Регулярных расходов в месяц',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                    color: AppColors.textSecondary,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  formatMoneySmart(data.monthlyOutflowCents(now)),
                  style: theme.textTheme.headlineMedium?.copyWith(
                    fontSize: 32,
                    fontWeight: FontWeight.w800,
                    fontFeatures: kTabularFigures,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  'Правил: ${data.items.length}'
                  '${due.isEmpty ? "" : ", наступило: ${due.length}"}',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: due.isEmpty
                        ? AppColors.textSecondary
                        : AppColors.warning,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          if (due.isNotEmpty) ...[
            InfoNote(
              icon: LucideIcons.alertTriangle,
              background: AppColors.warningSoft,
              foreground: const Color(0xFF8A5A00),
              text: 'Наступивших платежей: ${due.length}. Проведение создаст '
                  'операции за каждый пропущенный период, а не одну на правило.',
            ),
            const SizedBox(height: 10),
            if (posting.isNotEmpty)
              FilledButton.icon(
                onPressed: state.processing ? null : runProcess,
              icon: state.processing
                  ? const SizedBox(
                      height: 16,
                      width: 16,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white),
                    )
                  : const Icon(LucideIcons.playCircle, size: 18),
              label: const Text('Провести наступившие'),
            ),
            const SizedBox(height: 16),
            _Section(title: 'Наступили', items: due, now: now),
          ],
          if (upcoming.isNotEmpty) ...[
            if (due.isNotEmpty) const SizedBox(height: 16),
            _Section(title: 'Впереди', items: upcoming, now: now),
          ],
          if (data.items.isEmpty)
            const EmptyStateView(
              icon: LucideIcons.repeat,
              text: 'Регулярных платежей нет',
            ),
        ],
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({
    required this.title,
    required this.items,
    required this.now,
  });

  final String title;
  final List<ScheduledTransaction> items;
  final DateTime now;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
          child: Text(
            title,
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
            for (final item in items) _ScheduledRow(item: item, now: now),
          ],
        ),
      ],
    );
  }
}

class _ScheduledRow extends StatelessWidget {
  const _ScheduledRow({required this.item, required this.now});

  final ScheduledTransaction item;
  final DateTime now;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cubit = context.read<ScheduledCubit>();
    final overdue = item.isDue(now);
    final days = item.daysUntil(now);

    final when = overdue
        ? 'просрочен на ${-days} дн. · ${formatDayLabel(item.nextDate)}'
        : 'через $days дн. · ${formatDayLabel(item.nextDate)}';

    final what = item.isTransfer
        ? 'Перевод → ${item.transferAccountName ?? ""}'
        : (item.categoryName ?? 'Без категории');

    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 12, 6, 12),
      child: Row(
        children: [
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              color: overdue ? AppColors.warningSoft : AppColors.accentSoft,
              borderRadius: BorderRadius.circular(AppRadii.pill),
            ),
            child: Icon(
              overdue ? LucideIcons.alarmClock : LucideIcons.repeat,
              size: 16,
              color: overdue ? AppColors.warning : AppColors.accent,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.payeeName?.isNotEmpty == true
                      ? item.payeeName!
                      : item.accountName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodyLarge
                      ?.copyWith(fontSize: 15, fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 3),
                Text(
                  '$what · ${item.accountName}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodySmall
                      ?.copyWith(fontSize: 12, color: AppColors.textMuted),
                ),
                if (!item.autoPost) ...[
                  const SizedBox(height: 4),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                    decoration: BoxDecoration(
                      color: AppColors.accentSoft,
                      borderRadius: BorderRadius.circular(AppRadii.pill),
                    ),
                    child: Text(
                      'Напоминание',
                      style: theme.textTheme.bodySmall?.copyWith(
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                        color: AppColors.accent,
                      ),
                    ),
                  ),
                ],
                const SizedBox(height: 2),
                Text(
                  '${frequencyLabel(item.frequency)} · $when',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodySmall?.copyWith(
                    fontSize: 11,
                    color:
                        overdue ? AppColors.warning : AppColors.textMuted,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Text(
            formatMoneySigned(item.amountCents),
            style: theme.textTheme.titleMedium?.copyWith(
              fontSize: 15,
              fontWeight: FontWeight.w700,
              fontFeatures: kTabularFigures,
              color:
                  item.isInflow ? AppColors.positive : AppColors.textPrimary,
            ),
          ),
          PopupMenuButton<String>(
            icon: const Icon(LucideIcons.moreVertical,
                size: 18, color: AppColors.textMuted),
            onSelected: (value) async {
              if (value != 'delete') return;
              final ok = await confirmAction(
                context,
                title: 'Удалить правило?',
                body: 'Правило перестанет создавать операции. Уже созданные '
                    'операции останутся на месте.',
                action: 'Удалить',
                destructive: true,
              );
              if (!ok) return;
              final error = await cubit.delete(item.id);
              if (!context.mounted) return;
              showToast(context, error ?? 'Правило удалено',
                  isError: error != null);
            },
            itemBuilder: (context) => const [
              PopupMenuItem(
                value: 'delete',
                child: Text('Удалить',
                    style: TextStyle(color: AppColors.negative)),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
