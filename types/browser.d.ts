export {};
declare global {
  var DitaKnowledgeSourceData: typeof import('../public/knowledge-source-data');
  var DitaKnowledgeRetrieval: typeof import('../public/knowledge-retrieval');
  var DitaKnowledgePlan: typeof import('../public/knowledge-plan');
  var DitaKnowledgeSearch: typeof import('../public/knowledge-search');
  var DitaKnowledgeSemantic: typeof import('../public/knowledge-semantic');
  var DitaKnowledgePackage: typeof import('../public/knowledge-package');
  var DitaKnowledgeReader: typeof import('../public/knowledge-reader');
  var DitaKnowledgeZip: typeof import('../public/knowledge-zip');
  var DitaDiffCore: typeof import('../public/diff-core');
  var DitaReviewStore: typeof import('../public/review-store');
  var DitaReviewSession: typeof import('../public/review-session');
  var DitaAiEditCore: typeof import('../public/ai-edit-core');
  var DitaAiConversation: typeof import('../public/ai-conversation');
  var DitaDocumentStore: typeof import('../public/document-store');
  var DitaSnapshotData: typeof import('../public/snapshot-data');
  var DitaDeliveryData: typeof import('../public/delivery-data');
  var DitaSave: typeof import('../public/save');
  var DitaManualService: typeof import('../public/manual-service');
  var DitaPublicationResolver: typeof import('../public/publication-resolver');
  var DitaManualDomain: typeof import('../public/manual-domain');
  var DitaManualCore: typeof import('../public/manual-core');
  var DitaProfiling: typeof import('../public/profiling-core');
  interface Window {
    DitaDocumentStore: typeof DitaDocumentStore; DitaSnapshotData: typeof DitaSnapshotData;
    DitaSave: typeof DitaSave; DitaDeliveryData: typeof DitaDeliveryData; DitaManualService: typeof DitaManualService;
    DitaPublicationResolver: typeof DitaPublicationResolver; DitaManualDomain: typeof DitaManualDomain;
    DitaManualCore: typeof DitaManualCore; DitaProfiling: typeof DitaProfiling;
  }
}
