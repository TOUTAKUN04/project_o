const crypto = require('crypto');

const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed', 'canceled']);
const STEP_TERMINAL_STATUSES = new Set(['completed', 'failed', 'skipped', 'canceled']);
const FORCED_APPROVAL_TOOLS = new Set([
  'files:save',
  'files.save',
  'files:create',
  'files.create',
  'system:run',
  'system.run',
]);

function nowIso() {
  return new Date().toISOString();
}

function makeTaskId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeSteps(rawSteps, fallbackGoal) {
  const input = Array.isArray(rawSteps) ? rawSteps : [];
  if (!input.length) {
    return [{
      name: 'Goal',
      stepType: 'note',
      input: { goal: String(fallbackGoal || '').slice(0, 2000) },
      requiresApproval: false,
    }];
  }

  return input.map((step, index) => {
    const stepType = step?.stepType === 'tool' ? 'tool' : 'note';
    const toolName = stepType === 'tool' ? String(step?.toolName || '').trim() : null;
    const toolKey = String(toolName || '').toLowerCase();
    const forcedApproval = stepType === 'tool' && FORCED_APPROVAL_TOOLS.has(toolKey);
    return {
      name: String(step?.name || `Step ${index + 1}`).slice(0, 240),
      stepType,
      toolName: toolName || null,
      input: step?.input === undefined ? null : step.input,
      requiresApproval: forcedApproval || !!step?.requiresApproval,
    };
  });
}

function createTaskEngine({
  db,
  handlers = {},
  bus,
  logger,
}) {
  if (!db) throw new Error('task engine requires db api');

  let running = false;

  function publish(eventType, payload) {
    if (bus && typeof bus.publish === 'function') {
      bus.publish({ type: eventType, payload: payload || {} });
    }
  }

  function log(level, message, meta) {
    if (typeof logger === 'function') logger(level, message, meta);
  }

  async function executeStep(task, step) {
    if (step.stepType === 'note') {
      return { ok: true, output: { note: step.input || null } };
    }

    if (step.stepType !== 'tool' || !step.toolName) {
      return { ok: false, reason: 'invalid_step' };
    }

    const handler = handlers[step.toolName];
    if (typeof handler !== 'function') {
      return { ok: false, reason: 'handler_not_found' };
    }

    try {
      const output = await handler(step.input || {}, {
        taskId: task.id,
        stepIndex: step.stepIndex,
        stepName: step.name,
        createdAt: nowIso(),
      });
      if (output && output.ok === false) {
        return { ok: false, reason: output.reason || 'step_failed', output };
      }
      return { ok: true, output: output || { ok: true } };
    } catch (error) {
      return { ok: false, reason: String(error) };
    }
  }

  async function runTaskById(taskId) {
    const task = db.getTaskById(taskId);
    if (!task) return;
    if (task.status === 'canceled') return;

    db.addTaskEvent({
      taskId,
      level: 'info',
      message: 'task_started',
      payload: { taskId, stepCount: task.steps.length },
    });
    publish('task:started', { taskId });

    for (const step of task.steps) {
      const fresh = db.getTaskById(taskId);
      if (!fresh) return;
      if (fresh.status === 'canceled') return;

      const currentStep = fresh.steps.find((item) => item.stepIndex === step.stepIndex);
      if (!currentStep) continue;
      if (STEP_TERMINAL_STATUSES.has(currentStep.status)) continue;

      if (currentStep.requiresApproval) {
        db.updateTaskStepStatus({
          taskId,
          stepIndex: currentStep.stepIndex,
          status: 'waiting_approval',
          output: null,
          errorText: null,
        });
        db.updateTaskStatus({
          taskId,
          status: 'waiting_approval',
          errorText: null,
          completedAt: null,
        });
        db.addTaskEvent({
          taskId,
          level: 'info',
          message: 'step_waiting_approval',
          payload: {
            stepIndex: currentStep.stepIndex,
            name: currentStep.name,
          },
        });
        publish('task:waiting_approval', {
          taskId,
          stepIndex: currentStep.stepIndex,
        });
        return;
      }

      db.updateTaskStepStatus({
        taskId,
        stepIndex: currentStep.stepIndex,
        status: 'running',
        output: null,
        errorText: null,
      });
      db.addTaskEvent({
        taskId,
        level: 'info',
        message: 'step_started',
        payload: {
          stepIndex: currentStep.stepIndex,
          name: currentStep.name,
          stepType: currentStep.stepType,
          toolName: currentStep.toolName || null,
        },
      });
      publish('task:step_started', {
        taskId,
        stepIndex: currentStep.stepIndex,
      });

      const result = await executeStep(fresh, currentStep);
      if (!result.ok) {
        db.updateTaskStepStatus({
          taskId,
          stepIndex: currentStep.stepIndex,
          status: 'failed',
          output: result.output || null,
          errorText: result.reason || 'step_failed',
        });
        db.updateTaskStatus({
          taskId,
          status: 'failed',
          errorText: result.reason || 'step_failed',
          completedAt: nowIso(),
        });
        db.addTaskEvent({
          taskId,
          level: 'error',
          message: 'step_failed',
          payload: {
            stepIndex: currentStep.stepIndex,
            reason: result.reason || 'step_failed',
          },
        });
        publish('task:failed', { taskId, stepIndex: currentStep.stepIndex });
        return;
      }

      db.updateTaskStepStatus({
        taskId,
        stepIndex: currentStep.stepIndex,
        status: 'completed',
        output: result.output || null,
        errorText: null,
      });
      db.addTaskEvent({
        taskId,
        level: 'info',
        message: 'step_completed',
        payload: {
          stepIndex: currentStep.stepIndex,
          output: result.output || null,
        },
      });
      publish('task:step_completed', {
        taskId,
        stepIndex: currentStep.stepIndex,
      });
    }

    db.updateTaskStatus({
      taskId,
      status: 'completed',
      errorText: null,
      completedAt: nowIso(),
    });
    db.addTaskEvent({
      taskId,
      level: 'info',
      message: 'task_completed',
      payload: { taskId },
    });
    publish('task:completed', { taskId });
  }

  async function drainQueue() {
    if (running) return;
    running = true;
    try {
      while (true) {
        const taskId = db.claimNextQueuedTask();
        if (!taskId) break;
        await runTaskById(taskId);
      }
    } catch (error) {
      log('error', 'task queue drain failed', { error: String(error) });
    } finally {
      running = false;
    }
  }

  function kick() {
    if (running) return;
    setImmediate(() => {
      drainQueue().catch((error) => {
        log('error', 'task queue kick failed', { error: String(error) });
      });
    });
  }

  function enqueue({ title, goal, steps, metadata }) {
    const taskId = makeTaskId();
    const normalizedSteps = normalizeSteps(steps, goal);
    const ok = db.createTask({
      id: taskId,
      title: String(title || 'Task').slice(0, 180),
      goal: String(goal || '').slice(0, 4000),
      metadata: metadata || null,
      steps: normalizedSteps,
    });
    if (!ok) return { ok: false, reason: 'db_insert_failed' };
    db.addTaskEvent({
      taskId,
      level: 'info',
      message: 'task_queued',
      payload: {
        title: String(title || 'Task'),
        stepCount: normalizedSteps.length,
      },
    });
    publish('task:queued', { taskId });
    kick();
    return { ok: true, taskId };
  }

  function get(taskId) {
    return db.getTaskById(taskId);
  }

  function list(limit) {
    return db.listTasks(limit);
  }

  function listEvents(taskId, limit) {
    return db.listTaskEvents(taskId, limit);
  }

  function approveStep(taskId, stepIndex) {
    const task = db.getTaskById(taskId);
    if (!task) return { ok: false, reason: 'not_found' };
    if (task.status !== 'waiting_approval') return { ok: false, reason: 'not_waiting_approval' };

    const step = task.steps.find((item) => item.stepIndex === stepIndex);
    if (!step) return { ok: false, reason: 'step_not_found' };
    if (step.status !== 'waiting_approval') return { ok: false, reason: 'step_not_waiting_approval' };

    const updated = db.updateTaskStepStatus({
      taskId,
      stepIndex,
      status: 'pending',
      output: null,
      errorText: null,
    });
    if (!updated) return { ok: false, reason: 'db_update_failed' };

    db.updateTaskStatus({
      taskId,
      status: 'queued',
      errorText: null,
      completedAt: null,
    });
    db.addTaskEvent({
      taskId,
      level: 'info',
      message: 'step_approved',
      payload: { stepIndex },
    });
    publish('task:step_approved', { taskId, stepIndex });
    kick();
    return { ok: true };
  }

  function cancel(taskId) {
    const task = db.getTaskById(taskId);
    if (!task) return { ok: false, reason: 'not_found' };
    if (TERMINAL_TASK_STATUSES.has(task.status)) return { ok: false, reason: 'already_finalized' };

    db.cancelPendingTaskSteps(taskId);
    db.updateTaskStatus({
      taskId,
      status: 'canceled',
      errorText: null,
      completedAt: nowIso(),
    });
    db.addTaskEvent({
      taskId,
      level: 'warn',
      message: 'task_canceled',
      payload: { taskId },
    });
    publish('task:canceled', { taskId });
    return { ok: true };
  }

  return {
    enqueue,
    get,
    list,
    listEvents,
    approveStep,
    cancel,
    kick,
    drainQueue,
  };
}

module.exports = { createTaskEngine };
