import type { AiRequest, AiResult } from '../public/ai-contracts';
import { target, applyResult } from '../public/ai-edit-core';
import { create } from '../public/ai-conversation';
const request: AiRequest = { source: '<topic/>', start: 0, end: 8, instruction: '润色' };
const scope = target(request.source, request.start, request.end);
const result: AiResult = { summary: '', questions: [], edits: [{ id: 't0', before: 'a', after: 'b' }] };
const output: string = applyResult(scope, result).content;
void output;
// @ts-expect-error text replacements have no attribute or file write operation
const invalid: AiResult = { summary: '', questions: [], edits: [{ path: 'other.dita', xml: '<topic/>' }] };
void invalid;
// @ts-expect-error captured source cannot change during generation
scope.source = '<topic/>';
// @ts-expect-error captured fragments cannot be appended
scope.parts.push({ id: 'x', start: 0, end: 1, text: 'x', kind: 'text' });
// @ts-expect-error offsets are source positions, not strings
target(request.source, '0', 8);
const conversation = create(scope);
conversation.record('润色', result);
// @ts-expect-error retained user requirements are immutable
conversation.context().instructions.push('silently rewrite history');
// @ts-expect-error cumulative proposals do not grant file write capabilities
conversation.record('修改', { summary: '', questions: [], edits: [{ id: 't0', before: 'a', after: 'b', path: 'other.dita' }] });
