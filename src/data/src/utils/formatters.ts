export function formatPercent(value: number, decimals = 1): string {
  return `${(value * 100).toFixed(decimals)} %`;
}
