let sessionEditAllowed = false;
let sessionControlAllowed = false;

async function ensureEditPermission({ dialog, browserWindow }) {
  if (sessionEditAllowed) return true;

  const result = await dialog.showMessageBox(browserWindow, {
    type: 'warning',
    buttons: ['Allow', 'Deny'],
    defaultId: 0,
    cancelId: 1,
    title: 'Allow code edits for this session?',
    message: 'The assistant is requesting permission to edit files in this session.',
    detail: 'You can revoke by restarting the app.',
  });

  sessionEditAllowed = result.response === 0;
  return sessionEditAllowed;
}

async function ensureControlPermission({ dialog, browserWindow }) {
  if (sessionControlAllowed) return true;

  const result = await dialog.showMessageBox(browserWindow, {
    type: 'warning',
    buttons: ['Allow', 'Deny'],
    defaultId: 0,
    cancelId: 1,
    title: 'Allow app control for this session?',
    message: 'The assistant is requesting permission to launch or focus apps in this session.',
    detail: 'You can revoke by restarting the app.',
  });

  sessionControlAllowed = result.response === 0;
  return sessionControlAllowed;
}

function getSessionPermission() {
  return sessionEditAllowed;
}

function getSessionControlPermission() {
  return sessionControlAllowed;
}

module.exports = {
  ensureEditPermission,
  getSessionPermission,
  ensureControlPermission,
  getSessionControlPermission,
};