import { describe, it, expect } from 'vitest';
import { toSatang, fromSatang, multiplyMoney, sumMoney, parseMoney } from '../src/lib/money.js';

describe('lib/money.js integer arithmetic', () => {
  it('converts decimal number and string to integer satang and back', () => {
    expect(toSatang(19.99)).toBe(1999);
    expect(toSatang('19.99')).toBe(1999);
    expect(toSatang(0.1)).toBe(10);
    expect(toSatang('0.10')).toBe(10);
    expect(toSatang(100)).toBe(10000);
    expect(toSatang(0)).toBe(0);

    expect(fromSatang(1999)).toBe(19.99);
    expect(fromSatang(10)).toBe(0.1);
    expect(fromSatang(10000)).toBe(100);
    expect(fromSatang(0)).toBe(0);
  });

  it('avoids floating point errors on 0.1 + 0.2', () => {
    // Normal JS float: 0.1 + 0.2 = 0.30000000000000004
    expect(0.1 + 0.2).not.toBe(0.3);

    const sum = sumMoney([0.1, 0.2]);
    expect(sum).toBe(0.3);
  });

  it('correctly multiplies price by quantity, e.g. 19.99 * 3 = 59.97', () => {
    const total = multiplyMoney(19.99, 3);
    expect(total).toBe(59.97);

    const fromString = multiplyMoney('19.99', 3);
    expect(fromString).toBe(59.97);
  });

  it('sums multiple money amounts accurately', () => {
    const items = [19.99, 10.01, 5.50, 0.25];
    const total = sumMoney(items);
    // 19.99 + 10.01 = 30.00 + 5.50 = 35.50 + 0.25 = 35.75
    expect(total).toBe(35.75);
  });

  it('parses DB numeric strings to Number with at most 2 decimals', () => {
    expect(parseMoney('120.50')).toBe(120.5);
    expect(parseMoney('0.00')).toBe(0);
    expect(parseMoney(49.99)).toBe(49.99);
    expect(parseMoney(null)).toBe(0);
  });
});
