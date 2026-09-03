import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pfm_mobile/core/network/api_client.dart';
import 'package:pfm_mobile/core/storage/token_storage.dart';
import 'package:pfm_mobile/features/payoff/cubit/payoff_cubit.dart';
import 'package:pfm_mobile/features/payoff/data/payoff_repository.dart';
import 'package:pfm_mobile/features/reports/data/reports_repository.dart';
import 'package:pfm_mobile/features/transactions/cubit/transactions_cubit.dart';
import 'package:pfm_mobile/features/transactions/data/transactions_repository.dart';
import 'package:pfm_mobile/features/accounts/data/accounts_repository.dart';

/// Провалившийся запрос не должен выглядеть как данные.
///
/// Три места делали это по-разному, но с одним итогом: пользователь видит
/// экран без единого признака сбоя и принимает решения по числам, которых
/// сервер не подтверждал.
///
/// - Симулятор писал ошибку в состояние, но статус оставлял `ready`, и экран
///   продолжал показывать прошлый сценарий.
/// - Лента теряла ошибку целиком в `catch (_)`: кнопка «загрузить ещё»
///   просто переставала работать.
/// - Справочник категорий подменялся на `null` при любой сетевой ошибке, и в
///   отчёте все категории превращались в «Категория удалена» — то есть сбой
///   связи выглядел как удаление данных.

class _FailingApi implements ApiClient {
  _FailingApi({this.failOn});

  /// Путь, на котором запрос падает. null — падает всё.
  final String? failOn;
  final List<String> gets = [];

  @override
  Future<dynamic> get(String path, {Map<String, dynamic>? query}) async {
    gets.add(path);
    if (failOn == null || path.contains(failOn!)) {
      throw ApiException('сервер недоступен', status: 500);
    }
    if (path.contains('/accounts')) return <dynamic>[];
    if (path.contains('/transactions')) return <dynamic>[];
    return <String, dynamic>{};
  }

  @override
  Future<dynamic> post(String path, {Object? body}) async {
    throw ApiException('сервер недоступен', status: 500);
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

/// Сначала отвечает, потом ломается — так ведёт себя сеть в жизни.
class _FlakyApi implements ApiClient {
  _FlakyApi({this.withTransactions = false});

  final bool withTransactions;
  bool broken = false;
  bool throwPlainError = false;

  @override
  Future<dynamic> get(String path, {Map<String, dynamic>? query}) async {
    if (throwPlainError) throw StateError('что-то пошло не так');
    if (broken) throw ApiException('сервер недоступен', status: 500);
    if (path.contains('/accounts')) return <dynamic>[];
    if (path.contains('/categories')) return <dynamic>[];
    if (path.contains('/loans')) {
      // Список, а не объект: так отдаёт API. И кредит должен быть «пригодным»
      // — с долгом и платежом, иначе сценарий не запускается вовсе.
      return [
        {
          'id': 'ln', 'name': 'Кредит', 'type': 'loan',
          'principalCents': 100000000, 'aprBps': 2850, 'termMonths': 24,
          'startDate': '2026-01-01', 'monthlyPaymentCents': 5000000,
          'paymentDay': 3, 'currentDebtCents': 100000000, 'isActive': true,
        }
      ];
    }
    if (path.contains('/transactions')) {
      // Полная страница: иначе hasMore = false и loadMore выйдет сразу,
      // так и не дойдя до запроса, который должен упасть.
      return withTransactions
          ? [
              for (var i = 0; i < 50; i++)
                {
                  'id': 'tx\$i', 'accountId': 'acc', 'date': '2026-08-10',
                  'amountCents': -1000, 'cleared': 'cleared', 'approved': true,
                }
            ]
          : <dynamic>[];
    }
    return <String, dynamic>{};
  }

  @override
  Future<dynamic> post(String path, {Object? body}) async {
    if (throwPlainError) throw StateError('что-то пошло не так');
    if (broken) throw ApiException('сервер недоступен', status: 500);
    return {'strategy': 'avalanche', 'months': <dynamic>[], 'totalInterestCents': 0};
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

/// Отдаёт ровно столько операций, сколько запросили, — как переполненная
/// выборка на сервере.
class _BigPageApi implements ApiClient {
  @override
  Future<dynamic> get(String path, {Map<String, dynamic>? query}) async {
    if (path.contains('/accounts')) {
      return [
        {'id': 'acc', 'name': 'Kaspi', 'type': 'checking', 'onBudget': true,
         'currency': 'KZT', 'isActive': true, 'balanceCents': 0,
         'balanceFormatted': '0 ₸'}
      ];
    }
    if (path.contains('/categories')) return <dynamic>[];
    if (path.contains('/transactions')) {
      final limit = (query?['limit'] as int?) ?? 50;
      return [
        for (var i = 0; i < limit; i++)
          {'id': 'tx\$i', 'accountId': 'acc', 'date': '2026-08-10',
           'amountCents': -1000, 'payeeName': 'Магнум', 'categoryId': 'c',
           'cleared': 'cleared', 'approved': true}
      ];
    }
    return <String, dynamic>{};
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

void main() {
  test('сбой сценария не выдаётся за прежний результат', () async {
    // Первая загрузка удалась, дальше пользователь двигает ползунок и запрос
    // падает. Экран рендерит ошибку только в ветке PayoffStatus.error — при
    // status = ready он продолжит показывать прошлый сценарий как настоящий.
    final api = _FlakyApi();
    final cubit = PayoffCubit(PayoffRepository(api));
    await cubit.load();
    expect(cubit.state.status, PayoffStatus.ready);

    api.broken = true;
    cubit.setExtra(5000000);
    await Future<void>.delayed(const Duration(milliseconds: 500));

    expect(cubit.state.status, PayoffStatus.error,
        reason: 'иначе экран покажет устаревший сценарий без признака сбоя');
    expect(cubit.state.error, isNotNull);
    await cubit.close();
  });

  test('ошибка догрузки ленты не теряется в generic-catch', () async {
    // `catch (_)` глотал всё, что не ApiException: кнопка «загрузить ещё»
    // просто переставала работать, и понять почему было нельзя.
    final api = _FlakyApi(withTransactions: true);
    final cubit = TransactionsCubit(
      TransactionsRepository(api),
      AccountsRepository(api),
    );
    await cubit.load();
    expect(cubit.state.transactions, isNotEmpty);

    api.throwPlainError = true;
    await cubit.loadMore();

    expect(cubit.state.error, isNotNull,
        reason: 'иначе сбой неотличим от «больше ничего нет»');
    expect(cubit.state.loadingMore, isFalse);
    await cubit.close();
  });

  test('отчёт признаётся, что мог обрезаться по лимиту', () async {
    // Одна широкая страница на 2000 строк. Ровно 2000 означает «возможно,
    // было больше»: цифры занижены, но выглядят полными. За год активного
    // использования это начнёт врать без предупреждения.
    final api = _BigPageApi();
    final repo = ReportsRepository(api);

    final data = await repo.load(1);

    expect(data.truncated, isTrue,
        reason: 'иначе занижённые суммы выглядят как полные');
  });

  test('недоступный справочник категорий — это ошибка, а не «категория удалена»',
      () async {
    final api = _FailingApi(failOn: '/categories');
    final repo = ReportsRepository(api);

    await expectLater(
      repo.load(1),
      throwsA(isA<ApiException>()),
      reason: 'сетевой сбой нельзя подавать как данные',
    );
  });
}
