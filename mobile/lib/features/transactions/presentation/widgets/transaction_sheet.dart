import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:lucide_icons/lucide_icons.dart';

import '../../../../app/theme.dart';
import '../../../../core/money/money.dart';
import '../../../accounts/data/accounts_models.dart';
import '../../cubit/transactions_cubit.dart';
import '../../data/transactions_models.dart';

enum TxMode { expense, income, transfer }

/// Income is an inflow booked to the system Ready to Assign category.
const _readyToAssignId = 'ready-to-assign';

Future<void> showTransactionSheet(
  BuildContext context,
  TransactionsCubit cubit, {
  required TransactionsState state,
  Transaction? existing,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (_) =>
        _TransactionSheet(cubit: cubit, state: state, existing: existing),
  );
}

class _TransactionSheet extends StatefulWidget {
  const _TransactionSheet({
    required this.cubit,
    required this.state,
    this.existing,
  });

  final TransactionsCubit cubit;
  final TransactionsState state;
  final Transaction? existing;

  @override
  State<_TransactionSheet> createState() => _TransactionSheetState();
}

class _TransactionSheetState extends State<_TransactionSheet> {
  late TxMode _mode;
  late final TextEditingController _amount;
  late final TextEditingController _payee;
  late final TextEditingController _memo;
  Account? _account;
  Account? _toAccount;
  CategoryRef? _category;
  late DateTime _date;
  late bool _cleared;
  bool _saving = false;

  bool get _isEdit => widget.existing != null;

  @override
  void initState() {
    super.initState();
    final t = widget.existing;
    final accounts = widget.state.accounts;

    _mode = t == null
        ? TxMode.expense
        : (t.isTransfer
            ? TxMode.transfer
            : (t.isInflow ? TxMode.income : TxMode.expense));

    _amount = TextEditingController(
      text: t == null ? '' : formatMoneyInput(t.amountCents.abs()),
    );
    _payee = TextEditingController(text: t?.payeeName ?? '');
    _memo = TextEditingController(text: t?.memo ?? '');
    _date = t == null ? DateTime.now() : (DateTime.tryParse(t.date) ?? DateTime.now());
    _cleared = t?.isCleared ?? false;

    _account = t == null
        ? (accounts.isNotEmpty ? accounts.first : null)
        : widget.state.accountOf(t.accountId);
    _toAccount = t?.transferAccountId == null
        ? null
        : widget.state.accountOf(t!.transferAccountId!);

    final categories = widget.state.categories?.categories ?? const <CategoryRef>[];
    if (t?.categoryId != null && !t!.isIncome) {
      for (final c in categories) {
        if (c.id == t.categoryId) _category = c;
      }
    }
  }

  @override
  void dispose() {
    _amount.dispose();
    _payee.dispose();
    _memo.dispose();
    super.dispose();
  }

  String get _currency => _account?.currency ?? 'KZT';

  Future<void> _pickAccount({required bool isTarget}) async {
    final picked = await showModalBottomSheet<Account>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _AccountPicker(
        accounts: widget.state.accounts,
        excludeId: isTarget ? _account?.id : _toAccount?.id,
        title: isTarget ? 'Счёт зачисления' : 'Счёт списания',
      ),
    );
    if (picked == null || !mounted) return;
    setState(() => isTarget ? _toAccount = picked : _account = picked);
  }

  Future<void> _pickCategory() async {
    final categories = widget.state.categories?.categories ?? const <CategoryRef>[];
    if (categories.isEmpty) {
      _toast('Категории не загрузились', isError: true);
      return;
    }
    final picked = await showModalBottomSheet<CategoryRef>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _CategoryPicker(categories: categories),
    );
    if (picked == null || !mounted) return;
    setState(() => _category = picked);
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _date,
      firstDate: DateTime(2000),
      lastDate: DateTime(2100),
    );
    if (picked == null || !mounted) return;
    setState(() => _date = picked);
  }

  Future<void> _submit() async {
    final account = _account;
    if (account == null) {
      _toast('Выберите счёт', isError: true);
      return;
    }
    final magnitude = parseMoneyToCents(_amount.text);
    if (magnitude == null || magnitude <= 0) {
      _toast('Введите сумму больше нуля', isError: true);
      return;
    }
    if (_mode == TxMode.transfer && _toAccount == null) {
      _toast('Выберите счёт зачисления', isError: true);
      return;
    }
    if (_mode == TxMode.transfer && _toAccount!.id == account.id) {
      _toast('Счета перевода должны отличаться', isError: true);
      return;
    }

    final signed = _mode == TxMode.income ? magnitude : -magnitude;
    final date = DateFormat('yyyy-MM-dd').format(_date);

    setState(() => _saving = true);
    final String? error;
    if (_isEdit) {
      error = await widget.cubit.update(
        widget.existing!.id,
        date: date,
        amountCents: signed,
        payeeName: _mode == TxMode.transfer ? null : _payee.text.trim(),
        categoryId: switch (_mode) {
          TxMode.income => _readyToAssignId,
          TxMode.expense => _category?.id,
          TxMode.transfer => null,
        },
        clearCategory: _mode == TxMode.expense && _category == null,
        memo: _memo.text.trim(),
        cleared: _cleared,
      );
    } else {
      error = await widget.cubit.create(
        accountId: account.id,
        date: date,
        amountCents: signed,
        payeeName: _mode == TxMode.transfer ? null : _payee.text.trim(),
        categoryId: switch (_mode) {
          TxMode.income => _readyToAssignId,
          TxMode.expense => _category?.id,
          TxMode.transfer => null,
        },
        transferAccountId: _mode == TxMode.transfer ? _toAccount!.id : null,
        memo: _memo.text.trim(),
        cleared: _cleared,
      );
    }

    if (!mounted) return;
    setState(() => _saving = false);
    if (error != null) {
      _toast(error, isError: true);
      return;
    }
    Navigator.of(context).pop();
    _toast(_isEdit ? 'Операция обновлена' : 'Операция добавлена');
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
    final isTransfer = _mode == TxMode.transfer;

    final amountLabel = switch (_mode) {
      TxMode.expense => 'Сумма расхода',
      TxMode.income => 'Сумма дохода',
      TxMode.transfer => 'Сумма перевода',
    };
    final saveLabel = _isEdit
        ? 'Сохранить'
        : switch (_mode) {
            TxMode.expense => 'Добавить расход',
            TxMode.income => 'Добавить доход',
            TxMode.transfer => 'Перевести',
          };

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
                  if (_isEdit) ...[
                    Row(
                      children: [
                        Expanded(
                          child: Text('Операция',
                              style: theme.textTheme.titleLarge
                                  ?.copyWith(fontSize: 20)),
                        ),
                        IconButton(
                          icon: const Icon(LucideIcons.trash2,
                              size: 18, color: AppColors.negative),
                          onPressed: _saving ? null : _confirmDelete,
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                  ] else
                    _ModeSegments(
                      mode: _mode,
                      onChanged: (m) => setState(() => _mode = m),
                    ),
                  const SizedBox(height: 16),
                  Text(
                    amountLabel,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: AppColors.textSecondary,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: _amount,
                    autofocus: !_isEdit,
                    keyboardType: TextInputType.number,
                    style: theme.textTheme.headlineSmall?.copyWith(
                      fontSize: 28,
                      fontWeight: FontWeight.w800,
                      fontFeatures: kTabularFigures,
                    ),
                    decoration: InputDecoration(
                      hintText: '0',
                      suffixText: currencySymbol(_currency),
                      contentPadding: const EdgeInsets.symmetric(
                          horizontal: 18, vertical: 16),
                    ),
                  ),
                  const SizedBox(height: 12),
                  _PickerField(
                    label: isTransfer ? 'Счёт списания' : 'Счёт',
                    value: _account?.name,
                    placeholder: 'Выберите счёт',
                    icon: LucideIcons.wallet,
                    // accountId is not patchable on the API.
                    locked: _isEdit,
                    onTap: () => _pickAccount(isTarget: false),
                  ),
                  if (isTransfer) ...[
                    const SizedBox(height: 10),
                    _PickerField(
                      label: 'Счёт зачисления',
                      value: _toAccount?.name,
                      placeholder: 'Выберите счёт',
                      icon: LucideIcons.arrowDownLeft,
                      locked: _isEdit,
                      onTap: () => _pickAccount(isTarget: true),
                    ),
                  ],
                  if (_mode == TxMode.expense) ...[
                    const SizedBox(height: 10),
                    _PickerField(
                      label: 'Категория',
                      value: _category?.name,
                      placeholder: 'Без категории',
                      icon: LucideIcons.tag,
                      onTap: _pickCategory,
                    ),
                  ],
                  const SizedBox(height: 10),
                  _PickerField(
                    label: 'Дата',
                    value: DateFormat('d MMMM yyyy', 'ru').format(_date),
                    placeholder: '',
                    icon: LucideIcons.calendar,
                    onTap: _pickDate,
                  ),
                  if (!isTransfer) ...[
                    const SizedBox(height: 10),
                    TextField(
                      controller: _payee,
                      textCapitalization: TextCapitalization.sentences,
                      decoration: const InputDecoration(
                        labelText: 'Получатель',
                        prefixIcon: Icon(LucideIcons.store, size: 18),
                      ),
                    ),
                  ],
                  const SizedBox(height: 10),
                  TextField(
                    controller: _memo,
                    textCapitalization: TextCapitalization.sentences,
                    decoration: const InputDecoration(
                      labelText: 'Заметка',
                      prefixIcon: Icon(LucideIcons.pencil, size: 18),
                    ),
                  ),
                  const SizedBox(height: 12),
                  _ClearedToggle(
                    value: _cleared,
                    onChanged: (v) => setState(() => _cleared = v),
                  ),
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: _saving ? null : _submit,
                    child: _saving
                        ? const SizedBox(
                            height: 20,
                            width: 20,
                            child: CircularProgressIndicator(
                                strokeWidth: 2, color: Colors.white),
                          )
                        : Text(saveLabel),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _confirmDelete() async {
    final t = widget.existing!;
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Удалить операцию?'),
        content: Text(
          t.isTransfer
              ? 'Обе стороны перевода будут удалены.'
              : 'Операцию можно будет восстановить только через API.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Отмена'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            style: FilledButton.styleFrom(
              backgroundColor: AppColors.negative,
              minimumSize: const Size(88, 40),
            ),
            child: const Text('Удалить'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;

    setState(() => _saving = true);
    final error = await widget.cubit.delete(t.id);
    if (!mounted) return;
    setState(() => _saving = false);
    if (error != null) {
      _toast(error, isError: true);
      return;
    }
    Navigator.of(context).pop();
    _toast('Операция удалена');
  }
}

// ── Pieces ──────────────────────────────────────────────────────────────────

class _ModeSegments extends StatelessWidget {
  const _ModeSegments({required this.mode, required this.onChanged});

  final TxMode mode;
  final ValueChanged<TxMode> onChanged;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    Widget segment(TxMode value, String label) {
      final active = value == mode;
      return Expanded(
        child: GestureDetector(
          onTap: () => onChanged(value),
          child: Container(
            height: 38,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: active ? AppColors.surface : Colors.transparent,
              borderRadius: BorderRadius.circular(AppRadii.pill),
              boxShadow: active
                  ? const [
                      BoxShadow(
                        color: Color(0x14000000),
                        blurRadius: 3,
                        offset: Offset(0, 1),
                      )
                    ]
                  : null,
            ),
            child: Text(
              label,
              style: theme.textTheme.bodySmall?.copyWith(
                fontSize: 13,
                fontWeight: active ? FontWeight.w700 : FontWeight.w500,
                color:
                    active ? AppColors.textPrimary : AppColors.textSecondary,
              ),
            ),
          ),
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: AppColors.bg,
        borderRadius: BorderRadius.circular(AppRadii.pill),
      ),
      child: Row(
        children: [
          segment(TxMode.expense, 'Расход'),
          const SizedBox(width: 4),
          segment(TxMode.income, 'Доход'),
          const SizedBox(width: 4),
          segment(TxMode.transfer, 'Перевод'),
        ],
      ),
    );
  }
}

class _PickerField extends StatelessWidget {
  const _PickerField({
    required this.label,
    required this.value,
    required this.placeholder,
    required this.icon,
    required this.onTap,
    this.locked = false,
  });

  final String label;
  final String? value;
  final String placeholder;
  final IconData icon;
  final VoidCallback onTap;
  final bool locked;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final hasValue = value != null && value!.isNotEmpty;

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
                Icon(icon, size: 16, color: AppColors.textMuted),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    hasValue ? value! : placeholder,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodyLarge?.copyWith(
                      fontSize: 15,
                      fontWeight:
                          hasValue ? FontWeight.w600 : FontWeight.w400,
                      color: hasValue
                          ? AppColors.textPrimary
                          : AppColors.textMuted,
                    ),
                  ),
                ),
                if (!locked)
                  const Icon(LucideIcons.chevronDown,
                      size: 16, color: AppColors.textMuted),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _ClearedToggle extends StatelessWidget {
  const _ClearedToggle({required this.value, required this.onChanged});

  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      decoration: BoxDecoration(
        color: AppColors.bg,
        borderRadius: BorderRadius.circular(AppRadii.inner),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Уже прошла по банку',
                  style: theme.textTheme.bodyMedium
                      ?.copyWith(fontSize: 14, fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 2),
                Text(
                  'Иначе операция будет «не сверена»',
                  style: theme.textTheme.bodySmall
                      ?.copyWith(fontSize: 11, color: AppColors.textMuted),
                ),
              ],
            ),
          ),
          Switch(value: value, onChanged: onChanged),
        ],
      ),
    );
  }
}

class _AccountPicker extends StatelessWidget {
  const _AccountPicker({
    required this.accounts,
    required this.excludeId,
    required this.title,
  });

  final List<Account> accounts;
  final String? excludeId;
  final String title;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final items = accounts.where((a) => a.id != excludeId).toList();

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.6,
      maxChildSize: 0.9,
      builder: (context, controller) => Column(
        children: [
          Container(
            margin: const EdgeInsets.only(top: 10, bottom: 6),
            height: 4,
            width: 40,
            decoration: BoxDecoration(
              color: AppColors.border,
              borderRadius: BorderRadius.circular(AppRadii.pill),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 6, 20, 6),
            child: Row(
              children: [
                Expanded(
                  child: Text(title,
                      style:
                          theme.textTheme.titleLarge?.copyWith(fontSize: 18)),
                ),
              ],
            ),
          ),
          Expanded(
            child: ListView(
              controller: controller,
              children: [
                for (final a in items)
                  ListTile(
                    title: Text(a.name),
                    subtitle: Text(accountTypeLabel(a.type)),
                    trailing: Text(
                      formatMoneySmart(a.balanceCents, currency: a.currency),
                      style: theme.textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w700,
                        fontFeatures: kTabularFigures,
                      ),
                    ),
                    onTap: () => Navigator.of(context).pop(a),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _CategoryPicker extends StatelessWidget {
  const _CategoryPicker({required this.categories});

  final List<CategoryRef> categories;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    final rows = <Widget>[];
    String? currentGroup;
    for (final c in categories) {
      if (c.groupId != currentGroup) {
        currentGroup = c.groupId;
        rows.add(Padding(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 6),
          child: Text(
            c.groupName,
            style: theme.textTheme.bodySmall?.copyWith(
              color: AppColors.textSecondary,
              fontWeight: FontWeight.w700,
            ),
          ),
        ));
      }
      rows.add(ListTile(
        title: Text(c.name),
        onTap: () => Navigator.of(context).pop(c),
      ));
    }

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.7,
      maxChildSize: 0.9,
      builder: (context, controller) => Column(
        children: [
          Container(
            margin: const EdgeInsets.only(top: 10, bottom: 6),
            height: 4,
            width: 40,
            decoration: BoxDecoration(
              color: AppColors.border,
              borderRadius: BorderRadius.circular(AppRadii.pill),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 6, 20, 0),
            child: Row(
              children: [
                Expanded(
                  child: Text('Категория',
                      style:
                          theme.textTheme.titleLarge?.copyWith(fontSize: 18)),
                ),
              ],
            ),
          ),
          Expanded(child: ListView(controller: controller, children: rows)),
        ],
      ),
    );
  }
}
