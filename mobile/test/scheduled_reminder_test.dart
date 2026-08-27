import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:pfm_mobile/app/theme.dart';
import 'package:pfm_mobile/core/di/di.dart';
import 'package:pfm_mobile/core/events/data_bus.dart';
import 'package:pfm_mobile/core/network/api_client.dart';
import 'package:pfm_mobile/core/storage/token_storage.dart';
import 'package:pfm_mobile/features/scheduled/presentation/scheduled_page.dart';

/// Правило-напоминание в списке регулярных платежей.
///
/// Наступившее правило с `autoPost: false` выглядит ровно как обычное, но
/// «Провести» его не тронет. Не сказав об этом, экран пообещал бы списание,
/// которого не будет, — а счётчик «создано 0» потом читался бы как сбой.

class _FakeApi implements ApiClient {
  int processCalls = 0;

  @override
  Future<dynamic> get(String path, {Map<String, dynamic>? query}) async => {
        'scheduled': [
          _rule('auto', 'Tele2', autoPost: true),
          _rule('manual', 'Halyk Bank', autoPost: false),
        ],
      };

  Map<String, dynamic> _rule(String id, String payee,
          {required bool autoPost}) =>
      {
        'id': id,
        'accountId': 'acc',
        'accountName': 'Kaspi Gold',
        'frequency': 'monthly',
        'nextDate': '2020-01-01', // давно наступило
        'amountCents': -1549000,
        'payeeName': payee,
        'categoryId': 'c',
        'categoryName': 'Связь',
        'memo': null,
        'autoPost': autoPost,
        'isActive': true,
      };

  @override
  Future<dynamic> post(String path, {Object? body}) async {
    processCalls++;
    return {
      'created': 1,
      'transactions': [],
      'reminders': [
        {'scheduledId': 'manual', 'date': '2020-01-01'}
      ],
      'errors': [],
    };
  }

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

Future<void> _pump(WidgetTester tester) async {
  sl.registerSingleton<ApiClient>(_FakeApi());
  sl.registerSingleton<DataBus>(DataBus());
  await tester.pumpWidget(
    MaterialApp(theme: buildTheme(), home: const ScheduledPage()),
  );
  await tester.pumpAndSettle();
}

void main() {
  setUpAll(() => initializeDateFormatting('ru'));
  tearDown(() => sl.reset());

  testWidgets('правило-напоминание помечено в списке', (tester) async {
    await _pump(tester);

    expect(find.text('Напоминание'), findsOneWidget);
  });

  testWidgets('подтверждение считает только автоправила', (tester) async {
    // Наступило два правила, но операция создастся одна: обещать «по 2
    // правилам» значит соврать ещё до нажатия.
    await _pump(tester);

    await tester.tap(find.text('Провести наступившие'));
    await tester.pumpAndSettle();

    expect(find.textContaining('по 2 правилам'), findsNothing);
    expect(find.textContaining('по 1 правилу'), findsOneWidget);
  });
}
