import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:pfm_mobile/app/theme.dart';
import 'package:pfm_mobile/core/di/di.dart';
import 'package:pfm_mobile/core/events/data_bus.dart';
import 'package:pfm_mobile/core/network/api_client.dart';
import 'package:pfm_mobile/core/storage/token_storage.dart';
import 'package:pfm_mobile/features/budget/presentation/budget_page.dart';

/// Цели категорий из приложения.
///
/// На целях держится кнопка «Недофинансировано» и раздача по целям, но
/// выставить цель можно было только через агента: клиент читал
/// targetType/targetAmountCents и не писал их никогда.

class _FakeApi implements ApiClient {
  final List<({String path, Object? body})> patches = [];

  @override
  Future<dynamic> get(String path, {Map<String, dynamic>? query}) async {
    if (path.contains('rta-overview')) {
      throw ApiException('overview недоступен', status: 500);
    }
    return _month;
  }

  @override
  Future<dynamic> post(String path, {Object? body}) async => _month;

  @override
  Future<dynamic> patch(String path, {Object? body}) async {
    patches.add((path: path, body: body));
    return const <String, dynamic>{'id': 'c-rent'};
  }

  @override
  Future<dynamic> delete(String path) async => _month;

  @override
  Dio get dio => throw UnimplementedError();

  @override
  TokenStorage get tokens => throw UnimplementedError();

  @override
  String get baseUrl => '';

  @override
  set baseUrl(String value) {}
}

Map<String, dynamic> _category(
  String id,
  String name, {
  int? targetAmountCents,
  String targetType = 'none',
  String? targetDate,
}) =>
    {
      'categoryId': id,
      'categoryName': name,
      'assignedCents': 0,
      'assignedFormatted': '',
      'activityCents': 0,
      'activityFormatted': '',
      'availableCents': 0,
      'availableFormatted': '',
      'targetAmountCents': targetAmountCents,
      'targetType': targetType,
      'targetDate': targetDate,
      'underfundedCents': 0,
      'isUnderfunded': false,
      'isOverspent': false,
    };

final _month = <String, dynamic>{
  'month': '2026-08',
  'readyToAssignCents': 0,
  'readyToAssignFormatted': '',
  'totalAssignedCents': 0,
  'totalAssignedFormatted': '',
  'totalActivityCents': 0,
  'totalActivityFormatted': '',
  'totalAvailableCents': 0,
  'totalAvailableFormatted': '',
  'overspentCents': 0,
  'overspentFormatted': '',
  'totalUnderfundedCents': 0,
  'totalUnderfundedFormatted': '',
  'groups': [
    {
      'groupId': 'g1',
      'groupName': 'Обязательные',
      'categories': [
        _category('c-rent', 'Аренда'),
        _category('c-fund', 'Ремонт',
            targetAmountCents: 5000000,
            targetType: 'target_by_date',
            targetDate: '2026-12-01'),
      ],
    },
  ],
};

Future<void> _pump(WidgetTester tester, _FakeApi api) async {
  sl.registerSingleton<ApiClient>(api);
  sl.registerSingleton<DataBus>(DataBus());
  await tester.pumpWidget(
    MaterialApp(theme: buildTheme(), home: const BudgetPage()),
  );
  await tester.pumpAndSettle();
}

/// Открывает шторку категории и переходит в редактор цели.
Future<void> _openGoal(WidgetTester tester, String category) async {
  await tester.tap(find.text(category));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(const Key('goal-row')));
  await tester.pumpAndSettle();
}

void main() {
  late _FakeApi api;

  setUpAll(() => initializeDateFormatting('ru'));
  setUp(() => api = _FakeApi());
  tearDown(() => sl.reset());

  testWidgets('категория без цели предлагает её завести', (tester) async {
    await _pump(tester, api);
    await tester.tap(find.text('Аренда'));
    await tester.pumpAndSettle();

    expect(find.text('Цель не задана'), findsOneWidget);
  });

  testWidgets('ежемесячная цель уходит в PATCH категории', (tester) async {
    await _pump(tester, api);
    await _openGoal(tester, 'Аренда');

    await tester.tap(find.text('Откладывать каждый месяц'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('goal-amount')), '250000');
    await tester.tap(find.text('Сохранить цель'));
    await tester.pumpAndSettle();

    expect(api.patches, hasLength(1));
    expect(api.patches.single.path, '/api/v1/categories/c-rent');
    expect(api.patches.single.body, {
      'targetType': 'monthly_funding',
      'targetAmountCents': 25000000,
      'targetDate': null,
    });
  });

  testWidgets('цель «собрать к дате» требует месяц', (tester) async {
    // Цель с датой без даты бессмысленна: движок делит недостающее на
    // оставшиеся месяцы, а делить не на что.
    await _pump(tester, api);
    await _openGoal(tester, 'Аренда');

    await tester.tap(find.text('Собрать к дате'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('goal-amount')), '500000');
    await tester.tap(find.text('Сохранить цель'));
    await tester.pumpAndSettle();

    expect(api.patches, isEmpty);
    expect(find.textContaining('Выберите месяц'), findsWidgets);
  });

  testWidgets('существующая цель показана и снимается', (tester) async {
    await _pump(tester, api);
    await tester.tap(find.text('Ремонт'));
    await tester.pumpAndSettle();

    // Строка цели говорит и сумму, и срок.
    expect(find.textContaining('50 000 ₸'), findsWidgets);

    await tester.tap(find.byKey(const Key('goal-row')));
    await tester.pumpAndSettle();

    // Шторка длиннее экрана: у цели с датой есть ещё выбор месяца.
    await tester.ensureVisible(find.text('Убрать цель'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Убрать цель'));
    await tester.pumpAndSettle();

    expect(api.patches.single.body, {
      'targetType': 'none',
      'targetAmountCents': null,
      'targetDate': null,
    });
  });
}
