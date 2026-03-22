const { Telegraf } = require("telegraf");
const Anthropic = require("@anthropic-ai/sdk").default;
const express = require("express");
const { createClient } = require("@supabase/supabase-js");

// ── 环境变量 ──────────────────────────────────────────────────────────────────
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

// ── 初始化 ────────────────────────────────────────────────────────────────────
const bot = new Telegraf(BOT_TOKEN);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

const memoryStore = new Map();
const docsStore = new Map();
const summaryStore = new Map();

const RECENT_MESSAGES = 15;
const MAX_SUMMARIES = 5;
const SUMMARIZE_EVERY = 20;
const LEARN_EVERY = 5; // 每 5 条对话自动学习一次

// ── 对话记录 ──────────────────────────────────────────────────────────────────
async function getHistory(userId) {
  if (supabase) {
    try {
      const { data } = await supabase
        .from("conversations")
        .select("role, content")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(RECENT_MESSAGES);
      return (data || []).reverse();
    } catch (err) { console.error("getHistory error:", err.message); }
  }
  const h = memoryStore.get(userId) || [];
  return h.slice(-RECENT_MESSAGES);
}

async function saveMessage(userId, role, content) {
  if (supabase) {
    try {
      await supabase.from("conversations").insert({ user_id: userId, role, content });
      return;
    } catch (err) { console.error("saveMessage error:", err.message); }
  }
  if (!memoryStore.has(userId)) memoryStore.set(userId, []);
  const h = memoryStore.get(userId);
  h.push({ role, content });
  if (h.length > 100) h.splice(0, h.length - 100);
}

async function countMessages(userId) {
  if (supabase) {
    try {
      const { count } = await supabase
        .from("conversations")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId);
      return count || 0;
    } catch (err) { return 0; }
  }
  return (memoryStore.get(userId) || []).length;
}

async function clearHistory(userId) {
  if (supabase) {
    try {
      await supabase.from("conversations").delete().eq("user_id", userId);
      await supabase.from("conversation_summaries").delete().eq("user_id", userId);
      return;
    } catch (err) { console.error("clearHistory error:", err.message); }
  }
  memoryStore.delete(userId);
  summaryStore.delete(userId);
}

// ── .md 文件操作 ──────────────────────────────────────────────────────────────
async function getDoc(userId, docType) {
  if (supabase) {
    try {
      const { data } = await supabase
        .from("user_docs")
        .select("content")
        .eq("user_id", userId)
        .eq("doc_type", docType)
        .single();
      return data ? data.content : null;
    } catch (err) { return null; }
  }
  return docsStore.get(userId + "_" + docType) || null;
}

async function setDoc(userId, docType, content) {
  if (supabase) {
    try {
      await supabase.from("user_docs").upsert(
        { user_id: userId, doc_type: docType, content: content, updated_at: new Date().toISOString() },
        { onConflict: "user_id,doc_type" }
      );
      return;
    } catch (err) { console.error("setDoc error:", err.message); }
  }
  docsStore.set(userId + "_" + docType, content);
}

async function getAllDocs(userId) {
  const types = ["soul", "projects", "tasks", "notes"];
  const docs = {};
  for (const t of types) {
    const content = await getDoc(userId, t);
    if (content) docs[t] = content;
  }
  return docs;
}

// ── 摘要操作 ──────────────────────────────────────────────────────────────────
async function getSummaries(userId) {
  if (supabase) {
    try {
      const { data } = await supabase
        .from("conversation_summaries")
        .select("summary")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(MAX_SUMMARIES);
      return (data || []).map(function(d) { return d.summary; }).reverse();
    } catch (err) { return []; }
  }
  return summaryStore.get(userId) || [];
}

async function saveSummary(userId, summary) {
  if (supabase) {
    try {
      await supabase.from("conversation_summaries").insert({ user_id: userId, summary: summary });
      const { data } = await supabase
        .from("conversation_summaries")
        .select("id")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (data && data.length > MAX_SUMMARIES) {
        const toDelete = data.slice(MAX_SUMMARIES).map(function(d) { return d.id; });
        await supabase.from("conversation_summaries").delete().in("id", toDelete);
      }
      return;
    } catch (err) { console.error("saveSummary error:", err.message); }
  }
  if (!summaryStore.has(userId)) summaryStore.set(userId, []);
  const s = summaryStore.get(userId);
  s.push(summary);
  if (s.length > MAX_SUMMARIES) s.splice(0, s.length - MAX_SUMMARIES);
}

// ── 自动学习记忆（核心功能）───────────────────────────────────────────────────
async function autoLearnMemory(userId, userMessage, aiReply) {
  try {
    const docs = await getAllDocs(userId);
    const currentDocs = JSON.stringify(docs, null, 2);

    const extractPrompt = "You are a memory extraction system. Analyze this conversation exchange and the user's existing memory files. Extract any new important information and return a JSON object with updates.\n\n" +
      "CURRENT MEMORY FILES:\n" + currentDocs + "\n\n" +
      "NEW EXCHANGE:\n" +
      "User: " + userMessage + "\n" +
      "AI: " + aiReply + "\n\n" +
      "Extract updates for these categories (only include if there is genuinely new info worth remembering):\n" +
      "- soul: personal identity, values, background, communication style, preferences\n" +
      "- projects: project names, descriptions, status, tech stack, goals\n" +
      "- tasks: current action items, deadlines, priorities, completed items\n" +
      "- notes: important decisions, insights, facts, links, anything worth remembering\n\n" +
      "Rules:\n" +
      "1. Only extract genuinely new or updated information not already in memory\n" +
      "2. For soul and projects, merge with existing content (do not replace unless correcting)\n" +
      "3. For tasks, update status if user mentions completing something\n" +
      "4. Be concise - no fluff\n" +
      "5. If nothing new to learn, return empty updates\n\n" +
      "Return ONLY valid JSON in this exact format, nothing else:\n" +
      '{"soul":"updated soul content or empty string","projects":"updated projects content or empty string","tasks":"updated tasks content or empty string","notes":"new note to append or empty string"}';

    const response = await anthropic.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 1000,
      messages: [{ role: "user", content: extractPrompt }]
    });

    const raw = response.content[0] ? response.content[0].text.trim() : "{}";
    const clean = raw.replace(/```json|```/g, "").trim();
    const updates = JSON.parse(clean);

    // 应用更新
    if (updates.soul && updates.soul.trim()) {
      await setDoc(userId, "soul", updates.soul.trim());
    }
    if (updates.projects && updates.projects.trim()) {
      await setDoc(userId, "projects", updates.projects.trim());
    }
    if (updates.tasks && updates.tasks.trim()) {
      await setDoc(userId, "tasks", updates.tasks.trim());
    }
    if (updates.notes && updates.notes.trim()) {
      const existingNotes = await getDoc(userId, "notes") || "";
      const timestamp = new Date().toISOString().split("T")[0];
      const newNotes = existingNotes
        ? existingNotes + "\n[" + timestamp + "] " + updates.notes.trim()
        : "[" + timestamp + "] " + updates.notes.trim();
      await setDoc(userId, "notes", newNotes);
    }

    console.log("Auto-learned memory for user " + userId);
  } catch (err) {
    console.error("autoLearnMemory error:", err.message);
  }
}

// ── 自动压缩摘要 ──────────────────────────────────────────────────────────────
async function maybeAutoSummarize(userId) {
  const count = await countMessages(userId);
  if (count > 0 && count % SUMMARIZE_EVERY === 0) {
    try {
      const history = await getHistory(userId);
      const historyText = history.map(function(m) {
        return (m.role === "user" ? "用户" : "AI") + ": " + m.content;
      }).join("\n");
      const response = await anthropic.messages.create({
        model: "claude-opus-4-5",
        max_tokens: 500,
        messages: [{ role: "user", content: "请把以下对话压缩成简短摘要（100字以内），保留重要信息、决定、项目进度。用中文。\n\n" + historyText }]
      });
      const summary = response.content[0] ? response.content[0].text : "";
      if (summary) await saveSummary(userId, summary);
    } catch (err) { console.error("Auto-summarize error:", err.message); }
  }
}

// ── 网络搜索 ──────────────────────────────────────────────────────────────────
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
  } catch (err) { return []; }
}

// ── 组装系统提示（三层记忆）───────────────────────────────────────────────────
async function buildSystemPrompt(userId) {
  const docs = await getAllDocs(userId);
  const summaries = await getSummaries(userId);

  let prompt = "You are a smart, powerful personal AI assistant with memory.\n\n";
  prompt += "FORMATTING RULES:\n";
  prompt += "- Never use Markdown symbols like *, _, **, __ in replies\n";
  prompt += "- Plain text only - dashes for lists, numbers for steps\n";
  prompt += "- Emojis are fine\n";
  prompt += "- Short questions = concise replies\n";
  prompt += "- Detailed tasks = full complete replies without stopping\n";
  prompt += "- Always reply in the same language the user wrote in\n";
  prompt += "- Never stop mid-reply\n\n";

  if (docs.soul) prompt += "=== WHO THE USER IS ===\n" + docs.soul + "\n\n";
  if (docs.projects) prompt += "=== USER PROJECTS ===\n" + docs.projects + "\n\n";
  if (docs.tasks) prompt += "=== CURRENT TASKS ===\n" + docs.tasks + "\n\n";
  if (docs.notes) prompt += "=== IMPORTANT NOTES ===\n" + docs.notes + "\n\n";

  if (summaries.length > 0) {
    prompt += "=== CONVERSATION HISTORY ===\n";
    summaries.forEach(function(s, i) { prompt += "Summary " + (i + 1) + ": " + s + "\n"; });
    prompt += "\n";
  }

  return prompt;
}

// ── Claude 主函数 ─────────────────────────────────────────────────────────────
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
  const [systemPrompt, history] = await Promise.all([
    buildSystemPrompt(userId),
    getHistory(userId)
  ]);

  // 确保至少有当前这条消息，避免 empty messages 错误
  let messages = history.length > 0 ? [...history] : [{ role: "user", content: userMessage }];
  let finalReply = "";

  for (let i = 0; i < 5; i++) {
    const response = await anthropic.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 4096,
      system: systemPrompt,
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
        ? searchResults.map(function(r, idx) { return (idx + 1) + ". " + r.title + "\n" + r.content; }).join("\n\n")
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

  // 后台执行：自动学习 + 自动摘要（不阻塞回复）
  Promise.all([
    autoLearnMemory(userId, userMessage, finalReply),
    maybeAutoSummarize(userId)
  ]).catch(function(err) { console.error("Background tasks error:", err.message); });

  return finalReply;
}

// ── 发送长消息 ────────────────────────────────────────────────────────────────
async function sendLongMessage(ctx, text) {
  const MAX = 4000;
  if (text.length <= MAX) { await ctx.reply(text); return; }
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= MAX) { await ctx.reply(remaining); break; }
    let splitAt = remaining.lastIndexOf("\n", MAX);
    if (splitAt === -1) splitAt = MAX;
    await ctx.reply(remaining.substring(0, splitAt));
    remaining = remaining.substring(splitAt).trim();
  }
}

// ── Bot 命令 ──────────────────────────────────────────────────────────────────
bot.start(function(ctx) {
  const name = ctx.from && ctx.from.first_name ? ctx.from.first_name : "there";
  return ctx.reply(
    "Hey " + name + "! Your personal AI powered by Claude.\n\n" +
    "I automatically learn and remember everything about you as we talk.\n\n" +
    "Memory system:\n" +
    "- soul.md - who you are (auto-updated)\n" +
    "- projects.md - your projects (auto-updated)\n" +
    "- tasks.md - your tasks (auto-updated)\n" +
    "- notes.md - important notes (auto-updated)\n" +
    "- conversation summaries (auto-compressed)\n\n" +
    "Commands:\n" +
    "/memory - view what I know about you\n" +
    "/soul - view soul.md\n" +
    "/projects - view projects\n" +
    "/tasks - view tasks\n" +
    "/notes - view notes\n" +
    "/note [text] - add a note manually\n" +
    "/forget - clear conversation history\n" +
    "/reset - clear everything\n" +
    "/help - all commands"
  );
});

bot.help(function(ctx) {
  return ctx.reply(
    "All commands:\n\n" +
    "VIEW MEMORY:\n" +
    "/memory - full memory overview\n" +
    "/soul - who you are\n" +
    "/projects - your projects\n" +
    "/tasks - current tasks\n" +
    "/notes - saved notes\n\n" +
    "MANUAL UPDATES:\n" +
    "/setsoul [content] - update soul.md\n" +
    "/setprojects [content] - update projects\n" +
    "/settasks [content] - update tasks\n" +
    "/note [text] - add a note\n" +
    "/clearnotes - clear notes\n\n" +
    "HISTORY:\n" +
    "/summaries - view conversation summaries\n" +
    "/summarize - force summarize now\n" +
    "/forget - clear conversation history only\n" +
    "/reset - clear ALL memory\n\n" +
    "Everything else - just talk naturally!"
  );
});

// 查看完整记忆
bot.command("memory", async function(ctx) {
  await ctx.sendChatAction("typing");
  const docs = await getAllDocs(ctx.from.id);
  const summaries = await getSummaries(ctx.from.id);
  let output = "Your memory overview:\n\n";
  if (docs.soul) output += "SOUL:\n" + docs.soul + "\n\n";
  else output += "SOUL: Not set yet\n\n";
  if (docs.projects) output += "PROJECTS:\n" + docs.projects + "\n\n";
  else output += "PROJECTS: Not set yet\n\n";
  if (docs.tasks) output += "TASKS:\n" + docs.tasks + "\n\n";
  else output += "TASKS: Not set yet\n\n";
  if (docs.notes) output += "NOTES:\n" + docs.notes + "\n\n";
  if (summaries.length > 0) output += "SUMMARIES: " + summaries.length + " saved";
  await sendLongMessage(ctx, output);
});

// soul.md
bot.command("soul", async function(ctx) {
  const content = await getDoc(ctx.from.id, "soul");
  await ctx.reply(content ? "soul.md:\n\n" + content : "Not set yet. Just talk to me and I will learn about you automatically!");
});

bot.command("setsoul", async function(ctx) {
  const content = ctx.message.text.replace("/setsoul", "").trim();
  if (!content) return ctx.reply("Usage: /setsoul [your info]");
  await setDoc(ctx.from.id, "soul", content);
  return ctx.reply("soul.md updated!");
});

// projects.md
bot.command("projects", async function(ctx) {
  const content = await getDoc(ctx.from.id, "projects");
  await ctx.reply(content ? "projects.md:\n\n" + content : "No projects learned yet. Tell me about your projects and I will remember them!");
});

bot.command("setprojects", async function(ctx) {
  const content = ctx.message.text.replace("/setprojects", "").trim();
  if (!content) return ctx.reply("Usage: /setprojects [your projects]");
  await setDoc(ctx.from.id, "projects", content);
  return ctx.reply("projects.md updated!");
});

// tasks.md
bot.command("tasks", async function(ctx) {
  const content = await getDoc(ctx.from.id, "tasks");
  await ctx.reply(content ? "tasks.md:\n\n" + content : "No tasks learned yet. Tell me what you are working on!");
});

bot.command("settasks", async function(ctx) {
  const content = ctx.message.text.replace("/settasks", "").trim();
  if (!content) return ctx.reply("Usage: /settasks [your tasks]");
  await setDoc(ctx.from.id, "tasks", content);
  return ctx.reply("tasks.md updated!");
});

// notes.md
bot.command("notes", async function(ctx) {
  const content = await getDoc(ctx.from.id, "notes");
  if (content) { await sendLongMessage(ctx, "notes.md:\n\n" + content); }
  else { await ctx.reply("No notes yet. Use /note [text] to save something."); }
});

bot.command("note", async function(ctx) {
  const newNote = ctx.message.text.replace("/note", "").trim();
  if (!newNote) return ctx.reply("Usage: /note [your note]");
  const existing = await getDoc(ctx.from.id, "notes") || "";
  const timestamp = new Date().toISOString().split("T")[0];
  const updated = existing ? existing + "\n[" + timestamp + "] " + newNote : "[" + timestamp + "] " + newNote;
  await setDoc(ctx.from.id, "notes", updated);
  return ctx.reply("Note saved!");
});

bot.command("clearnotes", async function(ctx) {
  await setDoc(ctx.from.id, "notes", "");
  return ctx.reply("Notes cleared!");
});

// 摘要
bot.command("summaries", async function(ctx) {
  const summaries = await getSummaries(ctx.from.id);
  if (summaries.length > 0) {
    await sendLongMessage(ctx, "Conversation summaries:\n\n" + summaries.map(function(s, i) { return (i + 1) + ". " + s; }).join("\n\n"));
  } else {
    await ctx.reply("No summaries yet. They are created automatically every " + SUMMARIZE_EVERY + " messages.");
  }
});

bot.command("summarize", async function(ctx) {
  await ctx.sendChatAction("typing");
  try {
    const history = await getHistory(ctx.from.id);
    if (history.length === 0) return ctx.reply("No conversation to summarize.");
    const historyText = history.map(function(m) { return (m.role === "user" ? "用户" : "AI") + ": " + m.content; }).join("\n");
    const response = await anthropic.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 500,
      messages: [{ role: "user", content: "请把以下对话压缩成简短摘要（100字以内），保留重要信息、决定、项目进度。用中文。\n\n" + historyText }]
    });
    const summary = response.content[0] ? response.content[0].text : "";
    if (summary) { await saveSummary(ctx.from.id, summary); await ctx.reply("Summary saved:\n\n" + summary); }
  } catch (err) { await ctx.reply("Error creating summary."); }
});

// 清除
bot.command("forget", async function(ctx) {
  await clearHistory(ctx.from.id);
  return ctx.reply("Conversation history cleared. Your soul, projects, tasks and notes are kept.");
});

bot.command("reset", async function(ctx) {
  await clearHistory(ctx.from.id);
  await setDoc(ctx.from.id, "soul", "");
  await setDoc(ctx.from.id, "projects", "");
  await setDoc(ctx.from.id, "tasks", "");
  await setDoc(ctx.from.id, "notes", "");
  return ctx.reply("Everything cleared. Fresh start.");
});

// ── 处理文字消息 ──────────────────────────────────────────────────────────────
bot.on("text", async function(ctx) {
  const userId = ctx.from.id;
  const userMessage = ctx.message.text;
  await ctx.sendChatAction("typing");
  try {
    const reply = await askClaude(userId, userMessage);
    await sendLongMessage(ctx, reply);
  } catch (err) {
    console.error("Claude error:", err);
    await ctx.reply("Something went wrong. Please try again.");
  }
});

// ── 处理图片 ──────────────────────────────────────────────────────────────────
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
    const caption = ctx.message.caption || "请详细描述这张图片的内容。";
    const systemPrompt = await buildSystemPrompt(userId);
    const history = await getHistory(userId);
    const response = await anthropic.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 4096,
      system: systemPrompt,
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
    autoLearnMemory(userId, "[图片] " + caption, reply).catch(function(err) { console.error(err.message); });
    await sendLongMessage(ctx, reply);
  } catch (err) {
    console.error("Image error:", err);
    await ctx.reply("Something went wrong processing your image.");
  }
});

bot.on("document", async function(ctx) {
  await ctx.reply("I cannot read files directly yet - copy-paste the text content and I will help!");
});

// ── 启动 ──────────────────────────────────────────────────────────────────────
async function launch() {
  if (WEBHOOK_URL) {
    const app = express();
    app.use(express.json());
    app.use(bot.webhookCallback("/webhook"));
    app.get("/", function(_req, res) { res.send("Claude AI Bot v4 - Auto-learning memory active!"); });
    await bot.telegram.setWebhook(WEBHOOK_URL + "/webhook");
    app.listen(PORT, function() {
      console.log("Webhook running on port " + PORT);
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
