// Drop addresses that are not real airdroppable holders: programs/pools
// (Moralis `isContract`), burn/system addresses, the treasury itself, and any
// manually-excluded wallets (CEX, team, LP, etc.).

const SYSTEM_BURN = new Set([
  '11111111111111111111111111111111',            // System Program
  '1nc1nerator11111111111111111111111111111111', // Incinerator (burn)
])

export function filterHolders(holders, { treasury, exclude = [] } = {}) {
  const excludeSet = new Set([
    ...SYSTEM_BURN,
    ...(treasury ? [treasury] : []),
    ...exclude.map((s) => s.trim()).filter(Boolean),
  ])

  const kept = []
  const dropped = []
  for (const h of holders) {
    let reason = null
    if (!h.owner) reason = 'no-owner'
    else if (excludeSet.has(h.owner)) reason = 'excluded'
    else if (h.isContract) reason = 'contract/pool'
    else if (BigInt(h.balanceRaw || '0') <= 0n) reason = 'zero-balance'

    if (reason) dropped.push({ ...h, reason })
    else kept.push(h)
  }
  return { kept, dropped }
}
