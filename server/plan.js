// Proportional allocation math, done entirely in integer (raw) units with
// BigInt so there is no floating-point drift. Each holder's weight is their
// raw balance of the PROJECT token; the winner coin is split by that weight.

/** Parse a human amount string ("1234.56") into raw base units for `decimals`. */
export function toRaw(amountStr, decimals) {
  const s = String(amountStr).trim()
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`jumlah tidak valid: ${amountStr}`)
  const [int, frac = ''] = s.split('.')
  const fracPadded = (frac + '0'.repeat(decimals)).slice(0, decimals)
  return BigInt(int + (decimals ? fracPadded : ''))
}

/** Format raw base units back to a human string. */
export function fromRaw(raw, decimals) {
  const neg = raw < 0n
  let s = (neg ? -raw : raw).toString().padStart(decimals + 1, '0')
  const int = s.slice(0, s.length - decimals) || '0'
  const frac = decimals ? s.slice(s.length - decimals).replace(/0+$/, '') : ''
  return (neg ? '-' : '') + (frac ? `${int}.${frac}` : int)
}

/**
 * Split `amountRaw` of the winner coin across `holders` proportionally to each
 * holder's `balanceRaw` (project-token weight). Floors per holder, then hands
 * the leftover dust to the largest weight so the sum is exact.
 */
export function allocate(holders, amountRaw) {
  const weights = holders.map((h) => BigInt(h.balanceRaw || '0'))
  const total = weights.reduce((a, b) => a + b, 0n)
  if (total <= 0n) throw new Error('total weight 0 — tidak ada holder valid')

  let assigned = 0n
  let maxIdx = 0
  const allocs = holders.map((h, i) => {
    const a = (amountRaw * weights[i]) / total
    assigned += a
    if (weights[i] > weights[maxIdx]) maxIdx = i
    return a
  })
  // Give the rounding remainder to the biggest holder.
  allocs[maxIdx] += amountRaw - assigned

  return holders
    .map((h, i) => ({ owner: h.owner, weightRaw: weights[i].toString(), allocRaw: allocs[i] }))
    .filter((r) => r.allocRaw > 0n)
}
