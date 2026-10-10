# Gemini API stack for Articulate: research as of 2026-10-05

Scope: a personal English speaking-practice web app (realtime voice partner, post-answer coaching text, verbatim transcription that keeps fillers and pause timing, one atmosphere image per scenario). Target browsers: iPhone Chrome (WebKit) and desktop Chrome. Usage: about 170 min of live audio per month.

Method: I fetched official pages directly (ai.google.dev docs, the API reference, the changelog, the pricing and deprecations pages, blog.google, bugs.webkit.org, and the google-gemini GitHub repo) on 2026-10-05 and read their text. Labels used below:
- **[VERIFIED]**: stated on the cited official page.
- **[INFERRED]**: my own arithmetic or reasoning from verified facts.
- **[UNVERIFIED]**: not confirmed, or the official docs contradict each other.

---

## 1. Releases in September and October 2026

Source: https://ai.google.dev/gemini-api/docs/changelog (fetched 2026-10-05)

| Date | Model ID(s) | Status | Notes |
|---|---|---|---|
| 2026-09-01 | (feature) | — | Agentic video understanding for 3.7 Flash, 3.6 Flash and 3.5 Flash-Lite |
| 2026-09-02 | `gemini-3.8-flash` | GA | "most intelligent Flash model" |
| 2026-09-03 | `lyria-3.5` | GA | Music generation |
| 2026-09-15 | `gemini-3.8-live`, `gemini-3.8-live-extended-thinking` | GA | Audio-to-audio Live API models |
| 2026-09-17 | `antigravity-preview-09-2026` | Preview | Replaces `antigravity-preview-05-2026`, which shuts down 2026-10-05 |
| 2026-09-18 | (policy) | — | Gemini 2.5 models restricted to existing users. For new projects the changelog recommends 3.5 Flash-Lite or 3.8 Flash |
| 2026-09-22 | `gemini-3.8-flash-tts`, `gemini-3.8-flash-lite-tts` | GA | New TTS models plus the `/v1beta/voices` endpoint |

**October 2026:** the changelog has **no entries yet** [VERIFIED as of 2026-10-05]. The only October events I found are scheduled shutdowns listed on https://ai.google.dev/gemini-api/docs/deprecations:
- `gemini-2.5-flash-image` shuts down 2026-10-02.
- `antigravity-preview-05-2026` shuts down 2026-10-05.

Relevant releases from just before September:
- 2026-08-26: `gemini-3.5-transcribe` and `gemini-3.5-transcribe-live`, both GA.
- 2026-08-13: `gemini-3.7-flash`, GA.
- 2026-06-30: `gemini-3.1-flash-lite-image` (Nano Banana 2 Lite), GA.
- 2026-05-28: `gemini-3.1-flash-image` (Nano Banana 2) and `gemini-3-pro-image` (Nano Banana Pro), both GA.

Blog posts:
- https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-8-live-gemini-3-8-live-extended-thinking/
- https://blog.google/innovation-and-ai/technology/developers-tools/build-real-time-voice-applications-gemini-audio/ (dated 2026-09-15; covers 3.8 Live and 3.5 Transcribe)

## 2. Do the named models exist?

| Name you were given | Result | Real ID and status | Source |
|---|---|---|---|
| "Gemini 3.8 Live" (`/docs/models/gemini-3.8-live`) | **Exists** [VERIFIED] | `gemini-3.8-live`, GA 2026-09-15 (stable). Page last updated 2026-09-15 | https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live |
| "Gemini 3.8 Flash" | **Exists** [VERIFIED] | `gemini-3.8-flash`, GA 2026-09-02. Text-only output, 1,048,576 input tokens, no Live API support | https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash |
| "Nano Banana 2 Lite" / `gemini-3.1-flash-lite-image` | **Exists** [VERIFIED] | `gemini-3.1-flash-lite-image`, GA 2026-06-30 | changelog; https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite-image (HTTP 200) |
| "Gemini 3.5 Transcribe — Verbatim" (`/docs/transcribe`) | **Not a separate model.** The page exists, but "Verbatim" is a **mode** of `gemini-3.5-transcribe` (the default mode), not its own model. `/docs/models/gemini-3.5-transcribe-verbatim` returns 404 [VERIFIED] | `gemini-3.5-transcribe` (GA 2026-08-26) with `transcription_config.mode = {"type":"verbatim", ...}` | https://ai.google.dev/gemini-api/docs/transcribe (last updated 2026-09-23) |

## 3. Live API with `gemini-3.8-live` (current recommended native-audio model)

Sources:
- Model page: https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live
- Capabilities: https://ai.google.dev/gemini-api/docs/live-api/capabilities (updated 2026-09-18)
- Sessions: https://ai.google.dev/gemini-api/docs/live-api/session-management
- Best practices: https://ai.google.dev/gemini-api/docs/live-api/best-practices
- API reference: https://ai.google.dev/api/live (updated 2026-09-04)
- Pricing: https://ai.google.dev/gemini-api/docs/pricing

**Model facts [VERIFIED]**
- Inputs: text, images, audio, video. Output: text and audio, but audio is the only supported *response modality*. For text, enable output transcription.
- Token limits: 131,072 input and 65,536 output. Session context: 128k for native-audio models.
- Not supported: thinking level settings. `thinkingLevel` must be omitted; the model uses interleaved reasoning.
- Function calling is async (`NON_BLOCKING`) by default.
- The sibling model `gemini-3.8-live-extended-thinking` adds `thinkingLevel` (low, medium or high) and only supports async tools.
- Legacy models `gemini-3.1-flash-live-preview` and `gemini-2.5-flash-native-audio-preview-12-2025` list `gemini-3.8-live` as their replacement on the deprecations page.

**Pricing (paid tier, per 1M tokens) [VERIFIED]**
These rates apply to `gemini-3.8-live`, `gemini-3.8-live-extended-thinking` and `gemini-3.1-flash-live-preview`.

| Direction | Text | Audio | Image/video |
|---|---|---|---|
| Input | $0.75 | $3.00 (about $0.005/min) | $1.00 (about $0.002/min) |
| Output (including thinking) | $4.50 | $12.00 (about $0.018/min) | — |

- The free tier is "Free of charge", but free-tier content is used to improve Google's products.
- Audio is tokenized at 25 tokens/s.

**Billing details that change the cost estimate [VERIFIED, best-practices page "Pricing and billing"]**
- Context is re-billed every turn: "The API charges you per turn for all tokens present in the session context window." History is kept as raw audio tokens and charged at the audio input rate each turn. `contextWindowCompression` limits this.
- Transcription costs extra: input and output transcription text is billed at the text *output* rate ($4.50/M) on top of the audio cost.
- Proactive audio is **permanently enabled** on 3.8 Live, so input is billed **the whole time the session is listening**, not only while the user speaks.

**Session length [VERIFIED]**
- Without compression, audio-only sessions are limited to **15 min** and audio+video sessions to 2 min.
- **A single WebSocket connection lasts about 10 min.** The server sends a `GoAway` message with `timeLeft` before closing.
- Implication: a 10-minute practice session will hit the connection limit. Implement resumption.

**Session resumption [VERIFIED]**
- Set `sessionResumption` in the setup message. The server sends `SessionResumptionUpdate.newHandle`.
- Reconnect with `handle`. Handles are valid for 2 h after the session ends.

**Context window compression [VERIFIED]**
- Use `contextWindowCompression: { slidingWindow: {} }` with an optional trigger token count. The default trigger is 80% of the context limit.
- Compression causes a temporary latency spike.

**Automatic VAD [VERIFIED]** (`realtimeInputConfig.automaticActivityDetection`)
- `startOfSpeechSensitivity`: `START_SENSITIVITY_HIGH` (default) or `START_SENSITIVITY_LOW`.
- `endOfSpeechSensitivity`: `END_SENSITIVITY_HIGH` (default) or `END_SENSITIVITY_LOW`.
- `prefixPaddingMs` and `silenceDurationMs`. The docs recommend 500–800 ms; the server default is about 800 ms. Values of 2000 ms or more add latency but tolerate thinking pauses. That trade-off matters for language learners.
- If the mic pauses for more than 1 s, send `audioStreamEnd`.
- **Hybrid VAD:** server-side speech-start detection plus a client-side end detector that sends `audioStreamEnd`.

**Manual VAD / push-to-talk [VERIFIED]**
- Set `automaticActivityDetection.disabled = true`, then send `activityStart` and `activityEnd`.
- The server adds no pre-speech buffer and no silence tolerance. The docs recommend a client-side end threshold of at least 500 ms.

**Barge-in [VERIFIED]**
- The default `activityHandling` is `START_OF_ACTIVITY_INTERRUPTS`. The server sends `serverContent.interrupted = true`, and the client must flush its playback queue.
- `NO_INTERRUPTION` disables barge-in.
- `turnCoverage` defaults to `TURN_INCLUDES_AUDIO_ACTIVITY_AND_ALL_VIDEO` for 3.x models.

**Audio format [VERIFIED]**
- Input: 16-bit little-endian PCM, natively 16 kHz. Other rates are resampled if the MIME type is `audio/pcm;rate=N`. Send 20–40 ms chunks (at most about 100 ms).
- Output: 24 kHz PCM.

**Input and output transcription**
- Enable with `inputAudioTranscription` / `outputAudioTranscription` [VERIFIED].
- The server also sends `interimInputTranscription` (low-latency partial results) and `inputTranscription` (final). Ordering against other messages is not guaranteed [VERIFIED, API reference].
- Fillers: the API reference describes `AudioTranscriptionConfig.mode` as `VERBATIM` (default) or `SMART`, where only SMART removes fillers. It also lists `wordTimestamp` and `diarization` fields [VERIFIED in the reference].
- **[UNVERIFIED / CONFLICTING]** The 3.8 Live capabilities page does not say whether its input transcription keeps fillers or accepts `mode`. The Live Transcription guide (https://ai.google.dev/gemini-api/docs/live-api/live-transcribe, for `gemini-3.5-transcribe-live`) says: "Word-level timestamps are not supported over the Live API. The Live API emits utterance-level timestamps." That contradicts the `wordTimestamp` field in the reference. **Treat Live input transcription as approximate and test it.** Use the batch Transcribe model (section 4) as the source of truth for fillers and pauses.

**Ephemeral tokens [VERIFIED; the feature is labeled "Preview"]**
- Your backend calls `POST /v1beta/auth_tokens`, which works for the Live API only.
- Defaults: `expireTime` 30 min, `newSessionExpireTime` 1 min, and `uses: 1`.
- You can lock a token to a model and config with `liveConnectConstraints` (keeps the system prompt server-side).
- The client connects to `...BidiGenerateContentConstrained?access_token=...`, v1beta only.
- Because connections must reconnect about every 10 min, reuse the same token within `expireTime`.

**Keeping the model silent during long pauses**
- [VERIFIED] Several documented controls help:
  1. Manual VAD (push-to-talk): the model does not respond until `activityEnd`.
  2. A larger `silenceDurationMs` and/or `END_SENSITIVITY_LOW`.
  3. Proactive audio, which lets the model "decide not to respond if the content is not relevant". It is always on for 3.8.
  4. The server flag `waitingForInput`, which indicates the model expects the user to continue.
- [UNVERIFIED] There is no documented flag that guarantees silence during a long thinking pause under automatic VAD. Relying on system instructions for this is untested.
- **Recommendation for a speaking coach:** use push-to-talk, or hybrid VAD with a generous client-side end threshold.

**Affective dialog and proactive audio [VERIFIED, but the docs conflict]**
- The 3.8 Live model page says: "Affective dialogue is removed from the API. Remove any `enable_affective_dialog` configurations." It also says proactive audio is permanently on, and setting `proactive_audio: false` returns an error.
- The capabilities guide still documents `enable_affective_dialog` (v1beta). Follow the model page for 3.8.

**Other notes [VERIFIED]**
- The best-practices page still shows the banner "Preview: The Live API is in preview", even though the 3.8 Live models are GA.
- Blog claims (not re-tested): 97 languages, and 3.8 Live Extended Thinking ranks #1 on the Artificial Analysis S2S index.

## 4. Verbatim transcription with fillers and word timestamps

Best option: **`gemini-3.5-transcribe`** (GA 2026-08-26), using batch requests through the Interactions API. Source: https://ai.google.dev/gemini-api/docs/transcribe

**What it does [VERIFIED]**
- `verbatim` is the **default** mode. It "preserv[es] raw filler words ('um', 'uh', 'like', 'you know'), repetitions, pauses, and false starts".
- Word timestamps: set `transcription_config.mode = {"type":"verbatim","timestamp_granularities":["word"]}`. Results come back as `word_info` annotations with start and end offsets. Pause durations can be computed from the gaps between words [INFERRED].
- Diarization (`diarization_mode: "speaker"`) can be combined with timestamps.

**Limitations [VERIFIED]**
- Word timestamps "may degrade overall transcription accuracy".
- `custom_vocabulary` cannot be combined with timestamps or diarization.
- `smart` mode cannot be combined with timestamps or diarization.
- Maximum audio length is 1 h, or **30 min when timestamps or diarization are on**.

**Accepted formats [VERIFIED]:** wav, mp3, aac, ogg, flac, m4a, opus, **webm**, and l16. A MediaRecorder webm/opus or mp4 blob from Chrome should work; test the iOS mp4 output.

**Price (paid tier) [VERIFIED]**
- Input: $2.00/M audio tokens (about $0.003/min).
- Output: $12.00/M text tokens (about $0.002/min).
- Google's blended estimate: **about $0.005/min**, assuming 175 output tokens per minute.
- Word-timestamp annotations probably produce more output tokens than that [UNVERIFIED].

**Streaming option:** `gemini-3.5-transcribe-live` (GA).
- Price: $3.50/M input and $21/M output, about $0.009/min.
- VERBATIM (default) or SMART modes, plus interim and final results.
- Limits: **utterance-level timestamps only**, no diarization, 10-min sessions.

**Other Google speech products:** I did not research Google Cloud Speech-to-Text (Chirp) for this report [UNVERIFIED]. The Gemini Transcribe model already covers the requirement.

## 5. Image models (Nano Banana family) [VERIFIED, pricing page]

| Name | ID | Status | Standard price per image |
|---|---|---|---|
| Nano Banana 2 Lite | `gemini-3.1-flash-lite-image` | GA (2026-06-30) | **$0.0336 per 1K image** ($30/M output tokens, 1,120 tokens per image). Batch: $0.0168 |
| Nano Banana 2 | `gemini-3.1-flash-image` | GA (2026-05-28) | $0.045 (0.5K), **$0.067 (1K)**, $0.101 (2K), $0.151 (4K). Batch is about half |
| Nano Banana Pro | `gemini-3-pro-image` | GA (2026-05-28) | $0.134 (1K/2K), $0.24 (4K) |
| (old) Nano Banana | `gemini-2.5-flash-image` | **Shut down 2026-10-02** | — |

There is no free tier for image models ("Not available").

## 6. Monthly cost estimate [INFERRED arithmetic from VERIFIED rates]

Assumptions:
- 25 audio tokens/s, so 1,500 tokens/min.
- 17 sessions of 10 min each.
- The model speaks about 40% of the time.
- About 30 turns per session.
- Paid-tier rates, using the introductory 3.8 Flash price that runs through 2026-12-31.

**A. Live audio (`gemini-3.8-live`)**
- Input (billed the whole time because proactive audio is always on): 170 min × 1,500 = 255,000 tok × $3/M = **$0.77**
- Output audio: 170 × 0.4 = 68 min × 1,500 = 102,000 tok × $12/M = **$1.22**
- Transcription text: about 175 tok/min × 170 = 29,750 tok × $4.50/M = **$0.13**
- Per-turn re-billing of accumulated context (worst case, no compression):
  - Context grows to about 15,000 tok per 10-min session.
  - Over 30 turns, the summed prior context is about 217,500 tok per session.
  - Cost: 217,500 × $3/M = $0.65 per session × 17 = **about $11.09**
- **Live subtotal: about $2.12 (lower bound) to about $13.21 (with full re-billing)**

**B. Coaching text (`gemini-3.8-flash`): 40 calls**
- Each call: about 3k input + 1k output (including thinking).
- Input: 40 × 3,000 × $0.75/M = $0.09. Output: 40 × 1,000 × $3.75/M = $0.15.
- **Subtotal: $0.24.** From 2027-01-01 the price doubles to about $0.48.

**C. Images: 20 per month**
- Nano Banana 2 Lite: 20 × $0.0336 = **$0.67**
- Nano Banana 2 at 1K: 20 × $0.067 = $1.34

**D. Verbatim transcription (`gemini-3.5-transcribe`): 80 min**
- Input: 80 × 1,500 × $2/M = $0.24. Output: 80 × 175 × $12/M = $0.17.
- **Subtotal: about $0.41.** More if word timestamps raise output tokens.

**Total**
- About **$3.4/month** in the best case (2.12 + 0.24 + 0.67 + 0.41).
- About **$15/month** in the worst case (13.21 + 0.24 + 1.34 + 0.41).
- The biggest unknown is how much Live context re-billing actually costs. Measure it from `usageMetadata`. A sliding-window compression trigger limits it.
- The free tier covers Live, Flash and Transcribe at $0 but uses your data for training. Images have no free tier.

## 7. iOS Chrome (WebKit) audio pitfalls

iOS Chrome uses WebKit, so Safari's media and WebAudio bugs apply to it. I did not find any official Google Live API documentation addressing iOS or Safari specifically [UNVERIFIED gap].

| Issue | Status | Source |
|---|---|---|
| `echoCancellation` constraint had no effect | Resolved FIXED (2019) | https://bugs.webkit.org/show_bug.cgi?id=179411 |
| Volume drops sharply after granting mic permission (audio session category switches to play-and-record) | Resolved "CONFIGURATION CHANGED" (2026-05) | https://bugs.webkit.org/show_bug.cgi?id=218012 |
| iOS 15: WebRTC audio too quiet / routed to earpiece | Resolved CONFIGURATION CHANGED | https://bugs.webkit.org/show_bug.cgi?id=230902, https://bugs.webkit.org/show_bug.cgi?id=231421 (duplicate) |
| WebAudio delayed or glitchy after `getUserMedia` | **Still NEW (open)** | https://bugs.webkit.org/show_bug.cgi?id=221334 |
| Distorted audio after `getUserMedia` with `AudioWorkletNode` | FIXED (2023) | https://bugs.webkit.org/show_bug.cgi?id=251091 |
| iPadOS 17.5 regression: 44.1 kHz AudioContext + AudioWorklet distortion | FIXED (2024) | https://bugs.webkit.org/show_bug.cgi?id=274507 |
| WebAudio muted when the ringer switch is on silent | CONFIGURATION CHANGED. Mitigate with `navigator.audioSession.type` | https://bugs.webkit.org/show_bug.cgi?id=237322 |
| AudioContext suspended when the page goes to the background | FIXED (2024) | https://bugs.webkit.org/show_bug.cgi?id=261554 |
| `getUserMedia` with a `sampleRate` constraint may fail | FIXED (2020) | https://bugs.webkit.org/show_bug.cgi?id=217147 |
| Audio element volume cannot be changed once an AudioContext exists | REOPENED | https://bugs.webkit.org/show_bug.cgi?id=244667 |
| AudioWorklet example didn't work in Chrome iOS | WORKSFORME | https://bugs.webkit.org/show_bug.cgi?id=253220 |

**Audio Session API:** `navigator.audioSession.type = 'play-and-record'` has been available since Safari 16.4. Spec: https://w3c.github.io/audio-session/. Release notes: https://webkit.org/blog/13966/webkit-features-in-safari-16-4/

**Google's reference web app:** https://github.com/google-gemini/live-api-web-console
- Open issue #21: "Audio recording does not work on Safari" (desktop Safari 18.1, mic level stays at 0).
- Open PR #22 simplifies AudioContext creation to fix it.
- Both are unmerged as of 2026-10-05, and the repo's last push was 2026-06-21.

**Practical guidance [INFERRED from the above]**
- Create and resume one AudioContext inside the user's tap.
- Don't force a `sampleRate` on iOS. Capture at the native rate (usually 48 kHz) and resample to 16 kHz in the worklet, or send `audio/pcm;rate=48000` and let the server resample.
- Set `navigator.audioSession.type = 'play-and-record'` before capture.
- Play 24 kHz output through the same AudioContext with a gain node, not an `<audio>` element.
- Request `echoCancellation: true`. Test speaker-mode echo on a real iPhone, since barge-in will trigger on echo if AEC fails. Suggest headphones, or use push-to-talk.
- On `interrupted`, flush queued buffers.
- Handle `visibilitychange` and reconnect when it fires, because iOS suspends background tabs.

## Unverified or open items (summary)
1. Whether `gemini-3.8-live` input transcription honors `mode: VERBATIM` and `wordTimestamp`. The reference lists the fields; the Live Transcribe guide says no word timestamps over Live. Test it.
2. How much per-turn context re-billing actually adds for 10-min sessions. Measure with `usageMetadata`.
3. How many output tokens word-timestamp annotations add to Transcribe cost.
4. Whether system instructions alone can keep the 3.8 Live model quiet during long pauses under automatic VAD.
5. Whether iOS Chrome's MediaRecorder output format (likely mp4/aac) is accepted by Transcribe (`audio/m4a` and `audio/aac` are listed).
6. Google Cloud Speech-to-Text (Chirp) was not compared.
7. The Live API best-practices page still carries a "Preview" banner, while the models are GA.
