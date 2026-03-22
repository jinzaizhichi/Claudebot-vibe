# Claude 大神 Telegram Bot

一个接入 Claude AI 的 Telegram 私人 AI 助理。带向量记忆、自动学习、网络搜索、图片识别。

Built by [@0xKingsKuan](https://x.com/0xKingsKuan)

-----

## 功能

- 智能对话 - 全 Claude AI 驱动
- 自动学习记忆 - 每次对话后自动更新记忆档案，越用越了解你
- 四层记忆架构:
  - soul.md - 你是谁（永久）
  - projects.md - 你的项目（永久）
  - tasks.md - 当前任务（动态更新）
  - notes.md - 重要笔记（动态更新）
  - 向量记忆 - 语义搜索历史信息
  - 对话摘要 - 自动压缩长对话
- 网络搜索 - 接入 Tavily，实时搜索 2026 最新资讯
- 图片识别 - 发图片直接分析
- 长内容输出 - 不会中途停止
- 多语言 - 你说什么语言它就回什么语言
- 24/7 云端运行

-----

## 需要准备

|服务                   |用途            |费用         |
|---------------------|--------------|-----------|
|Telegram @BotFather  |Bot Token     |免费         |
|console.anthropic.com|Claude API Key|需充值        |
|github.com           |存代码           |免费         |
|railway.app          |云端部署          |免费         |
|supabase.com         |数据库存记忆        |免费         |
|tavily.com           |网络搜索          |免费（每月1000次）|
|voyageai.com         |向量记忆          |免费         |

-----

## 部署步骤

### 第一步 - Telegram Bot Token

1. 搜索 @BotFather
1. 发 /newbot
1. 取名字和用户名（用户名以 bot 结尾）
1. 复制 Token

### 第二步 - Anthropic API Key

1. console.anthropic.com
1. API Keys -> Create Key
1. 复制保存

### 第三步 - Supabase 数据库

1. supabase.com 注册，新建项目
1. SQL Editor -> New query -> 粘贴以下内容 -> Run：

```sql
create extension if not exists vector;

create table if not exists conversations (
  id serial primary key,
  user_id bigint not null,
  role text not null,
  content text not null,
  created_at timestamp default now()
);

create table if not exists user_docs (
  id serial primary key,
  user_id bigint not null,
  doc_type text not null,
  content text not null,
  updated_at timestamp default now(),
  unique(user_id, doc_type)
);

create table if not exists conversation_summaries (
  id serial primary key,
  user_id bigint not null,
  summary text not null,
  message_count int default 0,
  created_at timestamp default now()
);

create table if not exists memories (
  id serial primary key,
  user_id bigint not null,
  content text not null,
  memory_type text default 'general',
  embedding vector(1024),
  created_at timestamp default now()
);

alter table public.conversations enable row level security;
alter table public.user_docs enable row level security;
alter table public.conversation_summaries enable row level security;
alter table public.memories enable row level security;
```

1. Settings -> API -> 复制 Project URL 和 anon public key

### 第四步 - Tavily API Key

1. tavily.com 注册
1. 复制 API Key

### 第五步 - Voyage API Key（向量记忆）

1. voyageai.com 注册
1. 复制 API Key

### 第六步 - 部署到 Railway

1. railway.app 用 GitHub 登录
1. New Project -> Deploy from GitHub repo
1. 选这个 repo

### 第七步 - 填入环境变量

Railway -> Variables：

|变量名              |说明                      |必填  |
|-----------------|------------------------|----|
|BOT_TOKEN        |Telegram Bot Token      |必填  |
|ANTHROPIC_API_KEY|Anthropic API Key       |必填  |
|WEBHOOK_URL      |先留空，第八步填                |必填  |
|SUPABASE_URL     |Supabase Project URL    |强烈建议|
|SUPABASE_KEY     |Supabase anon public key|强烈建议|
|TAVILY_API_KEY   |Tavily API Key          |可选  |
|VOYAGE_API_KEY   |Voyage API Key          |可选  |

### 第八步 - 设置 Webhook

1. Railway -> Settings -> Networking -> Generate Domain
1. 复制网址（https://xxx.railway.app）
1. 填入 WEBHOOK_URL（结尾不要加 /）
1. Railway 自动重新部署

### 第九步 - 测试

搜索你的 Bot -> 发 /start -> 开始对话！

建议第一件事：

```
/setsoul 你的名字和背景
/setprojects 你的项目列表
```

-----

## 命令列表

查看记忆：

- /memory - 完整记忆总览
- /soul - 查看 soul.md
- /projects - 查看项目
- /tasks - 查看任务
- /notes - 查看笔记
- /summaries - 查看对话摘要

手动更新：

- /setsoul [内容]
- /setprojects [内容]
- /settasks [内容]
- /note [内容] - 添加笔记
- /clearnotes - 清空笔记
- /summarize - 立即压缩摘要

管理：

- /forget - 清除对话历史（保留记忆档案）
- /reset - 清除所有内容

-----

## 文件结构

```
telegram-claude-bot/
├── bot.cjs
├── package.json
├── railway.json
├── .gitignore
└── README.md
```

-----

## 常见问题

Bot 没反应 - 检查三个必填变量是否都填了

Something went wrong - 检查 ANTHROPIC_API_KEY，确认账号有余额

记忆消失 - 确认 Supabase 四张表都建好了

搜索没用 - 确认 TAVILY_API_KEY 正确

部署失败 - 确认没有多余的 index.js 文件

-----

## 想改 Bot 性格？

打开 bot.cjs 找到 SYSTEM_PROMPT 修改即可。

-----

## License

MIT - 随意使用、修改、分享。

如果这个项目对你有帮助，欢迎 Star 和 Fork！
