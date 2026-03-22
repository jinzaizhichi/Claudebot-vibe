-- 开启向量扩展（已经做过了，跳过没关系）
create extension if not exists vector;

-- 建向量记忆表
create table if not exists memories (
  id serial primary key,
  user_id bigint not null,
  content text not null,
  memory_type text default 'general',
  embedding vector(1024),
  created_at timestamp default now()
);

-- 开启安全
alter table public.memories enable row level security;

-- 建向量搜索函数
create or replace function match_memories(
  query_embedding text,
  match_user_id bigint,
  match_count int default 10
)
returns table(content text, similarity float)
language plpgsql
as $$
begin
  return query
  select
    memories.content,
    1 - (memories.embedding <=> query_embedding::vector) as similarity
  from memories
  where memories.user_id = match_user_id
    and memories.embedding is not null
  order by memories.embedding <=> query_embedding::vector
  limit match_count;
end;
$$;
