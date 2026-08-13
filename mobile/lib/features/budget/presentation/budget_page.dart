import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../../app/theme.dart';
import '../../../core/dates/months.dart';
import '../../../core/di/di.dart';
import '../../../core/money/money.dart';
import '../../../core/events/data_bus.dart';
import '../../../core/network/api_client.dart';
import '../cubit/budget_cubit.dart';
import '../data/budget_models.dart';
import '../data/budget_repository.dart';
import 'widgets/assign_sheet.dart';
import 'widgets/category_picker.dart';
import 'widgets/move_sheet.dart';

class BudgetPage extends StatelessWidget {
  const BudgetPage({super.key});

  @override
  Widget build(BuildContext context) => BlocProvider(
        create: (_) =>
            BudgetCubit(BudgetRepository(sl<ApiClient>()), bus: sl<DataBus>())
              ..load(),
        child: const _BudgetView(),
      );
}

class _BudgetView extends StatelessWidget {
  const _BudgetView();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: BlocBuilder<BudgetCubit, BudgetState>(
          builder: (context, state) {
            return Column(
              children: [
                const _Header(),
                // The month stays pinned so navigation never scrolls away.
                _MonthSwitcher(state: state),
                Expanded(child: _Body(state: state)),
              ],
            );
          },
        ),
      ),
    );
  }
}

// ── Chrome ──────────────────────────────────────────────────────────────────

class _Header extends StatelessWidget {
  const _Header();

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(20, 8, 12, 4),
        child: Row(
          children: [
            Expanded(
              child: Text(
                'Бюджет',
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

class _MonthSwitcher extends StatelessWidget {
  const _MonthSwitcher({required this.state});

  final BudgetState state;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isCurrent = state.month == currentMonth();
    final cubit = context.read<BudgetCubit>();

    Widget navButton(IconData icon, int delta) => InkWell(
          onTap: state.busy ? null : () => cubit.shiftSelectedMonth(delta),
          borderRadius: BorderRadius.circular(10),
          child: Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: AppColors.bg,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, size: 18, color: AppColors.textSecondary),
          ),
        );

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 4, 16, 12),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadii.inner),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          navButton(LucideIcons.chevronLeft, -1),
          Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                formatMonthLabel(state.month),
                style: theme.textTheme.titleLarge?.copyWith(fontSize: 17),
              ),
              const SizedBox(height: 1),
              Text(
                isCurrent ? 'текущий месяц' : 'другой месяц',
                style: theme.textTheme.bodySmall
                    ?.copyWith(fontSize: 11, color: AppColors.textMuted),
              ),
            ],
          ),
          navButton(LucideIcons.chevronRight, 1),
        ],
      ),
    );
  }
}

// ── States ──────────────────────────────────────────────────────────────────

class _Body extends StatelessWidget {
  const _Body({required this.state});

  final BudgetState state;

  @override
  Widget build(BuildContext context) {
    switch (state.status) {
      case BudgetStatus.initial:
      case BudgetStatus.loading:
        return const Center(child: CircularProgressIndicator());
      case BudgetStatus.error:
        return _ErrorView(state: state);
      case BudgetStatus.ready:
        return _Content(data: state.data!, busy: state.busy);
    }
  }
}

class _ErrorView extends StatelessWidget {
  const _ErrorView({required this.state});

  final BudgetState state;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final unauthorized = state.unauthorized;

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              unauthorized ? LucideIcons.keyRound : LucideIcons.cloudOff,
              size: 40,
              color: AppColors.textMuted,
            ),
            const SizedBox(height: 12),
            Text(
              unauthorized ? 'Нужен API-ключ' : 'Не удалось загрузить бюджет',
              style: theme.textTheme.titleLarge,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 6),
            Text(
              unauthorized
                  ? 'Укажите ключ в настройках, чтобы продолжить.'
                  : (state.error ?? 'Проверьте соединение и попробуйте снова.'),
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium
                  ?.copyWith(color: AppColors.textSecondary),
            ),
            const SizedBox(height: 20),
            unauthorized
                ? FilledButton(
                    onPressed: () => context.push('/settings'),
                    child: const Text('Открыть настройки'),
                  )
                : FilledButton(
                    onPressed: () => context.read<BudgetCubit>().load(),
                    child: const Text('Повторить'),
                  ),
          ],
        ),
      ),
    );
  }
}

// ── Content ─────────────────────────────────────────────────────────────────

class _Content extends StatelessWidget {
  const _Content({required this.data, required this.busy});

  final BudgetData data;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final month = data.month;

    return RefreshIndicator(
      onRefresh: () => context.read<BudgetCubit>().load(),
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
        children: [
          _RtaCard(data: data),
          const SizedBox(height: 12),
          _QuickActions(month: month, busy: busy),
          const SizedBox(height: 12),
          _MonthTotals(month: month),
          const SizedBox(height: 16),
          for (final group in month.groups) ...[
            _GroupSection(
              key: ValueKey(group.groupId),
              group: group,
              month: month,
            ),
            const SizedBox(height: 16),
          ],
        ],
      ),
    );
  }
}

class _RtaCard extends StatelessWidget {
  const _RtaCard({required this.data});

  final BudgetData data;

  /// Раздача денег начинается с выбора категории, а не с прокрутки до неё:
  /// сумма на этой карточке — то, ради чего экран открывают.
  Future<void> _distribute(BuildContext context) async {
    final cubit = context.read<BudgetCubit>();
    final month = data.month;

    final picked = await pickCategory(
      context,
      month: month,
      title: 'Куда распределить',
    );
    if (picked == null || !context.mounted) return;

    await showAssignSheet(context, cubit, month: month, category: picked);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final month = data.month;
    final cents = month.readyToAssignCents;
    final color = AppColors.forAvailable(cents);

    final (badgeIcon, badgeText) = switch (cents) {
      > 0 => (LucideIcons.checkCircle2, 'Есть что раздать'),
      0 => (LucideIcons.check, 'Всё роздано'),
      _ => (LucideIcons.alertTriangle, 'Роздано больше'),
    };

    return Material(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(AppRadii.card),
      child: InkWell(
        onTap: () => _distribute(context),
        borderRadius: BorderRadius.circular(AppRadii.card),
        child: Ink(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(AppRadii.card),
            border: Border.all(color: AppColors.border),
          ),
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
                          'Готово к распределению',
                          style: theme.textTheme.bodyMedium?.copyWith(
                            fontSize: 13,
                            fontWeight: FontWeight.w500,
                            color: AppColors.textSecondary,
                          ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          formatMoneySmart(month.readyToAssignCents),
                          style: theme.textTheme.headlineMedium?.copyWith(
                            fontSize: 34,
                            fontWeight: FontWeight.w800,
                            fontFeatures: kTabularFigures,
                            color: color,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 10),
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 12, vertical: 7),
                    decoration: BoxDecoration(
                      color: AppColors.forAvailableSoft(cents),
                      borderRadius: BorderRadius.circular(AppRadii.pill),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(badgeIcon, size: 14, color: color),
                        const SizedBox(width: 6),
                        Text(
                          badgeText,
                          style: theme.textTheme.bodySmall?.copyWith(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                            color: color,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              if (data.hasFutureSqueeze) ...[
                const SizedBox(height: 14),
                _FutureSqueeze(overview: data.overview!),
              ],
              const SizedBox(height: 16),
              const Divider(height: 1, color: AppColors.border),
              const SizedBox(height: 12),
              Row(
                children: [
                  const Icon(LucideIcons.arrowRightLeft,
                      size: 15, color: AppColors.accent),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      cents > 0
                          ? 'Распределить по категориям'
                          : 'Изменить назначения',
                      style: theme.textTheme.bodyMedium?.copyWith(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: AppColors.accent,
                      ),
                    ),
                  ),
                  const Icon(LucideIcons.chevronRight,
                      size: 16, color: AppColors.accent),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A single month's RTA does not see assignments made in later months, so the
/// engine's cross-month minimum is the number that actually constrains you.
class _FutureSqueeze extends StatelessWidget {
  const _FutureSqueeze({required this.overview});

  final RtaOverview overview;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.warningSoft,
        borderRadius: BorderRadius.circular(AppRadii.inner),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(LucideIcons.calendarClock,
              size: 16, color: AppColors.warning),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'С учётом будущих месяцев: '
                  '${formatMoneySmart(overview.minReadyToAssignCents)}',
                  style: theme.textTheme.bodySmall?.copyWith(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    fontFeatures: kTabularFigures,
                    color: const Color(0xFF8A5A00),
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  'минимум приходится на ${formatMonthInline(overview.minMonth)}',
                  style: theme.textTheme.bodySmall?.copyWith(
                    fontSize: 11,
                    color: const Color(0xFFA67A1F),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _QuickActions extends StatelessWidget {
  const _QuickActions({required this.month, required this.busy});

  final BudgetMonth month;
  final bool busy;

  Future<bool> _confirm(
    BuildContext context, {
    required String title,
    required String body,
    required String action,
  }) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: Text(body),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Отмена'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            style: FilledButton.styleFrom(minimumSize: const Size(88, 40)),
            child: Text(action),
          ),
        ],
      ),
    );
    return ok ?? false;
  }

  @override
  Widget build(BuildContext context) {
    final cubit = context.read<BudgetCubit>();
    final underfunded = month.totalUnderfundedCents;

    return Row(
      children: [
        if (underfunded > 0)
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: _QuickButton(
              icon: LucideIcons.zap,
              label: 'Недофинансировано',
              value: formatMoneySmart(underfunded),
              primary: true,
              onTap: busy
                  ? null
                  : () async {
                      // Сказать про нехватку заранее, а не после раздачи:
                      // сервер остановится на нуле RTA, и половина категорий
                      // останется ни с чем.
                      final free = month.readyToAssignCents;
                      final short = underfunded - (free > 0 ? free : 0);
                      final ok = await _confirm(
                        context,
                        title: 'Дофинансировать цели?',
                        body: [
                          'Категорий не хватает: ${month.underfunded.length}, '
                              'всего ${formatMoneySmart(underfunded)}.',
                          if (short > 0)
                            'Свободно только ${formatMoneySmart(free > 0 ? free : 0)} — '
                                'раздача остановится, ${formatMoneySmart(short)} '
                                'останется недофинансировано.'
                          else
                            'Каждой будет назначено недостающее до цели.',
                        ].join(' '),
                        action: 'Назначить',
                      );
                      if (!ok) return;

                      final outcome = await cubit.assignUnderfunded();
                      if (!context.mounted) return;

                      final message = switch (outcome) {
                        AssignTargetsOutcome(:final error?) => error,
                        AssignTargetsOutcome(addedCents: 0) =>
                          'Свободных денег нет — ничего не роздано',
                        AssignTargetsOutcome(
                          stoppedAtZeroRta: true,
                          :final addedCents,
                          :final remainingCents,
                        ) =>
                          'Роздано ${formatMoneySmart(addedCents)}, '
                              'не хватило ${formatMoneySmart(remainingCents)}',
                        AssignTargetsOutcome(:final addedCents) =>
                          'Роздано ${formatMoneySmart(addedCents)}',
                      };
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text(message),
                          backgroundColor: outcome.error != null
                              ? AppColors.negative
                              : outcome.stoppedAtZeroRta
                                  ? AppColors.warning
                                  : AppColors.textPrimary,
                        ),
                      );
                    },
            ),
          ),
        _QuickButton(
          icon: LucideIcons.history,
          label: 'Как в прошлом',
          value: null,
          primary: false,
          onTap: busy
              ? null
              : () async {
                  final previous =
                      formatMonthGenitive(shiftMonth(month.month, -1));
                  final ok = await _confirm(
                    context,
                    title: 'Скопировать прошлый месяц?',
                    // Это замена, а не слияние — и раньше диалог обещал замену,
                    // а делал слияние. Про обнуление надо сказать вслух.
                    body: 'Назначения этого месяца будут заменены значениями '
                        'из $previous. Категории, которым тогда не назначали, '
                        'обнулятся.',
                    action: 'Заменить',
                  );
                  if (!ok) return;

                  final outcome = await cubit.copyPreviousMonth();
                  if (!context.mounted) return;

                  final message = switch (outcome) {
                    CopyMonthOutcome(:final error?) => error,
                    // Предложный падеж intl не даёт, поэтому здесь без месяца.
                    CopyMonthOutcome(sourceEmpty: true) =>
                      'В прошлом месяце ничего не назначено — оставили как было',
                    CopyMonthOutcome(changedCount: 0) =>
                      'Уже как в прошлом месяце — менять нечего',
                    CopyMonthOutcome(:final changedCount, :final clearedCount) =>
                      'Изменено категорий: $changedCount'
                          '${clearedCount > 0 ? ', обнулено $clearedCount' : ''}',
                  };
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text(message),
                      backgroundColor: outcome.error != null
                          ? AppColors.negative
                          : AppColors.textPrimary,
                    ),
                  );
                },
        ),
      ],
    );
  }
}

class _QuickButton extends StatelessWidget {
  const _QuickButton({
    required this.icon,
    required this.label,
    required this.value,
    required this.primary,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final String? value;
  final bool primary;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final fg = primary ? Colors.white : AppColors.textSecondary;

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppRadii.pill),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 10),
        decoration: BoxDecoration(
          color: primary ? AppColors.accent : AppColors.surface,
          borderRadius: BorderRadius.circular(AppRadii.pill),
          border: Border.all(
              color: primary ? AppColors.accent : AppColors.border),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 14, color: fg),
            const SizedBox(width: 7),
            Text(
              label,
              style: theme.textTheme.bodySmall
                  ?.copyWith(fontSize: 12, fontWeight: FontWeight.w600, color: fg),
            ),
            if (value != null) ...[
              const SizedBox(width: 7),
              Text(
                value!,
                style: theme.textTheme.bodySmall?.copyWith(
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                  fontFeatures: kTabularFigures,
                  color: primary ? Colors.white : AppColors.textPrimary,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _MonthTotals extends StatelessWidget {
  const _MonthTotals({required this.month});

  final BudgetMonth month;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    Widget cell(String label, String value, Color color) => Expanded(
          child: Column(
            children: [
              Text(
                label,
                style: theme.textTheme.bodySmall?.copyWith(
                  fontSize: 11,
                  fontWeight: FontWeight.w500,
                  color: AppColors.textMuted,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                value,
                style: theme.textTheme.titleMedium?.copyWith(
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                  fontFeatures: kTabularFigures,
                  color: color,
                ),
              ),
            ],
          ),
        );

    // Fixed-height dividers instead of IntrinsicHeight — a stretched Row inside
    // a scroll view is the classic "RenderBox was not laid out" trap.
    const divider = SizedBox(
      height: 34,
      child: VerticalDivider(width: 1, thickness: 1, color: AppColors.border),
    );

    return Container(
      padding: const EdgeInsets.symmetric(vertical: 14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadii.card),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          cell('Назначено', formatMoneySmart(month.totalAssignedCents),
              AppColors.textPrimary),
          divider,
          cell('Расход', formatMoneySmart(month.totalActivityCents),
              AppColors.textPrimary),
          divider,
          cell('Доступно', formatMoneySmart(month.totalAvailableCents),
              AppColors.forAvailable(month.totalAvailableCents)),
        ],
      ),
    );
  }
}

class _GroupSection extends StatefulWidget {
  const _GroupSection({
    super.key,
    required this.group,
    required this.month,
  });

  final BudgetGroup group;
  final BudgetMonth month;

  @override
  State<_GroupSection> createState() => _GroupSectionState();
}

class _GroupSectionState extends State<_GroupSection> {
  bool _expanded = true;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final group = widget.group;
    final available = group.availableCents;

    final header = InkWell(
      onTap: () => setState(() => _expanded = !_expanded),
      borderRadius: BorderRadius.circular(8),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
        child: Row(
          children: [
            Icon(
              _expanded ? LucideIcons.chevronDown : LucideIcons.chevronRight,
              size: 16,
              color: AppColors.textMuted,
            ),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                group.groupName,
                style: theme.textTheme.bodySmall?.copyWith(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textSecondary,
                ),
              ),
            ),
            if (!_expanded) ...[
              Text(
                '${group.categories.length}',
                style: theme.textTheme.bodySmall
                    ?.copyWith(fontSize: 12, color: AppColors.textMuted),
              ),
              const SizedBox(width: 8),
            ],
            Text(
              // Group subtotals are not in the API response — summed locally.
              formatMoneySmart(available),
              style: theme.textTheme.bodySmall?.copyWith(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                fontFeatures: kTabularFigures,
                color: AppColors.forAvailable(available),
              ),
            ),
          ],
        ),
      ),
    );

    if (!_expanded) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [header],
      );
    }

    final rows = <Widget>[];
    for (var i = 0; i < group.categories.length; i++) {
      if (i > 0) {
        rows.add(const Divider(height: 1, indent: 14, endIndent: 14));
      }
      rows.add(_CategoryRow(
        category: group.categories[i],
        month: widget.month,
      ));
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        header,
        const SizedBox(height: 8),
        Container(
          clipBehavior: Clip.antiAlias,
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(AppRadii.card),
            border: Border.all(color: AppColors.border),
          ),
          child: Column(children: rows),
        ),
      ],
    );
  }
}

class _CategoryRow extends StatelessWidget {
  const _CategoryRow({required this.category, required this.month});

  final CategoryBudget category;
  final BudgetMonth month;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cubit = context.read<BudgetCubit>();
    final available = category.availableCents;
    final overspent = category.overspentCents > 0;

    final subtitle = category.hasTarget && category.underfundedCents > 0
        ? 'Цель ${formatMoneySmart(category.targetAmountCents!)} · '
            'Назначено ${formatMoneySmart(category.assignedCents)}'
        : 'Назначено ${formatMoneySmart(category.assignedCents)} · '
            'Расход ${formatMoneySmart(category.activityCents)}';

    return InkWell(
      onTap: () => showAssignSheet(
        context,
        cubit,
        month: month,
        category: category,
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    category.categoryName,
                    style: theme.textTheme.bodyLarge?.copyWith(
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                    ),
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
            Container(
              padding:
                  const EdgeInsets.symmetric(horizontal: 11, vertical: 6),
              decoration: BoxDecoration(
                color: category.isUnderfunded && available >= 0
                    ? AppColors.warningSoft
                    : AppColors.forAvailableSoft(available),
                borderRadius: BorderRadius.circular(AppRadii.pill),
              ),
              child: Text(
                formatMoneySmart(available),
                style: theme.textTheme.bodyMedium?.copyWith(
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                  fontFeatures: kTabularFigures,
                  color: category.isUnderfunded && available >= 0
                      ? AppColors.warning
                      : AppColors.forAvailable(available),
                ),
              ),
            ),
            // Overspending is the one thing the budget screen must not let you
            // scroll past — tapping here opens a prefilled cover-it move.
            if (overspent)
              IconButton(
                visualDensity: VisualDensity.compact,
                icon: const Icon(LucideIcons.arrowRightCircle,
                    size: 18, color: AppColors.negative),
                onPressed: () => showMoveSheet(
                  context,
                  cubit,
                  month: month,
                  fixedTo: category,
                ),
              )
            // Without this the row reads as a read-only fact and nobody
            // discovers that tapping it is how money gets assigned.
            else ...[
              const SizedBox(width: 6),
              const Icon(LucideIcons.chevronRight,
                  size: 16, color: AppColors.textMuted),
            ],
          ],
        ),
      ),
    );
  }
}
