export function factorial(n: number): number {
  if (n < 0) return 0;
  if (n === 0 || n === 1) return 1;

  let result = 1;
  for (let i = 2; i <= n; i += 1) {
    result *= i;
  }
  return result;
}

export function poissonProbability(lambda: number, goals: number): number {
  const safeLambda = Math.max(lambda, 0.01);
  return (Math.exp(-safeLambda) * Math.pow(safeLambda, goals)) / factorial(goals);
}
