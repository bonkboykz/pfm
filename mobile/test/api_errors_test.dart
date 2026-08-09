import 'package:flutter_test/flutter_test.dart';
import 'package:pfm_mobile/core/network/api_client.dart';
import 'package:pfm_mobile/core/network/api_errors.dart';

/// The budget engine throws bare `Error`s, so genuine user mistakes reach the
/// client as HTTP 500 INTERNAL_ERROR. Showing "server error, try again" for
/// those would be wrong, so each known message is translated instead.
void main() {
  ApiException engineError(String message) => ApiException(
        message,
        code: 'INTERNAL_ERROR',
        suggestion: 'Check server logs',
        status: 500,
      );

  group('сервер недоступен', () {
    // Во время выката Railway гасит старый контейнер раньше, чем поднимает
    // новый, и Dio отдаёт свой многоабзацный текст про 502 со ссылкой на MDN.
    // Он попадал на экран как есть.
    const dioProse =
        'This exception was thrown because the response has a status code of '
        '502 and RequestOptions.validateStatus was configured to throw for '
        'this status code. The status code of 502 has the following meaning: '
        '"Server error - the server failed to fulfil an apparently valid '
        'request". Read more about status codes at '
        'https://developer.mozilla.org/en-US/docs/Web/HTTP/Status';

    test('502 объясняется по-человечески, без текста Dio', () {
      final message = humanizeApiError(ApiException(dioProse, status: 502));

      expect(message, 'Сервер перезапускается. Попробуйте через минуту.');
      expect(message, isNot(contains('mozilla')));
      expect(message, isNot(contains('RequestOptions')));
    });

    test('503 и 504 объясняются так же', () {
      for (final status in [503, 504]) {
        expect(
          humanizeApiError(ApiException(dioProse, status: status)),
          'Сервер перезапускается. Попробуйте через минуту.',
        );
      }
    });

    test('без ответа вообще — это связь, а не сервер', () {
      expect(
        humanizeApiError(ApiException('Connection refused')),
        'Нет связи с сервером. Проверьте интернет.',
      );
    });

    test('прочие 5xx не выдают английский текст наружу', () {
      final message = humanizeApiError(ApiException(dioProse, status: 599));

      expect(message, 'Сервер не смог выполнить запрос.');
    });
  });

  test('renders insufficient-available with formatted amounts', () {
    expect(
      humanizeApiError(engineError('Insufficient available: 1240000 < 5000000')),
      'Недостаточно средств в категории: доступно 12 400 ₸, нужно 50 000 ₸',
    );
  });

  test('translates the other engine guards', () {
    expect(
      humanizeApiError(engineError('Cannot assign to system category')),
      'Нельзя назначать деньги в системную категорию',
    );
    expect(
      humanizeApiError(engineError('Category not found: abc123')),
      'Категория не найдена',
    );
    expect(
      humanizeApiError(engineError('Amount must be positive')),
      'Сумма должна быть больше нуля',
    );
  });

  test('does not disguise an unmapped 500 as a normal message', () {
    expect(
      humanizeApiError(engineError('SQLITE_BUSY')),
      'Сервер не смог выполнить запрос: SQLITE_BUSY',
    );
  });

  test('surfaces 401 as the API-key prompt', () {
    final e = ApiException('Invalid API key',
        code: 'UNAUTHORIZED', status: 401, suggestion: 'Check your key');
    expect(e.isUnauthorized, isTrue);
    expect(humanizeApiError(e), 'Нужен API-ключ');
  });

  test('appends the server suggestion for ordinary errors', () {
    expect(
      humanizeApiError(ApiException('date is required',
          code: 'VALIDATION_ERROR',
          status: 400,
          suggestion: 'Check request body')),
      'date is required. Check request body',
    );
  });
}
