import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../../app/theme.dart';
import '../../../core/di/di.dart';
import '../../../core/money/money.dart';
import '../../../core/events/data_bus.dart';
import '../../../core/network/api_client.dart';
import '../cubit/accounts_cubit.dart';
import '../data/accounts_models.dart';
import '../data/accounts_repository.dart';
import 'widgets/add_account_sheet.dart';

IconData accountIcon(String type) => switch (type) {
      'cash' => LucideIcons.banknote,
      'savings' => LucideIcons.piggyBank,
      'credit_card' => LucideIcons.creditCard,
      'line_of_credit' => LucideIcons.landmark,
      'tracking' => LucideIcons.lineChart,
      _ => LucideIcons.creditCard,
    };

class AccountsPage extends StatelessWidget {
  const AccountsPage({super.key});

  @override
  Widget build(BuildContext context) => BlocProvider(
        create: (_) =>
            AccountsCubit(AccountsRepository(sl<ApiClient>()),
                bus: sl<DataBus>())
              ..load(),
        child: const _AccountsView(),
      );
}

class _AccountsView extends StatelessWidget {
  const _AccountsView();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: BlocBuilder<AccountsCubit, AccountsState>(
          builder: (context, state) => Column(
            children: [
              _Header(enabled: state.status == AccountsStatus.ready),
              Expanded(child: _Body(state: state)),
            ],
          ),
        ),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.enabled});

  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final cubit = context.read<AccountsCubit>();

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 8, 16, 8),
      child: Row(
        children: [
          Expanded(
            child: Text(
              'Счета',
              style: Theme.of(context)
                  .textTheme
                  .headlineMedium
                  ?.copyWith(fontSize: 30),
            ),
          ),
          InkWell(
            onTap: enabled ? () => showAddAccountSheet(context, cubit) : null,
            borderRadius: BorderRadius.circular(AppRadii.pill),
            child: Container(
              width: 36,
              height: 36,
              decoration: BoxDecoration(
                color: enabled ? AppColors.accent : AppColors.neutral,
                borderRadius: BorderRadius.circular(AppRadii.pill),
              ),
              child: const Icon(LucideIcons.plus, size: 18, color: Colors.white),
            ),
          ),
        ],
      ),
    );
  }
}

class _Body extends StatelessWidget {
  const _Body({required this.state});

  final AccountsState state;

  @override
  Widget build(BuildContext context) {
    switch (state.status) {
      case AccountsStatus.initial:
      case AccountsStatus.loading:
        return const Center(child: CircularProgressIndicator());
      case AccountsStatus.error:
        return _ErrorView(state: state);
      case AccountsStatus.ready:
        return _Content(data: state.data!);
    }
  }
}

class _ErrorView extends StatelessWidget {
  const _ErrorView({required this.state});

  final AccountsState state;

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
              unauthorized ? 'Нужен API-ключ' : 'Не удалось загрузить счета',
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
                    onPressed: () => context.read<AccountsCubit>().load(),
                    child: const Text('Повторить'),
                  ),
          ],
        ),
      ),
    );
  }
}

class _Content extends StatelessWidget {
  const _Content({required this.data});

  final AccountsData data;

  @override
  Widget build(BuildContext context) {
    final onBudget = data.onBudget;
    final offBudget = data.offBudget;

    return RefreshIndicator(
      onRefresh: () => context.read<AccountsCubit>().load(),
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
        children: [
          _TotalCard(data: data),
          const SizedBox(height: 16),
          if (onBudget.isNotEmpty) ...[
            _Section(title: 'В бюджете', accounts: onBudget),
            const SizedBox(height: 16),
          ],
          if (offBudget.isNotEmpty)
            _Section(title: 'Вне бюджета', accounts: offBudget)
          else
            const _EmptyTrackingNote(),
        ],
      ),
    );
  }
}

class _TotalCard extends StatelessWidget {
  const _TotalCard({required this.data});

  final AccountsData data;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final totals = data.totalsByCurrency.entries.toList();

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
          Text(
            'Всего на счетах',
            style: theme.textTheme.bodyMedium?.copyWith(
              fontSize: 13,
              fontWeight: FontWeight.w500,
              color: AppColors.textSecondary,
            ),
          ),
          const SizedBox(height: 6),
          Wrap(
            spacing: 16,
            runSpacing: 4,
            crossAxisAlignment: WrapCrossAlignment.end,
            children: [
              for (var i = 0; i < totals.length; i++)
                Text(
                  formatMoneySmart(totals[i].value, currency: totals[i].key),
                  style: theme.textTheme.headlineMedium?.copyWith(
                    fontSize: i == 0 ? 32 : 20,
                    fontWeight: i == 0 ? FontWeight.w800 : FontWeight.w700,
                    fontFeatures: kTabularFigures,
                  ),
                ),
            ],
          ),
          if (data.isMultiCurrency) ...[
            const SizedBox(height: 12),
            Container(
              width: double.infinity,
              padding:
                  const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
              decoration: BoxDecoration(
                color: AppColors.neutralSoft,
                borderRadius: BorderRadius.circular(AppRadii.inner),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(LucideIcons.info,
                      size: 14, color: AppColors.textSecondary),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      // No FX rate exists anywhere in the API, so summing
                      // currencies would be inventing a number.
                      'Валюты показаны раздельно — курс не применяется',
                      style: theme.textTheme.bodySmall?.copyWith(
                        fontSize: 11,
                        color: AppColors.textSecondary,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.accounts});

  final String title;
  final List<Account> accounts;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    final rows = <Widget>[];
    for (var i = 0; i < accounts.length; i++) {
      if (i > 0) rows.add(const Divider(height: 1, indent: 14, endIndent: 14));
      rows.add(_AccountRow(account: accounts[i]));
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
                  title,
                  style: theme.textTheme.bodySmall?.copyWith(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textSecondary,
                  ),
                ),
              ),
              Text(
                _plural(accounts.length),
                style: theme.textTheme.bodySmall
                    ?.copyWith(fontSize: 12, color: AppColors.textMuted),
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

  static String _plural(int n) {
    final mod10 = n % 10;
    final mod100 = n % 100;
    if (mod10 == 1 && mod100 != 11) return '$n счёт';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
      return '$n счёта';
    }
    return '$n счетов';
  }
}

class _AccountRow extends StatelessWidget {
  const _AccountRow({required this.account});

  final Account account;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isEmpty = account.balanceCents == 0;

    final subtitle = [
      accountTypeLabel(account.type),
      if (account.currency != 'KZT') account.currency,
      if (isEmpty)
        'пусто'
      else if (account.clearedCents == 0)
        'не сверено',
    ].join(' · ');

    return InkWell(
      onTap: () => context.push('/accounts/${account.id}'),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
        child: Row(
          children: [
            Container(
              width: 38,
              height: 38,
              decoration: BoxDecoration(
                color: AppColors.accentSoft,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(accountIcon(account.type),
                  size: 18, color: AppColors.accent),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    account.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodyLarge
                        ?.copyWith(fontSize: 15, fontWeight: FontWeight.w600),
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
            Text(
              // Server strings do honour currency here, but formatting locally
              // keeps sub-unit balances from collapsing to a bare zero.
              formatMoneySmart(account.balanceCents,
                  currency: account.currency),
              style: theme.textTheme.titleMedium?.copyWith(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                fontFeatures: kTabularFigures,
                color: isEmpty ? AppColors.textMuted : AppColors.textPrimary,
              ),
            ),
            const SizedBox(width: 6),
            const Icon(LucideIcons.chevronRight,
                size: 16, color: AppColors.textMuted),
          ],
        ),
      ),
    );
  }
}

class _EmptyTrackingNote extends StatelessWidget {
  const _EmptyTrackingNote();

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(AppRadii.inner),
          border: Border.all(color: AppColors.border),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Icon(LucideIcons.eyeOff, size: 15, color: AppColors.textMuted),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                'Счетов вне бюджета нет — секция появится, когда добавите',
                style: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(fontSize: 12, color: AppColors.textMuted),
              ),
            ),
          ],
        ),
      );
}
