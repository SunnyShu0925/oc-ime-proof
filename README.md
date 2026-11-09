# Control UI IME proof artifacts

Evidence referenced from OpenClaw pull requests. Each directory holds one PR's artifacts.

## pr-195983 — personal section search Enter during IME composition

Fix under proof: `ui/src/components/personal-session-group-dialog-view.tsx` uses the shared
`isComposingKeyboardEvent` guard (`ui/src/lib/ime.ts`) so a committing Enter during IME
composition can no longer submit the section form.

Method (see `driver/ime-proof.standalone.ts`): the repo's own Control UI e2e server renders the
source build; Playwright drives a real Chromium (Chrome 138, `executablePath=/usr/bin/google-chrome`)
with a mocked Gateway. Text is composed through CDP `Input.imeSetComposition`
(`f` → `fa` → `fabu` → `发布`), so the browser itself emits `compositionstart`,
`compositionupdate`, `beforeinput`/`input` with `isComposing: true`, and finally the committing
`keydown Enter` with `isComposing: true`. A capture-phase trace records keydowns, composition
events, submit events, and the search input value.

Flow: sidebar → Filter & sort → New section → name → Choose sessions → Search sessions →
compose `发布` → Enter (commit) → then composing Escape and the two settled Escapes.

| Artifact | Contents |
|---|---|
| `head/head.mp4`, `base/base.mp4` | Full recordings (17s head, 14s base), 1280x720 |
| `head/head-1-composing.png` | Head, pre-edit text `发布` with composition active |
| `head/head-2-after-enter-annotated.png` | Head, after committing Enter: dialog open, query `发布`, filtered list (captioned) |
| `head/head-3-after-escape.png` | Head, after composing Escape and the settle-then-clear Escape |
| `base/base-2-after-enter-annotated.png` | Base, after committing Enter: dialog and search gone (captioned) |
| `head/head-trace.json`, `base/base-trace.json` | DOM event trace plus the derived summary |
| `head/head-summary.txt`, `base/base-summary.txt` | Same summary as text |

### Result

Base (`518e8a7`, the reviewed head minus the fix):
`keydown Enter isComposing=true keyCode=13 defaultPrevented=false` → native `submit` fired once →
dialog closed, search gone, committed text discarded.

Head (`ce802c7d`):
`keydown Enter isComposing=true keyCode=13 defaultPrevented=true` → no `submit` event, no
`sessions.groups.*` request, dialog stays open, query `发布` committed, one
`sessions.list(search=发布)` request, one matching row. Composing Escape is a no-op for the UI
(`defaultPrevented=false`, query cleared by the input method, search stays open); the first settled
Escape clears the query and keeps search open, the second closes it.

Note: this Chrome/CDP commit path delivers the commit as a keydown with `isComposing: true` and does
not emit `compositionend`, so the guard exercised here is the `isComposing`/`keyCode 229` branch, not
the WebKit composition-end grace window.
