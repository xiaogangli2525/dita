export {};
declare global {
  var fflate: Pick<typeof import('fflate'), 'deflateSync'>;
  var DitaKnowledgeSourceData: typeof import('../public/knowledge/knowledge-source-data');
  var DitaKnowledgeRetrieval: typeof import('../public/knowledge/knowledge-retrieval');
  var DitaKnowledgePlan: typeof import('../public/knowledge/knowledge-plan');
  var DitaKnowledgeSearch: typeof import('../public/knowledge/knowledge-search');
  var DitaKnowledgeSemantic: typeof import('../public/knowledge/knowledge-semantic');
  var DitaKnowledgePackage: typeof import('../public/knowledge/knowledge-package');
  var DitaKnowledgeReader: typeof import('../public/knowledge/knowledge-reader');
  var DitaKnowledgeLimits: typeof import('../public/knowledge/knowledge-limits');
  var DitaKnowledgeSearchProfile: typeof import('../public/knowledge/knowledge-search-profile');
  var DitaKnowledgeZip: typeof import('../public/knowledge/knowledge-zip');
  var DitaDiffCore: typeof import('../public/diff-core');
  var DitaReviewStore: typeof import('../public/review/review-store');
  var DitaReviewSession: typeof import('../public/review/review-session');
  var DitaReviewView: typeof import('../public/review/review-view');
  var DitaReviewMarkup: typeof import('../public/review/review-markup');
  var DitaAiEditCore: typeof import('../public/ai/ai-edit-core');
  var DitaAiConversation: typeof import('../public/ai/ai-conversation');
  var DitaAiContext: typeof import('../public/ai/ai-context');
  var DitaAiTaskStore: typeof import('../public/ai/ai-task-store');
  var DitaSearchCore: typeof import('../public/search-core');
  var DitaDocumentStore: typeof import('../public/document-store');
  var DitaDocumentLoader: typeof import('../public/workspace/document-loader');
  var DitaDocumentNavigation: typeof import('../public/workspace/document-navigation');
  var DitaWorkspaceClient: ReturnType<typeof import('../public/workspace/workspace-client').createWorkspaceClient>;
  var DitaSnapshotData: typeof import('../public/snapshot-data');
  var DitaDeliveryData: typeof import('../public/delivery/delivery-data');
  var DitaDeliveryDocument: typeof import('../public/delivery/delivery-document');
  var DitaReleaseStore: typeof import('../public/delivery/release-store');
  var DitaSave: typeof import('../public/save');
  var DitaManualService: typeof import('../public/manual-service');
  var DitaPublicationResolver: typeof import('../public/publication-resolver');
  var DitaManualDomain: typeof import('../public/manual-domain');
  var DitaManualCore: typeof import('../public/manual-core');
  var DitaProfiling: typeof import('../public/profiling-core');
  var DitaConditionGroups: typeof import('../public/condition-groups');
  var DitaThemePreference: typeof import('../public/appearance/theme-preference');
  var sax: typeof import('../public/vendor/sax');
  var DitaXmlSource: typeof import('../public/xml-source');
  var DitaMapSource: typeof import('../public/editor/map-source');
  var DitaMapAuthorController: typeof import('../public/editor/map-author-controller');
  var DitaKnowledgeMetadata: typeof import('../public/knowledge/knowledge-metadata');
  var DitaKnowledgeStructure: typeof import('../public/knowledge/knowledge-structure');
  var DitaKnowledgeDocument: typeof import('../public/knowledge/knowledge-document');
  interface HTMLElement {
    ditaSourceContent?: string;
    ditaSourcePath?: string;
    ditaReviewOriginal?: Text;
  }
  interface Text { ditaSourceTextPath?: string; }
  interface Window {
    DitaInputHistory: typeof import('../public/editor/input-history');
    DitaGitCommit: { createController(ports: import('../public/data-contracts').GitCommitPorts): object };
    DitaDocumentStore: typeof DitaDocumentStore; DitaSnapshotData: typeof DitaSnapshotData;
    DitaSave: typeof DitaSave; DitaDeliveryData: typeof DitaDeliveryData; DitaManualService: typeof DitaManualService;
    DitaPublicationResolver: typeof DitaPublicationResolver; DitaManualDomain: typeof DitaManualDomain;
    DitaManualCore: typeof DitaManualCore; DitaProfiling: typeof DitaProfiling;
  }
}
