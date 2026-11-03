'use strict';
// JSDoc contracts for editor autocomplete and module boundaries. This file is
// type-only documentation: it is not a browser script or a second state store.
/**
 * @typedef {'editor'|'visual'|'preview'|'review'} EditorMode
 * @typedef {Object} DocumentSnapshot
 * @property {string} path Repository-relative source path.
 * @property {string} current Working XML, possibly unsaved or temporarily invalid.
 * @property {string} disk Last acknowledged filesystem/browser-save XML.
 * @property {string} baseline Git comparison XML; independent of disk and current.
 * @property {string} gitStatus
 * @property {boolean} dirty Always current !== disk.
 *
 * @typedef {DocumentSnapshot & {history?: Object}} DocumentState
 * @typedef {{schema:1, models:string[]}} ProjectConfig
 * @typedef {Object} WorkspaceState
 * @property {string} root
 * @property {string} currentBranch
 * @property {string} activePath
 * @property {EditorMode} mode
 * @property {Map<string, DocumentState>} filesMap
 * @property {Set<string>} mapAuthorPaths
 * @property {{persistence:string, git:boolean, pdf?:boolean, remoteGit?:boolean}} capabilities
 *
 * @typedef {Object} WorkspaceApi
 * @property {string} token Live workspace identity; do not cache across awaits.
 * @property {(url:string, options?:Object)=>Promise<Response>} request
 * @property {(response:Response)=>Promise<string>} error
 *
 * @typedef {Object} ManualSnapshot
 * @property {string} workspace
 * @property {string} root
 * @property {string} branch
 * @property {string} path
 * @property {string} content
 * @property {Object} map
 * @property {ReadonlyMap<string,Readonly<{path:string,current:string}>>} files Resolved dependencies; records are copied/frozen. Collections remain Maps and must be treated as read-only.
 * @property {ReadonlyMap<string,DocumentSnapshot>} buffers Captured opened-file values, never live history.
 * @property {{path:string,current:string}|null} filter Captured DITAVAL, independently versioned from topic dependencies.
 * @property {Readonly<ProjectConfig>} project Detached/frozen model config captured before document IO; its models array is frozen too.
 * @property {string|null} projectContent Exact model-config comparison base.
 * @property {{config:Object,expectedContent:string|null,supported:boolean,error?:string}|null} noteRules Captured external export rules; never embedded in authoring XML.
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
 * @typedef {Object} SavePorts
 * @property {WorkspaceState} state
 * @property {WorkspaceApi} api
 * @property {ManualService} manual
 * @property {{emit:Function}} events
 * @property {boolean} saving Shared busy state, the only writable service port.
 * @property {(xml:string)=>unknown} validateXml
 * @property {()=>void} refreshChrome
 * @property {()=>void} refreshFiles
 * @property {(message:string, error?:boolean)=>void} setStatus
 * @property {(message:string, level?:string)=>void} toast
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
