import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:pfm_mobile/app/theme.dart';
import 'package:pfm_mobile/core/di/di.dart';
import 'package:pfm_mobile/core/network/api_client.dart';
import 'package:pfm_mobile/core/storage/token_storage.dart';
import 'package:pfm_mobile/features/budget/data/budget_models.dart';
import 'package:pfm_mobile/features/budget/presentation/budget_page.dart';

/// «Недофинансировано» раньше считалось на клиенте как `цель − назначено` и
/// назначалось полной суммой цели каждый месяц — для целей типа «накопить до N»
/// это финансовая ошибка. Теперь сумму считает движок, а клиент только шлёт её.

class _FakeApi implements ApiClient {
  final List<({String path, Object? body})> posts = [];

  @override
  Future<dynamic> get(String path, {Map<String, dynamic>? query}) async {
    if (path.contains('rta-overview')) {
      throw ApiException('overview недоступен', status: 500);
    }
    return _month();
  }

  @override
  Future<dynamic> post(String path, {Object? body}) async {
    posts.add((path: path, body: body));
    return _month();
  }

  @override
  Future<dynamic> patch(String path, {Object? body}) async => _month();

  @override
  Future<dynamic> delete(String path) async => _month();

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
  required int assigned,
  required int underfunded,
}) =>
    {
      'categoryId': id,
      'categoryName': name,
      'assignedCents': assigned,
      'assignedFormatted': '',
      'activityCents': 0,
      'activityFormatted': '',
      'availableCents': assigned,
      'availableFormatted': '',
      'targetAmountCents': 5000000,
      'targetType': 'monthly_funding',
      'targetDate': null,
      'underfundedCents': underfunded,
      'underfundedFormatted': '',
      'isUnderfunded': underfunded > 0,
      'isOverspent': false,
    };

Map<String, dynamic> _month() => {
      'month': '2026-08',
      'readyToAssignCents': 50000000,
      'readyToAssignFormatted': '500 000 ₸',
      'totalAssignedCents': 2000000,
      'totalAssignedFormatted': '',
      'totalActivityCents': 0,
      'totalActivityFormatted': '',
      'totalAvailableCents': 2000000,
      'totalAvailableFormatted': '',
      'overspentCents': 0,
      'overspentFormatted': '',
      'totalUnderfundedCents': 23000000,
      'totalUnderfundedFormatted': '230 000 ₸',
      'groups': [
        {
          'groupId': 'g1',
          'groupName': 'Обязательные',
          'categories': [
            // Частично назначена: не хватает 30 000 ₸ сверх имеющихся 20 000 ₸.
            _category('c-rent', 'Аренда', assigned: 2000000, underfunded: 3000000),
            // Не назначено ничего: не хватает всех 200 000 ₸.
            _category('c-food', 'Продукты', assigned: 0, underfunded: 20000000),
            // Цель закрыта — в раздачу попасть не должна.
            _category('c-net', 'Интернет', assigned: 5000000, underfunded: 0),
          ],
        },
      ],
    };

void main() {
  late _FakeApi api;

  setUpAll(() => initializeDateFormatting('ru'));
  setUp(() => api = _FakeApi());
  tearDown(() => sl.reset());

  Future<void> pump(WidgetTester tester) async {
    sl.registerSingleton<ApiClient>(api);
    await tester.pumpWidget(
      MaterialApp(theme: buildTheme(), home: const BudgetPage()),
    );
    await tester.pumpAndSettle();
  }

  test('сумма к отправке — недостающее плюс уже назначенное', () {
    // `POST /assign` ЗАДАЁТ назначение месяца, а не прибавляет к нему.
    final category = CategoryBudget.fromJson(
      _category('c', 'Тест', assigned: 2000000, underfunded: 3000000),
    );

    expect(category.assignToCloseTargetCents, 5000000);
  });

  test('totalUnderfundedCents берётся с сервера, а не суммируется на клиенте',
      () {
    final month = BudgetMonth.fromJson(_month());

    expect(month.totalUnderfundedCents, 23000000);
    expect(month.underfunded.map((c) => c.categoryId), ['c-rent', 'c-food']);
  });

  testWidgets('кнопка шлёт один bulk-assign с суммами движка', (tester) async {
    await pump(tester);

    expect(find.textContaining('Недофинансировано'), findsOneWidget);

    await tester.tap(find.textContaining('Недофинансировано'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Назначить'));
    await tester.pumpAndSettle();

    expect(api.posts, hasLength(1), reason: 'цикл из N запросов вернулся');
    expect(api.posts.single.path, '/api/v1/budget/2026-08/bulk-assign');
    expect(api.posts.single.body, {
      'assignments': [
        {'categoryId': 'c-rent', 'amountCents': 5000000},
        {'categoryId': 'c-food', 'amountCents': 20000000},
      ],
    });
  });
}
