import 'dotenv/config'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import express from 'express'
import { getHoldersViaHelius } from './holders.js'
import { filterHolders } from './filter.js'
import { toRaw, fromRaw, allocate } from './plan.js'
import {
  makeConnection, loadTreasury, resolveMint, treasuryBalanceRaw,
  resolveRecipients, sendDistribution, ATA_RENT_SOL,
} from './solana.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 4000

const env = (k, d = '') => process.env[k] || d
const MINTS = {
  ansem: env('ANSEM_MINT', '9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump'),
  tjr: env('TJR_MINT', '4U4U8oXwDyVXGeTffMXds4NAgBgLFwq3wNvTCRTSpump'),
  luke: env('LUKE_MINT', '86CFcbZBJAqGVnfgnLNcw3tPmfaTigAR2UxbUPYTpump'),
}
const TEAM = { ansem: 'ANSEM', tjr: 'TJR', luke: 'LUKE' }
const HOLDER_COUNT = Number(env('HOLDER_COUNT', '100'))
const PER_TX = Number(env('PER_TX_TRANSFERS', '5'))

const app = express()
app.use(express.json())
app.use(express.static(path.join(__dirname, '..', 'public')))

// Last computed plan held in memory; execute must reference it by id.
let lastPlan = null

// Public, non-secret config for the UI.
app.get('/api/config', (_req, res) => {
  res.json({
    teams: TEAM,
    holderCount: HOLDER_COUNT,
    perTx: PER_TX,
    projectTokenSet: !!env('PROJECT_TOKEN_MINT'),
    treasurySet: !!env('TREASURY_PRIVATE_KEY'),
    rpcSet: !!env('SOLANA_RPC_URL'),
  })
})

// --- KO events from the game (notify only — execution stays manual) ---------
// The game POSTs each KO here; we record the winner as a "pending airdrop". The
// operator still reviews + executes manually (guarded by ADMIN_SECRET). No funds
// move automatically.
const koEvents = [] // newest first
app.post('/api/ko-event', (req, res) => {
  if (!env('ADMIN_SECRET') || String(req.body.secret || '') !== env('ADMIN_SECRET')) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  const winner = String(req.body.winner || '').toLowerCase()
  if (!MINTS[winner]) return res.status(400).json({ error: 'unknown winner' })
  koEvents.unshift({ winner, name: TEAM[winner], stage: String(req.body.stage || ''), cycle: Number(req.body.cycle) || 0, ts: Date.now() })
  if (koEvents.length > 25) koEvents.length = 25
  console.log(`[ko-event] ${TEAM[winner]} won ${req.body.stage} (cycle ${req.body.cycle})`)
  res.json({ ok: true })
})
app.get('/api/pending', (_req, res) => res.json({ events: koEvents.slice(0, 25) }))

app.post('/api/preview', async (req, res) => {
  try {
    const winner = String(req.body.winner || '').toLowerCase()
    const amountStr = String(req.body.amount || '')
    if (!MINTS[winner]) throw new Error('winner harus "ansem" atau "tjr"')
    if (!MINTS[winner]) throw new Error(`mint ${winner} belum diset di .env`)

    const connection = makeConnection(env('SOLANA_RPC_URL'))
    const treasury = loadTreasury(env('TREASURY_PRIVATE_KEY'))

    // 1) Winner coin metadata + treasury balance guardrail.
    const { mint, programId, decimals } = await resolveMint(connection, MINTS[winner])
    const amountRaw = toRaw(amountStr, decimals)
    if (amountRaw <= 0n) throw new Error('jumlah harus > 0')
    const { ata: sourceAta, amount: balRaw } =
      await treasuryBalanceRaw(connection, treasury.publicKey, mint, programId)
    if (amountRaw > balRaw) {
      throw new Error(`saldo treasury kurang: punya ${fromRaw(balRaw, decimals)} ${TEAM[winner]}, butuh ${fromRaw(amountRaw, decimals)}`)
    }

    // 2) Top holders of the PROJECT token (via Helius RPC), filtered to real wallets.
    const raw = await getHoldersViaHelius({
      rpcUrl: env('SOLANA_RPC_URL'),
      mint: env('PROJECT_TOKEN_MINT'),
      want: HOLDER_COUNT * 2,
    })
    const { kept, dropped } = filterHolders(raw, {
      treasury: treasury.publicKey.toBase58(),
      exclude: env('EXCLUDE_ADDRESSES').split(',').filter(Boolean),
    })
    const holders = kept.slice(0, HOLDER_COUNT)
    if (!holders.length) throw new Error('tidak ada holder valid setelah filter')

    // 3) Proportional allocation + on-chain ATA existence check.
    const allocs = allocate(holders, amountRaw)
    const recRows = await resolveRecipients(connection, allocs.map((a) => a.owner), mint, programId)
    const ataByOwner = new Map(recRows.map((r) => [r.owner, r]))

    const weightTotal = holders.reduce((a, h) => a + BigInt(h.balanceRaw), 0n)
    const recipients = allocs.map((a) => {
      const r = ataByOwner.get(a.owner)
      return {
        owner: a.owner,
        ata: r.ata.toBase58(),
        needsAta: r.needsAta,
        allocRaw: a.allocRaw.toString(),
        alloc: fromRaw(a.allocRaw, decimals),
        sharePct: Number((BigInt(a.weightRaw) * 10000n) / weightTotal) / 100,
      }
    })

    // 4) Cost estimate.
    const newAtas = recipients.filter((r) => r.needsAta).length
    const batches = Math.ceil(recipients.length / PER_TX)
    const rentSol = newAtas * ATA_RENT_SOL
    const feeSol = batches * 0.000005
    const planId = crypto.createHash('sha256')
      .update(JSON.stringify({ winner, amountRaw: amountRaw.toString(), recipients }))
      .digest('hex').slice(0, 16)

    lastPlan = {
      id: planId, winner, mintStr: MINTS[winner], sourceAta: sourceAta.toBase58(),
      decimals, amountRaw: amountRaw.toString(), recipients, executed: false,
    }

    res.json({
      planId, winner, team: TEAM[winner],
      amount: fromRaw(amountRaw, decimals), decimals,
      recipientCount: recipients.length,
      newAtas, batches,
      cost: { rentSol: +rentSol.toFixed(6), feeSol: +feeSol.toFixed(6), totalSol: +(rentSol + feeSol).toFixed(6) },
      droppedCount: dropped.length,
      recipients,
    })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

app.post('/api/execute', async (req, res) => {
  try {
    if (!env('ADMIN_SECRET')) throw new Error('ADMIN_SECRET belum diset di server')
    if (String(req.body.secret || '') !== env('ADMIN_SECRET')) {
      return res.status(401).json({ error: 'secret salah' })
    }
    if (!lastPlan) throw new Error('belum ada preview — jalankan Preview dulu')
    if (req.body.planId !== lastPlan.id) throw new Error('planId tidak cocok — Preview ulang')
    if (lastPlan.executed) throw new Error('plan ini sudah dieksekusi')

    lastPlan.executed = true // lock immediately to prevent double-send
    const connection = makeConnection(env('SOLANA_RPC_URL'))
    const treasury = loadTreasury(env('TREASURY_PRIVATE_KEY'))
    const { mint, programId, decimals } = await resolveMint(connection, lastPlan.mintStr)

    const { PublicKey } = await import('@solana/web3.js')
    const recipients = lastPlan.recipients.map((r) => ({
      owner: r.owner,
      ownerPk: new PublicKey(r.owner),
      ata: new PublicKey(r.ata),
      needsAta: r.needsAta,
      allocRaw: BigInt(r.allocRaw),
    }))

    const results = await sendDistribution({
      connection, treasury, mint, programId, decimals,
      sourceAta: new PublicKey(lastPlan.sourceAta),
      recipients, perTx: PER_TX,
    })

    res.json({ ok: true, planId: lastPlan.id, batches: results })
  } catch (e) {
    if (lastPlan && req.body.planId === lastPlan.id) lastPlan.executed = false // allow retry on failure
    res.status(400).json({ error: e.message })
  }
})

app.listen(PORT, () => console.log(`[airdrop] http://localhost:${PORT}`))
