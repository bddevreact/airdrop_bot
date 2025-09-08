/* eslint-disable no-console */
const bs58Module = require('bs58');
const sqlite3     = require('sqlite3').verbose();
const {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  Transaction,
  sendAndConfirmTransaction
} = require('@solana/web3.js');
const {
  getMint,
  getOrCreateAssociatedTokenAccount,
  createTransferInstruction
} = require('@solana/spl-token');

/* ───────────── helpers ───────────────────────────────── */
const log = (...m) => console.log(new Date().toISOString(), ...m);

// robust bs58.decode
const decode =
  typeof bs58Module === 'function'           ? bs58Module
: typeof bs58Module.decode === 'function'    ? bs58Module.decode
: typeof bs58Module.default === 'function'   ? bs58Module.default
                                            : bs58Module.default.decode;

// built-in fetch or dynamic fallback
const fetch = global.fetch
  ? global.fetch
  : (...args) => import('node-fetch').then(({ default: f }) => f(...args));

class TokenService {
  constructor(cfg) {
    this.cfg      = cfg;
    this.conn     = new Connection(cfg.rpcUrl, 'confirmed');
    
    // Only create wallet if seed is provided and valid
    if (cfg.seed && cfg.seed !== "YourBase58PrivateKeyHere") {
      try {
        this.wallet   = Keypair.fromSecretKey(decode(cfg.seed));
        this.ownerStr = this.wallet.publicKey.toBase58();
      } catch (e) {
        log('⚠️ Invalid private key, bot will run in read-only mode');
        this.wallet = null;
        this.ownerStr = null;
      }
    } else {
      log('⚠️ No private key provided, bot will run in read-only mode');
      this.wallet = null;
      this.ownerStr = null;
    }
    
    this.mintPub  = new PublicKey(cfg.tokenMint);
    this.decimals = null;

    // open your airdrop.db and ensure `sent` table exists
    this.db = new sqlite3.Database(cfg.dbPath || 'airdrop.db', () =>
      log('🔗 SQLite opened for audit:', cfg.dbPath || 'airdrop.db')
    );
    this.db.run(`
      CREATE TABLE IF NOT EXISTS sent (
        signature   TEXT PRIMARY KEY,
        to_address  TEXT,
        amount      REAL,
        ts          INTEGER,
        tg_id       INTEGER,
        username    TEXT
      )
    `, err => {
      if (err) log('❌ Failed to ensure sent table:', err.message);
      else   log('✅ Sent table ready');
    });

    log('🔌 TokenService initialised – owner', this.ownerStr);
  }

  // fetch decimals once
  async _ensureDecimals() {
    if (this.decimals !== null) return;
    log('ℹ️  Resolving decimals for mint', this.mintPub.toBase58());
    const { decimals } = await getMint(this.conn, this.mintPub);
    this.decimals = decimals;
    log('✅ Mint decimals =', decimals);
  }

  // pull Helius transfers
  async getLatestTransfers(limit = 100) {
    const url = `https://api.helius.xyz/v0/addresses/${this.cfg.motherWallet}/transactions`
              + `?api-key=${this.cfg.apiKey}&limit=${limit}`;
    log('🌐 GET', url);
    const res  = await fetch(url);
    if (!res.ok) throw new Error(`Helius ${res.status}: ${await res.text()}`);
    const json = await res.json();
    log(`📄 Received ${json.length} tx`);
    return json;
  }

  // send $CR7 + audit log
  async sendTrw(destAddress, trwAmount) {
    if (!this.wallet) {
      throw new Error('No wallet configured - cannot send tokens');
    }
    
    await this._ensureDecimals();
    log(`🚚 Preparing to send ${trwAmount} $CR7 → ${destAddress}`);

    const fromATA = await getOrCreateAssociatedTokenAccount(
      this.conn, this.wallet, this.mintPub, this.wallet.publicKey
    );
    log('   fromATA:', fromATA.address.toBase58());

    const toATA = await getOrCreateAssociatedTokenAccount(
      this.conn, this.wallet, this.mintPub, new PublicKey(destAddress)
    );
    log('   toATA:  ', toATA.address.toBase58());

    const rawAmount = BigInt(Math.floor(trwAmount * 10 ** this.decimals));
    const ix        = createTransferInstruction(
      fromATA.address, toATA.address, this.wallet.publicKey, rawAmount
    );

    const tx    = new Transaction().add(ix);
    const sig   = await sendAndConfirmTransaction(this.conn, tx, [this.wallet]);
    const nowTs = Math.floor(Date.now() / 1000);
    log(`✅ Sent! sig = ${sig}`);

    // — audit into `sent` table —
    this.db.get(
      `SELECT tg_id, username FROM users WHERE wallet = ?`,
      [destAddress],
      (err, row) => {
        if (err) return log('❌ Audit lookup error:', err.message);
        const tg_id    = row ? row.tg_id     : null;
        const username = row ? row.username  : null;

        this.db.run(
          `INSERT OR IGNORE INTO sent
             (signature, to_address, amount, ts, tg_id, username)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [sig, destAddress, trwAmount, nowTs, tg_id, username],
          err2 => {
            if (err2) log('❌ Audit insert error:', err2.message);
            else       log('💾 Audit logged:', sig);
          }
        );
      }
    );

    return sig;
  }

  // Check if a deposit has already been rewarded
  async isDepositRewarded(depositSignature) {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT signature FROM sent WHERE signature = ?`,
        [depositSignature],
        (err, row) => {
          if (err) {
            log('❌ Error checking if deposit rewarded:', err.message);
            reject(err);
          } else {
            resolve(!!row); // true if found, false if not found
          }
        }
      );
    });
  }
}

module.exports = TokenService;
