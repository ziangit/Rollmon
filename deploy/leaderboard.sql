-- Leaderboard table (docs/ROADMAP.md §7). The function creates it on first
-- use (web/api/leaderboard.ts SCHEMA); kept here for reference and manual setup.
create table if not exists leaderboard (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  name text not null,
  score integer not null,
  wins smallint not null,
  battles smallint not null,
  seed bigint not null,
  team text[] not null,           -- drafted species ids in pick order
  handicap real not null,         -- team cost factor applied to the base points
  summary text not null,          -- the in-game record line
  proof jsonb not null,           -- RunProof: replayable without the search engine
  token text                      -- random per-browser token; one submission per (seed, token)
);
create index if not exists leaderboard_rank_idx on leaderboard (score desc, created_at asc);
create unique index if not exists leaderboard_run_idx on leaderboard (seed, token) where token is not null;
