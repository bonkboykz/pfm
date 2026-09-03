import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../../../app/theme.dart';
import '../../../../core/dates/months.dart';
import '../../../../core/money/money.dart';
import '../../../../core/widgets/states.dart';
import '../../cubit/budget_cubit.dart';
import '../../data/budget_models.dart';
import 'category_picker.dart';
import 'goal_sheet.dart';
import 'move_sheet.dart';

/// `POST /budget/:month/assign` — the endpoint SETS the month's assignment
/// rather than adding to it, so the field is prefilled with the current value
/// and the sheet says so explicitly.
Future<void> showAssignSheet(
  BuildContext context,
  BudgetCubit cubit, {
  required BudgetMonth month,
  required CategoryBudget category,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (_) =>
        _AssignSheet(cubit: cubit, month: month, category: category),
  );
}

class _AssignSheet extends StatefulWidget {
  const _AssignSheet({
    required this.cubit,
    required this.month,
    required this.category,
  });

  final BudgetCubit cubit;
  final BudgetMonth month;
  final CategoryBudget category;

  @override
  State<_AssignSheet> createState() => _AssignSheetState();
}

class _AssignSheetState extends State<_AssignSheet> {
  late final TextEditingController _amount = TextEditingController(
    text: widget.category.assignedCents == 0
        ? ''
        : formatMoneyInput(widget.category.assignedCents),
  );
  bool _saving = false;

  @override
  void dispose() {
    _amount.dispose();
    super.dispose();
  }

  void _setAmount(int cents) {
    _amount.text = cents == 0 ? '' : formatMoneyInput(cents);
    _amount.selection =
        TextSelection.collapsed(offset: _amount.text.length);
    setState(() {});
  }

  Future<void> _submit() async {
    final cents = parseMoneyToCents(_amount.text) ?? 0;
    if (cents < 0) {
      _toast('Назначить можно только неотрицательную сумму', isError: true);
      return;
    }

    setState(() => _saving = true);
    final error = await widget.cubit.assign(widget.category.categoryId, cents);
    if (!mounted) return;
    setState(() => _saving = false);

    if (error != null) {
      _toast(error, isError: true);
      return;
    }
    Navigator.of(context).pop();
    _toast('${widget.category.categoryName}: назначено ${formatMoneySmart(cents)}');
  }

  void _toast(String message, {bool isError = false}) {
    ScaffoldMessenger.maybeOf(context)?.showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: isError ? AppColors.negative : AppColors.textPrimary,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final category = widget.category;
    final snoozed = category.targetSnoozedMonth == widget.month.month;
    final spent = category.activityCents < 0 ? -category.activityCents : 0;

    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SheetGrabber(),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 10, 20, 28),
              child: Column(
                mainAxisSize: MainAxisSize.min,
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
                              category.categoryName,
                              style: theme.textTheme.titleLarge
                                  ?.copyWith(fontSize: 20),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              [
                                widget.month.groupNameOf(category.categoryId),
                                formatMonthInline(widget.month.month),
                              ].whereType<String>().join(' · '),
                              style: theme.textTheme.bodySmall
                                  ?.copyWith(color: AppColors.textMuted),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 12),
                      _AvailablePill(cents: category.availableCents),
                    ],
                  ),
                  const SizedBox(height: 14),
                  // Цель живёт на категории, а не на месяце, поэтому она не
                  // часть формы назначения — но найти её надо здесь, иначе
                  // выставить цель по-прежнему негде.
                  InkWell(
                    key: const Key('goal-row'),
                    onTap: _saving
                        ? null
                        : () {
                            Navigator.of(context).pop();
                            showGoalSheet(
                              context,
                              widget.cubit,
                              category: category,
                            );
                          },
                    borderRadius: BorderRadius.circular(AppRadii.inner),
                    child: Container(
                      width: double.infinity,
                      padding: const EdgeInsets.symmetric(
                          horizontal: 14, vertical: 12),
                      decoration: BoxDecoration(
                        color: AppColors.bg,
                        borderRadius: BorderRadius.circular(AppRadii.inner),
                        border: Border.all(color: AppColors.border),
                      ),
                      child: Row(
                        children: [
                          Icon(
                            LucideIcons.target,
                            size: 16,
                            color: category.hasTarget
                                ? AppColors.accent
                                : AppColors.textMuted,
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              goalSummary(category),
                              style: theme.textTheme.bodyMedium?.copyWith(
                                fontSize: 13,
                                fontWeight: FontWeight.w600,
                                color: category.hasTarget
                                    ? AppColors.textPrimary
                                    : AppColors.textMuted,
                              ),
                            ),
                          ),
                          const Icon(LucideIcons.chevronRight,
                              size: 16, color: AppColors.textMuted),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 18),
                  Text(
                    'Назначено за месяц',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: AppColors.textSecondary,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: _amount,
                    autofocus: true,
                    keyboardType: TextInputType.number,
                    style: theme.textTheme.headlineSmall?.copyWith(
                      fontSize: 28,
                      fontWeight: FontWeight.w800,
                      fontFeatures: kTabularFigures,
                    ),
                    decoration: const InputDecoration(
                      hintText: '0',
                      suffixText: '₸',
                      contentPadding:
                          EdgeInsets.symmetric(horizontal: 18, vertical: 16),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(
                        horizontal: 12, vertical: 10),
                    decoration: BoxDecoration(
                      color: AppColors.accentSoft,
                      borderRadius: BorderRadius.circular(AppRadii.inner),
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Icon(LucideIcons.info,
                            size: 15, color: AppColors.accent),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            'Сумма заменяет текущее назначение, '
                            'а не прибавляется к нему',
                            style: theme.textTheme.bodySmall?.copyWith(
                              fontSize: 11,
                              color: const Color(0xFF0B6E66),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 14),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      if (spent > 0)
                        _Chip(
                          label: 'Покрыть расход · ${formatMoneySmart(spent)}',
                          accent: true,
                          onTap: () => _setAmount(spent),
                        ),
                      if (category.hasTarget)
                        _Chip(
                          label:
                              'До цели · ${formatMoneySmart(category.targetAmountCents!)}',
                          accent: false,
                          onTap: () => _setAmount(category.targetAmountCents!),
                        ),
                      _Chip(
                        label: 'Обнулить',
                        accent: false,
                        onTap: () => _setAmount(0),
                      ),
                      _Chip(
                        label: '+10 000',
                        accent: false,
                        onTap: () => _setAmount(
                          (parseMoneyToCents(_amount.text) ?? 0) + 1000000,
                        ),
                      ),
                      // Отложить цель — третий вариант между «финансировать
                      // нечем» и «снять цель совсем». Снятую не вспоминают,
                      // отложенная просыпается сама в следующем месяце.
                      if (category.hasTarget)
                        _Chip(
                          label: snoozed
                              ? 'Вернуть цель'
                              : 'Отложить цель на месяц',
                          accent: false,
                          onTap: () async {
                            final error = await widget.cubit.snoozeTarget(
                              category.categoryId,
                              snooze: !snoozed,
                            );
                            if (!context.mounted) return;
                            if (error != null) {
                              showToast(context, error, isError: true);
                              return;
                            }
                            Navigator.of(context).pop();
                          },
                        ),
                    ],
                  ),
                  const SizedBox(height: 18),
                  FilledButton(
                    onPressed: _saving ? null : _submit,
                    child: _saving
                        ? const SizedBox(
                            height: 20,
                            width: 20,
                            child: CircularProgressIndicator(
                                strokeWidth: 2, color: Colors.white),
                          )
                        : const Text('Сохранить'),
                  ),
                  const SizedBox(height: 10),
                  OutlinedButton.icon(
                    onPressed: _saving
                        ? null
                        : () {
                            Navigator.of(context).pop();
                            showMoveSheet(
                              context,
                              widget.cubit,
                              month: widget.month,
                              fixedTo: category,
                            );
                          },
                    icon: const Icon(LucideIcons.arrowLeftRight, size: 16),
                    label: const Text('Переместить из другой категории'),
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size.fromHeight(48),
                      foregroundColor: AppColors.textSecondary,
                      side: const BorderSide(color: AppColors.border),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(AppRadii.inner),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _AvailablePill extends StatelessWidget {
  const _AvailablePill({required this.cents});

  final int cents;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final color = AppColors.forAvailable(cents);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: AppColors.forAvailableSoft(cents),
        borderRadius: BorderRadius.circular(AppRadii.inner),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.end,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            'Доступно',
            style: theme.textTheme.bodySmall?.copyWith(
              fontSize: 10,
              fontWeight: FontWeight.w600,
              color: color,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            formatMoneySmart(cents),
            style: theme.textTheme.titleMedium?.copyWith(
              fontSize: 16,
              fontWeight: FontWeight.w800,
              fontFeatures: kTabularFigures,
              color: color,
            ),
          ),
        ],
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({
    required this.label,
    required this.accent,
    required this.onTap,
  });

  final String label;
  final bool accent;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadii.pill),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
          decoration: BoxDecoration(
            color: accent ? AppColors.accentSoft : AppColors.bg,
            borderRadius: BorderRadius.circular(AppRadii.pill),
            border: Border.all(
                color: accent ? AppColors.accentSoft : AppColors.border),
          ),
          child: Text(
            label,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: accent ? AppColors.accent : AppColors.textSecondary,
                ),
          ),
        ),
      );
}
