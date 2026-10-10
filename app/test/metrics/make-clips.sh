#!/bin/sh
# Answer clips for scripts/metrics-check.mjs (ticket 08): Holding-phrase openings, leading fillers, "like" as a verb, and
# an Answer that opens with background. Made with macOS `say`, like the fake-mic clips; the check also uses those.
set -e
cd "$(dirname "$0")"
V=Samantha
gen() { say -v "$V" --file-format=WAVE --data-format=LEI16@24000 -o "$1" "$2"; }
gen first-read.wav "Um, my first read is yes. It turns on the queue at the door. If the queue goes away, I'd drop the ban."
gen question-is-whether.wav "So the question is whether the laptops cost her tables. Uh, I think they do, so I'd ban them at the window."
gen not-assessed.wav "Not fully assessed yet — my first read is, like, the ban helps. You know, the weekend tables turn over faster."
gen like-verb.wav "Uh, um, honestly I like the idea. People like quiet cafés, but, like, you know, kind of not on weekends."
gen background-first.wav "Well, last weekend I went to a café near my office, and it was really full of people with laptops. So yes, I'd ban them."
python3 ../fake-mic/normalize.py *.wav
