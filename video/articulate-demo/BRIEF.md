---
workflow: general-video
flow: automation
storyboard: no
message: "Say the point first. Then hold it."
destination: x-feed
aspect: 1920x1080
language: en
audience: "friends seeing a demo on X; not a call to sign up"
length: 20s
---

## Intent

A 20-second motion-graphics demo of Articulate, a personal tool for practising spoken answers in English on live
calls with an AI Partner. Showreel energy, but every product frame is the real UI. It is posted on X for friends; the
product is passcode-gated and not open to others, so the film shows what it is and asks for nothing.

One element per shot, so each reads in about three seconds:

1. Hook (0–3 s): "Um. Like. You know." slammed one word per beat, then struck out.
2. Ready (3–6 s): the desktop Ready screen assembles in a window; the cursor clicks Call.
3. Follow-up (6–10 s): the Main question, then one Follow-up with its HOSTILE FRAMING tag ringed. Cursor: Done.
4. Coaching point (10–14 s): the bubble alone; the quote is ringed, then the fix.
5. Summary (14–17 s): only the compare row; "Um," and "like," are struck in the Redo, the Better version is ringed.
6. Lockup (17–20 s): the app icon builds part by part, the eyebrow last; "Articulate";
   "Say the point first. Then hold it."; "Executive speaking coach".

## Assets

- assets/screens/*.png — real UI captured at 3x from `video/capture/` (a harness that imports the app's own
  `ui.ts` and `styles.css` and feeds it scripted state). Never redrawn.
- assets/screens/rects.js — element and word boxes for each capture, for crops, rings and cursor targets.
- assets/fonts/ — Bricolage Grotesque, Atkinson Hyperlegible, JetBrains Mono (the app's fonts), local files.
- assets/audio/track.wav — music and UI sounds synthesized by `scripts/synth-audio.mjs`, 120 BPM.

## Customizations

- Light theme, desktop layout.
- Brand comes from the app's code only: `app/public/icon.svg` (redrawn in the lockup from its own paths), the
  wordmark, the tokens in `app/public/styles.css`.
- Original music synthesized in code at 120 BPM, clicks and whooshes on the beat. No voice.

## Notes

- No proof metric and no numbers presented as results. No URL, no "sign up".
- Must read with the sound off (X autoplays muted).
- 30 fps. One aspect only: 16:9.
- The Main question is the Question bank's own. The Follow-up, Coaching point, Redo and Better version are written
  short for the screen; they are not the output of a call.
