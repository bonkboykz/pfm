import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../../../app/theme.dart';
import '../../../../core/money/money.dart';
import '../../cubit/budget_cubit.dart';
import '../../data/budget_models.dart';
import 'category_picker.dart';

/// `POST /budget/:month/move`. Opened either to cover an overspent category
/// (target fixed, amount prefilled with the shortfall) or to move money out of
/// a category the user is already looking at (source fixed).
Future<void> showMoveSheet(
  BuildContext context,
  BudgetCubit cubit, {
  required BudgetMonth month,
  CategoryBudget? fixedFrom,
  CategoryBudget? fixedTo,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (_) => _MoveSheet(
      cubit: cubit,
      month: month,
      fixedFrom: fixedFrom,
      fixedTo: fixedTo,
    ),
  );
}

class _MoveSheet extends StatefulWidget {
  const _MoveSheet({
    required this.cubit,
    required this.month,
    this.fixedFrom,
    this.fixedTo,
  });

  final BudgetCubit cubit;
  final BudgetMonth month;
  final CategoryBudget? fixedFrom;
  final CategoryBudget? fixedTo;

  @override
  State<_MoveSheet> createState() => _MoveSheetState();
}

class _MoveSheetState extends State<_MoveSheet> {
  late CategoryBudget? _from = widget.fixedFrom;
  late CategoryBudget? _to = widget.fixedTo;
  late final TextEditingController _amount = TextEditingController(
    text: widget.fixedTo != null && widget.fixedTo!.overspentCents > 0
        ? formatMoneyInput(widget.fixedTo!.overspentCents)
        : '',
  );
  bool _saving = false;

  @override
  void dispose() {
    _amount.dispose();
    super.dispose();
  }

  bool get _isCover =>
      widget.fixedTo != null && widget.fixedTo!.overspentCents > 0;

  Future<void> _pick({required bool isSource}) async {
    final exclude = isSource ? _to?.categoryId : _from?.categoryId;
    final picked = await pickCategory(
      context,
      month: widget.month,
      excludeCategoryId: exclude,
      title: isSource ? 'Откуда взять' : 'Куда перевести',
      // Only categories holding money can be a source.
      onlyWithMoney: isSource,
      // Ready to Assign — источник, но не получатель: обратное направление это
      // снятие назначения, а не перевод.
      allowReadyToAssign: isSource,
    );
    if (picked == null || !mounted) return;
    setState(() => isSource ? _from = picked : _to = picked);
  }

  Future<void> _submit() async {
    final from = _from;
    final to = _to;
    if (from == null || to == null) return;

    final cents = parseMoneyToCents(_amount.text);
    if (cents == null || cents <= 0) {
      _toast('Введите сумму больше нуля', isError: true);
      return;
    }
    if (cents > from.availableCents) {
      _toast(
        'В «${from.categoryName}» доступно только ${formatMoneySmart(from.availableCents)}',
        isError: true,
      );
      return;
    }

    setState(() => _saving = true);
    // Из RTA деньги не перемещают, а назначают: движок отказывает системным
    // категориям в `move`. Назначение абсолютно, поэтому прибавляем к текущему.
    final error = from.isReadyToAssign
        ? await widget.cubit.assign(to.categoryId, to.assignedCents + cents)
        : await widget.cubit.move(from.categoryId, to.categoryId, cents);
    if (!mounted) return;
    setState(() => _saving = false);

    if (error != null) {
      _toast(error, isError: true);
      return;
    }
    Navigator.of(context).pop();
    _toast('${formatMoneySmart(cents)} → ${to.categoryName}');
  }

  void _toast(String message, {bool isError = false}) {
    final messenger = ScaffoldMessenger.maybeOf(context);
    messenger?.showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: isError ? AppColors.negative : AppColors.textPrimary,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final from = _from;
    final to = _to;

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
                  Text(
                    _isCover ? 'Покрыть перерасход' : 'Переместить деньги',
                    style: theme.textTheme.titleLarge?.copyWith(fontSize: 20),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _isCover
                        ? '${widget.fixedTo!.categoryName} ушли в минус на '
                            '${formatMoneySmart(widget.fixedTo!.overspentCents)}'
                        : 'Деньги перейдут между категориями этого месяца',
                    style: theme.textTheme.bodySmall
                        ?.copyWith(color: AppColors.textMuted),
                  ),
                  const SizedBox(height: 16),
                  _Picker(
                    label: 'Откуда',
                    category: from,
                    placeholder: 'Выберите категорию',
                    locked: widget.fixedFrom != null,
                    onTap: () => _pick(isSource: true),
                  ),
                  const SizedBox(height: 10),
                  const Center(
                    child: CircleAvatar(
                      radius: 16,
                      backgroundColor: AppColors.accentSoft,
                      child: Icon(LucideIcons.arrowDown,
                          size: 16, color: AppColors.accent),
                    ),
                  ),
                  const SizedBox(height: 10),
                  _Picker(
                    label: 'Куда',
                    category: to,
                    placeholder: 'Выберите категорию',
                    locked: widget.fixedTo != null,
                    onTap: () => _pick(isSource: false),
                  ),
                  const SizedBox(height: 16),
                  Text(
                    'Сумма перемещения',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: AppColors.textSecondary,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: _amount,
                    autofocus: !_isCover,
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
                  if (from != null) ...[
                    const SizedBox(height: 12),
                    _Note(
                      icon: LucideIcons.shieldAlert,
                      background: AppColors.neutralSoft,
                      foreground: AppColors.textSecondary,
                      // Про RTA нельзя обещать отказ сервера: назначение сверх
                      // остатка движок примет и уведёт его в минус. Ограничение
                      // здесь наше, и причина у него своя.
                      text: from.isReadyToAssign
                          ? 'Больше ${formatMoneySmart(from.availableCents)} '
                              'отсюда брать нельзя — остаток уйдёт в минус'
                          : 'Больше ${formatMoneySmart(from.availableCents)} '
                              'отсюда взять нельзя — сервер откажет',
                    ),
                  ],
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed:
                        _saving || from == null || to == null ? null : _submit,
                    child: _saving
                        ? const SizedBox(
                            height: 20,
                            width: 20,
                            child: CircularProgressIndicator(
                                strokeWidth: 2, color: Colors.white),
                          )
                        : const Text('Переместить'),
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

class _Picker extends StatelessWidget {
  const _Picker({
    required this.label,
    required this.category,
    required this.placeholder,
    required this.locked,
    required this.onTap,
  });

  final String label;
  final CategoryBudget? category;
  final String placeholder;
  final bool locked;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final c = category;

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: theme.textTheme.bodySmall?.copyWith(
            color: AppColors.textSecondary,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 8),
        InkWell(
          onTap: locked ? null : onTap,
          borderRadius: BorderRadius.circular(AppRadii.inner),
          child: Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            decoration: BoxDecoration(
              color: AppColors.bg,
              borderRadius: BorderRadius.circular(AppRadii.inner),
              border: Border.all(color: AppColors.border),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    c?.categoryName ?? placeholder,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodyLarge?.copyWith(
                      fontWeight: FontWeight.w600,
                      color:
                          c == null ? AppColors.textMuted : AppColors.textPrimary,
                    ),
                  ),
                ),
                if (c != null)
                  Text(
                    formatMoneySmart(c.availableCents),
                    style: theme.textTheme.bodyMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                      fontFeatures: kTabularFigures,
                      color: AppColors.forAvailable(c.availableCents),
                    ),
                  ),
                if (!locked) ...[
                  const SizedBox(width: 8),
                  const Icon(LucideIcons.chevronDown,
                      size: 16, color: AppColors.textMuted),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _Note extends StatelessWidget {
  const _Note({
    required this.icon,
    required this.background,
    required this.foreground,
    required this.text,
  });

  final IconData icon;
  final Color background;
  final Color foreground;
  final String text;

  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: background,
          borderRadius: BorderRadius.circular(AppRadii.inner),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, size: 15, color: foreground),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                text,
                style: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(fontSize: 11, color: foreground),
              ),
            ),
          ],
        ),
      );
}
