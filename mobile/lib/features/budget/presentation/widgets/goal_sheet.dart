import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../../../app/theme.dart';
import '../../../../core/dates/months.dart';
import '../../../../core/money/money.dart';
import '../../cubit/budget_cubit.dart';
import '../../data/budget_models.dart';
import 'category_picker.dart';

/// `PATCH /categories/:id` — цель категории.
///
/// Три типа считаются движком по-разному, и разница видна пользователю в
/// «Недофинансировано», поэтому выбор объясняется словами, а не именем поля.
Future<void> showGoalSheet(
  BuildContext context,
  BudgetCubit cubit, {
  required CategoryBudget category,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (_) => _GoalSheet(cubit: cubit, category: category),
  );
}

/// Человеческое описание цели для строки в шторке категории.
String goalSummary(CategoryBudget c) {
  if (!c.hasTarget) return 'Цель не задана';
  final amount = formatMoneySmart(c.targetAmountCents!);
  return switch (c.targetType) {
    'monthly_funding' => '$amount каждый месяц',
    'target_balance' => 'Держать $amount',
    // «до» требует родительного падежа — ровно того, что даёт
    // formatMonthGenitive. С «к» пришлось бы дательный, а его intl не даёт,
    // и вышло бы «к декабря 2026».
    'target_by_date' => c.targetDate == null
        ? 'Собрать $amount'
        : 'Собрать $amount до ${formatMonthGenitive(c.targetDate!.substring(0, 7))}',
    _ => amount,
  };
}

class _GoalSheet extends StatefulWidget {
  const _GoalSheet({required this.cubit, required this.category});

  final BudgetCubit cubit;
  final CategoryBudget category;

  @override
  State<_GoalSheet> createState() => _GoalSheetState();
}

class _GoalSheetState extends State<_GoalSheet> {
  late String _type =
      widget.category.hasTarget ? widget.category.targetType! : 'monthly_funding';
  late String? _month = widget.category.targetDate?.substring(0, 7);
  late final TextEditingController _amount = TextEditingController(
    text: widget.category.targetAmountCents == null
        ? ''
        : formatMoneyInput(widget.category.targetAmountCents!),
  );
  bool _saving = false;
  bool _monthMissing = false;

  @override
  void dispose() {
    _amount.dispose();
    super.dispose();
  }

  Future<void> _pickMonth() async {
    final from = currentMonth();
    final months = [for (var i = 0; i < 24; i++) shiftMonth(from, i)];

    final picked = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (_) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.6,
        builder: (context, controller) => Column(
          children: [
            const SheetGrabber(),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 6, 20, 8),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  'К какому месяцу',
                  style: Theme.of(context)
                      .textTheme
                      .titleLarge
                      ?.copyWith(fontSize: 18),
                ),
              ),
            ),
            Expanded(
              child: ListView(
                controller: controller,
                children: [
                  for (final m in months)
                    ListTile(
                      title: Text(formatMonthLabel(m)),
                      onTap: () => Navigator.of(context).pop(m),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );

    if (picked == null || !mounted) return;
    setState(() {
      _month = picked;
      _monthMissing = false;
    });
  }

  Future<void> _save() async {
    final cents = parseMoneyToCents(_amount.text) ?? 0;
    if (cents <= 0) {
      _toast('Сумма цели должна быть больше нуля', isError: true);
      return;
    }
    if (_type == 'target_by_date' && _month == null) {
      setState(() => _monthMissing = true);
      return;
    }

    await _send(
      type: _type,
      amountCents: cents,
      // Движок считает целыми месяцами, поэтому день всегда первый.
      date: _type == 'target_by_date' ? '$_month-01' : null,
    );
  }

  Future<void> _clear() => _send(type: 'none');

  Future<void> _send({
    required String type,
    int? amountCents,
    String? date,
  }) async {
    setState(() => _saving = true);
    final error = await widget.cubit.setTarget(
      widget.category.categoryId,
      type: type,
      amountCents: amountCents,
      date: date,
    );
    if (!mounted) return;
    setState(() => _saving = false);

    if (error != null) {
      _toast(error, isError: true);
      return;
    }
    Navigator.of(context).pop();
    _toast(type == 'none'
        ? '${widget.category.categoryName}: цель убрана'
        : '${widget.category.categoryName}: цель сохранена');
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
                  Text('Цель категории',
                      style: theme.textTheme.titleLarge?.copyWith(fontSize: 20)),
                  const SizedBox(height: 4),
                  Text(
                    widget.category.categoryName,
                    style: theme.textTheme.bodySmall
                        ?.copyWith(color: AppColors.textMuted),
                  ),
                  const SizedBox(height: 16),
                  _TypeOption(
                    title: 'Откладывать каждый месяц',
                    subtitle:
                        'Сумму надо назначать заново в каждом месяце. Для аренды, '
                        'подписок, платежей по кредиту.',
                    selected: _type == 'monthly_funding',
                    onTap: () => setState(() => _type = 'monthly_funding'),
                  ),
                  const SizedBox(height: 8),
                  _TypeOption(
                    title: 'Держать на счету',
                    subtitle:
                        'Доступно не должно опускаться ниже суммы. Для подушки '
                        'и запаса на непредвиденное.',
                    selected: _type == 'target_balance',
                    onTap: () => setState(() => _type = 'target_balance'),
                  ),
                  const SizedBox(height: 8),
                  _TypeOption(
                    title: 'Собрать к дате',
                    subtitle:
                        'Недостающее делится на оставшиеся месяцы. Для отпуска, '
                        'ремонта, крупной покупки.',
                    selected: _type == 'target_by_date',
                    onTap: () => setState(() => _type = 'target_by_date'),
                  ),
                  const SizedBox(height: 18),
                  Text(
                    'Сумма цели',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: AppColors.textSecondary,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    key: const Key('goal-amount'),
                    controller: _amount,
                    keyboardType: TextInputType.number,
                    style: theme.textTheme.headlineSmall?.copyWith(
                      fontSize: 26,
                      fontWeight: FontWeight.w800,
                      fontFeatures: kTabularFigures,
                    ),
                    decoration: const InputDecoration(
                      hintText: '0',
                      suffixText: '₸',
                      contentPadding:
                          EdgeInsets.symmetric(horizontal: 18, vertical: 14),
                    ),
                  ),
                  if (_type == 'target_by_date') ...[
                    const SizedBox(height: 14),
                    InkWell(
                      key: const Key('goal-month'),
                      onTap: _pickMonth,
                      borderRadius: BorderRadius.circular(AppRadii.inner),
                      child: Container(
                        width: double.infinity,
                        padding: const EdgeInsets.symmetric(
                            horizontal: 16, vertical: 14),
                        decoration: BoxDecoration(
                          color: AppColors.bg,
                          borderRadius: BorderRadius.circular(AppRadii.inner),
                          border: Border.all(
                            color: _monthMissing
                                ? AppColors.negative
                                : AppColors.border,
                          ),
                        ),
                        child: Row(
                          children: [
                            const Icon(LucideIcons.calendar,
                                size: 16, color: AppColors.textMuted),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                _month == null
                                    ? 'Выберите месяц'
                                    : formatMonthLabel(_month!),
                                style: theme.textTheme.bodyLarge?.copyWith(
                                  fontWeight: FontWeight.w600,
                                  color: _month == null
                                      ? AppColors.textMuted
                                      : AppColors.textPrimary,
                                ),
                              ),
                            ),
                            const Icon(LucideIcons.chevronDown,
                                size: 16, color: AppColors.textMuted),
                          ],
                        ),
                      ),
                    ),
                    if (_monthMissing) ...[
                      const SizedBox(height: 6),
                      Text(
                        'Выберите месяц — без него делить недостающее не на что',
                        style: theme.textTheme.bodySmall?.copyWith(
                          fontSize: 11,
                          color: AppColors.negative,
                        ),
                      ),
                    ],
                    const SizedBox(height: 6),
                    Text(
                      'Движок считает целыми месяцами, день значения не имеет',
                      style: theme.textTheme.bodySmall
                          ?.copyWith(fontSize: 11, color: AppColors.textMuted),
                    ),
                  ],
                  const SizedBox(height: 18),
                  FilledButton(
                    onPressed: _saving ? null : _save,
                    child: _saving
                        ? const SizedBox(
                            height: 20,
                            width: 20,
                            child: CircularProgressIndicator(
                                strokeWidth: 2, color: Colors.white),
                          )
                        : const Text('Сохранить цель'),
                  ),
                  if (widget.category.hasTarget) ...[
                    const SizedBox(height: 10),
                    OutlinedButton(
                      onPressed: _saving ? null : _clear,
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size.fromHeight(48),
                        foregroundColor: AppColors.negative,
                        side: const BorderSide(color: AppColors.border),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(AppRadii.inner),
                        ),
                      ),
                      child: const Text('Убрать цель'),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _TypeOption extends StatelessWidget {
  const _TypeOption({
    required this.title,
    required this.subtitle,
    required this.selected,
    required this.onTap,
  });

  final String title;
  final String subtitle;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppRadii.inner),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: selected ? AppColors.accentSoft : AppColors.bg,
          borderRadius: BorderRadius.circular(AppRadii.inner),
          border: Border.all(
            color: selected ? AppColors.accent : AppColors.border,
          ),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              selected ? LucideIcons.circleCheck : LucideIcons.circle,
              size: 18,
              color: selected ? AppColors.accent : AppColors.textMuted,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: theme.textTheme.bodyLarge?.copyWith(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      color: selected ? AppColors.accent : AppColors.textPrimary,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    subtitle,
                    style: theme.textTheme.bodySmall?.copyWith(
                      fontSize: 11,
                      color: AppColors.textMuted,
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
