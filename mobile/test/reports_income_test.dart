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

/// «Откуда приходят деньги».
///
/// Расход разбит по категориям, а доход до сих пор был одним числом в шапке.
/// По категориям его разбивать бессмысленно: почти весь приход падает в одну
/// системную «Ready to Assign», и пирог вышел бы из одного сектора. Значимая
/// ось у дохода — от кого он пришёл.

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
            {'id': 'c-food', 'name': 'Продукты'},
          ],
        }
      ];
    }
    // Список операций приходит страницей: сервер сообщает и сколько всего.
    final rows = [
      _tx('in-1', 5547900, 'Rama', 'ready-to-assign'),
      _tx('in-2', 3000000, 'Халтурка', 'ready-to-assign'),
      _tx('in-3', 1000000, 'Назым', 'ready-to-assign'),
      _tx('out-1', -314900, 'Магнум', 'c-food'),
    ];
    return {'transactions': rows, 'totalCount': rows.length, 'hasMore': false};
  }

  Map<String, dynamic> _tx(String id, int cents, String payee, String cat) => {
        'id': id,
        'accountId': 'acc',
        'date': _today,
        'amountCents': cents,
        'payeeName': payee,
        'categoryId': cat,
        'cleared': 'cleared',
        'approved': true,
      };

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

  testWidgets('приход разбит по источникам', (tester) async {
    await _pump(tester);

    final card = find.text('Откуда приходят деньги');
    await tester.ensureVisible(card);
    await tester.pumpAndSettle();
    expect(card, findsOneWidget);

    for (final name in ['Rama', 'Халтурка', 'Назым']) {
      expect(find.text(name), findsWidgets, reason: '$name должен быть виден');
    }
  });

  testWidgets('плательщик расхода не попадает в источники дохода',
      (tester) async {
    // «Магнум» — расход. Смешать две стороны значило бы показать, что деньги
    // одновременно пришли и ушли.
    await _pump(tester);

    final card = find.text('Откуда приходят деньги');
    await tester.ensureVisible(card);
    await tester.pumpAndSettle();

    final incomeCard = find.ancestor(of: card, matching: find.byType(Column)).first;
    expect(
      find.descendant(of: incomeCard, matching: find.text('Магнум')),
      findsNothing,
    );
  });
}
