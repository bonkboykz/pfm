import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:pfm_mobile/app/theme.dart';
import 'package:pfm_mobile/core/di/di.dart';
import 'package:pfm_mobile/core/events/data_bus.dart';
import 'package:pfm_mobile/core/network/api_client.dart';
import 'package:pfm_mobile/core/storage/token_storage.dart';
import 'package:pfm_mobile/features/transactions/presentation/transactions_page.dart';

/// Покупка в валюте на тенговой карте.
///
/// Сумма записана по прогнозному курсу и ждёт выписки. Пока это так, строка
/// обязана об этом говорить: иначе через месяц оценку не отличить от
/// подтверждённой цифры. Признак снимается только явным подтверждением —
/// любая другая правка оставляет операцию оценочной.

class _FakeApi implements ApiClient {
  final List<({String path, Object? body})> patches = [];

  @override
  Future<dynamic> get(String path, {Map<String, dynamic>? query}) async {
    if (path.contains('/accounts')) {
      return [
        {
          'id': 'acc',
          'name': 'Forte Visa Signature',
          'type': 'checking',
          'onBudget': true,
          'currency': 'KZT',
          'isActive': true,
          'balanceCents': 0,
          'balanceFormatted': '0 ₸',
        }
      ];
    }
    if (path.contains('/categories')) return <dynamic>[];
    // Список операций приходит страницей: сервер сообщает и сколько всего.
    final rows = [
      {
        'id': 'tx-colab',
        'accountId': 'acc',
        'date': '2026-08-16',
        'amountCents': -491397,
        'payeeName': 'Google Colab',
        'categoryId': null,
        'memo': null,
        'cleared': 'uncleared',
        'approved': true,
        'originalAmountCents': -1059,
        'originalCurrency': 'USD',
        'quotedRateCents': 46402,
        'isEstimated': true,
      }
    ];
    return {'transactions': rows, 'totalCount': rows.length, 'hasMore': false};
  }

  @override
  Future<dynamic> post(String path, {Object? body}) async => <dynamic>[];

  @override
  Future<dynamic> patch(String path, {Object? body}) async {
    patches.add((path: path, body: body));
    return {
      'id': 'tx-colab',
      'accountId': 'acc',
      'date': '2026-08-16',
      'amountCents': -498120,
      'cleared': 'uncleared',
      'approved': true,
      'isEstimated': false,
    };
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

Future<void> _pump(WidgetTester tester, _FakeApi api) async {
  sl.registerSingleton<ApiClient>(api);
  sl.registerSingleton<DataBus>(DataBus());
  await tester.pumpWidget(
    MaterialApp(theme: buildTheme(), home: const TransactionsPage()),
  );
  await tester.pumpAndSettle();
}

void main() {
  late _FakeApi api;

  setUpAll(() => initializeDateFormatting('ru'));
  setUp(() => api = _FakeApi());
  tearDown(() => sl.reset());

  testWidgets('строка говорит, что сумма по курсу, и показывает чек',
      (tester) async {
    await _pump(tester, api);

    expect(find.text('по курсу'), findsOneWidget);
    // В подписи — то, что стояло в чеке, и курс ввода.
    expect(find.textContaining('10,59'), findsOneWidget);
    expect(find.textContaining('464,02'), findsOneWidget);
  });

  testWidgets('подтверждение по выписке снимает признак', (tester) async {
    await _pump(tester, api);

    await tester.tap(find.text('Google Colab'));
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.byKey(const Key('confirm-actual')));
    await tester.tap(find.byKey(const Key('confirm-actual')));
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.text('Сохранить'));
    await tester.tap(find.text('Сохранить'));
    await tester.pumpAndSettle();

    expect(api.patches, hasLength(1));
    expect((api.patches.single.body! as Map)['isEstimated'], false);
  });

  testWidgets('правка без подтверждения оставляет сумму оценочной',
      (tester) async {
    await _pump(tester, api);

    await tester.tap(find.text('Google Colab'));
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.text('Сохранить'));
    await tester.tap(find.text('Сохранить'));
    await tester.pumpAndSettle();

    expect(api.patches, hasLength(1));
    // Ключ не отправлен вовсе — сервер оставит признак как был.
    expect((api.patches.single.body! as Map).containsKey('isEstimated'), isFalse);
  });
}
