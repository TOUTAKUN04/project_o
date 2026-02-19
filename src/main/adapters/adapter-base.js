function createAdapterContext({ name, bus, log, enabled }) {
  function publish(event) {
    if (!enabled || !bus) return;
    bus.publish({
      type: 'adapter:incoming',
      payload: {
        adapter: name,
        ...event,
      },
    });
  }

  function info(message, meta) {
    if (log) log('info', `adapter:${name} ${message}`, meta);
  }

  function warn(message, meta) {
    if (log) log('warn', `adapter:${name} ${message}`, meta);
  }

  function error(message, meta) {
    if (log) log('error', `adapter:${name} ${message}`, meta);
  }

  return {
    name,
    enabled,
    publish,
    info,
    warn,
    error,
  };
}

module.exports = { createAdapterContext };