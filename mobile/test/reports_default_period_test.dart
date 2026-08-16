import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:intl/intl.dart';
import 'package:pfm_mobile/app/theme.dart';
import 'package:pfm_mobile/core/di/di.dart';
import 'package:pfm_mobile/core/events/data_bus.dart';
import 'package:pfm_mobile/core/network/api_client.dart';
import 'package:pfm_mobile/core/storage/token_storage.dart';
import 'package:pfm_mobile/features/reports/presentation/reports_page.dart';

/// Период отчётов по умолчанию.
///
/// Раньше открывался год: в коде так и было написано — живые данные
/// заканчивались в марте, а на дворе был август, и трёхмесячное окно
/// показывало пустой экран. Данные с тех пор догнали календарь, и годовое
/// окно стало давать не «побольше видно», а размазанную по двенадцати
/// месяцам картину вместо ответа на вопрос «что у меня в этом месяце».

class _FakeApi implements ApiClient {
  final List<Map<String, dynamic>> queries = [];

  @override
  Future<dynamic> get(String path, {Map<String, dynamic>? query}) async {
    if (path.contains('/accounts')) return <dynamic>[];
    if (path.contains('/categories')) return <dynamic>[];
    queries.add({'path': path, ...?query});
    return <dynamic>[];
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
    MaterialApp(theme: buildTheme(), home: const ReportsPage()),
  );
  await tester.pumpAndSettle();
}

void main() {
  late _FakeApi api;

  setUpAll(() => initializeDateFormatting('ru'));
  setUp(() => api = _FakeApi());
  tearDown(() => sl.reset());

  testWidgets('по умолчанию открывается текущий месяц', (tester) async {
    await _pump(tester, api);

    expect(find.text('Этот месяц'), findsOneWidget);

    // Окно начинается первым числом текущего месяца, а не год назад.
    final now = DateTime.now();
    final firstDay = DateFormat('yyyy-MM-dd').format(DateTime(now.year, now.month, 1));
    expect(api.queries.first['since'], firstDay);
  });

  testWidgets('длинные окна никуда не делись', (tester) async {
    await _pump(tester, api);

    await tester.tap(find.text('12 мес.'));
    await tester.pumpAndSettle();

    final now = DateTime.now();
    final start = DateFormat('yyyy-MM-dd')
        .format(DateTime(now.year, now.month - 11, 1));
    expect(api.queries.last['since'], start);
  });
}
