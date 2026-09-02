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

/// Возраст денег рядом с «Готово к распределению».
///
/// RTA отвечает, сколько денег без работы; возраст — насколько они твои
/// собственные, а не аванс под следующую зарплату. Без второго числа месяц с
/// нулевым RTA и месяц, прожитый на прошлый доход, выглядят одинаково.
///
/// Ноль здесь показывать нельзя, когда мерить нечего: он читается как
/// «трачу с колёс», то есть утверждение о финансах, а не о пробеле в данных.

class _FakeApi implements ApiClient {
  _FakeApi({this.ageDays = 34});

  final int? ageDays;

  @override
  Future<dynamic> get(String path, {Map<String, dynamic>? query}) async {
    if (path.contains('age-of-money')) {
      return {
        'days': ageDays,
        'sampleSize': ageDays == null ? 0 : 10,
        'asOfDate': '2026-09-02',
        'explanation': 'неважно',
      };
    }
    if (path.contains('rta-overview')) {
      return {'from': currentMonth(), 'to': currentMonth(), 'months': []};
    }
    return {
      'month': currentMonth(),
      'readyToAssignCents': 1522803,
      'readyToAssignFormatted': '15 228,03 ₸',
      'totalAssignedCents': 0,
      'totalAssignedFormatted': '',
      'totalActivityCents': 0,
      'totalActivityFormatted': '',
      'totalAvailableCents': 0,
      'totalAvailableFormatted': '',
      'overspentCents': 0,
      'overspentFormatted': '',
      'groups': <dynamic>[],
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

Future<void> _pump(WidgetTester tester, _FakeApi api) async {
  sl.registerSingleton<ApiClient>(api);
  sl.registerSingleton<DataBus>(DataBus());
  await tester.pumpWidget(
    MaterialApp(theme: buildTheme(), home: const BudgetPage()),
  );
  await tester.pumpAndSettle();
}

void main() {
  setUpAll(() => initializeDateFormatting('ru'));
  tearDown(() => sl.reset());

  testWidgets('возраст денег показан рядом с RTA', (tester) async {
    await _pump(tester, _FakeApi(ageDays: 34));

    expect(find.textContaining('34'), findsWidgets);
    expect(find.textContaining('Возраст денег'), findsOneWidget);
  });

  testWidgets('когда мерить нечего — прочерк, а не ноль', (tester) async {
    await _pump(tester, _FakeApi(ageDays: null));

    expect(find.textContaining('Возраст денег'), findsOneWidget);
    expect(find.text('0 дн.'), findsNothing);
  });
}
