-- ============================================================================
-- Fix missing FK relationships & column — three live 400 errors
--
-- 1. post_comments.user_id missing FK to profiles.id
--    → query uses profiles!user_id(...) → "no relationship found" (400)
-- 2. live_sessions.host_id missing FK to profiles.id
--    → query uses *, profiles(...) → 400
-- 3. live_messages.user_id missing FK to profiles.id
--    → query uses *, profiles(...) → 400
-- 4. profiles.news_last_seen missing column
--    → BottomNav / News read/update this column → 400
--
-- Also pre-adds FKs for other tables that use implicit profiles(...) joins
-- to prevent the same error from surfacing later.
-- ============================================================================

-- Each ADD CONSTRAINT is wrapped in a DO block with exception handling
-- so the script is idempotent (safe to run multiple times).

-- 1. post_comments.user_id → profiles.id
do $$ begin
  alter table post_comments
    add constraint fk_post_comments_user
    foreign key (user_id) references profiles(id) on delete cascade;
exception when duplicate_object then null;
end $$;

-- 2. live_sessions.host_id → profiles.id
do $$ begin
  alter table live_sessions
    add constraint fk_live_sessions_host
    foreign key (host_id) references profiles(id) on delete cascade;
exception when duplicate_object then null;
end $$;

-- 3. live_messages.user_id → profiles.id
do $$ begin
  alter table live_messages
    add constraint fk_live_messages_user
    foreign key (user_id) references profiles(id) on delete cascade;
exception when duplicate_object then null;
end $$;

-- 4. posts.user_id → profiles.id (uses profiles!user_id(...) same as post_comments)
do $$ begin
  alter table posts
    add constraint fk_posts_user
    foreign key (user_id) references profiles(id) on delete cascade;
exception when duplicate_object then null;
end $$;

-- 5. live_reactions.user_id → profiles.id
do $$ begin
  alter table live_reactions
    add constraint fk_live_reactions_user
    foreign key (user_id) references profiles(id) on delete cascade;
exception when duplicate_object then null;
end $$;

-- 6. live_shares.user_id → profiles.id
do $$ begin
  alter table live_shares
    add constraint fk_live_shares_user
    foreign key (user_id) references profiles(id) on delete cascade;
exception when duplicate_object then null;
end $$;

-- 7. live_views.user_id → profiles.id
do $$ begin
  alter table live_views
    add constraint fk_live_views_user
    foreign key (user_id) references profiles(id) on delete cascade;
exception when duplicate_object then null;
end $$;

-- 8. live_items.sender_id → profiles.id
do $$ begin
  alter table live_items
    add constraint fk_live_items_sender
    foreign key (sender_id) references profiles(id) on delete cascade;
exception when duplicate_object then null;
end $$;

-- 9. live_comments.user_id → profiles.id
do $$ begin
  alter table live_comments
    add constraint fk_live_comments_user
    foreign key (user_id) references profiles(id) on delete cascade;
exception when duplicate_object then null;
end $$;

-- 10. live_participants.user_id → profiles.id
do $$ begin
  alter table live_participants
    add constraint fk_live_participants_user
    foreign key (user_id) references profiles(id) on delete cascade;
exception when duplicate_object then null;
end $$;

-- 11. news.author_id → profiles.id
do $$ begin
  alter table news
    add constraint fk_news_author
    foreign key (author_id) references profiles(id) on delete cascade;
exception when duplicate_object then null;
end $$;

-- 12. news_comments.user_id → profiles.id
do $$ begin
  alter table news_comments
    add constraint fk_news_comments_user
    foreign key (user_id) references profiles(id) on delete cascade;
exception when duplicate_object then null;
end $$;

-- 13. user_subscriptions.subscriber_id → profiles.id
do $$ begin
  alter table user_subscriptions
    add constraint fk_user_subscriptions_subscriber
    foreign key (subscriber_id) references profiles(id) on delete cascade;
exception when duplicate_object then null;
end $$;

-- 14. stories.user_id → profiles.id
do $$ begin
  alter table stories
    add constraint fk_stories_user
    foreign key (user_id) references profiles(id) on delete cascade;
exception when duplicate_object then null;
end $$;

-- 15. gifts.sender_id → profiles.id (uses profiles:sender_id(...))
do $$ begin
  alter table gifts
    add constraint fk_gifts_sender
    foreign key (sender_id) references profiles(id) on delete cascade;
exception when duplicate_object then null;
end $$;

-- 16. playlists.owner_id → profiles.id (uses profiles:owner_id(...))
do $$ begin
  alter table playlists
    add constraint fk_playlists_owner
    foreign key (owner_id) references profiles(id) on delete cascade;
exception when duplicate_object then null;
end $$;

-- 17. news_last_seen column on profiles
alter table profiles
  add column if not exists news_last_seen timestamptz;