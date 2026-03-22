# Claude 大神 Telegram Bot

一个接入 Claude AI 的 Telegram 智能助手。支持多轮对话、网络搜索、图片识别、永久记忆。

Built by [@0xKingsKuan](https://x.com/0xKingsKuan)

-----

## 功能

- 智能对话 - 全 Claude AI 驱动，回答任何问题
- 永久记忆 - 用 Supabase 数据库存储，重启不丢失
- 网络搜索 - 接入 Tavily，实时搜索最新资讯
- 图片识别 - 发图片给它，它能看懂并分析
- 长内容输出 - 写文案、写脚本一次输出完，不会中断
- 多语言 - 你用什么语言说话，它就用什么语言回答
- 24/7 运行 - 部署在云端，随时可用

-----

## 你需要准备的

- Telegram Bot Token（从 @BotFather 获取，免费）
- Anthropic API Key（从 console.anthropic.com 获取，需充值）
- GitHub 账号（免费）
- Railway 账号（免费，不需要信用卡）
- Supabase 账号（免费，永久记忆用）
- Tavily 账号（免费，网络搜索用）

-----

## 部署步骤

### 第一步 - 获取 Telegram Bot Token

1. 打开 Telegram，搜索 @BotFather
1. 发送 /newbot
1. 给 Bot 取名字和用户名（用户名必须以 bot 结尾）
1. 复制保存 Token

### 第二步 - 获取 Anthropic API Key

1. 打开 https://console.anthropic.com
1. 注册或登录
1. 左侧菜单点 API Keys -> Create Key
1. 复制保存

### 第三步 - 建 Supabase 数据库（永久记忆）

1. 打开 https://supabase.com，注册并新建项目
1. 左边菜单点 SQL Editor -> New query
1. 粘贴以下 SQL，点 Run：

```sql
create table conversations (
  id serial primary key,
  user_id bigint not null,
  role text not null,
  content text not null,
  created_at timestamp default now()
);

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
```

1. 看到 Success 后，左边菜单点 Settings -> API
1. 复制 Project URL 和 anon public key

### 第四步 - 获取 Tavily API Key（网络搜索）

1. 打开 https://tavily.com，注册（免费，每月 1000 次）
1. 复制 API Key

### 第五步 - 部署到 Railway

1. 打开 https://railway.app，用 GitHub 账号登录
1. 点 New Project -> Deploy from GitHub repo
1. 选择这个 repo
1. Railway 自动开始构建

### 第六步 - 填入环境变量

Railway -> 你的项目 -> Variables，添加以下变量：

|变量名              |填什么                     |是否必填|
|-----------------|------------------------|----|
|BOT_TOKEN        |Telegram Bot Token      |必填  |
|ANTHROPIC_API_KEY|Anthropic API Key       |必填  |
|WEBHOOK_URL      |先留空，第七步填                |必填  |
|SUPABASE_URL     |Supabase Project URL    |可选  |
|SUPABASE_KEY     |Supabase anon public key|可选  |
|TAVILY_API_KEY   |Tavily API Key          |可选  |

没有 Supabase 和 Tavily 也能跑，记忆重启后清空，搜索功能关闭。

### 第七步 - 设置 Webhook

1. Railway -> Settings -> Networking -> Generate Domain
1. 复制生成的网址（格式：https://xxx.railway.app）
1. 回到 Variables，填入 WEBHOOK_URL（结尾不要加 /）
1. Railway 自动重新部署

### 第八步 - 测试

打开 Telegram，搜索你的 Bot，发送 /start，开始对话！

-----

## Bot 命令

|命令    |说明    |
|------|------|
|/start|开始对话  |
|/help |查看功能说明|
|/reset|清除对话记忆|

-----

## 文件结构

```
telegram-claude-bot/
├── bot.cjs          主程序
├── package.json     依赖配置
├── railway.json     Railway 部署配置
├── .gitignore       忽略敏感文件
└── README.md        说明文档
```

-----

## 常见问题

Bot 没反应 - 检查 Railway Logs，确认三个必填变量都填了

Something went wrong - 检查 ANTHROPIC_API_KEY 是否正确，账号是否有余额

记忆没有保存 - 确认 SUPABASE_URL 和 SUPABASE_KEY 填对了，conversations 表已建好

搜索没有用 - 确认 TAVILY_API_KEY 填了，Tavily 账号有剩余额度

部署失败 - 确认 repo 里有 bot.cjs 和 package.json，没有多余的 index.js

-----

## 想改 Bot 的性格？

打开 bot.cjs，找到 SYSTEM_PROMPT 这段，改成你想要的人设就行。

-----

## License

MIT - 随意使用、修改、分享。

-----

如果这个项目对你有帮助，欢迎 Star 和 Fork！
