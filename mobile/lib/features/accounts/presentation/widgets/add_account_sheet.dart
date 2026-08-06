import 'package:flutter/material.dart';

import '../../../../app/theme.dart';
import '../../cubit/accounts_cubit.dart';
import '../../data/accounts_models.dart';

Future<void> showAddAccountSheet(BuildContext context, AccountsCubit cubit) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (_) => _AddAccountSheet(cubit: cubit),
  );
}

class _AddAccountSheet extends StatefulWidget {
  const _AddAccountSheet({required this.cubit});

  final AccountsCubit cubit;

  @override
  State<_AddAccountSheet> createState() => _AddAccountSheetState();
}

class _AddAccountSheetState extends State<_AddAccountSheet> {
  final _name = TextEditingController();
  String _type = 'checking';
  String _currency = 'KZT';
  bool _onBudget = true;
  bool _saving = false;

  // The API accepts any ISO code; these are the ones formatMoney knows about.
  static const _currencies = ['KZT', 'USD', 'EUR', 'RUB', 'CNY', 'TRY', 'GEL'];

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final name = _name.text.trim();
    if (name.isEmpty) {
      _toast('Введите название счёта', isError: true);
      return;
    }

    setState(() => _saving = true);
    final error = await widget.cubit.create(
      name: name,
      type: _type,
      currency: _currency,
      onBudget: _onBudget,
    );
    if (!mounted) return;
    setState(() => _saving = false);

    if (error != null) {
      _toast(error, isError: true);
      return;
    }
    Navigator.of(context).pop();
    _toast('Счёт «$name» создан');
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
    final isTracking = _type == 'tracking';

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
                  Text('Новый счёт',
                      style: theme.textTheme.titleLarge?.copyWith(fontSize: 20)),
                  const SizedBox(height: 16),
                  TextField(
                    controller: _name,
                    autofocus: true,
                    textCapitalization: TextCapitalization.sentences,
                    decoration: const InputDecoration(labelText: 'Название'),
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    initialValue: _type,
                    decoration: const InputDecoration(labelText: 'Тип'),
                    items: [
                      for (final entry in accountTypes.entries)
                        DropdownMenuItem(
                            value: entry.key, child: Text(entry.value)),
                    ],
                    onChanged: (v) => setState(() {
                      _type = v ?? 'checking';
                      if (_type == 'tracking') _onBudget = false;
                    }),
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    initialValue: _currency,
                    decoration: const InputDecoration(labelText: 'Валюта'),
                    items: [
                      for (final c in _currencies)
                        DropdownMenuItem(value: c, child: Text(c)),
                    ],
                    onChanged: (v) => setState(() => _currency = v ?? 'KZT'),
                  ),
                  const SizedBox(height: 4),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    value: _onBudget && !isTracking,
                    onChanged:
                        isTracking ? null : (v) => setState(() => _onBudget = v),
                    title: const Text('Участвует в бюджете'),
                    subtitle: Text(
                      isTracking
                          ? 'Отслеживаемые счета всегда вне бюджета'
                          : 'Деньги со счёта попадают в Ready to Assign',
                      style: theme.textTheme.bodySmall
                          ?.copyWith(color: AppColors.textMuted),
                    ),
                  ),
                  const SizedBox(height: 12),
                  FilledButton(
                    onPressed: _saving ? null : _submit,
                    child: _saving
                        ? const SizedBox(
                            height: 20,
                            width: 20,
                            child: CircularProgressIndicator(
                                strokeWidth: 2, color: Colors.white),
                          )
                        : const Text('Создать счёт'),
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
