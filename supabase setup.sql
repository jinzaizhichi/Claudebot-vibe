-- 第一步：建对话记录表（如果你之前建过就跳过这段）
create table if not exists conversations (
  id serial primary key,
  user_id bigint not null,
  role text not null,
  content text not null,
  created_at timestamp default now()
);

-- 第二步：建 .md 文件存储表
create table if not exists user_docs (
  id serial primary key,
  user_id bigint not null,
  doc_type text not null,
  content text not null,
  updated_at timestamp default now(),
  unique(user_id, doc_type)
);

-- 第三步：建对话摘要表
create table if not exists conversation_summaries (
  id serial primary key,
  user_id bigint not null,
  summary text not null,
  message_count int default 0,
  created_at timestamp default now()
);

-- 第四步：开启安全
alter table public.conversations enable row level security;
alter table public.user_docs enable row level security;
alter table public.conversation_summaries enable row level security;
