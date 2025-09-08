import telebot

TOKEN = "8306444578:AAFFgkoXYkB-9EDqMDk_yh-881u7QJjXU9k"
bot = telebot.TeleBot(TOKEN)

@bot.message_handler(func=lambda m: True)
def get_custom_emoji_id(message):
    if message.entities:
        for entity in message.entities:
            if entity.type == "custom_emoji":
                bot.reply_to(message, f"Custom Emoji ID: {entity.custom_emoji_id}")

bot.polling()
