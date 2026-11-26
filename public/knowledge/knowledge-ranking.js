'use strict';
(function (root) {
  const search = typeof module !== 'undefined' ? require('./knowledge-search') : root.DitaKnowledgeSearch;
  const { aliasesFor } = search.createSearchEngine();
  function rank(records, chunks, similarityAt, query, lexical, { manualId = '', module = '', mode = '', limit = 10, semanticOnly = false } = {}) {
    const byChapter = new Map();
    const entities = query.toLowerCase().match(/at\+[a-z0-9_]+|cm_[a-z0-9_]+|\b(?:https?|ftp|mqtt|webui|gpio|pdp|apn|ssl|tls|tcp|udp|dns|ntp)\b/g) || [];
    const secondaryAuth = /二次(?:认证|验证)|二级认证|双重认证|两步(?:认证|验证)|双因素认证|\b(?:2fa|mfa)\b/i;
    const needsSecondaryAuth = secondaryAuth.test(query);
    const webuiScope = !entities.length && query.includes('网页') && records.some(record => /webui/i.test(record.manualTitle));
    const inScope = record => (!manualId || record.manualId === manualId) && (!module || (record.module || '').toLowerCase() === module.toLowerCase()) &&
      (!mode || (record.mode || '').toLowerCase() === mode.toLowerCase()) && (!webuiScope || /webui/i.test(record.manualTitle)) &&
      (!needsSecondaryAuth || secondaryAuth.test([record.title, record.text, ...(record.aliases || [])].join(' '))) &&
      entities.every(term => [record.title, record.text, record.manualTitle, record.module, ...aliasesFor(record)].join(' ').toLowerCase().includes(term));
    for (const [i, chunk] of chunks.entries()) {
      const record = records[chunk.position];
      if (!inScope(record)) continue;
      const similarity = similarityAt(i);
      const old = byChapter.get(chunk.position);
      if (!old || similarity > old.similarity) byChapter.set(chunk.position, { position: chunk.position, similarity, excerpt: chunk.text,
        chunk: { unitId: chunk.unitId, sourceAnchor: chunk.sourceAnchor || chunk.anchor, sourcePath: chunk.sourcePath || record.sourcePath || '',
          start: chunk.start, end: chunk.end, kind: chunk.kind, section: chunk.section || [], noteIds: chunk.noteIds || [] } });
    }
    const semanticHits = [...byChapter.values()].sort((a, b) => b.similarity - a.similarity);
    const eligibleLexical = lexical.filter(hit => inScope(records[hit.position]));
    const lexicalRank = new Map(eligibleLexical.map((hit, rank) => [hit.position, rank]));
    const combined = semanticHits.filter(hit => hit.similarity >= 0.55).map((hit, rank) => ({
      ...hit, score: semanticOnly ? hit.similarity : 1 / (60 + rank + 1) + (lexicalRank.has(hit.position) ? 1 / (60 + lexicalRank.get(hit.position) + 1) : 0),
      reason: lexicalRank.has(hit.position) ? '关键词与语义匹配' : '语义相关片段', matchedTerms: [],
      semanticScore: Math.round(hit.similarity * 1000) / 1000
    }));
    if (!semanticOnly) {
      const positions = new Set(combined.map(hit => hit.position));
      for (const [rank, hit] of eligibleLexical.entries()) {
        if (!positions.has(hit.position)) combined.push({ ...hit, score: 1 / (60 + rank + 1) });
      }
      // Strong exact titles and explicit aliases retain lexical precedence.
      const first = eligibleLexical[0], next = eligibleLexical[1];
      const clearLexical = first && first.reason === '章节关键词匹配' && first.matchedTerms.length >= 3 &&
        (!next || first.score >= next.score * 2);
      if (first?.score >= 1500 || clearLexical) return eligibleLexical.slice(0, limit).map(hit => {
        const evidence = byChapter.get(hit.position);
        return evidence?.similarity >= 0.55 ? { ...hit, chunk: evidence.chunk } : hit;
      });
    }
    return combined.sort((a, b) => b.score - a.score).slice(0, limit);
  }
  const api = { rank };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaKnowledgeRanking = api;
})(typeof window === 'undefined' ? globalThis : window);
