import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons/lucide_icons.dart';

import '../features/accounts/presentation/account_register_page.dart';
import '../features/accounts/presentation/accounts_page.dart';
import '../features/budget/presentation/budget_page.dart';
import '../features/debts/presentation/debts_page.dart';
import '../features/deposits/presentation/deposit_schedule_page.dart';
import '../features/deposits/presentation/deposits_page.dart';
import '../features/loans/presentation/loan_schedule_page.dart';
import '../features/loans/presentation/loans_page.dart';
import '../features/more/presentation/more_page.dart';
import '../features/payoff/presentation/payoff_page.dart';
import '../features/reports/presentation/reports_page.dart';
import '../features/scheduled/presentation/scheduled_page.dart';
import '../features/settings/presentation/settings_page.dart';
import '../features/transactions/presentation/transactions_page.dart';
import 'branch_pager.dart';

final _rootKey = GlobalKey<NavigatorState>();

final appRouter = GoRouter(
  navigatorKey: _rootKey,
  initialLocation: '/budget',
  routes: [
    // Root-level so it covers the bottom nav; reached with context.push('/settings').
    GoRoute(
      parentNavigatorKey: _rootKey,
      path: '/settings',
      builder: (context, state) => const SettingsPage(),
    ),
    StatefulShellRoute(
      builder: (context, state, shell) => shell,
      navigatorContainerBuilder: (context, shell, children) =>
          _Shell(shell: shell, children: children),
      branches: [
        StatefulShellBranch(routes: [
          GoRoute(
            path: '/budget',
            builder: (context, state) => const BudgetPage(),
          ),
        ]),
        StatefulShellBranch(routes: [
          GoRoute(
            path: '/accounts',
            builder: (context, state) => const AccountsPage(),
            routes: [
              GoRoute(
                path: ':id',
                builder: (context, state) => AccountRegisterPage(
                  accountId: state.pathParameters['id']!,
                ),
              ),
            ],
          ),
        ]),
        StatefulShellBranch(routes: [
          GoRoute(
            path: '/transactions',
            builder: (context, state) => const TransactionsPage(),
          ),
        ]),
        StatefulShellBranch(routes: [
          GoRoute(
            path: '/reports',
            builder: (context, state) => const ReportsPage(),
          ),
        ]),
        StatefulShellBranch(routes: [
          GoRoute(
            path: '/more',
            builder: (context, state) => const MorePage(),
            routes: [
              GoRoute(
                path: 'loans',
                builder: (context, state) => const LoansPage(),
                routes: [
                  GoRoute(
                    path: ':id',
                    builder: (context, state) =>
                        LoanSchedulePage(loanId: state.pathParameters['id']!),
                  ),
                ],
              ),
              GoRoute(
                path: 'debts',
                builder: (context, state) => const DebtsPage(),
              ),
              GoRoute(
                path: 'deposits',
                builder: (context, state) => const DepositsPage(),
                routes: [
                  GoRoute(
                    path: ':id',
                    builder: (context, state) => DepositSchedulePage(
                      depositId: state.pathParameters['id']!,
                    ),
                  ),
                ],
              ),
              GoRoute(
                path: 'scheduled',
                builder: (context, state) => const ScheduledPage(),
              ),
              GoRoute(
                path: 'payoff',
                builder: (context, state) => const PayoffPage(),
              ),
            ],
          ),
        ]),
      ],
    ),
  ],
);

class _Shell extends StatelessWidget {
  const _Shell({required this.shell, required this.children});

  final StatefulNavigationShell shell;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: BranchPager(navigationShell: shell, children: children),
      bottomNavigationBar: NavigationBar(
        selectedIndex: shell.currentIndex,
        onDestinationSelected: (i) =>
            shell.goBranch(i, initialLocation: i == shell.currentIndex),
        destinations: const [
          NavigationDestination(
              icon: Icon(LucideIcons.pieChart, size: 22), label: 'Бюджет'),
          NavigationDestination(
              icon: Icon(LucideIcons.wallet, size: 22), label: 'Счета'),
          NavigationDestination(
              icon: Icon(LucideIcons.arrowLeftRight, size: 22),
              label: 'Операции'),
          NavigationDestination(
              icon: Icon(LucideIcons.barChart3, size: 22), label: 'Отчёты'),
          NavigationDestination(
              icon: Icon(LucideIcons.layoutGrid, size: 22), label: 'Ещё'),
        ],
      ),
    );
  }
}
