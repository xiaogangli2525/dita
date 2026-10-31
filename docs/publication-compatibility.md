# Publication compatibility verification

PR #4 was merged into `master` at `ba21c6386fe87874d7e3fc50dc06ed79adc257f7` before this work. The GitHub connection exposes only `xiaogangli2525/dita`; no company documentation repository or existing released manual was available. These checks use the representative, fictional MQTT fixture in `tests/fixtures/manual`, not company-document acceptance or verification of actual product capabilities.

## Verified workflow

The fixture contains an independent function Map, two Topics, a resource-only reuse Topic, a local SVG, a DTD declaration, a GBK-declared Chinese Topic, a CALS table, a simple table, a list and a command example. Source fixtures are stored as UTF-8 in Git; the browser test encodes the GBK Topic to actual GBK bytes before starting the server.

- Edit the GBK Topic, save through HTTP and verify Chinese text, the encoding declaration and the saved change using GBK decoding.
- Edit the reusable resource without saving, then export the function Map. Output uses the edited resource buffer while its disk source remains unchanged.
- Preview M100/M200/M300 in Chromium; verify included/excluded notes, unchanged body, rendered images, working target anchors and table structure.
- Download both HTML and Markdown for each model (six actual browser downloads); verify filenames, model scope, embedded images, shared note content and absence of unused resource content.
- Keep existing editing, undo/review, export-snapshot and responsive regressions.

105 unit/HTTP tests and 12 Chromium tests passed. Run `npm test` and `npm run test:browser`. `DITA_CHROMIUM_EXECUTABLE` can select an installed Chromium binary.

## Supported publication behavior

| Case | Behavior |
| --- | --- |
| `fn product` and Topic ancestor `product` | Every applicable condition must match; body remains complete; no prose inference |
| Notes without any product condition | Always retained |
| Local `fn`/paragraph/other same-element `conref` | Resolve in publication copies; preserve the including element's attributes and ID; omit the referenced root ID when not locally supplied |
| Chained `conref` and images | Resolve relative to each source file and rebase image URIs into the including Topic |
| `xref type="fn"` across local files | Load dependencies even outside the Map; one definition/number for repeated calls across chapters |
| Map `processing-role="resource-only"` | Cascade the role; omit resource chapters; explicit normal descendants can publish |
| Local Topic/element links | Rewrite HTML and Markdown to explicit anchors; reject missing/out-of-Map targets |
| CALS/simple tables, list/table footnotes | Preserve content and publication context; HTML retains valid CALS row/column spans |
| Invalid or unsafe input | Report the file/reason and stop; no partial download |

Dependency loading is bounded to 128 files and 8M UTF-16 code units. Expansion is bounded to 24 references in a chain, 1,024 substitutions per publication preparation and 4M UTF-16 code units per expanded document. Paths must remain inside the selected workspace, with the HTTP server still enforcing real-path containment.

## Explicit remaining boundaries

This remains a lightweight publisher, not DITA-OT or a DTD/schema-validating processor. Common direct local reuse is supported; complete DITA processing is not claimed.

- Key-based reuse (`keyref`/`conkeyref`), push/range conrefs (`conaction`/`conrefend`), `xml:base`, child Maps/key scopes and Map-level model profiling are rejected. Map Topic-fragment selection is also rejected rather than ignored.
- Grouped product expressions are rejected for model footnotes. `audience`, `platform`, `props`, DITAVAL and other profiles are not used to filter Topic body content. The UI states that body content remains complete.
- Reused content with fragment-only xrefs needing ID relocation, duplicate IDs introduced by reuse, nested footnotes and footnote references inside other footnotes are rejected. DITA specialization generalization and external entity expansion are not implemented.
- Ordinary local links must point into the published Topics; a link whose target anchor cannot be emitted by the chosen format stops export. Other attachments are not packaged. HTML has valid explicit anchors; Markdown uses raw HTML anchors, so consumers must use a renderer that permits them.
- Markdown cannot represent merged table cells reliably, so it stops with a recommendation to export HTML. Images remain embedded in both formats. Nested list notes are rendered once and share the same numbering context.

Before company rollout, run this workflow against an authorized real function repository and compare its output with the current released manual. Product truth, full schema conformance and unseen company-specific structures have not been validated here.

Reference specifications consulted: [OASIS DITA conref](https://docs.oasis-open.org/dita/dita/v1.3/os/part2-tech-content/langRef/attributes/theconrefattribute.html), [conditional processing](https://docs.oasis-open.org/dita/dita/v1.3/os/part2-tech-content/archSpec/base/condproc.html) and [Map cascading](https://docs.oasis-open.org/dita/dita/v1.3/cs01/part1-base/archSpec/base/cascading-in-a-ditamap.html). The supported subset above defines this implementation's behavior.
