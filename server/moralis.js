// Read-only holder data from Moralis Solana API.
// Endpoint: GET /token/{network}/{address}/top-holders  (max limit 100, cursor paginated)

const BASE = 'https://solana-gateway.moralis.io'

/**
 * Fetch holders of a token, paginating until we have at least `want` rows
 * (or run out). Returns raw rows newest/largest first as Moralis orders them.
 */
export async function getTopHolders({ mint, apiKey, want = 200, network = 'mainnet' }) {
  if (!apiKey) throw new Error('MORALIS_API_KEY belum diisi')
  if (!mint) throw new Error('PROJECT_TOKEN_MINT belum diisi')

  const headers = { 'X-Api-Key': apiKey, accept: 'application/json' }
  const out = []
  let cursor = null

  do {
    const u = new URL(`${BASE}/token/${network}/${mint}/top-holders`)
    u.searchParams.set('limit', '100')
    if (cursor) u.searchParams.set('cursor', cursor)

    const r = await fetch(u, { headers })
    if (!r.ok) throw new Error(`Moralis ${r.status}: ${(await r.text()).slice(0, 200)}`)
    const data = await r.json()

    for (const h of data.result || []) {
      out.push({
        owner: h.ownerAddress,
        balanceRaw: String(h.balance ?? '0'),
        balance: Number(h.balanceFormatted ?? 0),
        isContract: !!h.isContract,
        pct: Number(h.percentageRelativeToTotalSupply ?? 0),
      })
    }
    cursor = data.cursor || null
  } while (cursor && out.length < want)

  return out
}
