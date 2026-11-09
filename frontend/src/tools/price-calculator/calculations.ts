const scale = 10_000n

export function hundredths(value: string): bigint | null {
  const match = /^(\d{1,7})(?:[,.](\d{0,2}))?$/.exec(value.trim())
  if (!match) return null
  return BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'))
}

function roundUp(numerator: bigint, denominator: bigint) {
  return (numerator + denominator - 1n) / denominator
}

export function minimumSkroutzPrice(purchase: bigint, vat: bigint) {
  // Divide by 0.91 and 0.915, then add VAT.
  return roundUp(purchase * scale * (scale + vat), 9_100n * 9_150n)
}

export function maximumPurchasePrice(skroutz: bigint, vat: bigint) {
  // Remove VAT, then apply the two signed Excel steps (10% − 100% and 8% − 100%).
  return roundUp(skroutz * 9_000n * 9_200n, scale * (scale + vat))
}
