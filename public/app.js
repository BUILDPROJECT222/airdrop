const $ = (id) => document.getElementById(id)
const short = (a) => `${a.slice(0, 4)}…${a.slice(-4)}`
const SOLSCAN = (a) => `https://solscan.io/account/${a}`
const SOLSCAN_TX = (s) => `https://solscan.io/tx/${s}`

let currentPlanId = null

async function loadConfig() {
  try {
    const c = await (await fetch('/api/config')).json()
    const flag = (ok, label) => `<span class="pill ${ok ? 'ok' : 'bad'}">${ok ? '●' : '○'} ${label}</span>`
    $('cfg').innerHTML =
      flag(c.rpcSet, 'RPC') + flag(c.moralisSet, 'Moralis') +
      flag(c.projectTokenSet, 'Project token') + flag(c.treasurySet, 'Treasury') +
      `<span class="pill">Top ${c.holderCount} · ${c.perTx}/tx</span>`
  } catch { /* ignore */ }
}

async function preview() {
  const btn = $('previewBtn')
  btn.disabled = true; btn.textContent = 'Menghitung…'
  try {
    const r = await fetch('/api/preview', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ winner: $('winner').value, amount: $('amount').value.trim() }),
    })
    const d = await r.json()
    if (!r.ok) throw new Error(d.error || 'gagal')
    currentPlanId = d.planId
    renderResult(d)
  } catch (e) {
    alert('Preview gagal: ' + e.message)
  } finally {
    btn.disabled = false; btn.textContent = 'Preview (dry-run)'
  }
}

function renderResult(d) {
  $('result').classList.remove('hidden')
  $('summary').innerHTML = [
    ['Pemenang', d.team],
    ['Total dibagikan', `${d.amount} ${d.team}`],
    ['Penerima', d.recipientCount],
    ['ATA baru dibuat', d.newAtas],
    ['Transaksi', d.batches],
    ['Estimasi biaya', `${d.cost.totalSol} SOL`],
    ['Dibuang oleh filter', d.droppedCount],
  ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')

  const tb = $('tbl').querySelector('tbody')
  tb.innerHTML = d.recipients.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><a href="${SOLSCAN(r.owner)}" target="_blank" rel="noopener">${short(r.owner)}</a></td>
      <td>${r.sharePct.toFixed(2)}%</td>
      <td class="num">${r.alloc}</td>
      <td>${r.needsAta ? '<span class="tag new">baru</span>' : '<span class="tag ok">ada</span>'}</td>
    </tr>`).join('')

  $('result').scrollIntoView({ behavior: 'smooth' })
}

async function execute() {
  if (!currentPlanId) return
  const secret = $('secret').value
  if (!secret) return alert('Isi ADMIN_SECRET dulu.')
  if (!confirm('Kirim airdrop SEKARANG? Token asli akan keluar dari treasury.')) return

  const btn = $('execBtn')
  btn.disabled = true; btn.textContent = 'Mengirim…'
  $('log').classList.remove('hidden')
  $('logBody').innerHTML = '<div class="logline">Mulai eksekusi…</div>'
  try {
    const r = await fetch('/api/execute', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planId: currentPlanId, secret }),
    })
    const d = await r.json()
    if (!r.ok) throw new Error(d.error || 'gagal')
    $('logBody').innerHTML = d.batches.map((b) =>
      `<div class="logline ok">✓ Batch ${b.batch}/${b.totalBatches} (${b.count} transfer) — <a href="${SOLSCAN_TX(b.signature)}" target="_blank" rel="noopener">${short(b.signature)}</a></div>`
    ).join('') + `<div class="logline done">Selesai · ${d.batches.length} transaksi terkonfirmasi.</div>`
  } catch (e) {
    $('logBody').innerHTML += `<div class="logline bad">✗ ${e.message}</div>`
  } finally {
    btn.disabled = false; btn.textContent = 'Kirim airdrop sekarang'
  }
}

$('previewBtn').addEventListener('click', preview)
$('execBtn').addEventListener('click', execute)
loadConfig()
