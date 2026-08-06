import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:lucide_icons/lucide_icons.dart';

import '../../../../app/theme.dart';
import '../../../../core/money/money.dart';
import '../../../../core/widgets/states.dart';
import '../../cubit/debts_cubit.dart';

Future<void> showAddDebtSheet(BuildContext context, DebtsCubit cubit) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (_) => _AddDebtSheet(cubit: cubit),
  );
}

class _AddDebtSheet extends StatefulWidget {
  const _AddDebtSheet({required this.cubit});

  final DebtsCubit cubit;

  @override
  State<_AddDebtSheet> createState() => _AddDebtSheetState();
}

class _AddDebtSheetState extends State<_AddDebtSheet> {
  final _person = TextEditingController();
  final _amount = TextEditingController();
  final _note = TextEditingController();
  String _direction = 'owe';
  String _currency = 'KZT';
  DateTime? _dueDate;
  bool _saving = false;

  static const _currencies = ['KZT', 'USD', 'EUR', 'RUB', 'CNY'];

  @override
  void dispose() {
    _person.dispose();
    _amount.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final person = _person.text.trim();
    if (person.isEmpty) {
      showToast(context, 'Введите имя', isError: true);
      return;
    }
    final cents = parseMoneyToCents(_amount.text);
    if (cents == null || cents <= 0) {
      showToast(context, 'Введите сумму больше нуля', isError: true);
      return;
    }

    setState(() => _saving = true);
    final error = await widget.cubit.create(
      personName: person,
      direction: _direction,
      amountCents: cents,
      currency: _currency,
      dueDate:
          _dueDate == null ? null : DateFormat('yyyy-MM-dd').format(_dueDate!),
      note: _note.text.trim(),
    );
    if (!mounted) return;
    setState(() => _saving = false);

    if (error != null) {
      showToast(context, error, isError: true);
      return;
    }
    Navigator.of(context).pop();
    showToast(context, 'Долг добавлен');
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    Widget directionOption(String value, String label, IconData icon) {
      final active = _direction == value;
      return Expanded(
        child: GestureDetector(
          onTap: () => setState(() => _direction = value),
          child: Container(
            padding: const EdgeInsets.symmetric(vertical: 12),
            decoration: BoxDecoration(
              color: active ? AppColors.accentSoft : AppColors.bg,
              borderRadius: BorderRadius.circular(AppRadii.inner),
              border: Border.all(
                  color: active ? AppColors.accent : AppColors.border),
            ),
            child: Column(
              children: [
                Icon(icon,
                    size: 18,
                    color: active ? AppColors.accent : AppColors.textMuted),
                const SizedBox(height: 5),
                Text(
                  label,
                  style: theme.textTheme.bodySmall?.copyWith(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: active ? AppColors.accent : AppColors.textSecondary,
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                margin: const EdgeInsets.only(top: 10, bottom: 6),
                height: 4,
                width: 40,
                decoration: BoxDecoration(
                  color: AppColors.border,
                  borderRadius: BorderRadius.circular(AppRadii.pill),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 10, 20, 28),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Новый долг',
                      style: theme.textTheme.titleLarge?.copyWith(fontSize: 20)),
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      directionOption('owe', 'Я должен', LucideIcons.arrowUpRight),
                      const SizedBox(width: 10),
                      directionOption(
                          'owed', 'Мне должны', LucideIcons.arrowDownLeft),
                    ],
                  ),
                  const SizedBox(height: 14),
                  TextField(
                    controller: _person,
                    autofocus: true,
                    textCapitalization: TextCapitalization.words,
                    decoration: const InputDecoration(
                      labelText: 'Кто',
                      prefixIcon: Icon(LucideIcons.user, size: 18),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        flex: 2,
                        child: TextField(
                          controller: _amount,
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(labelText: 'Сумма'),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: DropdownButtonFormField<String>(
                          initialValue: _currency,
                          decoration: const InputDecoration(labelText: 'Валюта'),
                          items: [
                            for (final c in _currencies)
                              DropdownMenuItem(value: c, child: Text(c)),
                          ],
                          onChanged: (v) =>
                              setState(() => _currency = v ?? 'KZT'),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  InkWell(
                    onTap: () async {
                      final picked = await showDatePicker(
                        context: context,
                        initialDate: _dueDate ?? DateTime.now(),
                        firstDate: DateTime(2000),
                        lastDate: DateTime(2100),
                      );
                      if (picked != null) setState(() => _dueDate = picked);
                    },
                    borderRadius: BorderRadius.circular(AppRadii.inner),
                    child: Container(
                      width: double.infinity,
                      padding: const EdgeInsets.symmetric(
                          horizontal: 16, vertical: 16),
                      decoration: BoxDecoration(
                        color: AppColors.bg,
                        borderRadius: BorderRadius.circular(AppRadii.inner),
                        border: Border.all(color: AppColors.border),
                      ),
                      child: Row(
                        children: [
                          const Icon(LucideIcons.calendar,
                              size: 16, color: AppColors.textMuted),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              _dueDate == null
                                  ? 'Срок возврата (необязательно)'
                                  : DateFormat('d MMMM yyyy', 'ru')
                                      .format(_dueDate!),
                              style: theme.textTheme.bodyLarge?.copyWith(
                                fontSize: 15,
                                color: _dueDate == null
                                    ? AppColors.textMuted
                                    : AppColors.textPrimary,
                              ),
                            ),
                          ),
                          if (_dueDate != null)
                            IconButton(
                              icon: const Icon(LucideIcons.x, size: 16),
                              onPressed: () => setState(() => _dueDate = null),
                            ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _note,
                    textCapitalization: TextCapitalization.sentences,
                    decoration: const InputDecoration(
                      labelText: 'Заметка',
                      prefixIcon: Icon(LucideIcons.pencil, size: 18),
                    ),
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
                        : const Text('Добавить'),
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
