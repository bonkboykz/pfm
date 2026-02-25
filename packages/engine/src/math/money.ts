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

export function formatMoney(amountCents: number, currency = 'KZT'): string {
  const amount = new Decimal(amountCents).dividedBy(100).truncated().toNumber();
  const isNegative = amount < 0;
  const absStr = Math.abs(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

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
