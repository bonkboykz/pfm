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
import 'package:pfm_mobile/features/overview/presentation/overview_page.dart';

/// Главный экран отвечает на «что делать», а не показывает цифры.
///
/// Раньше первым, что видел человек, был бюджет — таблица категорий, по
/// которой ещё надо понять, всё ли в порядке. Сводка называет это прямо:
/// сколько свободно, где перерасход, что просят цели, что скоро списывается,
/// и что с этим делать.
///
/// Пустой список действий значит «делать нечего»: сервер советует только то,
/// на что есть деньги.

class _Api implements ApiClient {
  _Api({this.calm = false});

  final bool calm;

  @override
  Future<dynamic> get(String path, {Map<String, dynamic>? query}) async {
    if (!path.contains('overview')) return <String, dynamic>{};
    return {
      'month': currentMonth(),
      'readyToAssignCents': 923511,
      'readyToAssignFormatted': '9 235,11 ₸',
      'isOverAssigned': false,
      'overspentCents': calm ? 0 : 535392,
      'overspent': calm
          ? <dynamic>[]
          : [
              {
                'categoryId': 'food', 'categoryName': '🍽️ Кафе/рестораны',
                'amountCents': 535392, 'amountFormatted': '5 353,92 ₸',
              }
            ],
      'underfundedCents': 79900365,
      'underfunded': [
        {
          'categoryId': 'rent', 'categoryName': '🏠 Аренда',
          'amountCents': 25000000, 'amountFormatted': '250 000 ₸',
        }
      ],
      'upcoming': [
        {
          'scheduledId': 's1', 'payeeName': 'Halyk Bank',
          'nextDate': '2026-09-21', 'amountCents': -13664865,
          'amountFormatted': '136 648,65 ₸', 'autoPost': false,
        }
      ],
      'actions': calm
          ? <dynamic>[]
          : [
              {
                'tool': 'assign_budget',
                'why': '«🍽️ Кафе/рестораны» в минусе на 5 353,92 ₸.',
                'arguments': {'categoryId': 'food'},
              }
            ],
    };
  }

  @override
  Future<dynamic> post(String path, {Object? body}) async => <dynamic>[];

  @override
  Future<dynamic> patch(String path, {Object? body}) async => <dynamic>[];

  @override
  Future<dynamic> delete(String path) async => null;

  @override
  Dio get dio => throw UnimplementedError();

  @override
  TokenStorage get tokens => throw UnimplementedError();

  @override
  String get baseUrl => '';

  @override
  set baseUrl(String value) {}
}

Future<void> _pump(WidgetTester tester, {bool calm = false}) async {
  sl.registerSingleton<ApiClient>(_Api(calm: calm));
  sl.registerSingleton<DataBus>(DataBus());
  await tester.pumpWidget(
    MaterialApp(theme: buildTheme(), home: const OverviewPage()),
  );
  await tester.pumpAndSettle();
}

void main() {
  setUpAll(() => initializeDateFormatting('ru'));
  tearDown(() => sl.reset());

  testWidgets('называет свободные деньги', (tester) async {
    await _pump(tester);
    expect(find.textContaining('9 235,11'), findsWidgets);
  });

  testWidgets('показывает перерасход поимённо', (tester) async {
    await _pump(tester);
    expect(find.textContaining('Кафе/рестораны'), findsWidgets);
    expect(find.textContaining('5 353,92'), findsWidgets);
  });

  testWidgets('называет ближайшее списание с датой', (tester) async {
    await _pump(tester);
    expect(find.textContaining('Halyk Bank'), findsOneWidget);
  });

  testWidgets('показывает, что делать, и почему', (tester) async {
    await _pump(tester);
    expect(find.textContaining('в минусе на 5 353,92'), findsOneWidget);
  });

  testWidgets('в спокойном месяце говорит, что делать нечего', (tester) async {
    // Пустой список действий — это ответ, а не отсутствие ответа.
    await _pump(tester, calm: true);

    expect(find.textContaining('Сейчас ничего не требуется'), findsOneWidget);
  });
}
