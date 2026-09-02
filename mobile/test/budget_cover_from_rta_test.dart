import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:pfm_mobile/app/theme.dart';
import 'package:pfm_mobile/core/dates/months.dart';
import 'package:pfm_mobile/core/di/di.dart';
import 'package:pfm_mobile/core/events/data_bus.dart';
import 'package:pfm_mobile/core/network/api_client.dart';
import 'package:pfm_mobile/core/storage/token_storage.dart';
import 'package:pfm_mobile/features/budget/presentation/budget_page.dart';

/// Покрыть перерасход из «Готово к распределению».
///
/// Красная стрелка на минусовой строке открывает перемещение между
/// категориями, а RTA — не категория: движок отказывает системным категориям
/// в `move` и не отдаёт их в списке месяца. Пользователь видел список без
/// очевидного источника и упирался в тупик. Здесь RTA стоит в списке первым,
/// а выбор уходит в `assign`.

class _FakeApi implements ApiClient {
  _FakeApi({this.rtaCents = 25000000});

  final int rtaCents;
  final List<({String path, Object? body})> posts = [];

  @override
  Future<dynamic> get(String path, {Map<String, dynamic>? query}) async {
    if (path.contains('rta-overview')) {
      throw ApiException('overview недоступен', status: 500);
    }
    return _month(rtaCents);
  }

  @override
  Future<dynamic> post(String path, {Object? body}) async {
    posts.add((path: path, body: body));
    return _month(rtaCents);
  }

  @override
  Future<dynamic> patch(String path, {Object? body}) async => _month(rtaCents);

  @override
  Future<dynamic> delete(String path) async => _month(rtaCents);

  @override
  Dio get dio => throw UnimplementedError();

  @override
  TokenStorage get tokens => throw UnimplementedError();

  @override
  String get baseUrl => '';

  @override
  set baseUrl(String value) {}
}

Map<String, dynamic> _category(
  String id,
  String name, {
  int assigned = 0,
  int available = 0,
}) =>
    {
      'categoryId': id,
      'categoryName': name,
      'assignedCents': assigned,
      'assignedFormatted': '',
      'activityCents': 0,
      'activityFormatted': '',
      'availableCents': available,
      'availableFormatted': '',
      'targetAmountCents': null,
      'targetType': 'none',
      'underfundedCents': 0,
      'isUnderfunded': false,
      'isOverspent': available < 0,
    };

Map<String, dynamic> _month(int rtaCents) => {
      'month': currentMonth(),
      'readyToAssignCents': rtaCents,
      'readyToAssignFormatted': 'RTA',
      'totalAssignedCents': 0,
      'totalAssignedFormatted': '',
      'totalActivityCents': 0,
      'totalActivityFormatted': '',
      'totalAvailableCents': 0,
      'totalAvailableFormatted': '',
      'overspentCents': 0,
      'overspentFormatted': '',
      'totalUnderfundedCents': 0,
      'totalUnderfundedFormatted': '',
      'groups': [
        {
          'groupId': 'g1',
          'groupName': 'Обязательные',
          'categories': [
            _category('c-rent', 'Аренда', assigned: 1000000, available: 1000000),
            _category('c-food', 'Продукты', assigned: 200000, available: -500000),
          ],
        },
      ],
    };

Future<void> _pumpBudget(WidgetTester tester, _FakeApi api) async {
  sl.registerSingleton<ApiClient>(api);
  sl.registerSingleton<DataBus>(DataBus());
  await tester.pumpWidget(
    MaterialApp(theme: buildTheme(), home: const BudgetPage()),
  );
  await tester.pumpAndSettle();
}

/// Карточка RTA на самом экране бюджета подписана так же, поэтому строку
/// источника ищем именно в списке шторки.
final rtaRow = find.widgetWithText(ListTile, 'Готово к распределению');

/// Открывает «Покрыть перерасход» по «Продуктам» и доходит до списка источников.
Future<void> _openSourcePicker(WidgetTester tester) async {
  // Карточка RTA растёт вместе с тем, что на ней показывают, и строка
  // категории уезжает за нижний край окна теста. Прокрутка к ней надёжнее,
  // чем надежда, что всё поместится.
  final cover = find.byIcon(LucideIcons.arrowRightCircle);
  await tester.ensureVisible(cover);
  await tester.pumpAndSettle();
  await tester.tap(cover);
  await tester.pumpAndSettle();
  expect(find.text('Покрыть перерасход'), findsOneWidget);

  // «Куда» уже заполнено и заблокировано, так что плейсхолдер ровно один.
  await tester.tap(find.text('Выберите категорию'));
  await tester.pumpAndSettle();
  expect(find.text('Откуда взять'), findsOneWidget);
}

void main() {
  setUpAll(() => initializeDateFormatting('ru'));

  tearDown(() => sl.reset());

  testWidgets('покрытие из RTA уходит в assign, а не в move', (tester) async {
    final api = _FakeApi();
    await _pumpBudget(tester, api);
    await _openSourcePicker(tester);

    expect(rtaRow, findsOneWidget);

    await tester.tap(rtaRow);
    await tester.pumpAndSettle();

    // Сумма подставлена перерасходом — 5 000 ₸.
    await tester.tap(find.text('Переместить'));
    await tester.pumpAndSettle();

    expect(api.posts, hasLength(1));
    expect(api.posts.single.path, '/api/v1/budget/${currentMonth()}/assign');
    // assign абсолютен: было назначено 2 000 ₸, добавляем 5 000 ₸.
    expect(api.posts.single.body, {
      'categoryId': 'c-food',
      'amountCents': 700000,
    });
  });

  testWidgets('при отрицательном RTA строки нет — брать оттуда нечего',
      (tester) async {
    // Живой случай на момент правки: RTA = −13 299,08 ₸.
    final api = _FakeApi(rtaCents: -1329908);
    await _pumpBudget(tester, api);
    await _openSourcePicker(tester);

    expect(rtaRow, findsNothing);
    expect(find.text('Аренда'), findsWidgets);
  });

  testWidgets('подсказка под суммой не врёт про отказ сервера', (tester) async {
    final api = _FakeApi();
    await _pumpBudget(tester, api);
    await _openSourcePicker(tester);
    await tester.tap(rtaRow);
    await tester.pumpAndSettle();

    // Назначение сверх RTA сервер как раз примет — просто уведёт остаток в
    // минус. Обещать отказ здесь значит врать про поведение движка.
    expect(find.textContaining('сервер откажет'), findsNothing);
    expect(find.textContaining('уйдёт в минус'), findsOneWidget);
  });

  testWidgets('RTA не предлагается как получатель', (tester) async {
    final api = _FakeApi();
    await _pumpBudget(tester, api);

    await tester.tap(find.text('Распределить по категориям'));
    await tester.pumpAndSettle();

    expect(find.text('Куда распределить'), findsOneWidget);
    expect(rtaRow, findsNothing);
  });
}
