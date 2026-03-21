const { Telegraf } = require("telegraf");
const Anthropic = require("@anthropic-ai/sdk").default;
const express = require("express");

const BOT_TOKEN = process.env.BOT_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN || !ANTHROPIC_API_KEY) {
  console.error("Missing BOT_TOKEN or ANTHROPIC_API_KEY");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const conversations = new Map();
const MAX_HISTORY = 20;

function getHistory(userId) {
  if (!conversations.has(userId)) conversations.set(userId, []);
  return conversations.get(userId);
}

function addToHistory(userId, role, content) {
  const history = getHistory(userId);
  history.push({ role, content });
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
}

const SYSTEM_PROMPT = "You are a smart, friendly AI assistant living inside Telegram.\n\nYour personality:\n- Conversational and warm, never robotic\n- Concise by default - Telegram messages should be short and punchy\n- If someone asks you to summarize something, give a crisp 3-5 point summary\n- You can help with anything: writing, coding, research, ideas, advice\n\nFORMATTING RULES:\n- Never use Markdown symbols like *, _, **, __ in your replies\n- Use plain text only - dashes for lists, plain numbers for steps\n- Emojis are fine\n\nAlways reply in the same language the user wrote in.\nKeep replies under 300 words unless the user asks for more.";

async function askClaude(userId, userMessage) {
  addToHistory(userId, "user", userMessage);
  const response = await anthropic.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: getHistory(userId),
  });
  const reply = response.content[0] ? response.content[0].text : "Sorry, I could not generate a reply.";
  addToHistory(userId, "assistant", reply);
  return reply;
}

bot.start(function(ctx) {
  const name = ctx.from && ctx.from.first_name ? ctx.from.first_name : "there";
  return ctx.reply("Hey " + name + "! I am your AI assistant powered by Claude.\n\nJust talk to me naturally - ask questions, paste text to summarize, get help with anything.\n\nType /help to see what I can do.");
});

bot.help(function(ctx) {
  return ctx.reply(
    "What I can do:\n\n" +
    "- Answer any question\n" +
    "- Summarize long text or articles\n" +
    "- Help with writing, coding, ideas\n" +
    "- Remember our conversation context\n" +
    "- Translate between languages\n\n" +
    "Commands:\n" +
    "/start - say hello\n" +
    "/reset - clear conversation memory\n" +
    "/help - this message\n\n" +
    "Just talk to me naturally - no commands needed!"
  );
});

bot.command("reset", function(ctx) {
  conversations.delete(ctx.from.id);
  return ctx.reply("Conversation cleared! Fresh start.");
});

bot.on("text", async function(ctx) {
  const userId = ctx.from.id;
  const userMessage = ctx.message.text;
  await ctx.sendChatAction("typing");
  try {
    const reply = await askClaude(userId, userMessage);
    await ctx.reply(reply);
  } catch (err) {
    console.error("Claude API error:", err);
    await ctx.reply("Something went wrong on my end. Please try again in a moment.");
  }
});

bot.on("photo", async function(ctx) {
  await ctx.reply("I can see you sent a photo! I cannot view images directly via Telegram yet, but paste any text from it and I will help you with that.");
});

bot.on("document", async function(ctx) {
  await ctx.reply("I cannot read files directly yet - but copy-paste the text content and I will summarize or analyse it for you!");
});

async function launch() {
  if (WEBHOOK_URL) {
    const app = express();
    app.use(express.json());
    app.use(bot.webhookCallback("/webhook"));
    app.get("/", function(_req, res) { res.send("Claude Telegram Bot - running!"); });
    await bot.telegram.setWebhook(WEBHOOK_URL + "/webhook");
    app.listen(PORT, function() {
      console.log("Webhook server running on port " + PORT);
      console.log("Webhook set to " + WEBHOOK_URL + "/webhook");
    });
  } else {
    await bot.launch();
    console.log("Bot running in polling mode");
  }
}

launch().catch(console.error);

process.once("SIGINT", function() { bot.stop("SIGINT"); });
process.once("SIGTERM", function() { bot.stop("SIGTERM"); });
