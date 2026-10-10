# The browser decides when the learner's turn ends, not Gemini's voice detection

The learner needs to pause for 3 s or more mid-Answer and also end a turn instantly with Done. Gemini Live's automatic voice detection can't do both. The spike (ticket 01) found:
- a 2 s silence threshold cut into 3 s thinking pauses;
- `audioStreamEnd` doesn't end the turn early (the server still waits out the silence);
- forcing the end with a text `turnComplete` made the Partner answer twice.

So we turn automatic detection off. The browser detects speech from mic level, sends `activityStart` and `activityEnd`, and treats Done as an immediate `activityEnd`.

## Consequences

- **Silence threshold and barge-in level are now ours to tune.** They are mic-level thresholds in the client, not Gemini settings. Echo shows up as a false barge-in, so the barge-in threshold must stay above the speaker's echo level (measured on iPhone in ticket 01).
- **Billing:** audio is sent only during learner turns. Silence is never billed.
- Don't switch back to automatic detection to "simplify" turn-taking: it reintroduces all three problems above.
