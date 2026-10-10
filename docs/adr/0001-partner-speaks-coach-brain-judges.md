# The Partner speaks the Coaching point, but Gemini Flash chooses it

The learner wanted a single voice for both conversation and feedback, with no separate coach persona. Two problems follow from letting the Live model judge answers on its own:
- It drifts toward being too agreeable when it has to both push back and console.
- Its own transcription of the learner is not reliably verbatim, so it cannot accurately quote the learner's words.

So after each Answer, a text model (Gemini 3.8 Flash) picks the single Coaching point from the transcript. That point is injected into the Live session, and the Partner speaks it. The learner still hears one continuous conversation.

## Consequences

- **Wait time:** each Coaching point adds a 1–2 s pause, which the Partner covers with a short line such as "Let me think about that…".
- **Coaching quality:** this depends on the Flash prompt and the transcript, not on the Live model's own instructions.
