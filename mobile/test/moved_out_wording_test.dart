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

/// Отрицательное назначение — это изъятие, а не отрицательный бюджет.
///
/// «Назначено −7 292 ₸» читается как «бюджет ушёл в минус» или «система
/// сломалась». На деле смысл обратный: деньги из категории забрали и положили
/// в другую. Слово «назначено» описывает пополнение, и под ним минус
/// бессмыслен.

class _Api implements ApiClient {
  _Api({required this.assignedCents});

  final int assignedCents;

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
      'readyToAssignCents': 0,
      'readyToAssignFormatted': '0 ₸',
      'totalAssignedCents': 0, 'totalAssignedFormatted': '',
      'totalActivityCents': 0, 'totalActivityFormatted': '',
      'totalAvailableCents': 0, 'totalAvailableFormatted': '',
      'overspentCents': 0, 'overspentFormatted': '',
      'groups': [
        {
          'groupId': 'g',
          'groupName': 'Накопления',
          'categories': [
            {
              'categoryId': 'trip',
              'categoryName': '✈️ Путешествия',
              'assignedCents': assignedCents,
              'assignedFormatted': '',
              'activityCents': 0,
              'activityFormatted': '',
              'availableCents': 446331,
              'availableFormatted': '4 463,31 ₸',
              'targetAmountCents': null,
              'targetType': 'none',
              'underfundedCents': 0,
              'isUnderfunded': false,
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

Future<void> _pump(WidgetTester tester, int assigned) async {
  sl.registerSingleton<ApiClient>(_Api(assignedCents: assigned));
  sl.registerSingleton<DataBus>(DataBus());
  await tester.pumpWidget(
    MaterialApp(theme: buildTheme(), home: const BudgetPage()),
  );
  await tester.pumpAndSettle();
}

void main() {
  setUpAll(() => initializeDateFormatting('ru'));
  tearDown(() => sl.reset());

  testWidgets('изъятие называется перемещением, а не назначением',
      (tester) async {
    await _pump(tester, -729200);

    expect(find.textContaining('Назначено −7 292'), findsNothing);
    expect(find.textContaining('Назначено -7 292'), findsNothing);
    expect(find.textContaining('Перемещено'), findsOneWidget);
  });

  testWidgets('обычное пополнение по-прежнему «Назначено»', (tester) async {
    await _pump(tester, 500000);

    expect(find.textContaining('Назначено'), findsWidgets);
    expect(find.textContaining('Перемещено'), findsNothing);
  });

  testWidgets('ноль — это не изъятие', (tester) async {
    await _pump(tester, 0);

    expect(find.textContaining('Перемещено'), findsNothing);
  });
}
