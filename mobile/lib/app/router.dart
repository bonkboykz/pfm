import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons/lucide_icons.dart';

import '../core/widgets/placeholder.dart';
import '../features/accounts/presentation/account_register_page.dart';
import '../features/accounts/presentation/accounts_page.dart';
import '../features/budget/presentation/budget_page.dart';
import '../features/settings/presentation/settings_page.dart';
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
            builder: (context, state) => const FeaturePlaceholder(
              title: 'Операции',
              note: 'Волна 3: лента операций, фильтры и добавление.',
            ),
          ),
        ]),
        StatefulShellBranch(routes: [
          GoRoute(
            path: '/reports',
            builder: (context, state) => const FeaturePlaceholder(
              title: 'Отчёты',
              note: 'Волна 4: тренды, траты по категориям, приход/расход.',
            ),
          ),
        ]),
        StatefulShellBranch(routes: [
          GoRoute(
            path: '/more',
            builder: (context, state) => const FeaturePlaceholder(
              title: 'Ещё',
              note: 'Волна 5: кредиты, долги, вклады, регулярные, симулятор.',
              showSettings: true,
            ),
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
