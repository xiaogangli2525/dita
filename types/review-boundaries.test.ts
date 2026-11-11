import { createReviewSession } from '../public/review-session';
import { createReviewStore } from '../public/review-store';
import type { ReviewState, ReviewFrame } from '../public/review-contracts';
import type { HistoryMeta } from '../public/data-contracts';
declare const state: ReviewState;
declare const frame: ReviewFrame;
const session = createReviewSession({ state, progress: createReviewStore(null) });
const write = () => true;
session.decide(frame, new Map([[0, 'accept'], [2, null]]), write);
// @ts-expect-error Review decisions form a closed set.
session.decide(frame, new Map([[0, 'approved']]), write);
// @ts-expect-error A Topic decision index is numeric; namespacing belongs to the session.
session.decide(frame, new Map([['topic.dita::0', 'accept']]), write);
// @ts-expect-error A captured review frame cannot be retargeted.
frame.rootPath = 'another.dita';
// @ts-expect-error History stores supported review decisions only.
const invalidHistory: HistoryMeta = { reviewDecisionsAfter: new Map([[0, 'pending']]) };
void invalidHistory;
// @ts-expect-error Review storage requires exact serialized strings.
createReviewStore({ getItem: () => false, setItem() {}, removeItem() {} });
// @ts-expect-error Progress cannot use namespaced indices outside the session.
createReviewStore(null).save(state, frame.file, frame.baseline, frame.current, new Map([['topic::0', 'accept']]));
