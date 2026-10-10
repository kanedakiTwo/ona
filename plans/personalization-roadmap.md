# Personalization Roadmap

## Summary

Rebuild Mimoia's personalization layer in 9 tracks, shipped as 16 stacked PRs. The goal is to move Mimoia from AI-first / single-user to user-controllable / household-shared, without breaking production. Two PRs are load-bearing and must ship first; the rest can fan out from there.

## Load-bearing foundations (ship first, in parallel)

These two PRs unblock every other track. They don't touch each other so they can land in parallel.

- **PR 1 — Household foundation** ([detailed plan](./personalization-pr1-household.md))
  Adds `households` + `household_members` + `household_invites`. Every existing user gets backfilled into a solo household. Menus / shopping / pantry / favorites / cook logs all become household-scoped via the user's primary household. Invitation flow + `/household` page. Without this, every later feature has to redo scoping.

- **PR 2 — User memory foundation** ([detailed plan](./personalization-pr2-user-memory.md))
  First-class `user_memories` table (typed fact storage), `GET/PATCH/DELETE /memory` endpoints, a `/profile/memoria` editor page, and a memory-loader the advisor injects into every skill call. Track A's voice onboarding writes to this storage; the editor reads it back. Without this, the voice onboarding has nowhere to land.

## Dependency graph

```
                          ┌──────────────────────┐
                          │ PR 1 — Household     │
                          │   foundation          │
                          └──────┬───────────────┘
                                 │
        ┌────────────────────────┼──────────────────────┐
        │                        │                       │
        ▼                        ▼                       ▼
  ┌────────────┐         ┌──────────────┐        ┌─────────────────┐
  │ PR 5 — Menu│         │ PR 7 — Recipe│        │ PR 10 — Shopping│
  │   shaping  │         │ ownership +  │        │   power features│
  │ (B quick   │         │ notes/rating │        │ (D quick wins)  │
  │   wins)    │         └──────┬───────┘        └─────────┬───────┘
  └────────────┘                │                          │
                                ▼                          ▼
                         ┌──────────────┐          ┌──────────────────┐
                         │ PR 8 — Recipe│          │ PR 11 — Pantry   │
                         │  photos +    │          │ quantities + auto│
                         │  tags + col. │          │ decrement (E +D) │
                         └──────┬───────┘          └─────────┬────────┘
                                ▼                            │
                         ┌──────────────┐         ┌──────────┴─────────┐
                         │ PR 9 — Recipe│         │                    │
                         │  community   │         ▼                    ▼
                         │ public toggle│   ┌──────────────┐    ┌──────────────┐
                         └──────────────┘   │ PR 12 — Cook │    │ PR 13 — Ticket│
                                            │ from pantry  │    │   OCR + price │
                                            └──────────────┘    │   history    │
                                                                └──────────────┘

                          ┌──────────────────────┐
                          │ PR 2 — User memory   │
                          │   foundation          │
                          └──────┬───────────────┘
                                 │
                ┌────────────────┼────────────────┐
                │                │                 │
                ▼                ▼                 ▼
         ┌─────────────┐  ┌─────────────┐  ┌──────────────┐
         │ PR 3 — Voice│  │ PR 4 — Memo │  │ PR 15 — All  │
         │ onboarding  │  │ editor page │  │ assistant     │
         │ (Track A)   │  │ (Track A)   │  │ skills read   │
         └─────────────┘  └─────────────┘  │ memory        │
                                            └──────────────┘

PR 1 ──▶ PR 6 — Cook log (Track E) ──▶ PR 16 — Analytics (Track F)
PR 1 ──▶ PR 14 — Shopping real-time sync (Track H)
Standalone: PR 17 — Accessibility & UI polish (Track I)
```

## Full PR list

| # | Title | Depends on | Track | Est. size |
|---|---|---|---|---|
| 1 | Household foundation (households, members, invites, scoping) | — | H | XL |
| 2 | User memory foundation (table, API, advisor injection) | — | A | M |
| 3 | Voice onboarding (Realtime API + skill_extract_facts) | 2 | A/G | L |
| 4 | Memory editor page (`/profile/memoria`) | 2 | A | M |
| 5 | Menu shaping quick wins (veto, skip day, leftovers, pin meal type) | — | B | M |
| 6 | Cook log (`cook_logs` table, "esto lo cocinamos" UI, time tracking) | 1 | E | L |
| 7 | Recipe notes + rating + substitutions per (user, recipe) | 1 | C | M |
| 8 | Recipe photos + custom tags + collections / cookbooks | 7 | C | L |
| 9 | Recipe community: public/private + Comunidad scope | 8 | C | M |
| 10 | Shopping list power features (free items, reorder, staples, prices, history) | 1 | D | L |
| 11 | Pantry quantities + units + expiresAt + auto-decrement on cook | 1, 6 | D/E | M |
| 12 | "Cook from what I have" matcher | 11 | D | M |
| 13 | Ticket OCR → pantry update + price history | 11 | D | XL |
| 14 | Shopping real-time sync across household members (SSE) | 1, 10 | D/H | M |
| 15 | All advisor skills consume user_memory at call time | 2 | A/Advisor | S |
| 16 | Analytics: monthly trends, cost trends, adherence | 6, 13 | F | M |
| 17 | Accessibility & UI polish (dark mode, font scaling, print, voice-everywhere) | — | I | M |

Sizes: S ≈ 1 day, M ≈ 2–4 days, L ≈ 1 week, XL ≈ 2 weeks.

## Sequencing recommendation

**Week 1** — PR 1 + PR 2 in parallel (different agents, no overlap). Land both before anything else.

**Week 2** — PR 5 (zero-dependency, pure value, small risk). PR 3 + PR 4 stack on PR 2. Run together.

**Week 3** — PR 6 (cook log, unblocks pantry auto-decrement + analytics) + PR 7 (recipe notes, customer-visible win).

**Week 4** — PR 10 (shopping power features) + PR 8 (recipe photos / tags / collections). Both shippable, mostly independent.

**Month 2** — PR 11 → 12 → 13 chain (pantry path culminates in OCR). PR 14 (real-time sync). PR 9 (community).

**Month 3** — PR 15 (advisor reads memory everywhere) + PR 16 (analytics) + PR 17 (a11y).

## Cross-cutting invariants

These apply to **every PR** below; they aren't tasks per-PR.

- **Spec gate**: every PR updates the relevant `specs/*.md` in the same commit. New tables → schema doc + new spec where needed. The spec describes the *current* reality of the code, not the future plan.
- **Test gate**: each PR ships at least one test that would fail if the bug returned. Unit tests for pure logic, integration / Playwright for multi-step flows. TDD where it pays (matchers, scorers, validators).
- **Production safety**: zero-downtime migrations only. Always nullable-add → backfill → set NOT NULL. Never `DROP COLUMN` without a deprecation cycle.
- **Mobile-first**: every UI change tested at 390×844 via Playwright MCP.
- **Spanish copy**: all user-facing strings in Spanish (Spain dialect: "comida" for lunch, "cena" for dinner, "merienda" for snack).
- **Editorial design tokens**: cream `#FAF6EE`, ink `#1A1612`, terracotta `#C65D38`, forest `#2D6A4F`. Use `@theme` tokens from `globals.css`.

## What lands first if you can only afford one PR

**PR 1 (household)**. It's the riskiest migration in the whole plan and it has to land before any other family-aware feature. If we delay it past two more PRs, we'll have to redo data scoping in those PRs to add household-awareness retroactively. Better to take the hit once.

PR 5 (menu shaping quick wins) is the cheapest customer-visible value with zero dependencies — pair it with PR 1 if there's bandwidth on a second agent.

## How to use these plans

1. Each detailed plan (`personalization-prN-*.md`) follows the implementation-plan template: flat task list ending in verification.
2. Run `/test-driven-development` against the chosen PR's plan to enter execution mode.
3. After each PR ships, refresh this roadmap (cross out completed PRs, adjust priorities based on user feedback).
