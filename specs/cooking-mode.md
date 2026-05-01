# Cooking Mode

Hands-free, fullscreen step-by-step cooking experience driven from a recipe.

## User Capabilities

- Users can enter cooking mode from any recipe detail view via a "Empezar a cocinar" button
- Cooking mode opens fullscreen, hides bottom navigation, and keeps the screen on while active (Wake Lock)
- Users see one preparation step at a time, in large readable type
- Users can swipe (or tap arrows) to advance to the next step or go back
- Users see the index of the current step ("3 / 6") and a thin progress bar
- Users see the ingredients used in the current step inline, with the live-scaled quantity (e.g. "200 g cebolla")
- Users can tap any ingredient in the current step to mark it as added (visual checkmark, persists for the cooking session)
- Users can start a per-step countdown timer when the step has a duration; the timer announces completion with sound + haptic and unlocks the swipe to the next step visually
- Users can pause/resume the timer
- Users see the step temperature and technique (when present) as small badges next to the step header
- Users can switch the diners count from inside cooking mode without losing their place; quantities re-scale live
- Users can exit cooking mode at any time; the wake lock is released and the app returns to the recipe detail
- A persistent "ingredients checklist" panel is reachable with one tap and shows the full ingredient list with checkmarks across all steps

## Display

- Step text uses display typography sized for at-arm's-length reading (≥ 1.4rem on mobile)
- Each step's `temperature` (e.g. "180 °C") and `technique` (e.g. "sofreír") render as compact pills above the text
- Inline ingredient chips are derived from `step.ingredientRefs`; when an ingredient is referenced multiple times in the recipe, the chip shows the quantity intended for that step (split equally across step references unless otherwise specified)
- The next-step preview is hinted (faded next instruction below the active one) so the user can read ahead while finishing the current task

## Timers

- A timer button appears only on steps with `step.durationMin` set
- Multiple timers can run concurrently (e.g. step 3 says "hornear 30 min", step 4 starts in parallel) — visible as floating chips at the top
- When a timer fires:
  - The phone vibrates (Vibration API)
  - A soft chime plays (respects the OS silent switch — no override)
  - A persistent banner appears at the top until the user dismisses it
- Timers persist if the user backgrounds the app and resumes (timestamp-based; not interval-based)

## Scaling Inside Cooking Mode

- The diners count carried over from the recipe detail is the source of truth
- Adjusting it inside cooking mode immediately re-renders all inline quantities and the ingredients panel
- Already-checked ingredients stay checked (the user's intent doesn't change just because they recalibrated)

## Wake Lock

- A `screen` Wake Lock is requested on entry; released on exit, on backgrounding the tab for > 30 s, or on user-initiated exit
- Failure to acquire the lock is silently tolerated (older browsers); the rest of the experience still works

## Constraints

- Cooking mode is **read-only**: it never mutates the underlying recipe
- The session state (current step, timers, checklist) is held in memory; closing the tab discards it (no persistence)
- The user must have at least one step in the recipe; recipes with zero steps cannot enter cooking mode
- Cooking mode does not require auth; any logged-in user with access to a recipe can use it
- Cooking mode must remain fully usable in landscape and with one hand (large hit targets, primary controls within thumb reach)

## Related specs

- [Recipes](./recipes.md) — the data model that drives cooking mode (`step.durationMin`, `ingredientRefs`, scaling)
- [Voice Mode](./voice-mode.md) — eventually integrates with cooking mode for "Hola Ona, siguiente paso" hands-free control
- [PWA](./pwa.md) — Wake Lock and Vibration are scoped to PWA-class features
- [Design System](./design-system.md) — typography and chip styles

## Source (planned)

- [apps/web/src/app/recipes/[id]/cook/page.tsx](../apps/web/src/app/recipes/[id]/cook/page.tsx) — cooking mode route
- [apps/web/src/components/cooking/](../apps/web/src/components/cooking/) — `CookingShell`, `StepCard`, `StepTimer`, `IngredientChip`, `ChecklistPanel`
- [apps/web/src/hooks/useWakeLock.ts](../apps/web/src/hooks/useWakeLock.ts)
- [apps/web/src/hooks/useStepTimers.ts](../apps/web/src/hooks/useStepTimers.ts)
