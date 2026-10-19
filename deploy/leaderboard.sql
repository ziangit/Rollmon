-- Leaderboard tables (docs/ROADMAP.md §7). The function creates and migrates
-- them on first use (web/api/leaderboard.ts SCHEMA); kept here for reference.
create table if not exists users (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  name text not null,             -- display spelling, 1–18 characters
  name_id text not null unique,   -- Showdown-style identity: lowercase letters and digits only
  password_hash text not null,    -- scrypt$<salt>$<key>
  ip_hash text                    -- keyed hash of the sign-up address; counts sign-ups per network per day
);
create index if not exists users_signup_idx on users (ip_hash, created_at);

create table if not exists leaderboard (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  user_id bigint not null references users (id),
  name text not null,             -- the account's display name at submission time
  score integer not null,
  wins smallint not null,
  battles smallint not null,
  seed bigint not null,
  team text[] not null,           -- drafted species ids in pick order
  handicap real not null,         -- team cost factor applied to the base points
  summary text not null,          -- the in-game record line
  proof jsonb not null            -- RunProof: replayable without the search engine
);
create index if not exists leaderboard_rank_idx on leaderboard (score desc, created_at asc);
create index if not exists leaderboard_user_idx on leaderboard (user_id, score desc, created_at asc);
create unique index if not exists leaderboard_user_run_idx on leaderboard (user_id, seed);  -- one submission per run per account
-- The board lists each player's best row: select distinct on (user_id) ... order by user_id, score desc, created_at asc.
