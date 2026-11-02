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
 * @property {Map<string,{path:string,current:string}>} files Resolved dependency scope.
 * @property {Map<string,DocumentSnapshot>} buffers Captured opened-file values, never live history.
 * @property {ProjectConfig} project
 * @property {string|null} projectContent Exact model-config comparison base.
 *
 * @typedef {Object} ManualService
 * @property {(path?:string,options?:{resources?:boolean})=>Promise<ManualSnapshot>} capture
 * @property {(snapshot:ManualSnapshot)=>boolean} current
 * @property {(snapshot:ManualSnapshot, model?:string)=>Object} prepare
 * @property {(snapshot:ManualSnapshot, model?:string)=>{notes:Object[],calls:Object[],models:string[],report:Object}} listNotes First-use labels, source-scoped occurrences and deduplicated per-source usages with inherited conditions.
 * @property {(snapshot:ManualSnapshot)=>DocumentSnapshot[]} saveCandidates
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
 * @typedef {Object} ProjectService
 * @property {ProjectConfig} value
 * @property {string} error
 * @property {string|null} expectedContent
 * @property {()=>Promise<void>} ready
 *
 * @typedef {Object} DocumentLoader
 * @property {(path:string)=>Promise<DocumentState>} load Shared by Topic tabs and Map surfaces; never replaces an existing working buffer.
 *
 * @typedef {Object} ManualPorts
 * @property {WorkspaceState} state
 * @property {WorkspaceApi} api
 * @property {Object} ditaCore
 * @property {ProjectService} project Resolved lazily after application composition.
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
