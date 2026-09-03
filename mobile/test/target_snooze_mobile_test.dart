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
import 'package:pfm_mobile/features/budget/presentation/budget_page.dart';

/// Отложить цель на месяц прямо из шторки категории.
///
/// В трудный месяц выбор был жёсткий: либо цель просит денег, которых нет,
/// либо снять её совсем — и не вспомнить. Отложка это третий, честный
/// вариант, и она бесполезна, если до неё надо идти в бота.

class _Api implements ApiClient {
  _Api({this.withTarget = true});

  final bool withTarget;
  final List<({String path, Object? body})> patches = [];
  String? snoozedMonth;

  @override
  Future<dynamic> get(String path, {Map<String, dynamic>? query}) async {
    if (path.contains('/accounts')) return <dynamic>[];
    if (path.contains('age-of-money')) {
      return {'days': 1, 'sampleSize': 10, 'asOfDate': '2026-09-03'};
    }
    if (path.contains('rta-overview')) {
      return {'from': currentMonth(), 'to': currentMonth(), 'months': []};
    }
    return {
      'month': currentMonth(),
      'readyToAssignCents': 0, 'readyToAssignFormatted': '0 ₸',
      'totalAssignedCents': 0, 'totalAssignedFormatted': '',
      'totalActivityCents': 0, 'totalActivityFormatted': '',
      'totalAvailableCents': 0, 'totalAvailableFormatted': '',
      'overspentCents': 0, 'overspentFormatted': '',
      'groups': [
        {
          'groupId': 'g',
          'groupName': 'Постоянные',
          'categories': [
            {
              'categoryId': 'rent',
              'categoryName': '🏠 Аренда',
              'assignedCents': 0, 'assignedFormatted': '',
              'activityCents': 0, 'activityFormatted': '',
              'availableCents': 0, 'availableFormatted': '0 ₸',
              'targetAmountCents': withTarget ? 25000000 : null,
              'targetType': withTarget ? 'monthly_funding' : 'none',
              'targetSnoozedMonth': snoozedMonth,
              'underfundedCents':
                  withTarget && snoozedMonth == null ? 25000000 : 0,
              'isUnderfunded': withTarget && snoozedMonth == null,
              'isOverspent': false,
            }
          ],
        }
      ],
    };
  }

  @override
  Future<dynamic> post(String path, {Object? body}) async => <dynamic>[];

  @override
  Future<dynamic> patch(String path, {Object? body}) async {
    patches.add((path: path, body: body));
    final map = body as Map?;
    if (map != null && map.containsKey('targetSnoozedMonth')) {
      snoozedMonth = map['targetSnoozedMonth'] as String?;
    }
    return <String, dynamic>{};
  }

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

Future<void> _openSheet(WidgetTester tester, _Api api) async {
  sl.registerSingleton<ApiClient>(api);
  sl.registerSingleton<DataBus>(DataBus());
  await tester.pumpWidget(
    MaterialApp(theme: buildTheme(), home: const BudgetPage()),
  );
  await tester.pumpAndSettle();

  final row = find.text('🏠 Аренда');
  await tester.ensureVisible(row);
  await tester.pumpAndSettle();
  await tester.tap(row);
  await tester.pumpAndSettle();
}

void main() {
  setUpAll(() => initializeDateFormatting('ru'));
  tearDown(() => sl.reset());

  testWidgets('цель откладывается одним действием из шторки', (tester) async {
    final api = _Api();
    await _openSheet(tester, api);

    final snooze = find.textContaining('Отложить');
    expect(snooze, findsOneWidget);

    await tester.tap(snooze);
    await tester.pumpAndSettle();

    final patch = api.patches.last;
    expect(patch.path, contains('/categories/rent'));
    expect((patch.body as Map)['targetSnoozedMonth'], currentMonth());
  });

  testWidgets('отложенная цель предлагает вернуть её', (tester) async {
    final api = _Api()..snoozedMonth = currentMonth();
    await _openSheet(tester, api);

    final wake = find.textContaining('Вернуть цель');
    expect(wake, findsOneWidget);

    await tester.tap(wake);
    await tester.pumpAndSettle();

    expect((api.patches.last.body as Map)['targetSnoozedMonth'], isNull);
  });

  testWidgets('у категории без цели откладывать нечего', (tester) async {
    // Предложить отложить несуществующую цель — обещать действие, которое
    // ничего не изменит.
    await _openSheet(tester, _Api(withTarget: false));

    expect(find.textContaining('Отложить'), findsNothing);
    expect(find.textContaining('Вернуть цель'), findsNothing);
  });
}
