# Claude 大神 Telegram Bot

一个接入 Claude AI 的 Telegram 智能助手，支持多轮对话、内容总结、多语言回复。

Built by [@0xKingsKuan](https://x.com/0xKingsKuan)

---

## 功能

- 智能对话 — 全 Claude AI 驱动，回答任何问题
- 记忆上下文 — 记住最近 20 条对话记录
- 内容总结 — 发给它一段长文，它帮你总结
- 多语言 — 你用什么语言说话，它就用什么语言回答
- 24/7 运行 — 部署在云端，随时可用

---

## 你需要准备的

- Telegram Bot Token（从 @BotFather 获取，免费）
- Anthropic API Key（从 console.anthropic.com 获取，需充值）
- GitHub 账号（免费）
- Railway 账号（免费，不需要信用卡）

---

## 部署步骤

### 第一步 — 获取 Telegram Bot Token

1. 打开 Telegram，搜索 @BotFather
2. 发送 /newbot
3. 给 Bot 取名字，例如：My Claude Assistant
4. 给 Bot 取用户名，例如：myclaudebot（必须以 bot 结尾）
5. BotFather 会给你一串 Token，复制保存好

### 第二步 — 获取 Anthropic API Key

1. 打开 https://console.anthropic.com
2. 注册或登录
3. 左侧菜单点 API Keys
4. 点 Create Key，复制保存好

### 第三步 — 部署到 Railway

1. 打开 https://railway.app，用 GitHub 账号登录
2. 点 New Project → Deploy from GitHub repo
3. 选择这个 repo
4. Railway 自动开始构建

### 第四步 — 填入环境变量

Railway → 你的项目 → Variables 标签，添加以下 3 个变量：

| 变量名 | 填什么 |
|---|---|
| BOT_TOKEN | 你的 Telegram Bot Token |
| ANTHROPIC_API_KEY | 你的 Anthropic API Key |
| WEBHOOK_URL | 先留空，第五步填 |

### 第五步 — 设置 Webhook

1. Railway → 你的项目 → Settings → Networking
2. 点 Generate Domain，复制生成的网址
3. 格式类似：https://telegram-claude-bot-production.up.railway.app
4. 回到 Variables，把这个网址填入 WEBHOOK_URL（结尾不要加 /）
5. Railway 自动重新部署

### 第六步 — 测试

打开 Telegram，搜索你的 Bot 用户名，发送 /start，开始对话！

---

## Bot 命令

| 命令 | 说明 |
|---|---|
| /start | 开始对话 |
| /help | 查看功能说明 |
| /reset | 清除对话记忆，重新开始 |

不需要命令，直接说话也可以。

---

## 文件结构

```
telegram-claude-bot/
├── bot.cjs          主程序
├── package.json     依赖配置
├── railway.json     Railway 部署配置
├── .gitignore       忽略敏感文件
└── README.md        说明文档
```

---

## 常见问题

**Bot 没反应？**
检查 Railway Logs，确认 3 个环境变量都填了，WEBHOOK_URL 格式正确。

**Something went wrong 报错？**
检查 ANTHROPIC_API_KEY 是否正确，账号是否有余额。

**部署失败？**
确认 repo 里有 bot.cjs 和 package.json，没有多余的 index.js。

---

## 想自己改 Bot 的性格？

打开 bot.cjs，找到 SYSTEM_PROMPT 这段，改成你想要的人设就行。

---

## License

MIT — 随意使用、修改、分享。

---

如果这个项目对你有帮助，欢迎 Star ⭐ 和 Fork！
