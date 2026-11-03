'use strict';
// UI contracts; checked data contracts have one source in data-contracts.d.ts. This file is
// type-only documentation: it is not a browser script or a second state store.
/**
 * @typedef {import('./data-contracts').EditorMode} EditorMode
 * @typedef {import('./data-contracts').DocumentSnapshot} DocumentSnapshot
 * @typedef {import('./data-contracts').DocumentState} DocumentState
 * @typedef {import('./data-contracts').ProjectConfig} ProjectConfig
 * @typedef {import('./data-contracts').WorkspaceState} WorkspaceState
 *
 * @typedef {Object} WorkspaceApi
 * @property {string} token Live workspace identity; do not cache across awaits.
 * @property {(url:string, options?:Object)=>Promise<Response>} request
 * @property {(response:Response)=>Promise<string>} error
 *
 * @typedef {import('./data-contracts').ManualSnapshot} ManualSnapshot
 *
 * @typedef {Object} ManualService
 * Pure prepare/list/discovery/save-selection methods are supplied by manual-domain.
 * Capture/current/listFilters/verifyRules/scopePath own workspace IO and freshness.
 * @property {(path?:string,options?:{resources?:boolean,filterPath?:string})=>Promise<ManualSnapshot>} capture
 * @property {()=>Promise<{files:string[],truncated?:boolean}>} listFilters
 * @property {(snapshot:ManualSnapshot)=>boolean} current
 * @property {(snapshot:ManualSnapshot)=>Promise<void>} verifyRules Re-read external rules before delivering output.
 * @property {(snapshot:ManualSnapshot, model?:string, validateProject?:boolean, options?:{useRules?:boolean,prefixes?:boolean})=>Object} prepare
 * @property {(snapshot:ManualSnapshot, model?:string)=>{notes:Object[],calls:Object[],models:string[],report:Object}} listNotes First-use labels, source-scoped occurrences and deduplicated per-source usages with inherited conditions.
 * @property {(snapshot:ManualSnapshot)=>DocumentSnapshot[]} saveCandidates
 * @property {(snapshot:ManualSnapshot)=>object} discoverModels
 * @property {(snapshot:ManualSnapshot)=>string[]} listModels
 * @property {()=>string} scopePath
 *
 * @typedef {Object} FootnotePresentation
 * @property {string} scope Current functional-manual or independent-Topic path.
 * @property {(path:string)=>void} setScope
 * @property {()=>Promise<Object>} ready Shared, guarded presentation snapshot.
 * @property {()=>void} apply Update protected display markers without editing XML.
 * @property {(path:string,xmlPath:string)=>Promise<Object|null>} resolve
 *
 * @typedef {Object} WorkspaceLifecycle
 * @property {boolean} busy Read-only guard during initialization and switching.
 * @property {()=>Promise<void>} initialize
 * @property {(result:Object)=>Promise<void>} reloadWorkspace Adopt an acknowledged workspace and invalidate old UI requests.
 * @property {()=>Promise<void>} selectRepository
 * @property {()=>Promise<void>} selectBranch
 * @property {()=>Promise<void>} refreshWorkspaceTree Refresh directories without replacing working buffers.
 *
 * @typedef {Object} DocumentNavigation
 * @property {(path:string,options?:{preserveFootnotesScope?:boolean})=>Promise<DocumentState|null>} openFile Null means a newer navigation won.
 * @property {(path:string)=>void} closeFile
 * @property {(path:string,start?:number,end?:number,expected?:string)=>Promise<void>} navigateToSource Rejects stale navigation before moving focus/selection.
 *
 * @typedef {Object} ProjectService
 * @property {ProjectConfig} value
 * @property {string} error
 * @property {string|null} expectedContent
 * @property {()=>Promise<void>} ready
 *
 * @typedef {Object} DocumentLoader
 * @property {(path:string)=>Promise<DocumentState>} load Shared by Topic tabs and Map surfaces; never replaces an existing working buffer.
 *
 * @typedef {Object} XmlDomAdapter
 * @property {(source:string,Parser?:typeof DOMParser)=>{document:Document,tree:Object}} parseSource Validated DOM plus canonical UTF-16 source ranges.
 * @property {(source:string,Parser?:typeof DOMParser)=>Document} parseXml
 *
 * @typedef {Object} AuthorRenderer
 * @property {(source:string,ownerDocument:Document,normalizeOxy?:boolean,topicPath?:string,parsed?:Document)=>HTMLElement} createAuthorTopic Per-call projection; no application state or IO.
 * @property {(node:Node,ownerDocument:Document,context?:Object)=>Node|null} renderDitaNode
 *
 * @typedef {Object} AuthorSource
 * @property {(source:string,surface:HTMLElement)=>string} updateSource Candidate XML; may rebase surface identities. Caller owns freshness, history and saving.
 *
 * @typedef {Object} ManualPorts
 * @property {WorkspaceState} state
 * @property {WorkspaceApi} api
 * @property {ProjectService} project Resolved lazily after application composition.
 * @property {Object} noteRuleStore Resolved lazily; handles rule persistence and workspace identity.
 *
 * @typedef {import('./data-contracts').SavePorts} SavePorts
 *
 * @typedef {Object} ExportPorts
 * @property {{show:Function}} noteRules Source-rule review entry, resolved by application composition.
 * @property {WorkspaceState} state
 * @property {WorkspaceApi} api
 * @property {ManualService} manual
 * @property {Object} dom
 * @property {Object} ditaCore
 * @property {(message:string,error?:boolean)=>void} setStatus
 * @property {(message:string,level?:string)=>void} toast
 * @property {Function} navigateToSource
 * @property {Function} downloadText
 * @property {Function} showLoading
 * @property {Function} hideLoading
 *
 * Events: document:changed carries DocumentState; file:opened carries
 * DocumentState; file:closed carries a relative path. workspace:willChange
 * occurs before token/state replacement; workspace:changed after config load.
 * Snapshot identity must be rechecked after asynchronous work and before apply.
 */
