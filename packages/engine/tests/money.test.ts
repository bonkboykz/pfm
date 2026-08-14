import { describe, it, expect } from 'vitest';
import { formatMoney, addCents, subtractCents, multiplyCents, sumCents } from '../src/math/money.js';

describe('formatMoney', () => {
  it('formats positive KZT amount', () => {
    expect(formatMoney(15000000)).toBe('150 000 ₸');
  });

  it('formats negative amount', () => {
    expect(formatMoney(-850000)).toBe('-8 500 ₸');
  });

  it('formats zero', () => {
    expect(formatMoney(0)).toBe('0 ₸');
  });

  // Усечение врало дважды: перерасход в 93 тиына рисовался как «0 ₸» с
  // красной плашкой, а усечённые слагаемые не складывались в усечённый итог —
  // шесть платежей по кредитам давали то 192 034 ₸, то 192 035 ₸ в
  // зависимости от того, где округлили. В приложении это исправлено в
  // f29577a; здесь та же правка для API и MCP.
  describe('тиыны', () => {
    it('показывает дробную часть, когда она есть', () => {
      expect(formatMoney(199)).toBe('1,99 ₸');
      expect(formatMoney(19203465)).toBe('192 034,65 ₸');
    });

    it('оставляет круглые суммы без запятой', () => {
      expect(formatMoney(100)).toBe('1 ₸');
      expect(formatMoney(15000000)).toBe('150 000 ₸');
      expect(formatMoney(0)).toBe('0 ₸');
    });

    it('не теряет знак и ведущий ноль на суммах меньше единицы', () => {
      expect(formatMoney(-93)).toBe('-0,93 ₸');
      expect(formatMoney(7)).toBe('0,07 ₸');
      expect(formatMoney(-100005)).toBe('-1 000,05 ₸');
    });

    it('работает с префиксными и неизвестными валютами', () => {
      expect(formatMoney(123456, 'USD')).toBe('$1 234,56');
      expect(formatMoney(-50, 'CNY')).toBe('-¥0,50');
      expect(formatMoney(50050, 'BTC')).toBe('500,50 BTC');
    });

    it('итог сходится со слагаемыми', () => {
      const parts = [3115400, 6523500, 13664865, 2547800, 1890200, 1461700];
      expect(formatMoney(sumCents(parts))).toBe('292 034,65 ₸');
    });
  });

  it('formats with EUR symbol (suffix)', () => {
    expect(formatMoney(5000, 'EUR')).toBe('50 €');
  });

  it('formats with RUB symbol (suffix)', () => {
    expect(formatMoney(1000000, 'RUB')).toBe('10 000 ₽');
  });

  it('formats large amount with spaces', () => {
    expect(formatMoney(50000000)).toBe('500 000 ₸');
  });

  // Prefix currencies
  it('formats USD with prefix symbol', () => {
    expect(formatMoney(100000, 'USD')).toBe('$1 000');
  });

  it('formats negative USD with prefix symbol', () => {
    expect(formatMoney(-500000, 'USD')).toBe('-$5 000');
  });

  it('formats GBP with prefix symbol', () => {
    expect(formatMoney(93000, 'GBP')).toBe('£930');
  });

  it('formats CNY with prefix symbol', () => {
    expect(formatMoney(93000, 'CNY')).toBe('¥930');
  });

  it('formats JPY with prefix symbol', () => {
    expect(formatMoney(93000, 'JPY')).toBe('¥930');
  });

  // Suffix currencies (new)
  it('formats TRY with suffix symbol', () => {
    expect(formatMoney(93000, 'TRY')).toBe('930 ₺');
  });

  it('formats UAH with suffix symbol', () => {
    expect(formatMoney(93000, 'UAH')).toBe('930 ₴');
  });

  it('formats GEL with suffix symbol', () => {
    expect(formatMoney(93000, 'GEL')).toBe('930 ₾');
  });

  // Unknown currency fallback
  it('falls back to ISO code suffix for unknown currency', () => {
    expect(formatMoney(50000, 'BTC')).toBe('500 BTC');
  });
});

describe('addCents', () => {
  it('adds two amounts', () => {
    expect(addCents(100, 200)).toBe(300);
  });

  it('adds multiple amounts', () => {
    expect(addCents(100, 200, 300, 400)).toBe(1000);
  });

  it('handles negatives', () => {
    expect(addCents(1000, -300)).toBe(700);
  });

  it('handles zero arguments', () => {
    expect(addCents()).toBe(0);
  });

  it('handles single argument', () => {
    expect(addCents(500)).toBe(500);
  });
});

describe('subtractCents', () => {
  it('subtracts b from a', () => {
    expect(subtractCents(1000, 300)).toBe(700);
  });

  it('returns negative when b > a', () => {
    expect(subtractCents(100, 500)).toBe(-400);
  });

  it('subtracts zero', () => {
    expect(subtractCents(500, 0)).toBe(500);
  });
});

describe('multiplyCents', () => {
  it('multiplies and rounds', () => {
    expect(multiplyCents(1000, 1.5)).toBe(1500);
  });

  it('rounds to nearest integer', () => {
    expect(multiplyCents(333, 1.5)).toBe(500);
  });

  it('handles zero factor', () => {
    expect(multiplyCents(1000, 0)).toBe(0);
  });

  it('handles negative factor', () => {
    expect(multiplyCents(1000, -1)).toBe(-1000);
  });
});

describe('sumCents', () => {
  it('sums array of amounts', () => {
    expect(sumCents([100, 200, 300])).toBe(600);
  });

  it('handles empty array', () => {
    expect(sumCents([])).toBe(0);
  });

  it('handles negatives in array', () => {
    expect(sumCents([1000, -300, -200])).toBe(500);
  });
});
