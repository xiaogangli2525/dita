'use strict';
(function (root) {
  // Buildless composition root. Modules receive declared capability subsets;
  // DitaApp remains a compatibility surface for the page and integrations.
  function compose(host, definitions) {
    const names = new Set(), available = new Set(Object.keys(host));
    for (const feature of definitions) {
      if (names.has(feature.name) || Object.hasOwn(host, feature.name)) throw new Error('重复初始化功能：' + feature.name);
      names.add(feature.name); available.add(feature.name);
    }
    for (const feature of definitions) {
      for (const key of feature.expose || []) {
        if (available.has(key)) throw new Error('重复公开接口：' + key);
        available.add(key);
      }
    }
    // Validate the complete plan before any factory installs DOM listeners.
    const ready = new Set(Object.keys(host));
    for (const feature of definitions) {
      if (typeof feature.create !== 'function') throw new Error('缺少功能工厂：' + feature.name);
      for (const key of feature.ports || []) if (!available.has(key)) throw new Error(feature.name + ' 依赖未知接口：' + key);
      for (const key of feature.writable || []) if (!feature.ports?.includes(key) || !Object.hasOwn(host, key)) throw new Error(feature.name + ' 声明了无效的可写接口：' + key);
      for (const key of feature.requires || []) if (!ready.has(key)) throw new Error(feature.name + ' 初始化前需要：' + key);
      ready.add(feature.name); (feature.expose || []).forEach(key => ready.add(key));
    }
    for (const feature of definitions) {
      const ports = {};
      for (const key of feature.ports || []) Object.defineProperty(ports, key, {
        enumerable: true, get: () => host[key],
        ...(feature.writable?.includes(key) ? { set: value => { host[key] = value; } } : {})
      });
      host[feature.name] = feature.create(Object.freeze(ports)) || {};
      for (const key of feature.expose || []) Object.defineProperty(host, key, { enumerable: true, get: () => host[feature.name][key] });
    }
    return host;
  }
  function start(host, views, catalog = root) {
    const feature = (name, module, method, ports, requires = [], extra = {}) => ({
      name, ports: ports.split(' '), requires,
      create: typeof catalog[module]?.[method] === 'function' ? context => catalog[module][method](context, extra.views) : undefined,
      ...extra
    });
    return compose(host, [
      feature('manual', 'DitaManualService', 'createManualService', 'state api ditaCore project'),
      feature('project', 'DitaProject', 'createProjectController', 'state api events manual setStatus', ['manual']),
      feature('delivery', 'DitaExport', 'createExportController', 'state dom api manual ditaCore setStatus toast navigateToSource downloadText showLoading hideLoading', ['manual'], {
        expose: ['openModelExport', 'releaseExportPreview', 'previewMapHtml', 'previewMapMd', 'exportMapToHtmlFile', 'exportMapToMarkdownFile', 'lastDeliveryRecord', 'lastExportReport']
      }),
      feature('save', 'DitaSave', 'createSaveController', 'state api events manual saving refreshChrome refreshFiles validateXml setStatus toast', ['manual'], { writable: ['saving'] }),
      feature('maps', 'DitaMapController', 'createMapController', 'state dom api setStatus setFileContent openFile', [], { views: views.maps }),
      feature('documents', 'DitaDocuments', 'createDocumentController', 'state api events setMode setStatus save footnotes validateXml downloadXML', ['save'], { views: views.documents }),
      feature('remoteLibraries', 'DitaRemoteLibraries', 'createController', 'state api events setStatus', [], { views: views.remoteLibraries }),
      feature('drafts', 'DitaDrafts', 'createDraftController', 'state api events openFile setFileContent setStatus toast downloadXML'),
      feature('authorSelection', 'DitaAuthorSelection', 'createController', 'state dom api events ditaCore applyAuthorEdit validateXml'),
      feature('bodyNavigation', 'DitaBodyNavigation', 'createController', 'state dom api events authorSelection openFile setMode setStatus', ['authorSelection']),
      feature('search', 'DitaSearch', 'createSearchController', 'state api events manual bodyNavigation navigateToSource', ['manual', 'bodyNavigation']),
      feature('authorCommands', 'DitaAuthorCommands', 'createController', 'state dom ditaCore authorSelection applyAuthorEdit validateXml', ['authorSelection'], {
        create: typeof catalog.DitaAuthorCommands?.createController === 'function' ? c => catalog.DitaAuthorCommands.createController({ state: c.state, dom: c.dom, core: c.ditaCore, selection: c.authorSelection, apply: c.applyAuthorEdit, validate: c.validateXml }) : undefined
      }),
      feature('inspector', 'DitaInspector', 'createController', 'state dom authorCommands editorTools setStatus', ['authorCommands'], {
        create: typeof catalog.DitaInspector?.createController === 'function' ? c => catalog.DitaInspector.createController({ state: c.state, dom: c.dom, commands: c.authorCommands, format: tag => c.editorTools.format(tag), status: c.setStatus }) : undefined
      }),
      feature('resources', 'DitaResources', 'createResourceController', 'state dom api events ditaCore manual authorSelection authorCommands setFileContent setStatus', ['manual', 'authorSelection', 'authorCommands']),
      feature('footnotes', 'DitaFootnotes', 'createPanel', 'state dom api events manual project authorSelection authorNotes bodyNavigation shell openFile setFileContent setMode setStatus applyAuthorEdit', ['manual', 'project', 'authorSelection', 'bodyNavigation']),
      feature('authorNotes', 'DitaAuthorNotes', 'createController', 'state dom events ditaCore project authorSelection footnotes shell applyAuthorEdit setStatus toast', ['project', 'authorSelection', 'footnotes']),
      feature('authorBlocks', 'DitaAuthorBlocks', 'createController', 'state dom events authorSelection setStatus toast', ['authorSelection']),
      feature('editorTools', 'DitaEditorTools', 'createController', 'state dom api events authorSelection authorNotes resources authorBlocks setStatus setFileContent setMode toast', ['authorSelection', 'authorNotes', 'resources', 'authorBlocks']),
      feature('clipboard', 'DitaClipboard', 'createController', 'state dom ditaCore authorSelection setStatus toast', ['authorSelection'], {
        create: typeof catalog.DitaClipboard?.createController === 'function' ? c => catalog.DitaClipboard.createController({ state: c.state, dom: c.dom, core: c.ditaCore, selection: c.authorSelection, status: c.setStatus, toast: c.toast }) : undefined
      }),
      feature('authorInput', 'DitaAuthorInput', 'createController', 'state dom authorSelection authorCommands setStatus toast', ['authorSelection', 'authorCommands']),
      feature('shell', 'DitaWorkspaceShell', 'createController', 'state dom events footnotes inspector setMode', ['footnotes', 'inspector'])
    ]);
  }
  const api = { compose, start };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaApplication = api;
})(typeof window === 'undefined' ? globalThis : window);
