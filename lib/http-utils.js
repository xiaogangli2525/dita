'use strict';
const MAX_BODY_SIZE = 5 * 1024 * 1024;

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(body);
}

function sendText(res, status, body, type = 'text/plain') {
  res.writeHead(status, {
    'content-type': `${type}; charset=utf-8`,
    'cache-control': 'no-store'
  });
  res.end(body);
}

async function readJson(req) {
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > MAX_BODY_SIZE) {
    throw Object.assign(new Error('Request body is too large'), { status: 413 });
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_SIZE) {
      throw Object.assign(new Error('Request body is too large'), { status: 413 });
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks);
  return JSON.parse(raw.toString('utf8'));
}

module.exports = { sendJson, sendText, readJson };
