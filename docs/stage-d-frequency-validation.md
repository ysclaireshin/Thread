# Stage D — Frequency Validation Protocol

**Status:** protocol ready. Conversations not yet run. Stage B is **gated on this.**

## Why this exists

Stage B (extraction-at-Save-My-Place — the system reads your session at the end and
proposes nodes instead of you tagging by hand) is a large build. It must not be
built until a real-user conversation confirms the assumption underneath it: **that
people return to interrupted analytical work often enough to want a tool for it.**

The only frequency evidence on record (`thread MAIN/HANDOFF.md`, pre-app) validated
the *general problem* frequency as **mixed** — strong for PhD / full-time
researchers, weak for occasional essay-writers. That is not enough to justify Stage
B, and it predates the product. Stage D generates an honest, falsifiable signal
that either unblocks Stage B or **cuts** it.

A negative result is a real, valuable outcome — not a failure. If people don't
return often, extraction isn't worth the confirm/reject overhead, and manual
Tab-to-tag stays as the only path.

## Hypothesis (both halves must hold to pass)

- **H1 — Frequency.** Target users repeatedly stop and return to the *same*
  in-progress analytical work — multiple returns across days/weeks as a norm — so
  re-entry is a recurring event, not a rare one.
- **H2 — Friction location.** The costly part is *organizing ideas into
  structure*, and doing it manually mid-writing is what breaks flow. (Both existing
  testers reported this; it is what motivates extraction.)

## Target segment

PhD students / full-time researchers / serious long-form analytical writers — the
HANDOFF's strong-frequency segment. **Do not** dilute the sample with occasional
essay-writers, where frequency was weak; a weak-segment "yes" would be a false
positive.

## Recruit (aim 3, minimum 1 real user)

- Stage 0 Reddit candidates named in the HANDOFF: `tc1991`, and the "3 hours
  scrolling" commenter.
- The two existing testers — but note their sessions established **H2 only**. H1
  (return frequency) must be probed with them explicitly; do not assume it.

## Interview — behavior-first, ~20–30 min

Ask about *past behavior* before any tool hypothetical, so we measure reality, not
politeness. Do not describe Stage B before question 5.

1. Walk me through the last analytical piece you wrote across more than one
   sitting. How many times did you stop and come back? Over what span?
2. When you sat back down, what did you do first — and how long until you were
   actually making progress again?
3. What specifically made re-entry slow or hard (if it was)?
4. When a distinct idea shows up while you write, what do you do with it now? Does
   organizing it interrupt you?
5. *(Only now, secondary — not the primary signal)* If something read your session
   and proposed the ideas back at the end, would that help or be noise?

## Pass / fail — fixed before running (do not move the goalposts)

| Verdict | Condition | Consequence |
|---|---|---|
| **PASS** | ≥2 of 3 users (or the 1 real user, strongly) independently show **H1 AND H2** | Unblock Stage B; begin Phase 2 of the plan |
| **MIXED** | Frequency real, but friction is elsewhere (e.g. re-entry legibility, which the Stage A legend/pin may already address) | **Do not** build extraction; re-evaluate |
| **FAIL** | Return is rare / one-shot for most | **Cut Stage B.** Tab-to-tag stays as the only path |

## After the conversations

1. Record raw notes + the verdict in [`stage-d-findings.md`](./stage-d-findings.md).
   The first numbers must be honest — no reframing a weak result as a pass.
2. Report the verdict. Only a logged **PASS** starts the Stage B build.
