/* eslint-disable no-console */
"use strict";

const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const path = require("path");

// Load config
const cfgPath = path.join(__dirname, "config.json");
const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));

const bot = new TelegramBot(cfg.botToken, { polling: true });

console.log("🤖 Sticker Emoji Bot Started");
console.log("📝 This bot will help you use stickers as emoji");

// Test sticker as emoji
bot.onText(/\/teststicker/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    // Method 1: Send sticker first, then message
    // await bot.sendSticker(chatId, 'YOUR_STICKER_FILE_ID');
    
    // Method 2: Send message with sticker reference
    await bot.sendMessage(chatId, "🎯 *Sticker Emoji Test*\n\nTo use your PNG as emoji:", {
      parse_mode: "Markdown"
    });
    
    // Method 3: Inline keyboard with sticker
    const keyboard = {
      inline_keyboard: [[
        {
          text: "🔄 Buy $CR7",
          url: "https://example.com"
        }
      ]]
    };
    
    await bot.sendMessage(chatId, "🎯 *New $CR7 Buy*\n💰 Spent: *0.25 SOL*", {
      parse_mode: "Markdown",
      reply_markup: keyboard
    });
    
    console.log("✅ Sticker test sent");
    
  } catch (error) {
    console.log("❌ Error:", error.message);
  }
});

// Instructions for creating sticker
bot.onText(/\/stickerhelp/, async (msg) => {
  const chatId = msg.chat.id;
  
  const instructions = `
🎨 *How to Use Your PNG as Emoji*

*Method 1: Create Sticker Pack*
1. Go to @Stickers bot
2. Send /newpack command
3. Give your pack a name
4. Upload your PNG (512x512 pixels)
5. Give it a name
6. Get sticker file_id

*Method 2: Use as Photo*
1. Resize PNG to 100x100 pixels
2. Send as photo with caption
3. Use in messages

*Method 3: Use in Inline Keyboard*
1. Create inline keyboard
2. Use your PNG as button text
3. Or use as button icon

*Method 4: Use Unicode Emoji*
1. Find similar Unicode emoji
2. Use in messages
3. Or create custom emoji in another group

*Current working emoji: 🎯 🔄 💰 🎁*
  `;
  
  await bot.sendMessage(chatId, instructions, { parse_mode: "Markdown" });
});

// Test current working emojis
bot.onText(/\/testworking/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    const testMessage = `
🎯 *New $CR7 Buy*
💰 Spent: *0.25 SOL*
🎁 Bought: *2500 $CR7*
🔄 Rate: *10000 $CR7 per SOL*

*Working Emojis:*
🎯 🎁 💰 🔄 🚀 ⭐ 💎 🏆 🎊 🎉
    `;
    
    await bot.sendMessage(chatId, testMessage, { parse_mode: "Markdown" });
    
    console.log("✅ Working emojis test sent");
    
  } catch (error) {
    console.log("❌ Error:", error.message);
  }
});

bot.on("polling_error", (error) => {
  console.log("❌ Polling error:", error.message);
});

console.log("✅ Sticker bot is ready! Send /stickerhelp for instructions.");
