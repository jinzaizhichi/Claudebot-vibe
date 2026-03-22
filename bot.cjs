const { Telegraf } = require("telegraf");
const Anthropic = require("@anthropic-ai/sdk").default;
const express = require("express");
const { createClient } = require("@supabase/supabase-js");

const BOT_TOKEN = process.env.BOT_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN || !ANTHROPIC_API_KEY) {
  console.error("Missing BOT_TOKEN or ANTHROPIC_API_KEY");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

if (!supabase) console.log("Supabase not configured - using in-memory storage");
if (!TAVILY_API_KEY) console.log("Tavily not configured - web search disabled");

const memoryStore = new Map();

async function getHistory(userId) {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("conversations")
        .select("role, content")
        .eq("user_id", userId)
        .order("created_at", { ascending: true })
        .limit(20);
      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error("Supabase read error:", err.message);
    }
  }
  return memoryStore.get(userId) || [];
}

async function saveMessage(userId, role, content) {
  if (supabase) {
    try {
      const { error } = await supabase
        .from("conversations")
        .insert({ user_id: userId, role, content });
      if (error) throw error;
      return;
    } catch (err) {
      console.error("Supabase write error:", err.message);
    }
  }
  if (!memoryStore.has(userId)) memoryStore.set(userId, []);
  const history = memoryStore.get(userId);
  history.push({ role, content });
  if (history.length > 20) history.splice(0, history.length - 20);
}

async function clearHistory(userId) {
  if (supabase) {
    try {
      await supabase.from("conversations").delete().eq("user_id", userId);
      return;
    } catch (err) {
      console.error("Supabase delete error:", err.message);
    }
  }
  memoryStore.delete(userId);
}

async function tavilySearch(query) {
  if (!TAVILY_API_KEY) return [];
  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: TAVILY_API_KEY, query: query, max_results: 5, search_depth: "basic" })
    });
    const data = await response.json();
    return data.results || [];
  } catch (err) {
    console.error("Tavily error:", err.message);
    return [];
  }
}

const SYSTEM_PROMPT = "You are a smart, friendly AI assistant living inside Telegram.\n\nYour personality:\n- Conversational and warm, never robotic\n- For short questions, keep replies concise\n- For creative or detailed tasks, write as much as needed to complete the task fully without stopping\n- You can help with anything: writing, coding, research, ideas, advice\n\nFORMATTING RULES:\n- Never use Markdown symbols like *, _, **, __ in your replies\n- Use plain text only - dashes for lists, plain numbers for steps\n- Emojis are fine\n\nAlways reply in the same language the user wrote in.\nNever stop mid-reply. Always complete your full response in one message.";

const tools = [
  {
    name: "web_search",
    description: "Search the web for current information, latest news, prices, or anything time-sensitive.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "The search query" } },
      required: ["query"]
    }
  }
];

async function askClaude(userId, userMessage) {
  await saveMessage(userId, "user", userMessage);
  const history = await getHistory(userId);
  let messages = [...history];
  let finalReply = "";

  for (let i = 0; i < 5; i++) {
    const response = await anthropic.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: TAVILY_API_KEY ? tools : [],
      messages: messages
    });

    if (response.stop_reason === "end_turn") {
      finalReply = (response.content.find(function(b) { return b.type === "text"; }) || {}).text || "Sorry, I could not generate a reply.";
      break;
    }

    if (response.stop_reason === "tool_use") {
      const toolUseBlock = response.content.find(function(b) { return b.type === "tool_use"; });
      if (!toolUseBlock) break;
      const searchResults = await tavilySearch(toolUseBlock.input.query);
      const resultsText = searchResults.length > 0
        ? searchResults.map(function(r, i) { return (i + 1) + ". " + r.title + "\n" + r.content; }).join("\n\n")
        : "No results found.";
      messages = [
        ...messages,
        { role: "assistant", content: response.content },
        { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseBlock.id, content: resultsText }] }
      ];
      continue;
    }

    finalReply = (response.content.find(function(b) { return b.type === "text"; }) || {}).text || "Sorry, I could not generate a reply.";
    break;
  }

  await saveMessage(userId, "assistant", finalReply);
  return finalReply;
}

async function sendLongMessage(ctx, text) {
  const MAX_LENGTH = 4000;
  if (text.length <= MAX_LENGTH) { await ctx.reply(text); return; }
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= MAX_LENGTH) { await ctx.reply(remaining); break; }
    let splitAt = remaining.lastIndexOf("\n", MAX_LENGTH);
    if (splitAt === -1) splitAt = MAX_LENGTH;
    await ctx.reply(remaining.substring(0, splitAt));
    remaining = remaining.substring(splitAt).trim();
  }
}

bot.start(function(ctx) {
  const name = ctx.from && ctx.from.first_name ? ctx.from.first_name : "there";
  return ctx.reply("Hey " + name + "! I am your AI assistant powered by Claude.\n\nI can:\n- Answer any question\n- Search the web for latest info\n- Analyze images you send me\n- Remember our full conversation history\n\nJust talk to me naturally!");
});

bot.help(function(ctx) {
  return ctx.reply(
    "What I can do:\n\n" +
    "- Answer any question\n" +
    "- Search the web for current info\n" +
    "- Analyze photos you send\n" +
    "- Summarize long text\n" +
    "- Help with writing, coding, ideas\n" +
    "- Remember our full conversation history\n\n" +
    "Commands:\n" +
    "/start - say hello\n" +
    "/reset - clear conversation memory\n" +
    "/help - this message"
  );
});

bot.command("reset", async function(ctx) {
  await clearHistory(ctx.from.id);
  return ctx.reply("Conversation cleared! Fresh start.");
});

bot.on("text", async function(ctx) {
  const userId = ctx.from.id;
  const userMessage = ctx.message.text;
  await ctx.sendChatAction("typing");
  try {
    const reply = await askClaude(userId, userMessage);
    await sendLongMessage(ctx, reply);
  } catch (err) {
    console.error("Claude API error:", err);
    await ctx.reply("Something went wrong on my end. Please try again in a moment.");
  }
});

bot.on("photo", async function(ctx) {
  const userId = ctx.from.id;
  await ctx.sendChatAction("typing");
  try {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const file = await ctx.telegram.getFile(photo.file_id);
    const fileUrl = "https://api.telegram.org/file/bot" + BOT_TOKEN + "/" + file.file_path;
    const imageResponse = await fetch(fileUrl);
    const arrayBuffer = await imageResponse.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const caption = ctx.message.caption || "请详细描述这张图片的内容。What do you see in this image?";
    const history = await getHistory(userId);
    const response = await anthropic.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        ...history,
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } },
            { type: "text", text: caption }
          ]
        }
      ]
    });
    const reply = response.content[0] ? response.content[0].text : "I could not analyze this image.";
    await saveMessage(userId, "user", "[图片] " + caption);
    await saveMessage(userId, "assistant", reply);
    await sendLongMessage(ctx, reply);
  } catch (err) {
    console.error("Image error:", err);
    await ctx.reply("Something went wrong processing your image. Please try again.");
  }
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
