/**
 * Money utilities using integer arithmetic (satang / cents) to prevent float inaccuracies.
 * All DB decimals/numeric and calculation results are converted to pure numbers with <= 2 decimal places.
 */

export function toSatang(amount) {
  if (amount === null || amount === undefined) return 0;
  if (typeof amount === 'number') {
    // Round to 2 decimals first to avoid floating point representations like 19.990000000000002
    amount = amount.toFixed(2);
  }
  const str = String(amount).trim();
  const isNegative = str.startsWith('-');
  const cleanStr = isNegative ? str.slice(1) : str;
  const [wholePart, fracPart = ''] = cleanStr.split('.');
  const paddedFrac = (fracPart + '00').slice(0, 2);
  const satang = (parseInt(wholePart, 10) || 0) * 100 + parseInt(paddedFrac, 10);
  return isNegative ? -satang : satang;
}

export function fromSatang(satang) {
  if (satang === null || satang === undefined) return 0;
  return Number((satang / 100).toFixed(2));
}

export function multiplyMoney(unitPrice, quantity) {
  const satang = toSatang(unitPrice);
  const totalSatang = satang * quantity;
  return fromSatang(totalSatang);
}

export function sumMoney(amounts) {
  const totalSatang = amounts.reduce((acc, curr) => acc + toSatang(curr), 0);
  return fromSatang(totalSatang);
}

export function parseMoney(val) {
  if (val === null || val === undefined) return 0;
  return Number(Number(val).toFixed(2));
}
