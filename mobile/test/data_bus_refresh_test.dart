import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pfm_mobile/core/events/data_bus.dart';
import 'package:pfm_mobile/core/network/api_client.dart';
import 'package:pfm_mobile/core/storage/token_storage.dart';
import 'package:pfm_mobile/features/accounts/cubit/accounts_cubit.dart';
import 'package:pfm_mobile/features/accounts/data/accounts_repository.dart';
import 'package:pfm_mobile/features/budget/cubit/budget_cubit.dart';
import 'package:pfm_mobile/features/budget/data/budget_repository.dart';
import 'package:pfm_mobile/features/reports/cubit/reports_cubit.dart';
import 'package:pfm_mobile/features/reports/data/reports_repository.dart';
import 'package:pfm_mobile/features/transactions/cubit/transactions_cubit.dart';
import 'package:pfm_mobile/features/transactions/data/transactions_repository.dart';

/// Вкладки живут в ветках StatefulShellRoute и между переключениями не
/// пересоздаются: cubit создаётся один раз и о чужой записи сам не узнаёт.
/// Добавил расход на «Операциях» — «Бюджет» и «Счета» показывали старые числа,
/// пока не потянешь refresh. Шина изменений закрывает именно это.

class _FakeApi implements ApiClient {
  final List<String> gets = [];
  final List<String> posts = [];

  @override
  Future<dynamic> get(String path, {Map<String, dynamic>? query}) async {
    gets.add(path);
    if (path.contains('/accounts')) return <dynamic>[];
    if (path.contains('rta-overview')) {
      throw ApiException('overview недоступен', status: 500);
    }
    if (path.contains('/categories')) return <dynamic>[];
    if (path.contains('/transactions')) {
      return {'transactions': <dynamic>[], 'totalCount': 0, 'hasMore': false};
    }
    return _month;
  }

  @override
  Future<dynamic> post(String path, {Object? body}) async {
    posts.add(path);
    return _month;
  }

  @override
  Future<dynamic> patch(String path, {Object? body}) async => _month;

  @override
  Future<dynamic> delete(String path) async => _month;

  @override
  Dio get dio => throw UnimplementedError();

  @override
  TokenStorage get tokens => throw UnimplementedError();

  @override
  String get baseUrl => '';

  @override
  set baseUrl(String value) {}
}

const _month = <String, dynamic>{
  'month': '2026-08',
  'readyToAssignCents': 0,
  'readyToAssignFormatted': '',
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
  'groups': <dynamic>[],
};

void main() {
  late _FakeApi api;
  late DataBus bus;

  setUp(() {
    api = _FakeApi();
    bus = DataBus();
  });

  tearDown(() => bus.dispose());

  int budgetLoads() => api.gets.where((p) => p.contains('/budget/2026')).length;
  int accountLoads() => api.gets.where((p) => p == '/api/v1/accounts').length;

  test('бюджет перезагружается, когда изменились операции', () async {
    final cubit = BudgetCubit(BudgetRepository(api), bus: bus);
    await cubit.load();
    final before = budgetLoads();

    bus.emit(DataChange.transactions);
    await Future<void>.delayed(Duration.zero);

    expect(budgetLoads(), greaterThan(before));
    await cubit.close();
  });

  test('счета перезагружаются, когда изменились операции', () async {
    final cubit = AccountsCubit(AccountsRepository(api), bus: bus);
    await cubit.load();
    final before = accountLoads();

    bus.emit(DataChange.transactions);
    await Future<void>.delayed(Duration.zero);

    expect(accountLoads(), greaterThan(before));
    await cubit.close();
  });

  test('бюджет не перезагружается от собственного события', () async {
    // Иначе назначение денег запускает петлю: мутация → событие → load →
    // мутация. Свой результат уже пришёл в ответе.
    final cubit = BudgetCubit(BudgetRepository(api), bus: bus);
    await cubit.load();
    final before = budgetLoads();

    bus.emit(DataChange.budget);
    await Future<void>.delayed(Duration.zero);

    expect(budgetLoads(), before);
    await cubit.close();
  });

  test('смена подключения оживляет экран, застрявший на «нужен ключ»',
      () async {
    // Пользователь вписал ключ в настройках и получил «Подключение работает».
    // Если бюджет об этом не узнает, он продолжит просить ключ, и человек
    // решит, что ключ не подошёл — хотя подошёл.
    final cubit = BudgetCubit(BudgetRepository(api), bus: bus);
    await cubit.load();
    final before = budgetLoads();

    bus.emit(DataChange.connection);
    await Future<void>.delayed(Duration.zero);

    expect(budgetLoads(), greaterThan(before));
    await cubit.close();
  });

  test('смена подключения перезагружает и счета', () async {
    final cubit = AccountsCubit(AccountsRepository(api), bus: bus);
    await cubit.load();
    final before = accountLoads();

    bus.emit(DataChange.connection);
    await Future<void>.delayed(Duration.zero);

    expect(accountLoads(), greaterThan(before));
    await cubit.close();
  });

  test('смена подключения оживляет и операции', () async {
    // Экран операций тоже умеет показывать «нужен ключ», а на шину подписан
    // не был вовсе: застревал до перезапуска глубже остальных.
    final cubit = TransactionsCubit(
      TransactionsRepository(api),
      AccountsRepository(api),
      bus: bus,
    );
    await cubit.load();
    final before = api.gets.where((p) => p.contains('/transactions')).length;

    bus.emit(DataChange.connection);
    await Future<void>.delayed(Duration.zero);

    expect(api.gets.where((p) => p.contains('/transactions')).length,
        greaterThan(before));
    await cubit.close();
  });

  test('событие после закрытия экрана ничего не делает', () async {
    // Cubit закрыт, а подписка жива — emit после close роняет bloc.
    final cubit = BudgetCubit(BudgetRepository(api), bus: bus);
    await cubit.load();
    await cubit.close();
    final before = budgetLoads();

    bus.emit(DataChange.transactions);
    await Future<void>.delayed(Duration.zero);

    expect(budgetLoads(), before);
  });

  test('отчёты перезагружаются, когда изменились операции', () async {
    // Отчёт — агрегат операций, и устаревает он ровно так же.
    final cubit = ReportsCubit(ReportsRepository(api), bus: bus);
    await cubit.load();
    final before = api.gets.where((p) => p.contains('/transactions')).length;

    bus.emit(DataChange.transactions);
    await Future<void>.delayed(Duration.zero);

    expect(api.gets.where((p) => p.contains('/transactions')).length,
        greaterThan(before));
    await cubit.close();
  });

  test('создание операции объявляет об изменении', () async {
    final seen = <DataChange>[];
    bus.stream.listen(seen.add);

    final cubit = TransactionsCubit(
      TransactionsRepository(api),
      AccountsRepository(api),
      bus: bus,
    );
    await cubit.create(
      accountId: 'acc',
      date: '2026-08-14',
      amountCents: -100000,
      cleared: true,
    );
    await Future<void>.delayed(Duration.zero);

    expect(seen, contains(DataChange.transactions));
    await cubit.close();
  });
}
