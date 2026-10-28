(function () {
  var PROTOCOL = '2026-01-26';
  globalThis.__radviewerInlineWorker = true;
  if (!window.parent || window.parent === window) return;

  var nextId = 1;
  var pending = new Map();
  var opens = [];
  var openId = 0;

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return;
    var msg = event.data;
    if (!msg || msg.jsonrpc !== '2.0') return;
    if (msg.id != null && pending.has(msg.id)) {
      var waiter = pending.get(msg.id);
      pending.delete(msg.id);
      clearTimeout(waiter.timer);
      if (msg.error) waiter.reject(new Error(msg.error.message || 'RadViewer host error'));
      else waiter.resolve(msg.result);
      return;
    }
    if (msg.method === 'ping' && msg.id != null) {
      window.parent.postMessage({ jsonrpc: '2.0', id: msg.id, result: {} }, '*');
      return;
    }
    if (msg.method === 'ui/notifications/tool-result') deliver(msg.params || {});
    if (msg.id != null && msg.method) {
      window.parent.postMessage({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32601, message: 'Method not found: ' + msg.method },
      }, '*');
    }
  });

  function request(method, params, timeoutMs) {
    var id = nextId++;
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        pending.delete(id);
        reject(new Error('RadViewer timed out waiting for the host.'));
      }, timeoutMs || 60000);
      pending.set(id, { resolve: resolve, reject: reject, timer: timer });
      window.parent.postMessage({ jsonrpc: '2.0', id: id, method: method, params: params }, '*');
    });
  }

  function textOf(result) {
    var content = (result && result.content) || [];
    return content.filter(function (item) { return item && item.type === 'text'; }).map(function (item) { return item.text; }).join('\n');
  }

  function deliver(result) {
    if (!opens.length) return;
    var structured = (result && result.structuredContent) || {};
    var path = typeof structured.path === 'string' ? structured.path : '';
    var id = typeof structured.id === 'number' ? structured.id : 0;
    if (!path) {
      var matched = /（([^（）]+)）/.exec(textOf(result)) || /打开 (.+)。/.exec(textOf(result));
      path = matched ? matched[1] : '';
    }
    if (!path || (id && id === openId)) return;
    openId = id || openId + 1;
    var payload = JSON.stringify({ type: 'open', id: openId, path: path });
    opens.forEach(function (source) {
      if (source.onmessage) source.onmessage({ data: payload });
    });
  }

  var ready = request('ui/initialize', {
    appInfo: { name: 'radviewer', version: '0.1.2' },
    appCapabilities: {},
    protocolVersion: PROTOCOL,
  }, 15000).then(function () {
    window.parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized' }, '*');
  });

  function jsonResponse(body, status) {
    return new Response(JSON.stringify(body), {
      status: status,
      headers: { 'content-type': 'application/json' },
    });
  }

  function decodeBase64(value) {
    var binary = atob(value || '');
    var bytes = new Uint8Array(binary.length);
    for (var index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  var nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var raw = typeof input === 'string' ? input : (input && input.url);
    var parsed;
    try {
      parsed = new URL(raw, 'http://radviewer.local');
    } catch (error) {
      return nativeFetch(input, init);
    }
    if (parsed.pathname !== '/api/list' && parsed.pathname !== '/api/file') {
      return nativeFetch(input, init);
    }
    var filePath = parsed.searchParams.get('path') || '';
    var signal = init && init.signal;
    return ready.then(function () {
      if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (parsed.pathname === '/api/list') {
        return request('tools/call', { name: 'list_directory', arguments: { path: filePath } }).then(function (result) {
          if (result && result.isError) return jsonResponse({ ok: false, error: { message: textOf(result) } }, 400);
          return jsonResponse(result.structuredContent, 200);
        });
      }
      return request('tools/call', { name: 'read_file', arguments: { path: filePath } }).then(function (result) {
        if (result && result.isError) return jsonResponse({ ok: false, error: { message: textOf(result) } }, 400);
        var meta = result.structuredContent || {};
        var parts = [];
        var chain = Promise.resolve();
        var count = meta.chunks || 0;
        for (var index = 0; index < count; index += 1) {
          (function (chunkIndex) {
            chain = chain.then(function () {
              if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
              return request('tools/call', { name: 'read_file_chunk', arguments: { id: meta.id, index: chunkIndex } }).then(function (read) {
                if (read && read.isError) throw new Error(textOf(read));
                var blob = read && read._meta && read._meta.blob;
                if (typeof blob !== 'string') throw new Error('RadViewer: missing file chunk.');
                parts.push(decodeBase64(blob));
              });
            });
          })(index);
        }
        return chain.then(function () {
          var out = new Uint8Array(meta.size || 0);
          var offset = 0;
          parts.forEach(function (part) {
            out.set(part, offset);
            offset += part.length;
          });
          return new Response(out, { status: 200, headers: { 'content-type': 'application/octet-stream' } });
        });
      });
    });
  };

  function RadEventSource() {
    this.onmessage = null;
    this.onerror = null;
    this.readyState = 0;
    opens.push(this);
    var source = this;
    var timer = 0;
    function tick() {
      if (source.readyState === 2) return;
      ready.then(function () {
        return request('tools/call', { name: 'viewer_state', arguments: {} });
      }).then(function (result) {
        deliver(result || {});
      }).catch(function (error) {
        if (source.onerror) source.onerror(error);
      }).then(function () {
        if (source.readyState !== 2) timer = setTimeout(tick, 400);
      });
    }
    timer = setTimeout(tick, 50);
    this.close = function () {
      source.readyState = 2;
      clearTimeout(timer);
      var next = [];
      for (var index = 0; index < opens.length; index += 1) {
        if (opens[index] !== source) next.push(opens[index]);
      }
      opens = next;
    };
  }

  window.EventSource = RadEventSource;
})();
