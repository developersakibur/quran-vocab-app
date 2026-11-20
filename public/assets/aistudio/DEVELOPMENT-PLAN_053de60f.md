# Quran Vocabulary App — Development Plan

> Status: Proposed roadmap | Stack: Vanilla JS, HTML, CSS, PWA, IndexedDB, Supabase

## 1. Confirmed product decisions

| Area | Decision |
|---|---|
| Account | Required login |
| Authentication | Supabase Auth |
| Storage | Hybrid: IndexedDB + Supabase PostgreSQL |
| Quran content | Versioned static JSON, cached locally |
| Vocabulary Sets | One global frequency-ranked list |
| Repeated Words | One question per unique vocabulary item; show all occurrences |
| Ayah Practice | Word-by-word |
| Vocabulary set size | 10 unique items |
| Existing Surah set size | Preserve current 20-item behavior |
| SM-2 | Vocabulary-level |
| Ayah progress | Occurrence-level |

## 2. Target architecture

```text
User
 └─ Supabase Auth (required account)
     └─ Quran Vocabulary PWA
         ├─ UI and feature modules
         ├─ Repositories
         │   └─ IndexedDB (immediate local reads/writes)
         ├─ Durable Sync Queue
         │   └─ Sync Engine
         │       └─ Supabase PostgreSQL
         ├─ Versioned Quran/vocabulary JSON
         └─ Service Worker and audio cache
```

### Architecture principles

1. Local-first: save user actions to IndexedDB immediately; never wait for a network round trip to update the UI.
2. Cloud-synced: upload pending changes when online and an authenticated session is available.
3. Repository boundary: features use repositories; only the cloud/sync layer talks to Supabase.
4. Idempotency: retrying the same event must not duplicate review history or side effects.
5. Security: every private cloud record is scoped to `auth.uid()` and protected by RLS.
6. Versioning: shared Quran content and vocabulary datasets are versioned independently of user progress.
7. Offline access: an already authenticated device may continue supported offline workflows. First-time sign-in on a new device requires internet.

## 3. Data placement

| Data | IndexedDB | Supabase |
|---|---:|---:|
| Surah/Ayah content | Cache | No per-user copy |
| Vocabulary dataset/mapping | Cache | No per-user copy |
| Profile/preferences | Cache | Yes |
| Vocabulary SM-2 progress | Yes | Yes |
| Vocabulary set progress | Yes | Yes |
| Ayah occurrence progress | Yes | Yes |
| Review history | Yes | Yes |
| Bookmarks and notes | Yes | Yes |
| Pending sync queue | Yes | No |
| Sync metadata | Yes | No |

Keep shared Quran content in versioned static JSON. Do not duplicate the full Quran dataset in every user's private database records.

## 4. Proposed Supabase tables

- `profiles`: display name, locale, timezone, preferences.
- `vocabulary_progress`: one current SM-2 record per `(user_id, word_id)`.
- `vocabulary_set_progress`: set completion and state.
- `ayah_progress`: occurrence-level learning state.
- `review_history`: append-only review events with unique event IDs.
- `bookmarks`: stable bookmark records.
- `notes`: stable note IDs and update metadata.

All user-owned tables need `user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE`, suitable indexes/constraints, and RLS for SELECT, INSERT, UPDATE, DELETE. Policies must enforce `auth.uid() = user_id`. Never put the Supabase `service_role` key in frontend code.

Example starting schema:

```sql
create table public.vocabulary_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  word_id text not null,
  repetitions integer not null default 0,
  ease_factor numeric not null default 2.5,
  interval integer not null default 0,
  next_review_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, word_id)
);

alter table public.vocabulary_progress enable row level security;

create policy "read own vocabulary progress"
on public.vocabulary_progress for select
using (auth.uid() = user_id);

create policy "insert own vocabulary progress"
on public.vocabulary_progress for insert
with check (auth.uid() = user_id);

create policy "update own vocabulary progress"
on public.vocabulary_progress for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "delete own vocabulary progress"
on public.vocabulary_progress for delete
using (auth.uid() = user_id);
```

This is an example, not the complete production migration. Test RLS for every table and operation.

## 5. IndexedDB migration

The current app uses IndexedDB v2. Audit the full schema before upgrading to the next version (e.g. v3).

Add/formalize stores:
- `vocabulary`
- `vocabulary_sets`
- `ayah_progress`
- `review_history`
- `sync_queue`
- `sync_metadata`

Retain existing stores such as `words`, `ayahs`, `word_progress`, `weak_words`, `bookmarks`, `notes`, and `activity` where needed.

Migration rules:
1. Never delete existing user data during upgrade.
2. Provide a recoverable migration/backup path.
3. Map old occurrence-based records to canonical vocabulary IDs using the generated mapping.
4. Preserve unmapped legacy records for later review.
5. Merge duplicate progress deterministically and document the rule.
6. Keep vocabulary-level SM-2 separate from occurrence-level Ayah progress.
7. Validate counts and keys before marking migration complete.
8. Make migration safe to resume after interruption.

## 6. Authentication flow

1. Sign up with email/password.
2. Verify email according to Supabase Auth settings.
3. Sign in and restore session.
4. Pull/reconcile cloud data with local data.
5. Open the learning app.

Also implement sign out, forgot/reset password, session expiry handling, protected views, account deletion, and clear network/auth error states. A new device cannot complete first-time authentication offline.

## 7. Sync design

### Local write flow

1. Save the learning action to IndexedDB.
2. Create a durable event with unique `event_id`.
3. Add it to `sync_queue`.
4. Attempt upload if online and authenticated.
5. Acknowledge/remove it only after server success.
6. On failure, retain it and retry with backoff.

Example event:

```js
{
  event_id: "uuid",
  user_id: "authenticated-user-uuid",
  type: "vocabulary_review",
  entity_id: "vocab_00001",
  payload: { quality: 4, reviewed_at: "2026-11-07T10:00:00Z" },
  created_at: "2026-11-07T10:00:00Z",
  status: "pending",
  retry_count: 0
}
```

### Conflict rules

- Review history: append-only; deduplicate by `event_id`.
- SM-2: do not blindly use last-write-wins across devices. Reconcile deterministically from ordered review events or a trusted server-side rule.
- Bookmarks: stable key and explicit add/remove mutations.
- Notes: stable IDs, revisions or conflict copies to prevent silent loss.
- Set progress: define completion/reset events explicitly.
- Prefer server timestamps; client clocks alone are not a safe ordering authority.

Show truthful sync states: Synced, Syncing, Offline (saved locally), and Sync failed (will retry). Never show cloud success before server acknowledgement.

## 8. Vocabulary and practice data

Unique Vocabulary and Quranic Occurrences are separate entities.

- Stable `word_id` identifies canonical vocabulary.
- Occurrence key identifies one position in an Ayah (e.g. `1:1:3`).
- Frequency is the number of mapped Quranic occurrences.
- Root alone must never be the only duplicate-detection key.
- Same root but different lemma/grammatical identity may remain separate.
- Generate global frequency ranking at build time, not in the browser.

Suggested generated files:
- `data/vocabulary/vocabulary-index.json`
- `data/vocabulary/vocabulary-words.json`
- `data/vocabulary/vocabulary-mapping.json`

Vocabulary Sets:
- One global frequency-ranked list.
- 10 unique words per set.
- Stable IDs even if frequency ranking changes.
- Flashcards, MCQ, and Fill-in-the-blank engines.

Repeated Words:
- One learning item per unique vocabulary.
- Show every mapped Ayah occurrence and context.

Ayah Practice:
- Word-by-word questions in Quranic order.
- Occurrence-level progress.
- The same vocabulary can recur in another Ayah as a separate occurrence.
- Aim for 10 questions per session without splitting an Ayah mid-way.
- Apply one final vocabulary-level SM-2 grade per vocabulary item per session, not duplicate grades for repeated occurrences.

## 9. Suggested module boundaries

```text
js/
  auth/       auth-manager.js, session-manager.js, auth-guard.js
  cloud/      supabase-client.js, profile-repository.js, progress-repository.js
  db/         quran-db.js, migrations/
  sync/       sync-manager.js, sync-queue.js, sync-engine.js,
              conflict-resolver.js, connectivity-manager.js
  data/       vocabulary-repository.js, word-repository.js
  vocabulary/ vocabulary-builder.js, vocabulary-set-manager.js,
              occurrence-manager.js
  practice/   practice-generator.js, vocabulary-practice.js, ayah-practice.js
  audio-manager.js
```

Adapt to the current repository. Do not move files blindly or break existing modules.

## 10. Implementation phases

### Phase 0 — Repository audit
- Record current DB schema, entry points, service worker behavior, and data formats.
- Identify progress/bookmark keys and add a regression checklist.
- Verify Quran metadata and vocabulary source fields.

### Phase 1 — Supabase foundation
- Create project and configure Auth, verification, redirect URLs, password reset.
- Set environment configuration without committing secrets.
- Create SQL migrations, indexes, constraints, and RLS.
- Test isolation with two separate users.

### Phase 2 — Authentication
- Build sign-up, sign-in, verification, reset, sign-out.
- Add session restoration and route guards.
- Test unauthenticated access and auth error states.

### Phase 3 — IndexedDB migration
- Upgrade DB version and add stores/indexes.
- Migrate existing user data without loss.
- Test with realistic v2 database snapshots.

### Phase 4 — Cloud repositories
- Implement profile and user-data repositories.
- Keep feature modules independent of Supabase SDK details.
- Add safe cloud read/upsert/delete operations under RLS.

### Phase 5 — Sync engine
- Implement durable queue, event IDs, retry/backoff, acknowledgement, and pull reconciliation.
- Add sync status UI.
- Test retries, offline/online transitions, and two-device changes.

### Phase 6 — Vocabulary data pipeline
- Audit morphology and canonical lemma rules.
- Generate stable IDs and occurrence mapping.
- Verify frequency totals and global order.
- Generate versioned JSON assets.

### Phase 7 — Practice integration
- Implement global Vocabulary Sets and Repeated Words contexts.
- Implement word-by-word Ayah practice.
- Separate SM-2 from occurrence progress.
- Integrate bookmarks, notes, and review history.

### Phase 8 — PWA and release
- Verify service worker versioning and old-cache cleanup.
- Test offline app shell/content, update flow, and storage quota.
- Run accessibility, responsive, security, and multi-device QA.
- Establish backup, monitoring, and account deletion procedures.

## 11. Acceptance criteria

- [ ] Sign-up, verification, sign-in, sign-out, and password reset work.
- [ ] Unauthenticated users cannot access protected learning views.
- [ ] Previously authenticated users can use supported offline workflows.
- [ ] Every local learning action saves before network sync.
- [ ] Failed events remain queued and retry safely.
- [ ] Replaying an event does not duplicate review history.
- [ ] Users cannot read or mutate another user's private data.
- [ ] Existing local progress survives DB migration.
- [ ] Vocabulary IDs remain stable across dataset rebuilds.
- [ ] Frequency and occurrence mapping pass validation.
- [ ] SM-2 and Ayah occurrence progress remain separate.
- [ ] Multi-device sync does not silently overwrite reviews or notes.
- [ ] Offline/syncing/synced/error states are accurate.
- [ ] Service worker updates do not leave incompatible cached assets.

## 12. Delivery rule

Implement one phase at a time: inspect current code, make a focused change, test it, check regressions, and update this plan. A phase is complete only when its acceptance checks pass.
