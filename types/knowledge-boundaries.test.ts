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
