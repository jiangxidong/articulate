#!/bin/sh
# Answer clips for scripts/follow-up-check.mjs (ticket 09), modelled on a hedged answer from an early call.
# Made with macOS `say`; the check also uses the fake-mic clips in ../fake-mic/.
set -e
cd "$(dirname "$0")"
V=Samantha
gen() { say -v "$V" --file-format=WAVE --data-format=LEI16@24000 -o "$1" "$2"; }
gen hedge-size.wav "I think it depends. Um, if the café is big enough, we don't really need the ban, because there are enough tables. [[slnc 1500]] But if it's a small café, then, uh, maybe the laptops take too much space."
gen like-i-said.wav "Again, like I said, it depends on the size of the café. If it's big, it's fine. If it's small, it's a problem."
gen one-line.wav "If she added the ban, that could bring more people in."
gen number.wav "I'd say the laptop people are maybe ten to twenty percent of revenue on weekends. So the ban would have, um, a ten to twenty percent impact on revenue at most."
python3 ../fake-mic/normalize.py *.wav
