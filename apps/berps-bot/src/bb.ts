export function calculateBollingerBands(
  prices: number[],
  period: number,
  multiplier: number,
) {
  const sma = calculateSMA(prices, period);
  const stdDev = calculateStdDev(prices, period);
  const upperBand = sma + multiplier * stdDev;
  const lowerBand = sma - multiplier * stdDev;

  return { upperBand, lowerBand };
}

function calculateSMA(prices: number[], period: number): number {
  const sum = prices.slice(-period).reduce((acc, price) => acc + price, 0);
  return sum / period;
}

function calculateStdDev(prices: number[], period: number): number {
  const sma = calculateSMA(prices, period);
  const sum = prices
    .slice(-period)
    .reduce((acc, price) => acc + Math.pow(price - sma, 2), 0);
  return Math.sqrt(sum / period);
}
