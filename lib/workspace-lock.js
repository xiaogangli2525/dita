'use strict';

// Reads may overlap; a switch/save waits for earlier reads and excludes later
// requests until complete. In particular, DOCS_ROOT cannot change mid-request.
function createWorkspaceLock() {
  const queue = [];
  let readers = 0;
  let writing = false;
  function drain() {
    if (writing || !queue.length) return;
    if (queue[0].write && readers) return;
    const next = queue.shift();
    if (next.write) writing = true;
    else readers++;
    Promise.resolve().then(next.run).then(next.resolve, next.reject).finally(() => {
      if (next.write) writing = false;
      else readers--;
      drain();
    });
    if (!next.write) drain();
  }
  return (write, run) => new Promise((resolve, reject) => {
    queue.push({ write, run, resolve, reject });
    drain();
  });
}

module.exports = { createWorkspaceLock };
