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

/// Разделённая покупка в ленте.
///
/// Каспи списывает пять рассрочек одной строкой. У такой операции нет своей
/// категории — они у частей, — и без отдельной обработки лента показывает её
/// как «Без категории». Для покупки на 107 940 ₸, разложенной полностью, это
/// прямая неправда: выглядит так, будто деньги ушли мимо бюджета.

class _Api implements ApiClient {
  @override
  Future<dynamic> get(String path, {Map<String, dynamic>? query}) async {
    if (path.contains('/accounts')) {
      return [
        {
          'id': 'acc', 'name': 'Kaspi Gold', 'type': 'checking',
          'onBudget': true, 'currency': 'KZT', 'isActive': true,
          'balanceCents': 0, 'balanceFormatted': '0 ₸',
        }
      ];
    }
    if (path.contains('/categories')) {
      return [
        {
          'groupId': 'g',
          'groupName': 'Кредиты',
          'categories': [
            {'id': 'c-a', 'name': 'ИП ЖУБАНАЗАРОВА'},
            {'id': 'c-b', 'name': 'ИП SADO'},
          ],
        }
      ];
    }
    return {
      'transactions': [
        {
          'id': 'parent',
          'accountId': 'acc',
          'date': '2026-10-03',
          'amountCents': -10794000,
          'payeeName': 'Kaspi',
          'categoryId': null,
          'cleared': 'cleared',
          'approved': true,
          'splits': [
            {
              'id': 'p1', 'accountId': 'acc', 'date': '2026-10-03',
              'amountCents': -4590700, 'categoryId': 'c-a',
              'cleared': 'cleared', 'approved': true,
            },
            {
              'id': 'p2', 'accountId': 'acc', 'date': '2026-10-03',
              'amountCents': -6203300, 'categoryId': 'c-b',
              'cleared': 'cleared', 'approved': true,
            },
          ],
        }
      ],
      'totalCount': 1,
      'hasMore': false,
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

Future<void> _pump(WidgetTester tester) async {
  sl.registerSingleton<ApiClient>(_Api());
  sl.registerSingleton<DataBus>(DataBus());
  await tester.pumpWidget(
    MaterialApp(theme: buildTheme(), home: const TransactionsPage()),
  );
  await tester.pumpAndSettle();
}

void main() {
  setUpAll(() => initializeDateFormatting('ru'));
  tearDown(() => sl.reset());

  testWidgets('разделённая покупка не выдаётся за нераспределённую',
      (tester) async {
    await _pump(tester);

    expect(find.textContaining('Без категории'), findsNothing);
    expect(find.textContaining('2 категории'), findsOneWidget);
  });

  testWidgets('в карточке видно, куда разошлись деньги', (tester) async {
    await _pump(tester);

    await tester.tap(find.text('Kaspi'));
    await tester.pumpAndSettle();

    expect(find.textContaining('Разделено по категориям'), findsOneWidget);
    expect(find.text('ИП ЖУБАНАЗАРОВА'), findsOneWidget);
    expect(find.text('ИП SADO'), findsOneWidget);
  });

  testWidgets('категорию поверх частей задать не предлагают', (tester) async {
    // Своей категории у разделённой покупки нет, и пустой выбор приглашал бы
    // задать её поверх частей — то есть сломать разбивку.
    await _pump(tester);

    await tester.tap(find.text('Kaspi'));
    await tester.pumpAndSettle();

    expect(find.text('Без категории'), findsNothing);
  });

  testWidgets('покупка остаётся одной строкой, как в выписке', (tester) async {
    await _pump(tester);

    // Одна строка — одна покупка. Сумма встречается и в итоге периода
    // сверху, поэтому считаем по плательщику.
    expect(find.text('Kaspi'), findsOneWidget);
    expect(find.textContaining('107 940'), findsWidgets);
  });
}
