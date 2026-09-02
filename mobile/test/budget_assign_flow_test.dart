import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:pfm_mobile/app/theme.dart';
import 'package:pfm_mobile/core/dates/months.dart';
import 'package:pfm_mobile/core/di/di.dart';
import 'package:pfm_mobile/core/events/data_bus.dart';
import 'package:pfm_mobile/core/network/api_client.dart';
import 'package:pfm_mobile/core/storage/token_storage.dart';
import 'package:pfm_mobile/features/budget/presentation/budget_page.dart';

/// Раздать деньги из «Готово к распределению» — главный сценарий экрана,
/// и до этих тестов он был доступен только тому, кто догадается тапнуть по
/// строке категории. Тесты держат обе точки входа: карточку RTA и шеврон.

/// Записывает вызовы и отдаёт заготовленный бюджет. `rta-overview` намеренно
/// падает — репозиторий обязан пережить это и показать месяц без предупреждения
/// о будущих месяцах.
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
  int assigned = 0,
  int activity = 0,
  int available = 0,
}) =>
    {
      'categoryId': id,
      'categoryName': name,
      'assignedCents': assigned,
      'assignedFormatted': '',
      'activityCents': activity,
      'activityFormatted': '',
      'availableCents': available,
      'availableFormatted': '',
      'targetAmountCents': null,
      'targetType': 'none',
      'isUnderfunded': false,
      'isOverspent': available < 0,
    };

Map<String, dynamic> _month() => {
      'month': currentMonth(),
      'readyToAssignCents': 25000000,
      'readyToAssignFormatted': '250 000 ₸',
      'totalAssignedCents': 0,
      'totalAssignedFormatted': '',
      'totalActivityCents': 0,
      'totalActivityFormatted': '',
      'totalAvailableCents': 0,
      'totalAvailableFormatted': '',
      'overspentCents': 0,
      'overspentFormatted': '',
      'groups': [
        {
          'groupId': 'g1',
          'groupName': 'Обязательные',
          'categories': [
            _category('c-rent', 'Аренда'),
            _category('c-food', 'Продукты', available: -500000),
          ],
        },
      ],
    };

Future<void> _pumpBudget(WidgetTester tester, _FakeApi api) async {
  sl.registerSingleton<ApiClient>(api);
  sl.registerSingleton<DataBus>(DataBus());
  await tester.pumpWidget(
    MaterialApp(theme: buildTheme(), home: const BudgetPage()),
  );
  await tester.pumpAndSettle();
}

void main() {
  late _FakeApi api;

  // Шапка месяца форматируется через DateFormat('LLLL yyyy', 'ru').
  setUpAll(() => initializeDateFormatting('ru'));

  setUp(() {
    api = _FakeApi();
  });

  tearDown(() => sl.reset());

  testWidgets('карточка RTA ведёт к назначению в выбранную категорию',
      (tester) async {
    await _pumpBudget(tester, api);

    // Призыв к действию виден на самой карточке, а не спрятан в строке списка.
    expect(find.text('Распределить по категориям'), findsOneWidget);

    await tester.tap(find.text('Распределить по категориям'));
    await tester.pumpAndSettle();
    expect(find.text('Куда распределить'), findsOneWidget);

    await tester.tap(find.text('Аренда').last);
    await tester.pumpAndSettle();
    expect(find.text('Назначено за месяц'), findsOneWidget);

    await tester.enterText(find.byType(TextField), '30000');
    await tester.tap(find.text('Сохранить'));
    await tester.pumpAndSettle();

    expect(api.posts, hasLength(1));
    expect(api.posts.single.path, '/api/v1/budget/${currentMonth()}/assign');
    expect(api.posts.single.body, {
      'categoryId': 'c-rent',
      'amountCents': 3000000,
    });
  });

  testWidgets('строка категории показывает шеврон, а с перерасходом — стрелку',
      (tester) async {
    await _pumpBudget(tester, api);

    // Ближайший Row над названием — это и есть строка категории.
    Finder rowOf(String name) =>
        find.ancestor(of: find.text(name), matching: find.byType(Row)).first;

    Finder iconIn(String name, IconData icon) =>
        find.descendant(of: rowOf(name), matching: find.byIcon(icon));

    // «Аренда» в порядке — шеврон. «Продукты» в минусе — стрелка «покрыть»,
    // она и служит аффордансом, второй значок там был бы шумом.
    expect(iconIn('Аренда', LucideIcons.chevronRight), findsOneWidget);
    expect(iconIn('Продукты', LucideIcons.arrowRightCircle), findsOneWidget);
    expect(iconIn('Продукты', LucideIcons.chevronRight), findsNothing);
  });

  testWidgets('тап по строке категории по-прежнему открывает назначение',
      (tester) async {
    await _pumpBudget(tester, api);

    await tester.tap(find.text('Аренда'));
    await tester.pumpAndSettle();

    expect(find.text('Назначено за месяц'), findsOneWidget);
  });
}
