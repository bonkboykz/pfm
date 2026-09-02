import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:pfm_mobile/app/theme.dart';
import 'package:pfm_mobile/core/di/di.dart';
import 'package:pfm_mobile/core/network/api_client.dart';
import 'package:pfm_mobile/core/storage/token_storage.dart';
import 'package:pfm_mobile/features/debts/presentation/debts_page.dart';

/// «Мне должны 303 040» — это не деньги, которыми можно распорядиться.
///
/// Экран показывает крупные суммы ровно в том же виде, что и остатки по
/// счетам, но модуль личных долгов в бюджет не входит вообще: ни в RTA, ни в
/// Available, ни в баланс. Не сказав этого, экран приглашает прочитать долг
/// как доступные средства — то самое смешение, из-за которого заём ушёл по
/// пустой категории и всплыл падением RTA месяц спустя.

class _FakeApi implements ApiClient {
  @override
  Future<dynamic> get(String path, {Map<String, dynamic>? query}) async => {
        'debts': [
          {
            'id': 'd1',
            'personName': 'Алдияр Сембиев',
            'direction': 'owed',
            'amountCents': 15304000,
            'amountFormatted': '153 040 ₸',
            'currency': 'KZT',
            'dueDate': '2026-09-06',
            'note': null,
            'isSettled': false,
          }
        ],
        'summary': {
          'totalOweCents': 0,
          'totalOwedCents': 15304000,
          'netCents': 15304000,
        },
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

void main() {
  setUpAll(() => initializeDateFormatting('ru'));
  tearDown(() => sl.reset());

  testWidgets('экран предупреждает, что долги не участвуют в бюджете',
      (tester) async {
    sl.registerSingleton<ApiClient>(_FakeApi());
    await tester.pumpWidget(
      MaterialApp(theme: buildTheme(), home: const DebtsPage()),
    );
    await tester.pumpAndSettle();

    expect(find.textContaining('не участвуют в бюджете'), findsOneWidget);
  });
}
