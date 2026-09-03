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
import 'package:pfm_mobile/features/reports/presentation/reports_page.dart';

/// Подсказка появляется, только когда что-то действительно потеряно.
///
/// Экраны носили постоянные объяснения: «считается по счетам в ₸», «курса в
/// API нет», «деньги тратятся почти сразу после прихода». Всё это объясняет
/// устройство системы, а не состояние денег, и занимает место каждый раз —
/// даже когда исключать нечего и валютных счетов нет вовсе.
///
/// «Курса в API нет» вдобавок не забота пользователя: он видит валюту счёта
/// в списке счетов, и почему число не сошлось — вопрос к нам, а не к нему.
///
/// Остаётся то, что сообщает о неполноте данных: если строки действительно
/// выброшены или выборка упёрлась в предел, молчать нельзя.

class _Api implements ApiClient {
  _Api({this.excludedCurrency = false, this.manyRows = false});

  final bool excludedCurrency;
  final bool manyRows;

  @override
  Future<dynamic> get(String path, {Map<String, dynamic>? query}) async {
    if (path.contains('/accounts')) {
      return [
        {
          'id': 'acc', 'name': 'Kaspi', 'type': 'checking', 'onBudget': true,
          'currency': 'KZT', 'isActive': true, 'balanceCents': 0,
          'balanceFormatted': '0 ₸',
        },
        if (excludedCurrency)
          {
            'id': 'usd', 'name': 'Наличные', 'type': 'cash', 'onBudget': false,
            'currency': 'USD', 'isActive': true, 'balanceCents': 10000,
            'balanceFormatted': r'$100',
          },
      ];
    }
    if (path.contains('age-of-money')) {
      return {'days': 1, 'sampleSize': 10, 'asOfDate': '2026-09-03'};
    }
    if (path.contains('rta-overview')) {
      return {'from': currentMonth(), 'to': currentMonth(), 'months': []};
    }
    if (path.contains('/categories')) return <dynamic>[];
    if (path.contains('/transactions')) {
      final limit = (query?['limit'] as int?) ?? 50;
      final count = manyRows ? limit : 2;
      return [
        for (var i = 0; i < count; i++)
          {
            'id': 'tx$i', 'accountId': excludedCurrency && i == 0 ? 'usd' : 'acc',
            'date': _today, 'amountCents': -1000, 'payeeName': 'Магнум',
            'categoryId': 'c', 'cleared': 'cleared', 'approved': true,
          }
      ];
    }
    return {
      'month': currentMonth(),
      'readyToAssignCents': 923511,
      'readyToAssignFormatted': '9 235,11 ₸',
      'totalAssignedCents': 0, 'totalAssignedFormatted': '',
      'totalActivityCents': 0, 'totalActivityFormatted': '',
      'totalAvailableCents': 0, 'totalAvailableFormatted': '',
      'overspentCents': 0, 'overspentFormatted': '',
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

String get _today {
  final n = DateTime.now();
  return '${n.year}-${n.month.toString().padLeft(2, '0')}-'
      '${n.day.toString().padLeft(2, '0')}';
}

Future<void> _pump(WidgetTester tester, Widget page, _Api api) async {
  sl.registerSingleton<ApiClient>(api);
  sl.registerSingleton<DataBus>(DataBus());
  await tester.pumpWidget(MaterialApp(theme: buildTheme(), home: page));
  await tester.pumpAndSettle();
}

/// Заметки живут в самом низу прокрутки, а невидимые элементы списка не
/// строятся вовсе — без докрутки проверка «ничего нет» пройдёт вхолостую.
Future<void> _scrollToEnd(WidgetTester tester) async {
  final list = find.byType(Scrollable).first;
  for (var i = 0; i < 6; i++) {
    await tester.drag(list, const Offset(0, -600));
    await tester.pumpAndSettle();
  }
}

void main() {
  setUpAll(() => initializeDateFormatting('ru'));
  tearDown(() => sl.reset());

  testWidgets('возраст денег — только число, без пояснения', (tester) async {
    await _pump(tester, const BudgetPage(), _Api());

    expect(find.textContaining('Возраст денег'), findsOneWidget);
    expect(find.textContaining('тратятся почти сразу'), findsNothing);
  });

  testWidgets('отчёты молчат, когда исключать нечего', (tester) async {
    await _pump(tester, const ReportsPage(), _Api());
    await _scrollToEnd(tester);

    expect(find.textContaining('курса в API'), findsNothing);
    expect(find.textContaining('Считается по счетам'), findsNothing);
  });

  testWidgets('но говорят, когда строки действительно выброшены',
      (tester) async {
    await _pump(tester, const ReportsPage(), _Api(excludedCurrency: true));
    await _scrollToEnd(tester);

    expect(find.textContaining('исключено'), findsOneWidget);
  });

  testWidgets('и когда выборка упёрлась в предел', (tester) async {
    await _pump(tester, const ReportsPage(), _Api(manyRows: true));
    await _scrollToEnd(tester);

    expect(find.textContaining('часть операций'), findsOneWidget);
  });
}
