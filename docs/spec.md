# Spec: Articulate v1 — live spoken-answer practice

The original product spec, written before the build. The app was first called Bottom Line. "Ticket" numbers refer to the build's work items, and "the spike" and "the prototype" to two throwaways (an iPhone audio test and a static screen mock-up) that are not part of this repository.

## Problem Statement

I'm a product manager and a non-native English speaker. In meetings with leadership I:
- can't answer quickly, especially when someone asks a Follow-up;
- fill the silence with "um", "like" and "you know";
- even when I know the answer, I struggle to structure it; when I don't, I struggle to think it through logically;
- don't know how to sound convincing.

Practising on real meetings is too risky and too infrequent. I need a safe place to rehearse spoken answers to unfamiliar questions under realistic, meeting-like pressure, get one concrete fix at a time, and see whether I am getting better.

## Solution

**Articulate** is a personal web app for iPhone Chrome and desktop Chrome. Four times a week, I do a roughly 10-minute **Session** as a live voice call with a **Partner**.

**Each Session**
1. I see a **Scene** and the **Next focus** from my last Session.
2. I tap Call and go through two **Rounds**. In each Round:
   - The Partner asks a **Main question** in a meeting tone.
   - It presses me with 2–3 **Follow-ups** of different **Follow-up types**.
   - It speaks one **Coaching point** that quotes my own words.
   - I do a **Redo**, then see a **Better version** of my answer.
3. A **Transfer question** checks whether the fix carries over to an unseen question.

**Afterwards**, a summary shows:
- the Coaching points with my Redo next to the Better version;
- trends for my **Response latency**, **Filler rate** and Answer length;
- the Next focus for the following Session.

**How the practice supports me**
- I can pause to think, finish an Answer early with Done, and ask for a silent **Structure hint**.
- I practise three **Thinking patterns** and use three **Holding phrases** that I pick at onboarding.

## User Stories

### Onboarding

1. As the learner, I want a one-screen onboarding that explains how a Session works, so that I know what to expect before my first call.
2. As the learner, I want to pick exactly 3 Holding phrases out of 6, so that I own a small set of phrases I'll actually reach for under pressure.
3. As the learner, I want to change my Holding phrases later, so that I can replace one that doesn't feel natural.
4. As the learner, I want a microphone check with a live level meter, so that I know the app can hear me before the call starts.
5. As the learner, I want to be told to use headphones if there's echo on iPhone, so that the Partner doesn't hear itself.
6. As the learner, I want to enter a passcode once per device, so that only I can use the app and spend the API budget.

### Before the call

7. As the learner, I want to see a Scene image and a one-line setting, so that I get into the situation quickly.
8. As the learner, I want to see the Next focus from my previous Session, so that today's practice builds on last time.
9. As the learner, I want to see today's Thinking pattern with its skeleton (for example Position → 2 reasons → so what), so that I know what I'm practising.
10. As the learner, I want to choose a topic category or Random, so that I can vary what I practise.
11. As the learner, I want Main questions to come only from Question bank entries I haven't seen before, so that I'm practising spontaneity rather than recall.
12. As the learner, I want to start the Session with one tap on Call, so that there's no friction.

### During the call

13. As the learner, I want the Partner to speak in a meeting tone at normal speed, so that the practice feels like the real situation.
14. As the learner, I want the Partner to open by reminding me of my Next focus, so that I keep it in mind.
15. As the learner, in my first few Sessions, I want the Partner to introduce the day's Thinking pattern in one sentence, so that I learn the patterns explicitly before the reminders fade.
16. As the learner, I want each Main question and Follow-up shown as a text bubble, so that I don't have to hold the question in memory while I think.
17. As the learner, I want each Follow-up bubble labelled with its Follow-up type, so that I learn to recognise the kinds of pressure being applied.
18. As the learner, I want my own words kept off screen during the call, showing only "You answered · N s", so that I focus on thinking rather than reading myself.
19. As the learner, I want the Partner to wait through a natural thinking pause of about 2 s or more, so that it doesn't cut me off while I'm composing.
20. As the learner, I want a Done button that ends my Answer immediately, so that I don't have to wait out the silence threshold.
21. As the learner, I want to be able to interrupt the Partner, so that I can answer as soon as I'm ready.
22. As the learner, I want 2–3 Follow-ups after each Main question, each responding to what I actually said, so that I practise the moment I find hardest.
23. As the learner, I want the Partner to push back and never agree just to be agreeable, so that my reasoning is genuinely tested.
24. As the learner, I want a Hint button that silently shows a one-line skeleton of today's Thinking pattern plus one of my Holding phrases, so that I can recover without stopping the call.
25. As the learner, I want every Hint use recorded, so that I can see whether I'm relying on hints less over time.
26. As the learner, I want the Partner to speak exactly one Coaching point per Round that quotes my own words, so that the feedback is concrete and I fix one thing at a time.
27. As the learner, I want the Coaching point also shown as a bubble with the quote, so that I can re-read it before my Redo.
28. As the learner, I want the Partner to say a short filler line such as "Let me think about that…" while the Coaching point is being prepared, so that the pause feels natural.
29. As the learner, I want to do a Redo of the same question right after the Coaching point, so that I confirm I can apply the fix.
30. As the learner, I want to see a Better version of my answer after the Redo, written with my own position and words, so that I can compare and learn the gap.
31. As the learner, I want the Partner to tell me briefly to look at the Better version rather than read it aloud, so that the comparison happens visually.
32. As the learner, I want two Rounds followed by one Transfer question, so that a 10-minute Session includes a check that the fix carries over.
33. As the learner, I want the Partner to wrap up by 12 minutes, so that the Session stays within my commitment.
34. As the learner, I want a progress indicator showing where I am in the Session, so that I know how much is left.
35. As the learner, I want the call to continue seamlessly if the connection drops or hits its session limit, so that a network blip doesn't ruin a Session.
36. As the learner, I want to end the call at any time with a clear End button, so that I stay in control.
37. As the learner, I want the screen to stay awake during a call, so that the phone doesn't lock mid-answer.

### After the call

38. As the learner, I want a summary screen right after the call, so that I review while the Session is fresh.
39. As the learner, I want each Round's Coaching point shown with my Redo and the Better version side by side, so that I can see the improvement concretely.
40. As the learner, I want to see my Response latency for this Session and its trend, so that I can track whether I'm answering faster.
41. As the learner, I want to see my Filler rate and its trend, counted from a verbatim transcript, so that I can check whether fillers fall as my structure improves.
42. As the learner, I want to see my average Answer length and its trend, so that I can watch for rambling even though it isn't enforced.
43. As the learner, I want to see how often I put my position in the first sentence, so that I can track Directness.
44. As the learner, I want to see counts of Hints and Holding phrases used and the Follow-up types I faced, so that I understand my patterns.
45. As the learner, I want one Next focus line generated for my next Session, so that each Session links to the one before.
46. As the learner, I want the trend metrics to fill in a few seconds after the summary opens once transcription finishes, so that I'm not blocked waiting.
47. As the learner, I want my raw recording deleted once it has been transcribed, so that no audio is kept.

### History and content

48. As the learner, I want past Sessions saved on the device, with transcripts, Coaching points, Better versions and metrics, so that I can review them later.
49. As the learner, I want to delete a single Session or all history, so that I control my data.
50. As the learner, I want to review the Question bank and strike out questions I dislike, so that Sessions use questions I find worthwhile.
51. As the learner, I want every Main question in the bank to be answerable without specialist or current-events knowledge, so that knowledge gaps don't distort the practice.
52. As the learner, I want the Scene image to come from a pre-generated library, so that Sessions start instantly and cost nothing extra.

### Cost and access

53. As the learner, I want my API key never to reach the browser, so that it can't leak.
54. As the learner, I want the Gemini API's AI Studio Prepay balance kept topped up (auto-reload, or a low-balance check), so that Sessions don't suddenly fail. On Prepay, a $0 balance stops every key, even when Google Cloud promotional credits remain.

### The spike (first milestone)

55. As the builder, I want a minimal call-only spike that runs on iPhone Chrome for 12 minutes with seamless resumption, no echo on speaker, a 3 s pause that isn't interrupted, a working Done button, and audio successfully sent for transcription, so that I validate the riskiest technical assumption before building features.
56. As the builder, I want to try 2–3 Partner voices during the spike, so that I pick a clear one.

## Implementation Decisions

### Architecture

- **Client:** a single-page web app for iPhone Chrome (WebKit) and desktop Chrome. It is served over HTTPS, which iPhone requires for microphone access.
- **Backend:** a small Cloudflare Worker, gated by a single passcode.
  - Failed passcodes are rate-limited by a Durable Object: per IP, 5 failures lock that IP out for 15 min; globally, 20 failures in an hour lock everyone out for 15 min. A correct passcode sets a 30-day HMAC-signed, HttpOnly cookie.
  - It mints short-lived ephemeral tokens for the Live API, so the browser connects to Gemini directly. Ephemeral tokens are still marked Preview in Google's docs.
  - It proxies the text-model calls (Coach brain, Better version, Next focus) and transcription calls. The Question bank and Scene library are committed content, so nothing is generated at run time.
  - The API key exists only as a Worker secret.
- **Models:** see `docs/research/gemini-stack-2026-10.md`.
  - **Partner:** `gemini-3.8-live`, standard rather than extended-thinking, because thinking adds latency and the Partner doesn't need deep reasoning.
  - **Coach brain** (Coaching point, Better version, Next focus): `gemini-3.8-flash`.
  - **Transcription:** `gemini-3.5-transcribe` in verbatim mode with word timestamps, run on each learner turn's audio as soon as the turn closes, during the call. The Coach brain needs the verbatim words while the Round is still going (Live's own input transcription is not verbatim, ADR-0001).
  - **Scene library:** Nano Banana images, generated once (27 Scenes). The first four came from `gemini-3.1-flash-lite-image` through the API; the rest were made in Antigravity from the prompts in `content/scenes/image-prompts.md`, each with the Corner Café image attached as the style reference.
- **Coaching flow** (ADR-0001): the Partner speaks the Coaching point, but the Coach brain chooses it from the transcript. The chosen text is injected into the Live session for the Partner to say. There is one voice and no separate coach persona.
- **Partner voice:** Charon (chosen in the spike over Kore and Orus).
- **Turn-taking** (ADR-0002): the browser decides when the learner's turn starts and ends; Gemini's automatic voice detection is off.
  - The browser opens a learner turn when mic level stays above the **speech level** for 3 × 40 ms. While the Partner is talking, it uses the higher **barge-in level** instead. On opening, it sends `activityStart` plus 320 ms of pre-roll audio.
  - It closes the turn with `activityEnd` after **4500 ms** of quiet, or immediately on Done.
  - Starting values, tuned on iPhone speaker in the spike: speech level RMS 0.02, barge-in level RMS 0.08. These depend on the mic, so the onboarding mic check (user story 4) checks them on the device, with the call's own mic settings and capture path, in three phases: a quiet room (3 s), the learner saying a phrase (6 s), and a recorded Partner line (Charon) played on the speaker.
    - The spike's levels are only ever raised. The speech level goes up to 2× the room's noise (95th percentile) when that is higher than 0.02. The barge-in level goes up to 1.5× the Partner's echo, measured as the loudest level held for 3 frames (what would open a turn), when that is higher than 0.08.
    - Past 0.06 (speech) or 0.15 (barge-in), ordinary speech might not clear the level (ticket 01: barge-in speech at 0.175). The check then says the room is too noisy, or recommends headphones. In the headphones case the capped level is still saved. In the noisy case the speech level stays at 0.02: on iPhone the "noise" was the learner talking during the quiet phase, and a saved 0.06 lost quiet openings in the next call. A noisy-raised level saved by an earlier version is dropped on load.
    - The learner's phrase only confirms that the mic hears them: at least 0.5 s above the speech level. It doesn't move any level. A first version also lowered the levels to fit a quiet voice. On iPhone that read a pause-filled phrase as quiet (median 0.016), lowered the speech level to 0.008, and wrongly said headphones.
    - The levels are saved on the device and used for every call (not with the fake mic).
  - Audio is sent only while a learner turn is open.
  - Barge-in by the learner is allowed: opening a turn while the Partner talks stops its playback, and the server confirms with `interrupted`.
- **Connection limits:** a Live connection is cut after about 10 minutes.
  - The server may close it with `1011` and **no `goAway` warning** (seen in the spike at 600 s), so don't rely on `goAway`.
  - The client swaps connections on its own once a connection is **8.5 min** old. It waits for a quiet moment: no Partner audio playing, no learner turn open, no reply pending, and the engine not about to have the Partner speak (it holds the swap while it waits on the Coach brain). It forces the swap 60 s later if no quiet moment comes.
  - Swap order: close the old connection, wait 800 ms, then reconnect with the latest resumption handle. Retry with backoff. Opening the new connection first, or reconnecting immediately after close, fails with `1011`.
  - The swap takes about 1.3 s and is inaudible at a quiet moment. Messages are queued during it.
  - An unexpected close triggers the same resume path.
  - The ephemeral token is `uses: 1`. Resuming doesn't count as a use, so one token covers a whole Session.
  - Context-window compression is optional: re-billing is within budget (see Further Notes).
### Modules

**Session engine** (the deep module and the test seam): a state machine that owns the Session's flow. It takes events and emits UI state and commands. It talks to the outside world only through injected adapters:
- **LiveAdapter:** connect, send text instruction to speak, set the instruction for the Partner's next reply, send end-of-turn (`activityEnd`, used by Done), and events for Partner turn start/end, the Partner's transcribed words, and learner turn start/end. The learner-turn-end event carries the turn's audio (the 16 kHz PCM sent to Live), for the TranscriberAdapter.
  - Under manual turn-taking the Partner replies on its own when the learner's turn ends. So the engine steers that reply in advance: when the Partner finishes a question, it sends a `[Director]` note (a text turn with `turnComplete: false`) saying what the next reply must be, for example a Follow-up of a given type. The adapter re-sends the note after a connection swap until the Partner starts speaking. It owns the audio path (capture, browser-side turn detection, playback) and connection swaps and resumption (ADR-0002, Connection limits). The engine only sees a resumed event and never handles resumption handles.
  - The Follow-up note carries the Follow-up type and its intent, never a ready-made line: given one, the Partner reads it out whatever the learner said. Since the note goes out before the Answer, it tells the Partner how to build on the Answer instead: pick up one specific thing the learner just said (a word, a number, an example, or a condition such as "it depends on…"), never ask a generic question, and never assume a side the learner didn't take. If the Answer made no call, the same Follow-up type is shaped to make the learner make it (ticket 09). Two types come from the course (lessons 0001, 0003; ticket 11): Have you considered…? raises one risk the Answer didn't cover and wants reassurance that it is under control (Reassurance, 0003); Hostile framing restates the learner's point as a blunt attack in one short question, politely and without agreeing.
- **CoachAdapter:** given a question, Follow-ups and the Answer transcript, returns a Coaching point (rubric dimension plus quote plus instruction). It also returns a Better version given the Redo, a one-sentence comment on the Transfer Answer given the Session's Coaching points (same rules: what to change, never a wording; quotes verbatim), a Next focus given the Session, and, after the Session, whether each Answer's first sentence of substance is its Answer (a metric).
  - It judges against the course's skeleton (see Coaching rubric), and the Coaching point's instruction, the Transfer comment and the Next focus name the skeleton step that went wrong ("Your Answer came in your third sentence. Put it first."). They never ask for more reasons or for "first… second…".
  - The Worker checks that the quote is a verbatim copy of the learner's words and asks once more if it isn't.
  - The Coaching point says what to change, never a wording to use. A ready-made sentence would be a Better version read aloud before the Redo (user story 31), and the learner would just repeat it. The Worker rejects a fix that quotes a wording and asks again.
  - The Better version is the learner's Redo rewritten in the skeleton: their call in the first sentence (no Paraphrase), then one Detail (their most concrete reason or example, with their number if they gave one; their other reasons are left out), then the so what (on a first read, their tripwire), then a stop. Each sentence is about 12 words at most, with at most two thought groups (lesson 0004); 3 or 4 sentences. It keeps their position and uses only their facts.
    - The Worker checks it and asks once more with what was wrong: a first sentence that praises the question or paraphrases it (the rewrite starts on the Answer, like the Thinking patterns), a sentence over 16 words, more than 5 sentences, or a number the learner never said in the Round (digits or words; "one" is left out). If the second attempt still has only style problems, it is shown anyway; a made-up number is never shown, and the Round goes on without a Better version.
  - While the Coach brain works, the Partner covers the wait: its automatic reply to the last Answer is a scripted short line, then the engine has it say another scripted covering line whenever it has been quiet for 1 s (at most 3). The Coaching point is then sent with "say exactly this", so the Partner never improvises one.
  - If the Coach brain fails or is still not back after the covering lines, the Round closes without a Coaching point, Redo or Better version.
  - If only the Better version fails or is still not back, the Coaching point and the Redo stand: the Partner says "Sorry, I couldn't write up a tighter version this time. Let's move on." and asks the next question. (It used to say it couldn't put a point together, which was wrong after a Coaching point.)
  - The Next focus is asked for together with the Transfer comment (and again if the learner goes on with the Transfer Answer), so it is usually back before the wrap-up. The Partner says it word for word in the wrap-up. While it is still coming, the Partner covers the wait with the covering lines left over from the Transfer comment. If it fails or is still not back, the Partner wraps up without it. A Next focus that arrives after the call is still added to the summary and saved.
  - A Session that ends early (End, time cap, lost connection) asks for its Next focus when it ends, if it had at least one Coaching point. The time-up line includes the Next focus only if it is already known.
- **TranscriberAdapter:** given Answer audio, returns words with timestamps. A transcript from the fallback model is marked `untimed`.
- **Clock:** the time, and timers (used for the covering lines and for re-sending an instruction that brought no Partner turn).
- **Store:** Sessions, the Question bank marks, settings. Sessions and the marks (which questions were seen, which struck) are kept on the device in IndexedDB, in separate stores, so deleting history doesn't bring seen questions back. The settings (the learner's Holding phrases and the mic check's levels) are small and live in localStorage, outside the engine. The engine saves a Session when it ends, then replaces that record as a Redo transcript, the Next focus or the metrics come in, unless the learner has deleted it in the meantime. Answer audio waiting for a transcription retry is kept in its own store and deleted with its Session.

Rules the engine enforces:
- Each Round has 2–3 Follow-ups. The engine asks the Partner for a Follow-up of a chosen Follow-up type, preferring types the learner has faced least.
- Each Round has exactly one Coaching point.
- The Redo happens before the Better version.
- When the last Session left a Next focus, the Session opens with the Partner saying it word for word ("Hi. Your focus from last time: …", at most about 12 words), then the first Main question. A Session that ended without one leaves the one before it standing. The first Session skips the reminder.
- There are two Rounds and then a Transfer question, which gets a one-line comment and no Redo. The comment comes from the Coach brain, and the Partner says it word for word, covering the wait as for a Coaching point.
- After each Better version the learner reads it and taps Next to go on; if they don't within 30 s, the Partner moves on. While they read, the Partner only answers "Take your time. Tap Next when you're ready."
- At about 12:00 the engine sends a wrap-up instruction to the Partner. Nothing new starts after that: a Coaching point still being prepared is dropped, an open learner turn finishes and the Partner's reply to it is the wrap-up, and a line already sent is said first. The Session ends with `timeCap`.

Session step model, encoded from the prototype's progress tracker:

```ts
type Step =
  | { kind: "opening" }                                   // Next focus reminder, pattern intro (early Sessions)
  | { kind: "main"; round: 1 | 2 }
  | { kind: "followUp"; round: 1 | 2; n: 1 | 2 | 3; type: FollowUpType }
  | { kind: "coaching"; round: 1 | 2 }                    // Coach brain pending → Partner speaks it
  | { kind: "redo"; round: 1 | 2 }
  | { kind: "betterVersion"; round: 1 | 2 }               // shown as text; Partner says one line
  | { kind: "transfer" }
  | { kind: "wrapUp" }
  | { kind: "ended"; reason: "complete" | "userEnded" | "timeCap" | "connectionLost" };
type FollowUpType = "why" | "soWhat" | "counterexample" | "changeYourMind" | "beSpecific" | "haveYouConsidered" | "hostileFraming";
```

**Metrics** (internal to the summary step, tested through the Session seam; ticket 08):
- They count the Answers to the Main questions, the Follow-ups and the Transfer question, not the Redos or what is said during a wait. An Answer can span several learner turns.
- **Response latency:** time from the end of the Partner's question to the first word of substance. Holding phrases count as substance; fillers do not.
  - Per Answer: (turn open − 320 ms pre-roll − end of the question's audio) + the first substantive word's offset in the transcript. None when the learner cut in on the question. The Session shows the median.
- **Filler rate:** fillers per minute of learner speech, counted from the verbatim transcript, over all the Answers.
  - Fillers, from the course (lessons 0001, 0002 and the drills' check): um, uh, er, ah, hmm, mm (stretched too), "you know", "I mean", "kind of", "sort of", "basically", "actually", and "like" where it starts a clause or stands alone ("On weekends, like, a table…"), not as a verb or comparison. "So", "yeah" and "right" are not counted.
- **Answer length:** duration of each Answer (the turn detector's speech time); the Session shows the mean.
- **Answer in the first sentence:** judged by the Coach brain for every Answer, against the skeleton's Directness rule (an optional one-sentence Paraphrase first is fine; a confident first read counts). Shown as "yes of judged".
- **Counts:** Hint uses and Holding phrase uses (any of the 6, by a fixed cue such as "my first read", counted once per phrase).
- **Trends:** each metric over the last 8 Sessions that have it, the latest emphasised.
- **On the summary** (decided by the learner after the first full iPhone call, 2026-10-09): the Next focus and the metrics come first, then the Rounds.
  - Three metrics are shown: Answer in the first sentence, Response latency and Filler rate. Each has its value, how it compares with the average of the earlier Sessions in its trend (within 10%, or 5 points for Answer first, counts as the same), and its trend line.
  - One sentence on top names the biggest improvement (Answer first wins a tie), else the biggest slip, with the course's remedy for a slower start (a Holding phrase) or more fillers (a silent pause).
  - Answer length, Answers, Time answering, Holding phrases used, Follow-up types faced, the Thinking pattern and Hints used are folded under Details.
- **Transcripts and audio:** the metrics reuse the transcripts made during the call. A turn's audio is kept in memory until it has a timed transcript from `gemini-3.5-transcribe`. One that failed, or came from the fallback model (no word timings), is transcribed again after the Session, twice, 30 s apart (the model allows 10 requests a minute). If one is still missing, the Session's Answers are kept in IndexedDB (`pendingMetrics`, with the audio of the missing turns only) and tried again whenever Ready opens; the record says `metricsPending`. Deleting a Session deletes them.
  - Retries go one request at a time, 6.5 s apart (the model also allows only 100 requests a day), and those at app start stop as soon as a call begins, so they never take the call's share. After 10 app opens that still leave Answers untranscribed, the audio is deleted and the record says `metricsUnavailable`.

**Question bank:**
- 216 Everyday questions in 27 Scenes (8 per Scene; the Corner Café's first three are the original hand-written ones), in `app/src/content/question-bank.json`. Each is tagged with a category (Everyday decisions, Tech & society, Personal opinions, Products & AI) and a difficulty (easy, medium, hard).
  - Products & AI covers consumer apps, workplace tools everyone in an office uses, and AI products, always asked from a user's point of view: no inside knowledge of a company and nothing about the learner's own job.
  - In each Scene, about 3 questions ask for a yes/no call, about 3 offer two options to pick from, and about 2 ask for a judgement under uncertainty, so all three Thinking patterns get used.
- Written once by subagents in a Claude Code session from one set of rules, screened by another subagent (specialist or current-events knowledge, obvious answers, duplicates, unclear wording, category fit), and fixed. `app/scripts/generate-bank.mjs` merges, validates, writes the image prompts and imports the images. `app/scripts/bank-check.mjs` checks that the Partner says every question word for word.
- Entries carry no Follow-up lines. The Partner is never handed a line (it would read it out whatever the learner said, ticket 09), and the Follow-up note describes each type itself (`FOLLOW_UP_ASK`).
- A Session takes three questions from one Scene: Round 1, Round 2 and the Transfer question, all neither seen nor struck, from a Scene with at least three left in the chosen category (Random: any). The engine adds the lead-ins ("First question.", "Second question.", "Last one, quickly.").
- A question is marked seen once the Partner has asked it, so one never reached in a Session stays unseen. The learner reviews the bank in a Questions screen and can strike entries (and restore them); struck entries are never chosen.
- Ready shows the chosen Scene's image and setting, and topic chips (Random plus the four categories). A chip with no Scene left is disabled. The fake mic always gets the Corner Café's first three questions and leaves the seen marks alone.

**Content:**
- 6 Holding phrases; the learner picks 3.
- 3 Thinking patterns, aligned with the learner's course on high-stakes PM communication (Paraphrase → ADD; a first read with a tripwire): Answer first (Answer → Detail → So what → Stop), First read (First read → It turns on X → If X flips → My call), Two options + pick (A or B → My pick → Because → So for you). Each has a filled-in example on a neutral topic.
- The 6 Holding phrases include a paraphrase ("So the question is whether …") that opens any pattern; the others are tagged with the pattern they open.
- One Thinking pattern is introduced per Session for the first few Sessions; after that, patterns appear only via Hint.
  - Today's pattern is the first one not yet introduced. The screen teaches it: a pattern card (skeleton plus example) opens the call thread, and Ready shows the same. The Partner only names it, word for word and in one short line ("Today's pattern is First read. It's on your screen."), after the Next focus reminder ("Hi. Your focus from last time: …") if there is one. The whole opening stays under about 8 s, so the Next focus is at most about 12 words.
  - After the introduction period, Ready shows only the pattern's name; its steps are a tap away, so the learner recalls them first. A Session counts as having introduced it only once the Partner said it, so a Session ended before that introduces the same pattern again. Once all three have been introduced, today's pattern is the one used least so far.
  - The Hint shows the pattern's skeleton and one of the learner's Holding phrases (those that open today's pattern first, then the others in turn). It is silent: the Partner isn't told. Each opening is counted in the Session (`hintUses`), and it closes when the Partner asks its next question.

**UI:**
- Follows the prototype's four screens: Onboarding, Ready, Live call and Summary. Settings reuses the Onboarding screen for changing the Holding phrases and running the mic check again. Onboarding blocks the Call until exactly 3 Holding phrases are picked; the mic check is offered but not required.
- Desktop uses a three-column call layout. The right-hand reference panel must respect hint fading: hide the persistent pattern and Holding phrases panel once the patterns have been introduced. This resolves the conflict noted during prototyping. The panel shows only in a Session that introduces a pattern.
- Partner bubbles show questions, Follow-ups and Coaching points. The learner's turns appear only as "You answered · N s" lines.

**Coaching rubric**, in priority order: Directness → Structure → Reasoning, judged against the learner's course skeleton (Paraphrase → ADD, lessons 0001, 0003, 0004; the Thinking patterns are its shapes). Delivery (length, pauses, fillers) is observed and trended, but never chosen as the Coaching point in v1.
- **Skeleton:** an optional one-sentence Paraphrase, then the Answer (the call, in one sentence), one Detail (a concrete example or number; a relative term such as "a small share" when there is no number), and the so what for the asker, then a clean stop. On a question under uncertainty, the Detail uses at least one lens (Likelihood × Impact; a one-way or two-way door; an early signal), and the last step names a tripwire before the stop: the signal that would change the call, and what they would do then (no date required; lesson 0003's Commit).
- **Directness:** the Answer isn't the first sentence of substance (a one-sentence Paraphrase before it is fine), it is hedged until the call is unclear, or the learner opens by praising the question ("That's a great question", lesson 0003). An honest first read said with confidence ("My first read is…", "more likely X than Y") counts as an Answer.
- **Structure:** a step is missing or out of place (no Detail, no so what, the Detail before the Answer, wandering between steps), or there is no clean stop (a trailing "so yeah…"). Several reasons are not a problem in themselves, only when they bury the Answer or crowd out the so what.
- **Reasoning:** the Detail is vague or doesn't back the Answer; on a question under uncertainty, no lens is used or the tripwire has no signal or no action.

**Language:** the conversation and feedback are in English.

**Spike first:** before any feature work, a throwaway spike validates the iPhone audio path against acceptance criteria (user story 55). If it fails, revisit a PWA or native shell before continuing.

## Testing Decisions

**What we test**
- We test only external behaviour, through one seam: the **Session engine**, with fake adapters (scripted LiveAdapter events, canned CoachAdapter responses, canned word-timestamp transcripts, a controllable Clock, an in-memory Store).
- Tests drive events and assert on emitted UI state, on commands sent to adapters (for example "Partner told to ask a Counterexample Follow-up", "wrap-up sent at 12:00"), and on the persisted Session summary.
- Tests never assert on internal state shapes or private helpers.
- The engine module also exports the pure choices the screens and the engine share: `todaysPattern()`, `lastNextFocus()`, and the Question bank's `chooseQuestions()` and `stillUnused()`. They are tested directly, next to the Session tests.

**Key behaviours to cover**
- Round order: Main → 2–3 Follow-ups → Coaching → Redo → Better version, ×2, then Transfer.
- Coaching is requested exactly once per Round, and the Partner is told to cover the wait.
- Done ends the learner's turn immediately.
- The Hint toggle is recorded.
- Time cap at 12:00 triggers wrap-up, including in the middle of a Round.
- A Live disconnect in mid-Session resumes without losing the step.
- Metrics:
  - Response latency excludes leading fillers but counts a Holding phrase.
  - Filler rate is computed from verbatim words.
  - Answer length is measured.
  - Metrics appear after transcription completes.
- Only unseen, unstruck questions are chosen, and they are marked seen afterwards.
- The Next focus is persisted and surfaced in the next Session's opening.
- Audio is deleted after transcription succeeds and kept for retry if it fails.

**Not automated**
- The iPhone audio path, echo, voice quality and turn-taking feel. These are covered by the spike's manual acceptance checklist (ticket 01's test protocol and results), repeated whenever audio code changes.

**Prior art:** none; this is a greenfield repo.

## Out of Scope

Deferred until the app has been used for about 2 weeks and proved useful:
- Google login, cross-device sync and saving recordings;
- Easy/Normal/Challenging difficulty and suggested progression;
- Baseline and Weekly check;
- Chinese explanations;
- an in-app budget cap (v1 relies on keeping the AI Studio Prepay balance topped up);
- a cut-in by the Partner when an Answer runs long (length is only trended);
- PM and leadership scenarios that need work context;
- image-based questions;
- continuing a call while the screen is locked or in the background;
- a native app (unless the spike fails).

## Further Notes

- **Glossary:** `CONTEXT.md`. Use its terms; avoid the synonyms it lists.
- **ADR-0001:** the Partner speaks the Coaching point, which the Coach brain chooses.
- **Research and costs:** `docs/research/gemini-stack-2026-10.md`. The spike measured about **$0.30–0.36 per 10-min Session** of Live audio, or about $5–6 per month at 17 Sessions, plus transcription (about $0.001 per Answer). Per-turn context re-billing is confirmed and makes up about 85% of that.
- **Spike (ticket 01):** GO for iPhone Chrome on speaker; no headphones needed. The spike code is the primary reference for the audio path, the Worker token and passcode gate, and connection swaps. It is throwaway: rewrite it into the modules above, don't copy it.
- **Prototype:** a static mock-up of the screens. It is a throwaway; rewrite properly rather than promoting it.
- **First Scene content:** `content/scenes/01-corner-cafe.md` (draft; the bank now holds the questions).
- **Known iOS risk:** WebKit has open bugs on Web Audio after microphone capture (WebKit #221334, #244667), and Google's Live API sample has an unmerged Safari recording fix.
- **Prototype questions left open for the build:**
  - Should the learner be able to peek at their first Answer before the Redo?
  - The Coaching point quote is visible on the call screen. This is intended and doesn't conflict with keeping the learner's transcript off screen.
