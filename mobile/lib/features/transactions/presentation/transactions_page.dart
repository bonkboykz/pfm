import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../../app/theme.dart';
import '../../../core/dates/months.dart';
import '../../../core/di/di.dart';
import '../../../core/money/money.dart';
import '../../../core/network/api_client.dart';
import '../../accounts/data/accounts_repository.dart';
import '../cubit/transactions_cubit.dart';
import '../data/transactions_models.dart';
import '../data/transactions_repository.dart';
import 'widgets/transaction_sheet.dart';

class TransactionsPage extends StatelessWidget {
  const TransactionsPage({super.key});

  @override
  Widget build(BuildContext context) => BlocProvider(
        create: (_) => TransactionsCubit(
          TransactionsRepository(sl<ApiClient>()),
          AccountsRepository(sl<ApiClient>()),
        )..load(),
        child: const _TransactionsView(),
      );
}

class _TransactionsView extends StatelessWidget {
  const _TransactionsView();

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<TransactionsCubit, TransactionsState>(
      builder: (context, state) {
        final ready = state.status == TransactionsStatus.ready;
        return Scaffold(
          floatingActionButton: ready
              ? FloatingActionButton(
                  onPressed: () => showTransactionSheet(
                    context,
                    context.read<TransactionsCubit>(),
                    state: state,
                  ),
                  child: const Icon(LucideIcons.plus, size: 24),
                )
              : null,
          body: SafeArea(
            bottom: false,
            child: Column(
              children: [
                const _Header(),
                if (ready) _Filters(state: state),
                Expanded(child: _Body(state: state)),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _Header extends StatelessWidget {
  const _Header();

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 4),
        child: Row(
          children: [
            Expanded(
              child: Text(
                'Операции',
                style: Theme.of(context)
                    .textTheme
                    .headlineMedium
                    ?.copyWith(fontSize: 30),
              ),
            ),
          ],
        ),
      );
}

class _Filters extends StatelessWidget {
  const _Filters({required this.state});

  final TransactionsState state;

  @override
  Widget build(BuildContext context) {
    final cubit = context.read<TransactionsCubit>();
    final theme = Theme.of(context);

    Widget chip(String label, bool active, VoidCallback onTap) => Padding(
          padding: const EdgeInsets.only(right: 8),
          child: InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(AppRadii.pill),
            child: Container(
              padding:
                  const EdgeInsets.symmetric(horizontal: 13, vertical: 9),
              decoration: BoxDecoration(
                color: active ? AppColors.accent : AppColors.surface,
                borderRadius: BorderRadius.circular(AppRadii.pill),
                border: Border.all(
                    color: active ? AppColors.accent : AppColors.border),
              ),
              child: Text(
                label,
                style: theme.textTheme.bodySmall?.copyWith(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: active ? Colors.white : AppColors.textSecondary,
                ),
              ),
            ),
          ),
        );

    final filterAccount =
        state.accountFilterId == null ? null : state.accountOf(state.accountFilterId!);

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
      child: Column(
        children: [
          TextField(
            onChanged: cubit.setQuery,
            decoration: const InputDecoration(
              hintText: 'Поиск по получателю или заметке',
              prefixIcon: Icon(LucideIcons.search, size: 18),
              isDense: true,
              contentPadding:
                  EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            ),
          ),
          const SizedBox(height: 10),
          SizedBox(
            height: 36,
            child: ListView(
              scrollDirection: Axis.horizontal,
              children: [
                chip('Все', state.period == TxPeriod.all,
                    () => cubit.setPeriod(TxPeriod.all)),
                chip('Этот месяц', state.period == TxPeriod.thisMonth,
                    () => cubit.setPeriod(TxPeriod.thisMonth)),
                chip('30 дней', state.period == TxPeriod.last30,
                    () => cubit.setPeriod(TxPeriod.last30)),
                chip(
                  filterAccount?.name ?? 'Счёт',
                  filterAccount != null,
                  () => _pickAccountFilter(context, state),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _pickAccountFilter(
      BuildContext context, TransactionsState state) async {
    final cubit = context.read<TransactionsCubit>();
    final selected = await showModalBottomSheet<String>(
      context: context,
      builder: (_) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            ListTile(
              leading: const Icon(LucideIcons.layers, size: 18),
              title: const Text('Все счета'),
              onTap: () => Navigator.of(context).pop('__all__'),
            ),
            const Divider(height: 1),
            for (final a in state.accounts)
              ListTile(
                title: Text(a.name),
                trailing: Text(
                  formatMoneySmart(a.balanceCents, currency: a.currency),
                  style: const TextStyle(fontFeatures: kTabularFigures),
                ),
                onTap: () => Navigator.of(context).pop(a.id),
              ),
          ],
        ),
      ),
    );
    if (selected == null) return;
    await cubit.setAccountFilter(selected == '__all__' ? null : selected);
  }
}

class _Body extends StatelessWidget {
  const _Body({required this.state});

  final TransactionsState state;

  @override
  Widget build(BuildContext context) {
    switch (state.status) {
      case TransactionsStatus.initial:
      case TransactionsStatus.loading:
        return const Center(child: CircularProgressIndicator());
      case TransactionsStatus.error:
        return _ErrorView(state: state);
      case TransactionsStatus.ready:
        return _Content(state: state);
    }
  }
}

class _ErrorView extends StatelessWidget {
  const _ErrorView({required this.state});

  final TransactionsState state;

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
            Icon(unauthorized ? LucideIcons.keyRound : LucideIcons.cloudOff,
                size: 40, color: AppColors.textMuted),
            const SizedBox(height: 12),
            Text(
              unauthorized ? 'Нужен API-ключ' : 'Не удалось загрузить операции',
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
                    onPressed: () => context.read<TransactionsCubit>().load(),
                    child: const Text('Повторить'),
                  ),
          ],
        ),
      ),
    );
  }
}

class _Content extends StatelessWidget {
  const _Content({required this.state});

  final TransactionsState state;

  @override
  Widget build(BuildContext context) {
    final cubit = context.read<TransactionsCubit>();
    final days = state.byDay;

    return RefreshIndicator(
      onRefresh: cubit.load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 96),
        children: [
          if (days.isEmpty)
            _Empty(hasQuery: state.query.trim().isNotEmpty)
          else ...[
            for (final day in days) ...[
              _DaySection(date: day.key, transactions: day.value, state: state),
              const SizedBox(height: 16),
            ],
            if (state.hasMore)
              OutlinedButton.icon(
                onPressed: state.loadingMore ? null : cubit.loadMore,
                icon: state.loadingMore
                    ? const SizedBox(
                        height: 16,
                        width: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(LucideIcons.chevronDown, size: 16),
                label: const Text('Показать ещё'),
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size.fromHeight(46),
                  foregroundColor: AppColors.textSecondary,
                  side: const BorderSide(color: AppColors.border),
                  backgroundColor: AppColors.surface,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(AppRadii.inner),
                  ),
                ),
              ),
          ],
        ],
      ),
    );
  }
}

class _DaySection extends StatelessWidget {
  const _DaySection({
    required this.date,
    required this.transactions,
    required this.state,
  });

  final String date;
  final List<Transaction> transactions;
  final TransactionsState state;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    // Mixed-currency days get no total — adding ₸ to ¥ would be meaningless.
    final currency = state.dayCurrency(transactions);
    final total = transactions.fold<int>(0, (acc, t) => acc + t.amountCents);

    final rows = <Widget>[];
    for (var i = 0; i < transactions.length; i++) {
      if (i > 0) rows.add(const Divider(height: 1, indent: 14, endIndent: 14));
      rows.add(_TransactionRow(transaction: transactions[i], state: state));
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  formatDayLabel(date),
                  style: theme.textTheme.bodySmall?.copyWith(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textSecondary,
                  ),
                ),
              ),
              if (currency != null)
                Text(
                  formatMoneySigned(total, currency: currency),
                  style: theme.textTheme.bodySmall?.copyWith(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    fontFeatures: kTabularFigures,
                    color: total > 0
                        ? AppColors.positive
                        : AppColors.textSecondary,
                  ),
                )
              else
                Text(
                  'разные валюты',
                  style: theme.textTheme.bodySmall
                      ?.copyWith(fontSize: 11, color: AppColors.textMuted),
                ),
            ],
          ),
        ),
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

class _TransactionRow extends StatelessWidget {
  const _TransactionRow({required this.transaction, required this.state});

  final Transaction transaction;
  final TransactionsState state;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final t = transaction;
    final currency = state.currencyOf(t.accountId);
    final accountName = state.accountOf(t.accountId)?.name ?? '';

    final (icon, iconBg, iconFg) = switch (t) {
      _ when t.isTransfer => (
          LucideIcons.arrowLeftRight,
          AppColors.accentSoft,
          AppColors.accent
        ),
      _ when t.isInflow => (
          LucideIcons.arrowDownLeft,
          AppColors.positiveSoft,
          AppColors.positive
        ),
      _ => (
          LucideIcons.arrowUpRight,
          AppColors.neutralSoft,
          AppColors.textSecondary
        ),
    };

    final rawPayee = t.payeeName ?? '';
    final title = switch (rawPayee) {
      '' => 'Без получателя',
      _ when t.isTransfer && rawPayee.startsWith('Transfer: ') =>
        rawPayee.substring('Transfer: '.length),
      _ => rawPayee,
    };

    final kind = t.isTransfer
        ? 'Перевод'
        : (t.isIncome
            ? 'Доход'
            : (state.categories?.nameOf(t.categoryId) ?? 'Без категории'));

    return InkWell(
      onTap: () => showTransactionSheet(
        context,
        context.read<TransactionsCubit>(),
        state: state,
        existing: t,
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        child: Row(
          children: [
            Container(
              width: 34,
              height: 34,
              decoration: BoxDecoration(
                color: iconBg,
                borderRadius: BorderRadius.circular(AppRadii.pill),
              ),
              child: Icon(icon, size: 16, color: iconFg),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodyLarge?.copyWith(
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                      color: rawPayee.isEmpty
                          ? AppColors.textMuted
                          : AppColors.textPrimary,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    [kind, if (accountName.isNotEmpty) accountName].join(' · '),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodySmall
                        ?.copyWith(fontSize: 12, color: AppColors.textMuted),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 12),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  // Formatted from cents with the owning account's currency —
                  // the server renders amountFormatted in KZT for every row.
                  formatMoneySigned(t.amountCents, currency: currency),
                  style: theme.textTheme.bodyLarge?.copyWith(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    fontFeatures: kTabularFigures,
                    color:
                        t.isInflow ? AppColors.positive : AppColors.textPrimary,
                  ),
                ),
                if (!t.isCleared) ...[
                  const SizedBox(height: 3),
                  Text(
                    'не сверено',
                    style: theme.textTheme.bodySmall
                        ?.copyWith(fontSize: 10, color: AppColors.textMuted),
                  ),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _Empty extends StatelessWidget {
  const _Empty({required this.hasQuery});

  final bool hasQuery;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 64),
        child: Column(
          children: [
            Icon(hasQuery ? LucideIcons.searchX : LucideIcons.receipt,
                size: 36, color: AppColors.textMuted),
            const SizedBox(height: 12),
            Text(
              hasQuery ? 'Ничего не нашлось' : 'Операций за период нет',
              style: Theme.of(context)
                  .textTheme
                  .bodyMedium
                  ?.copyWith(color: AppColors.textSecondary),
            ),
          ],
        ),
      );
}
