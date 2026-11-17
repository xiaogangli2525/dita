import { buildPackage } from '../public/knowledge-package';
import { createSearchEngine } from '../public/knowledge-search';
import { createZip } from '../public/knowledge-zip';
import type { KnowledgeManual, SearchIndex } from '../public/knowledge-contracts';
declare const manual: KnowledgeManual;
buildPackage({ title: 'Docs', model: 'ML307G', sdkVersion: 'V1', manuals: [manual] });
// @ts-expect-error A package must pin its SDK version.
buildPackage({ title: 'Docs', model: 'ML307G', manuals: [manual] });
// @ts-expect-error Published content has an immutable model identity.
manual.model = 'ML307N';
// @ts-expect-error Source provenance cannot be overwritten by the reader.
manual.source.documents.push({ path: 'new.dita', sha256: 'unknown' });
// @ts-expect-error Files contain serialized bytes or text, never object graphs.
createZip([{ name: 'docs/index.html', content: { html: true } }]);
declare const index: SearchIndex;
// @ts-expect-error Search records require the owning manual identity.
createSearchEngine().search([{ title: 'AT+OPEN', text: 'Example' }], index, 'AT+OPEN');

import { createPlanStore } from '../public/knowledge-plan';
import type { KnowledgePlan } from '../public/knowledge-contracts';
declare const plan: KnowledgePlan;
// @ts-expect-error Source recipes retain the original publication condition.
plan.sources[0].filterPath = 'other.ditaval';
// @ts-expect-error A persisted plan cannot contain a mutable HTML snapshot.
createPlanStore(null).save({ ...plan, html: '<html>' });

import { hydrate } from '../public/knowledge-source-data';
import type { KnowledgeBundle } from '../public/knowledge-contracts';
declare const bundle: KnowledgeBundle;
hydrate(bundle);
// @ts-expect-error A captured source hash is immutable.
bundle.receipt.files[0].sha256 = 'changed';
// @ts-expect-error A Git revision is text, not an options object.
createPlanStore(null).save({ ...plan, sources: [{ ...plan.sources[0], revision: { branch: 'main' } }] });

import { defaultBuilder } from '../lib/knowledge-index';
import { combineIndexes } from '../public/knowledge-semantic';
const builder = defaultBuilder();
builder.manual(manual, { model: 'ML307G', force: true, signal: new AbortController().signal });
// @ts-expect-error Model scope must be a string.
builder.manual(manual, { model: ['ML307G'] });
// @ts-expect-error Snapshot entries are required for cache identity and validation.
builder.manual({ id: 'a', title: 'HTTP' });
declare const vectorResult: Awaited<ReturnType<typeof builder.book>>;
// @ts-expect-error Reuse statistics are immutable publication results.
vectorResult.stats.reusedManuals = 100;
combineIndexes([builder.recordsFor(manual)], [vectorResult.index]);

builder.publish({ model: 'ML307G', manuals: [manual] }, { archiveOverhead: 1000, onManual: result => { result.index.chunks.length; } });
// @ts-expect-error Publication needs the archive budget before it may infer.
builder.publish({ model: 'ML307G', manuals: [manual] }, { onManual: () => {} });
// @ts-expect-error Clients cannot inject their own prepared chunks into publication.
builder.publish({ model: 'ML307G', manuals: [manual] }, { archiveOverhead: 1000, onManual: () => {}, chunks: [] });
