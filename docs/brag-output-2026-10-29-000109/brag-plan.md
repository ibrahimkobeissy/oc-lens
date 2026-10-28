# oc-lens: brag plan (first public post)

## Rubric
- **What:** oc-lens is a local, read-only analytics dashboard for your opencode history. Run it with `npx oc-lens`.
- **For:** opencode users who want to know where the agent looped, where provider failures cost them, and where the tokens went.
- **Different:** it matches loops on the *same* call with the *same* input, never just the tool name. It traces failures down to retries opencode hides inside a step. It prices tokens only with your own rates, so an unpriced model reads "not priced", never $0.00. It runs 100% locally, read-only, with no telemetry.
- **Most impressive claim:** "≈112,468 tokens the provider accepted that opencode never recorded" (a real card in the audit, from the synthetic demo DB).
- **Visual hook:** the same failing command slams onto the screen four times, then a giant ×4.
- **Real UI:** the light-mode Loops, Provider audit, Overview and Session replay screenshots from `docs/screenshots/`. These come from the synthetic demo database, so no real history appears.
- **Tone:** freeform direction: bright, kinetic, eye-catching, light mode only. Mapped to `default`/`app-store` pacing, with punchier cuts.
- **Caption:** "Your agent ran the same failing test 4 times. oc-lens shows you where."

## Angle
The model looping for nothing is the pain everyone's felt. Open on it, then show oc-lens catching it, pricing it, and marking it in place.

## Visual identity (light only)
- Background: the app's `#f4f7fb` with its faint grid. Large drifting pastel blobs in blue `#93c5fd`, violet `#c4b5fd`, cyan `#67e8f9` and a little amber.
- Ink: navy `#14213d`. Brand: `#1e40af` / `#2563eb`. Failure: `#dc2626`. Marker highlight: yellow `#fde047`.
- Type: Fira Mono Medium for display (the app's display face is mono), Fira Sans for body.
- Logo: blue rounded square with the lucide Activity pulse, as in the sidebar.
- Screenshots sit in white browser frames with soft shadows and 3D tilt, and zoom into the exact rows and cards being discussed.
- Transitions: a saturated blue diagonal wipe at the act breaks. Elsewhere old content leaves before new content arrives, with no muddy crossfades.

## Music: 120 BPM (beat 0.5 s, bar 2 s), C major, I–V–vi–IV
Kick lands on the hook cards, then the full groove drops at 4.0 s. Effects are pitched in key: plucks on card lands, filtered-noise whooshes at the cuts, and a final chord ring-out.

## Storyboard (22.0 s)
| Time | Scene | On screen | Motion / sound |
|---|---|---|---|
| 0.0–3.5 | Hook | "Your agent ran the same failing test" then "4 times." Four `$ pnpm test` → `exit 1` cards | Cards slam in on beats 0–3, and a giant red ×4 hits on beat 4 (2.0 s). Kick and pluck on each card. Riser into 3.5. |
| 3.5–6.5 | Reveal | Logo, "oc-lens", "See where your opencode tokens really go." | Blue wipe. Logo pops, the overview UI rises tilted from below. The groove drops at 4.0. |
| 6.5–10.0 | Loops | "01 · Loop detection" / "Catch the loop. Not the useful work." / sticker "same call + same input" | Loops screenshot pushes into the Error retry · shell · 4 row, ringed in red. |
| 10.0–13.5 | Audit | "02 · Provider audit" / "See what failures really cost." / counter to ≈112,468, "tokens accepted, never recorded" | Audit screenshot zooms to the card while the counter rolls up. |
| 13.5–16.5 | Replay | "03 · Session replay" / "Every failure, marked in place." | Replay screenshot scrolls, and the slow-start and failed-call panels pulse. |
| 16.5–18.5 | Trust | Chips: "Read-only" · "100% local" · "No telemetry" | Chips pop on beats. |
| 18.5–22.0 | Outro | `npx oc-lens` typed, logo, "Open source · MIT" · github.com/ibrahimkobeissy/oc-lens | Blue wipe, the command types out, final chord. |

Privacy: every screenshot is from the synthetic demo DB. `pnpm test` is illustrative text (the README describes this exact case: "a test re-run four times with the same failure").
