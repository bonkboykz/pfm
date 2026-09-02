import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:pfm_mobile/app/theme.dart';
import 'package:pfm_mobile/core/dates/months.dart';
import 'package:pfm_mobile/core/di/di.dart';
import 'package:pfm_mobile/core/events/data_bus.dart';
import 'package:pfm_mobile/core/network/api_client.dart';
import 'package:pfm_mobile/core/storage/token_storage.dart';
import 'package:pfm_mobile/features/budget/data/budget_models.dart';
import 'package:pfm_mobile/features/budget/presentation/budget_page.dart';

/// Раздача по целям: суммы, порядок и останов на нуле RTA считает движок.
/// Клиент обязан позвать ручку, а не собирать раздачу сам, и обязан сказать
/// заранее, если денег на все цели не хватит.

class _FakeApi implements ApiClient {
  _FakeApi({this.rtaCents = 50000000, this.sourceEmpty = false});

  final int rtaCents;
  final bool sourceEmpty;
  final List<({String path, Object? body})> posts = [];

  @override
  Future<dynamic> get(String path, {Map<String, dynamic>? query}) async {
    if (path.contains('rta-overview')) {
      throw ApiException('overview недоступен', status: 500);
    }
    return _month(rtaCents);
  }

  @override
  Future<dynamic> post(String path, {Object? body}) async {
    posts.add((path: path, body: body));
    if (path.contains('copy-from')) {
      return {
        'applied': sourceEmpty
            ? const []
            : [
                {'categoryId': 'c-rent', 'fromCents': 2000000, 'toCents': 0},
              ],
        'clearedCount': sourceEmpty ? 0 : 1,
        'sourceEmpty': sourceEmpty,
        'budget': _month(rtaCents),
      };
    }
    if (path.contains('assign-targets')) {
      // Свободно меньше, чем просят цели → раздача обрывается.
      final short = rtaCents < 23000000;
      return {
        'totalAddedCents': short ? rtaCents : 23000000,
        'remainingUnderfundedCents': short ? 23000000 - rtaCents : 0,
        'stoppedAtZeroRta': short,
        'budget': _month(short ? 0 : rtaCents - 23000000, funded: true),
      };
    }
    return _month(rtaCents);
  }

  @override
  Future<dynamic> patch(String path, {Object? body}) async => _month(rtaCents);

  @override
  Future<dynamic> delete(String path) async => _month(rtaCents);

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

Map<String, dynamic> _month(int rtaCents, {bool funded = false}) => {
      'month': currentMonth(),
      'readyToAssignCents': rtaCents,
      'readyToAssignFormatted': '',
      'totalAssignedCents': 2000000,
      'totalAssignedFormatted': '',
      'totalActivityCents': 0,
      'totalActivityFormatted': '',
      'totalAvailableCents': 2000000,
      'totalAvailableFormatted': '',
      'overspentCents': 0,
      'overspentFormatted': '',
      'totalUnderfundedCents': funded ? 0 : 23000000,
      'totalUnderfundedFormatted': '',
      'groups': [
        {
          'groupId': 'g1',
          'groupName': 'Обязательные',
          'categories': [
            _category('c-rent', 'Аренда',
                assigned: 2000000, underfunded: funded ? 0 : 3000000),
            _category('c-food', 'Продукты',
                assigned: 0, underfunded: funded ? 0 : 20000000),
            _category('c-net', 'Интернет', assigned: 5000000, underfunded: 0),
          ],
        },
      ],
    };

void main() {
  setUpAll(() => initializeDateFormatting('ru'));
  tearDown(() => sl.reset());

  Future<void> pump(WidgetTester tester, _FakeApi api) async {
    sl.registerSingleton<ApiClient>(api);
  sl.registerSingleton<DataBus>(DataBus());
    await tester.pumpWidget(
      MaterialApp(theme: buildTheme(), home: const BudgetPage()),
    );
    await tester.pumpAndSettle();
  }

  test('totalUnderfundedCents берётся с сервера, а не суммируется на клиенте',
      () {
    final month = BudgetMonth.fromJson(_month(50000000));

    expect(month.totalUnderfundedCents, 23000000);
    expect(month.underfunded.map((c) => c.categoryId), ['c-rent', 'c-food']);
  });

  test('разбирает итог раздачи с остановом', () {
    final result = AssignTargetsResult.fromJson({
      'totalAddedCents': 1000000,
      'remainingUnderfundedCents': 22000000,
      'stoppedAtZeroRta': true,
      'budget': _month(0),
    });

    expect(result.totalAddedCents, 1000000);
    expect(result.remainingUnderfundedCents, 22000000);
    expect(result.stoppedAtZeroRta, true);
    expect(result.month.month, currentMonth());
  });

  testWidgets('кнопка зовёт assign-targets, а не собирает раздачу сама',
      (tester) async {
    final api = _FakeApi();
    await pump(tester, api);

    await tester.tap(find.textContaining('Недофинансировано'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Назначить'));
    await tester.pumpAndSettle();

    expect(api.posts, hasLength(1));
    expect(api.posts.single.path, '/api/v1/budget/${currentMonth()}/assign-targets');
    expect(api.posts.single.body, {'allowNegativeRta': false});
    expect(find.textContaining('Роздано'), findsOneWidget);
  });

  testWidgets('при нехватке денег предупреждает ДО раздачи', (tester) async {
    // Свободно 100 000 ₸, цели просят 230 000 ₸.
    final api = _FakeApi(rtaCents: 10000000);
    await pump(tester, api);

    await tester.tap(find.textContaining('Недофинансировано'));
    await tester.pumpAndSettle();

    expect(find.textContaining('раздача остановится'), findsOneWidget);
    expect(find.textContaining('останется недофинансировано'), findsOneWidget);
  });

  testWidgets('после частичной раздачи говорит, сколько не хватило',
      (tester) async {
    final api = _FakeApi(rtaCents: 10000000);
    await pump(tester, api);

    await tester.tap(find.textContaining('Недофинансировано'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Назначить'));
    await tester.pumpAndSettle();

    expect(find.textContaining('не хватило'), findsOneWidget);
  });

  group('Как в прошлом', () {
    testWidgets('диалог честно предупреждает об обнулении', (tester) async {
      final api = _FakeApi();
      await pump(tester, api);

      await tester.tap(find.text('Как в прошлом'));
      await tester.pumpAndSettle();

      expect(find.textContaining('обнулятся'), findsOneWidget);
      // Кнопка называет действие своим именем.
      expect(find.text('Заменить'), findsOneWidget);
    });

    testWidgets('шлёт один copy-from, а не цикл assign', (tester) async {
      final api = _FakeApi();
      await pump(tester, api);

      await tester.tap(find.text('Как в прошлом'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Заменить'));
      await tester.pumpAndSettle();

      expect(api.posts, hasLength(1));
      expect(api.posts.single.path, '/api/v1/budget/${currentMonth()}/copy-from');
      expect(api.posts.single.body,
          {'fromMonth': shiftMonth(currentMonth(), -1)});
    });

    testWidgets('пустой источник не выдаётся за успех', (tester) async {
      final api = _FakeApi(sourceEmpty: true);
      await pump(tester, api);

      await tester.tap(find.text('Как в прошлом'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Заменить'));
      await tester.pumpAndSettle();

      expect(find.textContaining('ничего не назначено'), findsOneWidget);
    });
  });
}
