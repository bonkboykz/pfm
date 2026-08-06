import '../money/money.dart';
import 'api_client.dart';

/// The budget engine throws bare `Error`s, so the API surfaces genuine user
/// mistakes as HTTP 500 `INTERNAL_ERROR`. Showing "server error, try again"
/// for those is wrong — translate the known ones instead.
String humanizeApiError(Object error) {
  if (error is! ApiException) return error.toString();

  final message = error.message;

  final insufficient =
      RegExp(r'Insufficient available:\s*(-?\d+)\s*<\s*(-?\d+)').firstMatch(message);
  if (insufficient != null) {
    final have = int.parse(insufficient.group(1)!);
    final want = int.parse(insufficient.group(2)!);
    return 'Недостаточно средств в категории: доступно ${formatMoney(have)}, '
        'нужно ${formatMoney(want)}';
  }

  if (message.contains('Cannot assign to system category')) {
    return 'Нельзя назначать деньги в системную категорию';
  }
  if (message.contains('Cannot move from/to system category')) {
    return 'Нельзя перемещать деньги в системную категорию или из неё';
  }
  if (message.startsWith('Category not found')) {
    return 'Категория не найдена';
  }
  if (message.contains('Amount must be non-negative')) {
    return 'Сумма не может быть отрицательной';
  }
  if (message.contains('Amount must be positive')) {
    return 'Сумма должна быть больше нуля';
  }
  if (message.contains('Debt is already settled')) {
    return 'Долг уже погашен';
  }

  if (error.isUnauthorized) {
    return 'Нужен API-ключ';
  }
  if (error.status == 500 && error.code == 'INTERNAL_ERROR') {
    return 'Сервер не смог выполнить запрос: $message';
  }

  final suggestion = error.suggestion;
  if (suggestion != null && suggestion.isNotEmpty) {
    return '$message. $suggestion';
  }
  return message;
}
