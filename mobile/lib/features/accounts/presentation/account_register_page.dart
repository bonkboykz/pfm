import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons/lucide_icons.dart';

import '../../../app/theme.dart';
import '../../../core/dates/months.dart';
import '../../../core/di/di.dart';
import '../../../core/money/money.dart';
import '../../../core/network/api_client.dart';
import '../../transactions/data/transactions_models.dart';
import '../../transactions/data/transactions_repository.dart';
import '../cubit/account_register_cubit.dart';
import '../data/accounts_models.dart';
import '../data/accounts_repository.dart';
import 'accounts_page.dart' show accountIcon;

class AccountRegisterPage extends StatelessWidget {
  const AccountRegisterPage({super.key, required this.accountId});

  final String accountId;

  @override
  Widget build(BuildContext context) => BlocProvider(
        create: (_) => AccountRegisterCubit(
          AccountsRepository(sl<ApiClient>()),
          TransactionsRepository(sl<ApiClient>()),
          accountId,
        )..load(),
        child: const _RegisterView(),
      );
}

class _RegisterView extends StatelessWidget {
  const _RegisterView();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: BlocBuilder<AccountRegisterCubit, AccountRegisterState>(
          builder: (context, state) => Column(
            children: [
              _AppBar(title: state.account?.name ?? 'Счёт'),
              Expanded(child: _Body(state: state)),
            ],
          ),
        ),
      ),
    );
  }
}

class _AppBar extends StatelessWidget {
  const _AppBar({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(8, 4, 16, 8),
        child: Row(
          children: [
            IconButton(
              icon: const Icon(LucideIcons.chevronLeft, size: 24),
              onPressed: () => context.pop(),
            ),
            Expanded(
              child: Text(
                title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context)
                    .textTheme
                    .headlineSmall
                    ?.copyWith(fontSize: 22, fontWeight: FontWeight.w800),
              ),
            ),
          ],
        ),
      );
}

class _Body extends StatelessWidget {
  const _Body({required this.state});

  final AccountRegisterState state;

  @override
  Widget build(BuildContext context) {
    switch (state.status) {
      case RegisterStatus.initial:
      case RegisterStatus.loading:
        return const Center(child: CircularProgressIndicator());
      case RegisterStatus.error:
        return _ErrorView(state: state);
      case RegisterStatus.ready:
        return _Content(state: state);
    }
  }
}

class _ErrorView extends StatelessWidget {
  const _ErrorView({required this.state});

  final AccountRegisterState state;

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
              unauthorized ? 'Нужен API-ключ' : 'Не удалось загрузить счёт',
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
                    onPressed: () =>
                        context.read<AccountRegisterCubit>().load(),
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

  final AccountRegisterState state;

  @override
  Widget build(BuildContext context) {
    final account = state.account!;
    final days = state.byDay;

    return RefreshIndicator(
      onRefresh: () => context.read<AccountRegisterCubit>().load(),
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
        children: [
          _BalanceCard(account: account),
          const SizedBox(height: 16),
          if (days.isEmpty)
            const _EmptyRegister()
          else
            for (final day in days) ...[
              _DaySection(
                date: day.key,
                transactions: day.value,
                account: account,
                categories: state.categories,
              ),
              const SizedBox(height: 16),
            ],
        ],
      ),
    );
  }
}

class _BalanceCard extends StatelessWidget {
  const _BalanceCard({required this.account});

  final Account account;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    Widget cell(String label, int cents, Color color) => Expanded(
          child: Column(
            children: [
              Text(
                label,
                style: theme.textTheme.bodySmall
                    ?.copyWith(fontSize: 11, color: AppColors.textMuted),
              ),
              const SizedBox(height: 3),
              Text(
                formatMoneySmart(cents, currency: account.currency),
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

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppColors.surface,
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
                      'Баланс счёта',
                      style: theme.textTheme.bodyMedium?.copyWith(
                        fontSize: 13,
                        fontWeight: FontWeight.w500,
                        color: AppColors.textSecondary,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      formatMoneySmart(account.balanceCents,
                          currency: account.currency),
                      style: theme.textTheme.headlineMedium?.copyWith(
                        fontSize: 34,
                        fontWeight: FontWeight.w800,
                        fontFeatures: kTabularFigures,
                        color: account.balanceCents < 0
                            ? AppColors.negative
                            : AppColors.textPrimary,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 10),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
                decoration: BoxDecoration(
                  color: AppColors.accentSoft,
                  borderRadius: BorderRadius.circular(AppRadii.pill),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(accountIcon(account.type),
                        size: 14, color: AppColors.accent),
                    const SizedBox(width: 6),
                    Text(
                      '${account.currency} · ${accountTypeLabel(account.type).toLowerCase()}',
                      style: theme.textTheme.bodySmall?.copyWith(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: AppColors.accent,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              cell('Сверено', account.clearedCents, AppColors.textMuted),
              const SizedBox(
                height: 30,
                child: VerticalDivider(
                    width: 1, thickness: 1, color: AppColors.border),
              ),
              cell(
                'Не сверено',
                account.unclearedCents,
                account.hasUncleared ? AppColors.warning : AppColors.textMuted,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _DaySection extends StatelessWidget {
  const _DaySection({
    required this.date,
    required this.transactions,
    required this.account,
    required this.categories,
  });

  final String date;
  final List<Transaction> transactions;
  final Account account;
  final CategoryCatalog? categories;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final total = transactions.fold<int>(0, (acc, t) => acc + t.amountCents);

    final rows = <Widget>[];
    for (var i = 0; i < transactions.length; i++) {
      if (i > 0) rows.add(const Divider(height: 1, indent: 14, endIndent: 14));
      rows.add(_TransactionRow(
        transaction: transactions[i],
        account: account,
        categories: categories,
      ));
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
              Text(
                formatMoneySigned(total, currency: account.currency),
                style: theme.textTheme.bodySmall?.copyWith(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  fontFeatures: kTabularFigures,
                  color: total > 0
                      ? AppColors.positive
                      : AppColors.textSecondary,
                ),
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
  const _TransactionRow({
    required this.transaction,
    required this.account,
    required this.categories,
  });

  final Transaction transaction;
  final Account account;
  final CategoryCatalog? categories;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final t = transaction;

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

    // The server stores transfer payees as "Transfer: <other account>"; show
    // just the counterpart, since the row already reads "Перевод" below.
    final rawPayee = t.payeeName ?? '';
    final title = switch (rawPayee) {
      '' => 'Без получателя',
      _ when t.isTransfer && rawPayee.startsWith('Transfer: ') =>
        rawPayee.substring('Transfer: '.length),
      _ => rawPayee,
    };

    final subtitle = t.isTransfer
        ? 'Перевод'
        : (t.isIncome
            ? 'Доход'
            : (categories?.nameOf(t.categoryId) ??
                (t.categoryId == null ? 'Без категории' : '—')));

    return Padding(
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
                  [
                    subtitle,
                    // Memos often just repeat the category ("✈️ Путешествия"
                    // + "Путешествия") — only add one that says something new.
                    if ((t.memo?.isNotEmpty ?? false) &&
                        !subtitle.contains(t.memo!))
                      t.memo!,
                  ].join(' · '),
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
                // NOT t.amountFormatted: the server renders every transaction
                // in KZT, so a CNY account would show "-500 ₸" for -¥500.
                formatMoneySigned(t.amountCents,
                    currency: account.currency),
                style: theme.textTheme.bodyLarge?.copyWith(
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                  fontFeatures: kTabularFigures,
                  color: t.isInflow
                      ? AppColors.positive
                      : AppColors.textPrimary,
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
    );
  }
}

class _EmptyRegister extends StatelessWidget {
  const _EmptyRegister();

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 48),
        child: Column(
          children: [
            const Icon(LucideIcons.receipt, size: 36, color: AppColors.textMuted),
            const SizedBox(height: 12),
            Text(
              'Операций по счёту нет',
              style: Theme.of(context)
                  .textTheme
                  .bodyMedium
                  ?.copyWith(color: AppColors.textSecondary),
            ),
          ],
        ),
      );
}
