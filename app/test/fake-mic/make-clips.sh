#!/bin/sh
# Regenerates the fake-mic Answers with macOS `say`. [[slnc N]] inserts N ms of digital silence.
# Test-only: served at /test/fake-mic/ and used by ?fakeMic=1.
set -e
cd "$(dirname "$0")"
V=Samantha
gen() { say -v "$V" --file-format=WAVE --data-format=LEI16@24000 -o "$1" "$2"; }
gen 01-main-pause.wav "Um, I think it's a good idea, but only partly. [[slnc 3000]] Uh, the main reason is the queue at the door. On weekends, like, a table taken for three hours is lost revenue. So I'd ban laptops at the window tables, but not everywhere."
gen 02-done.wav "Because the bottleneck on weekends is tables, not customers. If tables turn over faster, she serves more people."
gen 03-barge-in.wav "Sorry, let me jump in. The laptop people mostly come on weekdays anyway, so on Saturdays she doesn't really lose them."
gen 04-filler-pause.wav "Hmm, you know, I'd change my mind if, like, weekend sales per table went down after the ban. [[slnc 3000]] Then the ban is costing her money, and I'd drop it."
gen 07-redo.wav "My call is a partial ban. No laptops at the window tables on weekends, but the rest of the room stays open. Um, the reason is the queue: on Saturdays the bottleneck is tables, not customers, so faster turnover means more sales."
# Round 2 (cash) and the Transfer question (reservations).
gen 08-r2-main.wav "Uh, no, I don't think so. Like, most people pay by card now, but, um, some people still need cash. [[slnc 3000]] So I'd keep it, but maybe, you know, make card the default."
gen 09-r2-fu1.wav "Maybe if almost nobody paid cash, like under five percent. Then handling cash costs more than it brings in."
gen 10-r2-fu2.wav "Counting the cash takes maybe twenty minutes every night, so honestly it's a small cost."
gen 11-r2-fu3.wav "An older regular who only carries cash would just leave, and that's a customer we lose every week."
gen 12-r2-redo.wav "No, cafés shouldn't go cashless. Two reasons. First, cash costs very little to handle, maybe twenty minutes a night. Second, regulars who only carry cash would leave. So keep cash, and make card the default."
gen 13-transfer.wav "Um, I think, it depends. Walk-in only is good for small places, like, because people come more. [[slnc 2500]] But for, uh, busy restaurants, reservations are better, so I'd keep them there."
# Reached only in ?soak=1 runs, after the Round's usual Answers.
gen 05-repeat.wav "Sorry, could you repeat the question?"
say -v Yuna --file-format=WAVE --data-format=LEI16@24000 -o 06-korean.wav "진짜야? 잘 모르겠어요. 그냥 노트북 금지는 좀 심한 것 같아요."
python3 normalize.py *.wav
