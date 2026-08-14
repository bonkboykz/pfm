import Decimal from 'decimal.js';

interface CurrencyConfig {
  symbol: string;
  position: 'prefix' | 'suffix';
}

const CURRENCY_CONFIG: Record<string, CurrencyConfig> = {
  KZT: { symbol: '₸', position: 'suffix' },
  USD: { symbol: '$', position: 'prefix' },
  EUR: { symbol: '€', position: 'suffix' },
  RUB: { symbol: '₽', position: 'suffix' },
  GBP: { symbol: '£', position: 'prefix' },
  CNY: { symbol: '¥', position: 'prefix' },
  JPY: { symbol: '¥', position: 'prefix' },
  TRY: { symbol: '₺', position: 'suffix' },
  UAH: { symbol: '₴', position: 'suffix' },
  GEL: { symbol: '₾', position: 'suffix' },
};

/**
 * Тиыны показываются там, где они есть; круглые суммы остаются без запятой.
 *
 * Раньше функция усекала до целых единиц, и это врало дважды. Перерасход в
 * 93 тиына рендерился как «0 ₸» — с красной плашкой рядом. И усечённые
 * слагаемые не складывались в усечённый итог: шесть платежей по кредитам
 * давали 192 034 ₸ поштучно против 192 035 ₸ при сложении до округления,
 * причём объяснить это, глядя в ответ API, было нельзя.
 *
 * «150 000,00 ₸» вместо «150 000 ₸» превратило бы любой список в частокол
 * нулей, поэтому дробная часть появляется только когда она ненулевая.
 */
export function formatMoney(amountCents: number, currency = 'KZT'): string {
  const isNegative = amountCents < 0;
  const abs = new Decimal(amountCents).abs();
  const units = abs.dividedBy(100).floor();
  const fraction = abs.minus(units.times(100)).toNumber();

  const grouped = units.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const absStr = fraction === 0
    ? grouped
    : `${grouped},${fraction.toString().padStart(2, '0')}`;

  const config = CURRENCY_CONFIG[currency];

  if (config) {
    if (config.position === 'prefix') {
      return `${isNegative ? '-' : ''}${config.symbol}${absStr}`;
    }
    return `${isNegative ? '-' : ''}${absStr} ${config.symbol}`;
  }

  // Unknown currency: fallback to suffix with ISO code
  return `${isNegative ? '-' : ''}${absStr} ${currency}`;
}

export function addCents(...amounts: number[]): number {
  return amounts.reduce((acc, val) => new Decimal(acc).plus(val).toNumber(), 0);
}

export function subtractCents(a: number, b: number): number {
  return new Decimal(a).minus(b).toNumber();
}

export function multiplyCents(amount: number, factor: number): number {
  return new Decimal(amount).times(factor).round().toNumber();
}

export function sumCents(amounts: number[]): number {
  return amounts.reduce((acc, val) => new Decimal(acc).plus(val).toNumber(), 0);
}
