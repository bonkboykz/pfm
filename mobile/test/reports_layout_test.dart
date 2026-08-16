import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:pfm_mobile/app/theme.dart';
import 'package:pfm_mobile/core/di/di.dart';
import 'package:pfm_mobile/core/events/data_bus.dart';
import 'package:pfm_mobile/core/network/api_client.dart';
import 'package:pfm_mobile/core/storage/token_storage.dart';
import 'package:pfm_mobile/features/reports/presentation/reports_page.dart';

/// Раскладка отчётов за один месяц.
///
/// «По месяцам» с единственным столбиком — не график, а недоразумение:
/// сравнивать не с чем, а место занимает. За один месяц он не показывается,
/// и освободившееся место отдано категориям: пирог крупнее, под ним список,
/// а не пять строк сбоку.

class _FakeApi implements ApiClient {
  @override
  Future<dynamic> get(String path, {Map<String, dynamic>? query}) async {
    if (path.contains('/accounts')) {
      return [
        {
          'id': 'acc',
          'name': 'Kaspi Gold',
          'type': 'checking',
          'onBudget': true,
          'currency': 'KZT',
          'isActive': true,
          'balanceCents': 0,
          'balanceFormatted': '0 ₸',
        }
      ];
    }
    if (path.contains('/categories')) {
      return [
        {
          'groupId': 'g',
          'groupName': 'Расходы',
          'categories': [
            for (var i = 1; i <= 9; i++)
              {'id': 'c$i', 'name': 'Категория $i'},
          ],
        }
      ];
    }
    // Девять категорий с убывающими суммами.
    return [
      for (var i = 1; i <= 9; i++)
        {
          'id': 'tx$i',
          'accountId': 'acc',
          'date': _today,
          'amountCents': -100000 * (10 - i),
          'payeeName': 'Плательщик $i',
          'categoryId': 'c$i',
          'cleared': 'cleared',
          'approved': true,
        }
    ];
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

Future<void> _pump(WidgetTester tester) async {
  sl.registerSingleton<ApiClient>(_FakeApi());
  sl.registerSingleton<DataBus>(DataBus());
  await tester.pumpWidget(
    MaterialApp(theme: buildTheme(), home: const ReportsPage()),
  );
  await tester.pumpAndSettle();
}

void main() {
  setUpAll(() => initializeDateFormatting('ru'));
  tearDown(() => sl.reset());

  testWidgets('за один месяц график по месяцам не показывается',
      (tester) async {
    await _pump(tester);

    expect(find.text('По месяцам'), findsNothing);
  });

  testWidgets('на длинном окне график возвращается', (tester) async {
    await _pump(tester);

    await tester.tap(find.text('3 мес.'));
    await tester.pumpAndSettle();

    expect(find.text('По месяцам'), findsOneWidget);
  });

  testWidgets('категорий показано больше пяти', (tester) async {
    await _pump(tester);

    // Раньше помещалось четыре плюс «Прочее»; девять должны быть видны все.
    for (var i = 1; i <= 9; i++) {
      expect(find.text('Категория $i'), findsOneWidget,
          reason: 'категория $i должна быть в списке');
    }
    expect(find.text('Прочее'), findsNothing);
  });
}
