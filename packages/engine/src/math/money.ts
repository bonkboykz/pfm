import Decimal from 'decimal.js';

const CURRENCY_SYMBOLS: Record<string, string> = {
  KZT: '₸',
  USD: '$',
  EUR: '€',
  RUB: '₽',
};

export function formatMoney(amountCents: number, currency = 'KZT'): string {
  const amount = new Decimal(amountCents).dividedBy(100).truncated().toNumber();
  const isNegative = amount < 0;
  const absStr = Math.abs(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const symbol = CURRENCY_SYMBOLS[currency] ?? currency;
  return `${isNegative ? '-' : ''}${absStr} ${symbol}`;
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
