// On-chain layer: load treasury, resolve mint/decimals/token-program, check ATAs,
// and send the distribution as batched SPL transfers. Read paths are used by
// /api/preview; sendDistribution() is only called by /api/execute.

import {
  Connection, Keypair, PublicKey, Transaction, ComputeBudgetProgram,
} from '@solana/web3.js'
import {
  getMint, getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction, getAccount,
} from '@solana/spl-token'
import bs58 from 'bs58'

// Rent-exempt minimum for a token account (≈ what each new ATA costs the payer).
export const ATA_RENT_SOL = 0.00203928

export function makeConnection(rpcUrl) {
  if (!rpcUrl) throw new Error('SOLANA_RPC_URL belum diisi')
  return new Connection(rpcUrl, 'confirmed')
}

/** Accept either base58 (Phantom) or JSON array (Solana CLI id.json). */
export function loadTreasury(secret) {
  if (!secret) throw new Error('TREASURY_PRIVATE_KEY belum diisi')
  const s = secret.trim()
  const bytes = s.startsWith('[')
    ? Uint8Array.from(JSON.parse(s))
    : bs58.decode(s)
  return Keypair.fromSecretKey(bytes)
}

/** Mint metadata + which token program owns it (classic SPL vs Token-2022). */
export async function resolveMint(connection, mintStr) {
  const mint = new PublicKey(mintStr)
  const info = await connection.getAccountInfo(mint)
  if (!info) throw new Error(`mint tidak ditemukan: ${mintStr}`)
  const programId = info.owner // TOKEN_PROGRAM_ID or TOKEN_2022_PROGRAM_ID
  const m = await getMint(connection, mint, 'confirmed', programId)
  return { mint, programId, decimals: m.decimals }
}

/** Treasury's balance (raw) of `mint`. 0n if it has no token account yet. */
export async function treasuryBalanceRaw(connection, treasuryPubkey, mint, programId) {
  const ata = getAssociatedTokenAddressSync(mint, treasuryPubkey, false, programId)
  try {
    const acc = await getAccount(connection, ata, 'confirmed', programId)
    return { ata, amount: acc.amount }
  } catch {
    return { ata, amount: 0n }
  }
}

/**
 * For each owner, compute its ATA for `mint` and check existence on-chain
 * (batched getMultipleAccountsInfo). Returns rows with { owner, ata, needsAta }.
 */
export async function resolveRecipients(connection, owners, mint, programId) {
  const rows = owners.map((owner) => {
    const ownerPk = new PublicKey(owner)
    const ata = getAssociatedTokenAddressSync(mint, ownerPk, true, programId)
    return { owner, ownerPk, ata }
  })

  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100)
    const infos = await connection.getMultipleAccountsInfo(chunk.map((r) => r.ata))
    chunk.forEach((r, j) => { r.needsAta = infos[j] === null })
  }
  return rows
}

/**
 * Build and send the distribution. `recipients` rows carry { owner, ownerPk, ata,
 * needsAta, allocRaw:BigInt }. Sequential, ~perTx transfers per transaction.
 * onProgress({ batch, totalBatches, signature, count }) is called per confirmed tx.
 */
export async function sendDistribution({
  connection, treasury, mint, programId, decimals, sourceAta, recipients,
  perTx = 5, onProgress,
}) {
  const batches = []
  for (let i = 0; i < recipients.length; i += perTx) batches.push(recipients.slice(i, i + perTx))

  const results = []
  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b]
    const tx = new Transaction()
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20000 }))

    for (const r of batch) {
      if (r.needsAta) {
        tx.add(createAssociatedTokenAccountInstruction(
          treasury.publicKey, r.ata, r.ownerPk, mint, programId,
        ))
      }
      tx.add(createTransferCheckedInstruction(
        sourceAta, mint, r.ata, treasury.publicKey, r.allocRaw, decimals, [], programId,
      ))
    }

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
    tx.recentBlockhash = blockhash
    tx.feePayer = treasury.publicKey
    tx.sign(treasury)

    const sig = await connection.sendRawTransaction(tx.serialize(), { maxRetries: 5 })
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')

    const row = { batch: b + 1, totalBatches: batches.length, signature: sig, count: batch.length }
    results.push(row)
    onProgress && onProgress(row)
  }
  return results
}
