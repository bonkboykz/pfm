/// Dart port of `packages/engine/src/math/money.ts`.
///
/// The API returns `*Formatted` strings alongside `*Cents`, but those strings
/// are rendered server-side in KZT for transactions / budget / loans / deposits
/// regardless of the entity's real currency. Only `/accounts` and the per-row
/// `amountFormatted` in `/debts` honour it. Rule for the app: if the entity
/// carries its own currency, format from `*Cents` here; use the server string
/// only where the currency is known to be KZT.
library;

class _Currency {
  final String symbol;
  final bool prefix;
  const _Currency(this.symbol, {this.prefix = false});
}

const _currencies = <String, _Currency>{
  'KZT': _Currency('₸'),
  'USD': _Currency(r'$', prefix: true),
  'EUR': _Currency('€'),
  'RUB': _Currency('₽'),
  'GBP': _Currency('£', prefix: true),
  'CNY': _Currency('¥', prefix: true),
  'JPY': _Currency('¥', prefix: true),
  'TRY': _Currency('₺'),
  'UAH': _Currency('₴'),
  'GEL': _Currency('₾'),
};

/// Truncates to whole units (never rounds), groups thousands with a space and
/// places the currency symbol on the side the engine uses.
String formatMoney(int amountCents, {String currency = 'KZT'}) {
  final amount = amountCents ~/ 100; // truncates toward zero, like Decimal.truncated()
  return _decorate(groupDigits(amount.abs()), amount < 0, currency);
}

/// Формат для экрана: тиыны показываются всегда, когда они есть.
///
/// [formatMoney] усекает, и это врало дважды. Перерасход в 93 тиына рисовался
/// как «0 ₸» с красной плашкой, а шесть платежей по кредитам давали в сумме
/// 192 034 ₸ при поштучном усечении против 192 035 ₸ при сложении до
/// округления — расхождение, которое невозможно объяснить, глядя на экран.
///
/// Круглые суммы остаются без дробной части: «25 000 ₸», а не «25 000,00 ₸».
String formatMoneySmart(int amountCents, {String currency = 'KZT'}) {
  final abs = amountCents.abs();
  final fraction = abs % 100;
  if (fraction == 0) return formatMoney(amountCents, currency: currency);

  final body =
      '${groupDigits(abs ~/ 100)},${fraction.toString().padLeft(2, '0')}';
  return _decorate(body, amountCents < 0, currency);
}

String _decorate(String absStr, bool isNegative, String currency) {
  final sign = isNegative ? '-' : '';
  final config = _currencies[currency];
  if (config == null) return '$sign$absStr $currency';
  return config.prefix
      ? '$sign${config.symbol}$absStr'
      : '$sign$absStr ${config.symbol}';
}

/// [formatMoneySmart] with an explicit `+` on inflows, for registers where the
/// direction of a row matters as much as its size.
String formatMoneySigned(int amountCents, {String currency = 'KZT'}) {
  final formatted = formatMoneySmart(amountCents, currency: currency);
  return amountCents > 0 ? '+$formatted' : formatted;
}

/// Bare currency symbol (or the ISO code when unknown).
String currencySymbol(String currency) =>
    _currencies[currency]?.symbol ?? currency;

String groupDigits(int value) {
  final digits = value.toString();
  final buffer = StringBuffer();
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) buffer.write(' ');
    buffer.write(digits[i]);
  }
  return buffer.toString();
}

/// Renders cents for an editable amount field: no currency symbol, and the
/// fractional part is kept whenever it is non-zero. Prefilling a field with the
/// truncated value would silently drop kopecks the moment the user saves.
String formatMoneyInput(int amountCents) {
  final abs = amountCents.abs();
  final whole = groupDigits(abs ~/ 100);
  final fraction = abs % 100;
  final body =
      fraction == 0 ? whole : '$whole,${fraction.toString().padLeft(2, '0')}';
  return amountCents < 0 ? '-$body' : body;
}

/// Parses user input ("12 500", "12500,50", "-1 200.75") into integer cents.
/// Returns null when the input holds no parsable number.
int? parseMoneyToCents(String input) {
  var cleaned = input.trim().replaceAll(',', '.');
  cleaned = cleaned.replaceAll(RegExp(r'[^0-9.\-]'), '');
  if (cleaned.isEmpty || cleaned == '-' || cleaned == '.') return null;

  final negative = cleaned.startsWith('-');
  cleaned = cleaned.replaceAll('-', '');

  final parts = cleaned.split('.');
  final whole = parts.first.isEmpty ? '0' : parts.first;
  final fraction = parts.length > 1 ? parts[1] : '';

  final wholeValue = int.tryParse(whole);
  if (wholeValue == null) return null;

  final fractionPadded = fraction.padRight(2, '0').substring(0, 2);
  final fractionValue = int.tryParse(fractionPadded) ?? 0;

  final cents = wholeValue * 100 + fractionValue;
  return negative ? -cents : cents;
}
