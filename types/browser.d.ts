export {};
declare global {
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
