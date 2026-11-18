'use strict';
function aborted(signal) {
  if (signal?.aborted) throw Object.assign(Error('已取消操作'), { name: 'AbortError' });
}
module.exports = { aborted };
