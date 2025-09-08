/*  bot.js – full & final (v3.5)
    — Keeps every original feature
    — Exactly‑once deposit → reward (works with new TokenService)
    — Group confirmation is ALWAYS delivered as photo‑caption
      • picks img.png / img.jpg / img.jpeg (first found in project root)
    — /admin inline panel gains 1 extra button:  🖼 Set image
      • press → bot asks for a *photo reply*; the file replaces the old img.*
      • supports PNG / JPG / JPEG               */
/* eslint-disable no-console */
"use strict";

const fs          = require("fs");
const https       = require("https");
const path        = require("path");
const sqlite3     = require("sqlite3").verbose();
const TelegramBot = require("node-telegram-bot-api");
const QRCode      = require("qrcode");
const { PublicKey, LAMPORTS_PER_SOL } = require("@solana/web3.js");

const cfgPath = path.join(__dirname, "config.json");
let   cfg     = JSON.parse(fs.readFileSync(cfgPath, "utf8"));      // ← mutable
const msg     = require("./messages");
const TokenService = require("./tokenService");
let   tokenSvc = new TokenService(cfg);                            // ← mutable

/* ───────── Custom Emoji ───────── */
const CR7_EMOJI_ID = "6192627015812652886";
const CR7_EMOJI = `<a href="tg://emoji?id=${CR7_EMOJI_ID}">⚽️</a>`;

/* ───────── helpers ───────── */
const log = (...m) => console.log(new Date().toISOString(), ...m);
// PRESALE_END_TS will be calculated from contestStart + contestDays

const reloadConfig = () => {
  cfg      = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  tokenSvc = new TokenService(cfg);
  PROGRESS_SOL_CAP   = cfg.progressSolCap || 100;
  CONTEST_START_UNIX = cfg.presaleStart  || Math.floor(Date.now() / 1e3);
  CONTEST_DAYS       = Math.ceil((cfg.presaleEnd - cfg.presaleStart) / 86400) || 2;
  CONTEST_END_MS     = cfg.presaleEnd * 1000;

  log("♻️  Config reloaded");
};
const findImage = () => {
  for (const n of ["img.png", "img.jpg", "img.jpeg"])
    if (fs.existsSync(path.join(__dirname, n))) return path.join(__dirname, n);
  return null;
};
const SOLSCAN_TX = s => `https://solscan.io/tx/${s}`;
const SOLSCAN_AC = a => `https://solscan.io/account/${a}`;

/* ───────── SQLite ───────── */
const dbFile = path.join(__dirname, "airdrop.db");
const db = new sqlite3.Database(dbFile, () => log("🔗 SQLite opened:", dbFile));
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY,
            tg_id INTEGER, username TEXT, wallet TEXT UNIQUE,
            created_at INTEGER
          )`);
  db.run(`CREATE TABLE IF NOT EXISTS deposits (
            signature  TEXT PRIMARY KEY,
            from_addr  TEXT,
            amount_sol REAL,
            ts         INTEGER,
            processed  INTEGER DEFAULT 0
          )`);
  log("✅ Tables ensured");
});

/* ───────── Telegram bot ───────── */
const bot = new TelegramBot(cfg.botToken, { polling: true });
log("🤖 Telegram bot started");

/*  Promise‑wrapped helpers  */
const sqlRun = (q, p = []) =>
  new Promise((res, rej) => db.run(q, p, function (e) { e ? rej(e) : res(this); }));
const sqlAll = (q, p = []) =>
  new Promise((res, rej) => db.all(q, p, (e, r) => (e ? rej(e) : res(r))));

/* ───────── /start ───────── */
bot.onText(/\/start/, async ctx => {
  if (ctx.chat.type !== "private") return;  // 💡 Only proceed in private chats

  const chat = ctx.chat.id;
  log("/start from", chat);

  /* — presale gate — */
  const currentTime = Math.floor(Date.now() / 1e3);
  if (currentTime < cfg.presaleStart)
    return bot.sendMessage(chat, "🚀 Presale hasn't started yet!");
  if (currentTime >= cfg.presaleEnd)
    return bot.sendMessage(chat, "⏰ Presale has ended!");

  await bot.sendMessage(chat, msg.WELCOME, { parse_mode: "HTML" });

  const qrBuf   = await QRCode.toBuffer(cfg.motherWallet, { type: "png" });
  const caption = msg.makeProcess(cfg);

  await bot.sendPhoto(chat, qrBuf, {
    caption,
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: [[{ text: "🔍 Track", callback_data: "track" }]] }
  });
});

/* ───────── Admin panel state ───────── */
const adminStates = new Map();   // chatId → { mode:'edit'|'setimage', key? }

/* ───────── /admin ───────── */
bot.onText(/\/admin/, async ctx => {
  const chatId = ctx.chat.id;
  if (!cfg.adminIds.includes(chatId)) return;

  const editable = Object.keys(cfg)
    .filter(k => !["botToken", "adminIds"].includes(k));

  const rows = editable.map(k => [{ text: `✏️ ${k}`, callback_data: `edit:${k}` }]);
  rows.push([{ text: "🖼 Set image", callback_data: "setimage" }]);   // ← NEW button

  let summary = "*Current config* ```json\n";
  summary += JSON.stringify(cfg, null, 2).slice(0, 3800);
  summary += "\n```";

  await bot.sendMessage(chatId, summary + "\nSelect a field to edit ↓", {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: rows }
  });
});





/* ───────── contest / progress helpers ───────── */

let PROGRESS_SOL_CAP   = cfg.progressSolCap || 100;                // ← from config
let CONTEST_START_UNIX = cfg.presaleStart  || Math.floor(Date.now() / 1e3);
let CONTEST_DAYS       = Math.ceil((cfg.presaleEnd - cfg.presaleStart) / 86400) || 2;
let CONTEST_END_MS     = cfg.presaleEnd * 1000;


const progressFile = path.join(__dirname, "contest.json");

/* ensure file + schema */
if (!fs.existsSync(progressFile))
  fs.writeFileSync(
    progressFile,
    JSON.stringify({ totalSol: 0, bigSpenders: [] }, null, 2)
  );

const loadProgress = () => JSON.parse(fs.readFileSync(progressFile, "utf8"));
const saveProgress = obj =>
  fs.writeFileSync(progressFile, JSON.stringify(obj, null, 2));

/* track total + “spent ≥ 1 SOL at once” wallets */
function addSolAndGetTotal(deltaSol, wallet) {
  const now  = Date.now();
  const prog = loadProgress();

  prog.totalSol = +(prog.totalSol + deltaSol).toFixed(4);

  if (deltaSol >= 1 && now < CONTEST_END_MS) {
    prog.bigSpenders.push({
      wallet,
      amount: +deltaSol.toFixed(4),
      ts: Math.floor(now / 1000)
    });
  }
  saveProgress(prog);
  return prog.totalSol;
}

/* 🟧🟧🟧◻️◻️… (10-segment) */
const makeProgressBar = pct => {
  const filled = Math.min(10, Math.floor(pct / 10));
  return "🟧".repeat(filled) + "◻️".repeat(10 - filled);
};

const contestActive = () => {
  const now = Date.now();
  const start = CONTEST_START_UNIX * 1000;
  const end = start + CONTEST_DAYS * 86400 * 1000;
  return now >= start && now <= end;
};
const formatTimeLeft = () => {
  let ms = CONTEST_END_MS - Date.now();
  if (ms <= 0) return "0d 0h 0m 0s";
  const d = Math.floor(ms / 864e5);   ms %= 864e5;
  const h = Math.floor(ms / 36e5);    ms %= 36e5;
  const m = Math.floor(ms / 6e4);     ms %= 6e4;
  const s = Math.floor(ms / 1e3);
  return `${d}d ${h}h ${m}m ${s}s`;
};

/* build current contest block */
function buildContestBlock() {
  const pr      = loadProgress();
  const percent = Math.min((pr.totalSol / PROGRESS_SOL_CAP) * 100, 100);
  return (
`*Contest Progress*
• Total Spent: *${pr.totalSol.toFixed(4)} / ${PROGRESS_SOL_CAP} SOL*
• ${makeProgressBar(percent)} ${percent.toFixed(2)}%
• ⏳ Time left: ${formatTimeLeft()}`
  );
}





/* ───────── token-launch progress (40 M cap) ───────── */
const TOKEN_CAP = 15_000_000;                              // 40 M $CR7
const tokenFile = path.join(__dirname, "token_progress.json");

if (!fs.existsSync(tokenFile))
  fs.writeFileSync(tokenFile, JSON.stringify({ total: 0 }, null, 2));

const loadTokenTotal  = () => JSON.parse(fs.readFileSync(tokenFile, "utf8")).total;
const saveTokenTotal  = t => fs.writeFileSync(tokenFile, JSON.stringify({ total: t }, null, 2));

/* bump running total and return it */
function addTokensAndGetTotal(delta) {
  const total = Math.round(loadTokenTotal() + delta);      // keep it integer
  saveTokenTotal(total);
  return total;
}

/* 1 234 567 → “1.23 M”, 9 876 → “9.9 K”, 900 → “900” */
function compact(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "K";
  return n.toString();
}

function buildTokenBlock() {
  const total = loadTokenTotal();
  const pct   = Math.min((total / TOKEN_CAP) * 100, 100);
  return (
`*Launch Progress*
• Bought: *${compact(total)} / ${compact(TOKEN_CAP)} $CR7*
• ${makeProgressBar(pct)} ${pct.toFixed(2)}%`
  );
}




/* ───────── callback buttons ───────── */
bot.on("callback_query", async ({ message, data, id }) => {
  const chatId = message.chat.id;

  /*  Track button  */
  if (data === "track") {
    await bot.answerCallbackQuery(id);
    const prompt = await bot.sendMessage(chatId, msg.askWallet, {
      reply_markup: { force_reply: true }
    });

    bot.onReplyToMessage(chatId, prompt.message_id, async reply => {
      try {
        const wallet = new PublicKey(reply.text).toBase58();
        await sqlRun(
          `INSERT OR IGNORE INTO users (tg_id, username, wallet, created_at)
           VALUES (?, ?, ?, strftime('%s','now'))`,
          [reply.from.id, reply.from.username || "", wallet]
        );
        await bot.sendMessage(reply.chat.id, "📝 Tracked! I’ll notify you.");
      } catch {
        await bot.sendMessage(reply.chat.id, "❌ Invalid Solana address, try again.");
      }
    });
    return;
  }

  /*  Config edit buttons  */
  if (data.startsWith("edit:") && cfg.adminIds.includes(chatId)) {
    await bot.answerCallbackQuery(id);
    const key = data.split(":")[1];
    adminStates.set(chatId, { mode: "edit", key });
    await bot.sendMessage(chatId, `🔧 Send new value for *${key}*`, {
      parse_mode: "Markdown",
      reply_markup: { force_reply: true }
    });
    return;
  }

  /*  Set image button  */
  if (data === "setimage" && cfg.adminIds.includes(chatId)) {
    await bot.answerCallbackQuery(id);
    adminStates.set(chatId, { mode: "setimage" });
    await bot.sendMessage(
      chatId,
      "📸 Send *one photo* **as a reply** to this message — it will replace img.png/jpg/jpeg.",
      { parse_mode: "Markdown", reply_markup: { force_reply: true } }
    );
  }
});

/* ───────── admin replies ───────── */
bot.on("message", async msg => {
  const chatId = msg.chat.id;
  const state  = adminStates.get(chatId);
  if (!state || !cfg.adminIds.includes(chatId)) return;

  /*  ── 1) Editing config value ── */
  if (state.mode === "edit") {
    const key  = state.key;
    const orig = cfg[key];
    let   val  = msg.text.trim();

    if (typeof orig === "number") {
      const num = Number(val);
      if (Number.isNaN(num))
        return bot.sendMessage(chatId, "❌ That is not a valid number.");
      val = num;
    }
    cfg[key] = val;
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    reloadConfig();
    adminStates.delete(chatId);
    return bot.sendMessage(chatId, `✅ *${key}* updated to \`${val}\``, {
      parse_mode: "Markdown"
    });
  }


  /*  ── 3) /updatecontest – step 1 (delay) ── */
  if (state.mode === "contest_time") {
    const [h, m] = msg.text.trim().split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || m < 0 || m > 59)
      return bot.sendMessage(chatId, "❌ Use H:MM (example 2:45).");

    const newStartMs = Date.now() + (h * 60 + m) * 60 * 1000;
    adminStates.set(chatId, { mode: "contest_days", newStartMs });
    return bot.sendMessage(
      chatId,
      "📆 *How many days* will the contest last?",
      { parse_mode: "Markdown", reply_markup: { force_reply: true } }
    );
  }

/*  ── 4) /updatecontest – step 2 (days) ── */
if (state.mode === "contest_days") {
  const days = Number(msg.text.trim());
  if (Number.isNaN(days) || days <= 0)
    return bot.sendMessage(chatId, "❌ Enter a positive number of days.");

  // carry forward only the needed data and set next mode
  adminStates.set(chatId, {
    mode: "contest_cap",
    newStartMs: state.newStartMs,
    days: days
  });

  return bot.sendMessage(
    chatId,
    "💰 Total SOL *cap* for this contest?",
    { parse_mode: "Markdown", reply_markup: { force_reply: true } }
  );
}

  /*  ── 5) /updatecontest – step 3 (cap) ── */
  if (state.mode === "contest_cap") {
    const solCap = Number(msg.text.trim());
    if (Number.isNaN(solCap) || solCap <= 0)
      return bot.sendMessage(chatId, "❌ Enter a positive number.");

    const { newStartMs, days } = state;

    /* archive old progress */
    const archive = `contest_${Date.now()}.json`;
    if (fs.existsSync(progressFile))
      fs.renameSync(progressFile, path.join(__dirname, archive));

    /* fresh progress file */
    fs.writeFileSync(
      progressFile,
      JSON.stringify({ totalSol: 0, bigSpenders: [] }, null, 2)
    );

    /* write to config */
    cfg.contestStart   = Math.floor(newStartMs / 1000);
    cfg.contestDays    = days;
    cfg.progressSolCap = solCap;
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    reloadConfig();

    adminStates.delete(chatId);
    return bot.sendMessage(
      chatId,
      `✅ New contest scheduled!\n` +
      `• Starts: *${new Date(newStartMs).toLocaleString()}*\n` +
      `• Duration: *${days} day(s)*\n` +
      `• Cap: *${solCap} SOL*`,
      { parse_mode: "Markdown" }
    );
  }


  /*  ── 2) Setting new confirmation image ── */
  if (state.mode === "setimage") {
    if (!msg.photo?.length)
      return bot.sendMessage(chatId, "⚠️ Please *reply with a photo*.", {
        parse_mode: "Markdown"
      });

    const fileObj = msg.photo.slice(-1)[0];           // best resolution
    try {
      const file   = await bot.getFile(fileObj.file_id);
      const ext    = path.extname(file.file_path).toLowerCase() || ".jpg";
      const target = path.join(__dirname, `img${ext}`);
      const url    = `https://api.telegram.org/file/bot${cfg.botToken}/${file.file_path}`;

      https.get(url, res => {
        const ws = fs.createWriteStream(target);
        res.pipe(ws);
        ws.on("finish", () => {
          ws.close();
          /*  remove any other img.*  */
          ["img.png", "img.jpg", "img.jpeg"]
            .map(f => path.join(__dirname, f))
            .filter(p => p !== target && fs.existsSync(p))
            .forEach(p => fs.unlinkSync(p));

          adminStates.delete(chatId);
          bot.sendMessage(chatId, "✅ Confirmation image updated.");
          log("🖼  New confirmation image saved by admin", chatId);
        });
      }).on("error", e => {
        log("❌ download:", e.message);
        bot.sendMessage(chatId, "⚠️ Could not download image.");
      });
    } catch (e) {
      log("❌ setimage:", e.message);
      bot.sendMessage(chatId, "⚠️ Error processing image.");
    }
  }
});

/* ───────── group confirmation helper ───────── */
/* ───────── group confirmation helper ───────── */
// Add this helper at the top of your file
function formatDecimal(value) {
  const str = value.toString();
  const [intPart, decPart = ""] = str.split(".");
  return decPart.length > 4
    ? `${intPart}.${decPart.slice(0, 4)}`
    : str;
}


/* ───────── group confirmation helper (contest aware) ───────── */
async function announceInGroup({ trw, sol, sendSig, dest }) {
  if (!cfg.groupid) return;

  /* stop sending group messages after presale ends */
  const currentTime = Math.floor(Date.now() / 1e3);
  if (currentTime < cfg.presaleStart || currentTime >= cfg.presaleEnd) return;

  /* core buy info */
  const formattedSol = formatDecimal(sol);
  const formattedTrw = formatDecimal(trw);
  const dynamicEmojis = msg.generateEmojis(sol);
  
let caption = `
🐐 New $CR7 Buy

${dynamicEmojis}

• 💰 Spent: ${formattedSol} SOL
• 🎁 Bought: ${formattedTrw} $CR7
• 🔗 <a href="${SOLSCAN_TX(sendSig)}">Signature</a> | 👛 <a href="${SOLSCAN_AC(dest)}">Wallet</a>`;


  /* bookkeeping + optional progress */
  addSolAndGetTotal(sol, dest);
  addTokensAndGetTotal(trw);
  if (contestActive()) caption += "\n\n" + buildContestBlock();
  // caption += "\n\n" + buildTokenBlock();     // NEW – token progress

  /* send with image (if available) */
  const imgPath = findImage();
  const opts = { caption, parse_mode: "HTML", disable_web_page_preview: true };

  try {
    if (imgPath) await bot.sendPhoto(cfg.groupid, imgPath, opts);
    else         await bot.sendMessage(cfg.groupid, caption, opts);
    log("📣 Announced in group", cfg.groupid);
  } catch (e) {
    log("❌ group announce:", e.message);
  }
}
/* ───────── /contest — show current status ───────── */
bot.onText(/\/contest/, async ctx => {
  const chatId = ctx.chat.id;
  const reply  = contestActive()
               ? buildContestBlock()
               : "*Contest has ended.*";
  await bot.sendMessage(chatId, reply, { parse_mode: "Markdown" });
});
/* ───────── /updatecontest ───────── */
bot.onText(/\/updatecontest/, async ctx => {
  const chatId = ctx.chat.id;
  if (!cfg.adminIds.includes(chatId)) return;          // admin-only
  adminStates.set(chatId, { mode: "contest_time" });
  await bot.sendMessage(
    chatId,
    "⏱️  Delay until the new contest starts?\nFormat *H:MM* — e.g. `2:45`",
    { parse_mode: "Markdown", reply_markup: { force_reply: true } }
  );
});

/* ───────── /eligible — download big-spender list ───────── */
const os = require("os");   // already built-in

bot.onText(/\/eligible/, async ctx => {
  const chatId = ctx.chat.id;
  if (!cfg.adminIds.includes(chatId)) return;

  const { bigSpenders } = loadProgress();
  if (!bigSpenders.length)
    return bot.sendMessage(chatId, "❌ No eligible wallets yet.");

  const lines = bigSpenders.map(e =>
    `${e.wallet}, ${e.amount} SOL, ${new Date(e.ts * 1000).toISOString()}`
  );
  const tmp = path.join(__dirname, `eligible_${Date.now()}.txt`);
  fs.writeFileSync(tmp, lines.join(os.EOL));

  await bot.sendDocument(chatId, tmp, {}, { filename: "eligible.txt" });
  fs.unlinkSync(tmp);
});


/* ───────── /progress — show token-buy progress (15 M cap) ───────── */
// bot.onText(/\/progress/, async ctx => {
//   const chatId = ctx.chat.id;
//   const reply  = buildTokenBlock();          // uses TOKEN_CAP = 15_000_000
//   await bot.sendMessage(chatId, reply, { parse_mode: "Markdown" });
// });


/* ───────── main loop (every cfg.loopSeconds) ───────── */
async function processLoop() {
  try {
    log("⏳ Loop tick – fetching transfers…");
    const transfers = await tokenSvc.getLatestTransfers(100);

    /* 1) Insert deposits  */
    for (const tx of transfers) {
      const sig = tx.signature;
      for (const tr of tx.nativeTransfers) {
        if (tr.toUserAccount !== cfg.motherWallet) continue;
        const sol = tr.amount / LAMPORTS_PER_SOL;
        if (sol < cfg.minDeposit) continue;

        const added = await sqlRun(
          `INSERT OR IGNORE INTO deposits
             (signature, from_addr, amount_sol, ts)
           VALUES (?, ?, ?, ?)`,
          [sig, tr.fromUserAccount, sol, tx.timestamp]
        );
        if (added.changes) log("➕ New qualifying deposit", sig, sol, "SOL");
      }
    }

    /* 2) Process pending  */
/* 2) Process pending  — NEW EXACTLY-ONCE VERSION */
const debugDir = path.join(__dirname, "debug");
if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir);

function trace(sig, step, extra = {}) {
  const fp  = path.join(debugDir, `${sig}.json`);
  const log = fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, "utf8")) : { deposit_sig: sig, steps: [] };
  log.steps.push({ ts: new Date().toISOString(), step, ...extra });
  fs.writeFileSync(fp, JSON.stringify(log, null, 2));
}

const pending = await sqlAll(`SELECT * FROM deposits WHERE processed = 0`);
for (const dep of pending) {
  const depSig = dep.signature;
  trace(depSig, "start", { sol: dep.amount_sol, from: dep.from_addr });

  /* ---- SKIP if already rewarded (safety when bot restarts) ---- */
  if (await tokenSvc.isDepositRewarded(depSig)) {
    await sqlRun(`UPDATE deposits SET processed = 1 WHERE signature = ?`, [depSig]);
    trace(depSig, "already_rewarded_skip");
    continue;
  }

  const trw = dep.amount_sol * cfg.rate;
  const u   = await sqlAll(`SELECT tg_id, username FROM users WHERE wallet = ?`, [dep.from_addr]);
  const tgId = u[0]?.tg_id;
  const uname= u[0]?.username ?? "";

  /* ---- RETRY ONLY THE ON-CHAIN TRANSFER ---- */
  let sendSig, attempt = 0;
  while (!sendSig && attempt < 5) {
    attempt++;
    try {
      trace(depSig, `send_attempt_${attempt}`);
      sendSig = await tokenSvc.sendTrw(dep.from_addr, trw, depSig, { tgId, username: uname });
      trace(depSig, "send_success", { sendSig });
    } catch (e) {
      trace(depSig, "send_fail", { err: e.message });
      if (e.message.includes('No wallet configured')) {
        log('⚠️ Skipping token send - no wallet configured');
        sendSig = 'NO_WALLET_CONFIGURED';
        break;
      }
      if (attempt < 5) await new Promise(r => setTimeout(r, 20_000));
      else throw e;                   // give up after final try
    }
  }

  /* ---- mark processed AFTER successful transfer ---- */
  await sqlRun(`UPDATE deposits SET processed = 1 WHERE signature = ?`, [depSig]);
  trace(depSig, "db_processed");

  /* ---- user DM (never retried) ---- */
       if (tgId && sendSig !== 'NO_WALLET_CONFIGURED') {
        try {
          await bot.sendMessage(
            tgId,
            msg.credited({ trw, sol: dep.amount_sol, sig: sendSig }),
            { parse_mode: "HTML", disable_web_page_preview: true }
          );
          trace(depSig, "user_notified", { tgId });
        } catch (err) {
          log("⚠️ Could not DM user", tgId, err.message);
        }
      }

      // ---- group announcement (always run) ----
      try {
        await announceInGroup({ trw, sol: dep.amount_sol, sendSig, dest: dep.from_addr });
        trace(depSig, "group_announced");
      } catch (err) {
        log("⚠️ Could not announce in group", cfg.groupid, err.message);
      }
    }  // <-- end for

  } catch (err) {
    log("💥 Loop error:", err);
  } finally {
    setTimeout(processLoop, (cfg.loopSeconds || 120) * 1000);
  }
}
processLoop();
log("🔄 Processing loop launched");

/*  Keep alive on polling errors  */
bot.on("polling_error", e => log("polling_error:", e.message));
