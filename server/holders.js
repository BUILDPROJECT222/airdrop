// Holder source: Helius DAS `getTokenAccounts` (RPC). Reliable for pump.fun
// tokens that Moralis' top-holders endpoint doesn't index. We page through every
// token account for the mint, sum balances per OWNER (a wallet may hold several
// ATAs), sort desc, and flag off-curve owners (PDAs: pools / bonding curve /
// program accounts) as `isContract` so the existing filter drops them.
import { PublicKey } from '@solana/web3.js'

export async function getHoldersViaHelius({ rpcUrl, mint, want = 200 }) {
  if (!rpcUrl) throw new Error('SOLANA_RPC_URL belum diisi')
  if (!mint) throw new Error('PROJECT_TOKEN_MINT belum diisi')

  const LIMIT = 1000
  const MAX_PAGES = 50 // safety cap (50k accounts) for huge tokens
  const byOwner = new Map()
  let page = 1
  let capped = false

  while (page <= MAX_PAGES) {
    const r = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: page, method: 'getTokenAccounts',
        params: { mint, limit: LIMIT, page },
      }),
    })
    if (!r.ok) throw new Error(`RPC http ${r.status}`)
    const j = await r.json()
    if (j.error) throw new Error(`RPC ${j.error.message || JSON.stringify(j.error)}`)
    const accts = j.result?.token_accounts || []
    if (accts.length === 0) break
    for (const a of accts) {
      const amt = BigInt(a.amount || '0')
      if (amt <= 0n) continue
      byOwner.set(a.owner, (byOwner.get(a.owner) || 0n) + amt)
    }
    if (accts.length < LIMIT) break
    page++
    if (page > MAX_PAGES) capped = true
  }

  const rows = [...byOwner.entries()]
    .sort((x, y) => (x[1] < y[1] ? 1 : x[1] > y[1] ? -1 : 0))
    .map(([owner, amt]) => {
      let onCurve = false
      try { onCurve = PublicKey.isOnCurve(new PublicKey(owner)) } catch { /* invalid -> treat as contract */ }
      return { owner, balanceRaw: amt.toString(), balance: 0, isContract: !onCurve, pct: 0 }
    })

  if (capped) console.warn('[holders] hit MAX_PAGES — top-holder list may be approximate')
  return rows.slice(0, want)
}
