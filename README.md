# 🪂 Airdrop Distributor — ANSEM vs TJR

App terpisah untuk membagikan **coin pemenang KO** ke **top-100 holder token project kamu**
secara **proporsional**. Dipicu **manual** (kamu yang klik), versi aman v1:
**distribusi-saja** — kamu beli coin pemenangnya manual ke treasury, app yang membagikan.

> ⚠️ **Jalankan LOKAL / private.** App ini memegang private key treasury (`.env`).
> Jangan pernah deploy publik dengan key terisi.

## Alur

```
KO → pilih pemenang (ANSEM/TJR) + jumlah coin → Preview (dry-run) → cek tabel → Execute
```

1. **Moralis** ambil top holder token project kamu → buang LP/pool/program (`isContract`),
   burn, treasury sendiri, dan `EXCLUDE_ADDRESSES`.
2. Alokasi **proporsional** (BigInt, tanpa dust hilang) berdasarkan berat = saldo token project.
3. Cek ATA tiap penerima on-chain → estimasi biaya (rent ATA baru + fee).
4. **Preview** tidak mengirim apa pun. **Execute** (butuh `ADMIN_SECRET`) mengirim
   batch SPL transfer dari treasury (default 5 transfer/tx).

## Setup

```bash
cd airdrop
npm install
cp .env.example .env   # lalu isi nilainya
npm start              # http://localhost:4000
```

Isi `.env`:

| Var | Isi |
|---|---|
| `SOLANA_RPC_URL` | Helius: `https://mainnet.helius-rpc.com/?api-key=KEY` |
| `MORALIS_API_KEY` | dari https://moralis.com (read holders) |
| `PROJECT_TOKEN_MINT` | CA token project kamu (holdernya yang dapat airdrop) |
| `ANSEM_MINT` / `TJR_MINT` | mint kandidat pemenang (sudah terisi default game) |
| `TREASURY_PRIVATE_KEY` | base58 (Phantom) atau JSON array (CLI). **RAHASIA** |
| `ADMIN_SECRET` | passphrase untuk endpoint execute |

## Yang perlu disiapkan sebelum Execute

- Treasury sudah **pegang coin pemenang** (kamu beli manual) ≥ jumlah yang dibagikan.
- Treasury punya **SOL** untuk rent ATA + fee (lihat estimasi di Preview;
  ±0.002 SOL per holder yang belum punya ATA coin itu).

## Endpoint

- `GET /api/config` — status env (tanpa bocorkan secret).
- `POST /api/preview` `{ winner, amount }` — hitung rencana (dry-run).
- `POST /api/execute` `{ planId, secret }` — kirim airdrop (butuh `ADMIN_SECRET`).

## Catatan v1 / ide lanjutan

- **Distribusi-saja.** Auto-buy (treasury swap via Jupiter) belum dibuat — bisa ditambah nanti.
- **Trigger manual.** Belum nyambung ke server game; bisa di-otomatiskan saat KO nanti.
- Plan disimpan in-memory (1 plan terakhir). Execute mengunci plan agar tak dobel kirim.
