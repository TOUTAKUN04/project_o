const { createAdapterContext } = require('./adapter-base');

function createLocalAdapter({ bus, log, config } = {}) {
  const enabled = !!config?.adapters?.local;
  const ctx = createAdapterContext({ name: 'local', bus, log, enabled });

  function start() {
    if (!enabled) return;
    ctx.info('started');
  }

  function stop() {
    if (!enabled) return;
    ctx.info('stopped');
  }

  return {
    name: 'local',
    enabled,
    start,
    stop,
  };
}

module.exports = { createLocalAdapter };