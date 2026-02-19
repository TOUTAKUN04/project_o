const { EventEmitter } = require('events');

function createBus(options = {}) {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(50);

  const maxQueue = Number.isFinite(options.maxQueue) ? options.maxQueue : 500;
  const logger = options.logger;

  let running = false;
  let draining = false;
  let seq = 0;
  const queue = [];

  function publish(event) {
    if (!event || !event.type) return;
    const item = {
      id: ++seq,
      ts: new Date().toISOString(),
      ...event,
    };
    queue.push(item);
    if (queue.length > maxQueue) {
      const dropped = queue.shift();
      if (logger) logger('warn', 'event bus queue full, dropping event', { type: dropped.type });
    }
    if (running && !draining) drain();
  }

  function drain() {
    if (draining) return;
    draining = true;
    setImmediate(() => {
      while (queue.length && running) {
        const evt = queue.shift();
        try {
          emitter.emit(evt.type, evt);
          emitter.emit('*', evt);
        } catch (error) {
          if (logger) logger('error', 'event bus handler error', { error: String(error) });
        }
      }
      draining = false;
      if (queue.length && running) drain();
    });
  }

  function subscribe(type, handler) {
    emitter.on(type, handler);
    return () => emitter.off(type, handler);
  }

  function start() {
    running = true;
    if (queue.length) drain();
  }

  function stop() {
    running = false;
    queue.length = 0;
  }

  return {
    publish,
    subscribe,
    start,
    stop,
  };
}

module.exports = { createBus };