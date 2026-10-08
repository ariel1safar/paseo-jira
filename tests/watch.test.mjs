import { test } from 'node:test';
import assert from 'node:assert/strict';
import { watchJira } from '../client/watch.ts';
import { harness, settings, workspace } from './helpers.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const page = (entries, nextCursor = null) => ({ requestId: 'r', subscriptionId: 's', entries, pageInfo: { nextCursor, prevCursor: null, hasMore: nextCursor !== null } });
function observation(snapshot) {
  const observers = new Set();
  const value = { subscriptionId: 's', ready: Promise.resolve(snapshot), released: 0,
    subscribe(observer) { observers.add(observer); if (snapshot) observer.snapshot(snapshot); return () => observers.delete(observer); },
    async release() { value.released++; },
    snapshot(next) { for (const o of observers) o.snapshot(next); },
    update(message) { for (const o of observers) o.update(message); },
    error() { for (const o of observers) o.error(new Error('offline')); },
  };
  return value;
}
function setup({ first = page([workspace()]), listPage, read } = {}) {
  const ui = harness();
  const workspaces = observation(first);
  const events = observation({ subscriptionId: 'events' });
  const requests = [], reads = [], scheduled = [];
  const client = {
    paseo: {
      workspaces: { async list(options) { requests.push(options); if (options.subscribe) return { ...first, subscription: workspaces }; return listPage(options); } },
      observeEvents(types) { assert.deepEqual(types, ['status.plugin_settings_changed']); return events; },
    },
    rpc(contract, input) { reads.push({ contract, input }); return read ? read() : Promise.resolve({ status: 'ready', revision: '1', values: settings }); },
  };
  const stop = watchJira(client, ui.controller, (callback) => { const task = { callback, cancelled: false }; scheduled.push(task); return () => { task.cancelled = true; }; });
  return { ...ui, client, stop, workspaces, events, requests, reads, scheduled };
}
const update = w => ({ type: 'workspace_update', payload: { kind: 'upsert', workspace: w } });
const remove = id => ({ type: 'workspace_update', payload: { kind: 'remove', id } });
const changed = (settingsId = 'jira') => ({ type: 'status', payload: { status: 'plugin_settings_changed', pluginId: 'custom-install-id', settingsId } });

test('bootstrap owns demand, paginates and applies updates over delayed pages without resurrecting removals', async () => {
  const next = deferred();
  const h = setup({ first: page([workspace()], 'next'), listPage: () => next.promise });
  await tick();
  assert.deepEqual(h.requests, [{ subscribe: {}, page: { limit: 200 } }, { page: { limit: 200, cursor: 'next' } }]);
  h.workspaces.update(remove('w'));
  h.workspaces.update(update(workspace('w2', 'IC-9')));
  next.resolve(page([workspace('w2', 'IC-2'), workspace('w3')]));
  await tick();
  assert.deepEqual([...h.buttons.keys()].sort(), ['w2', 'w3']);
  assert.equal(h.buttons.get('w2').label, 'IC-9');
  h.stop();
  assert.equal(h.workspaces.released, 1);
  assert.equal(h.events.released, 1);
  assert.equal(h.buttons.size, 0);
});

test('settings events read this installation, ignore other settings IDs and reject out-of-order reads', async () => {
  const first = deferred(), second = deferred();
  let call = 0;
  const h = setup({ read: () => (++call === 1 ? first : second).promise });
  await tick();
  h.events.update(changed('other'));
  assert.equal(h.reads.length, 1);
  h.events.update(changed());
  second.resolve({ status: 'ready', revision: '2', values: settings });
  await tick();
  assert.equal(h.buttons.get('w').label, 'IC-01');
  first.resolve({ status: 'ready', revision: '1', values: { projects: {} } });
  await tick();
  assert.equal(h.buttons.get('w').label, 'IC-01');
  assert.deepEqual(h.reads[0].input, {});
  h.stop();
});

test('reconnect snapshots replace descriptors and refresh settings', async () => {
  const h = setup();
  await tick();
  h.workspaces.snapshot(page([workspace('new', 'IC-8')]));
  h.events.snapshot({ subscriptionId: 'new-events' });
  await tick();
  assert.deepEqual([...h.buttons.keys()], ['new']);
  assert.equal(h.buttons.get('new').label, 'IC-8');
  assert.equal(h.reads.length, 2);
  h.stop();
});

test('disposal ignores late bootstrap, page, settings and update results', async () => {
  const next = deferred(), read = deferred();
  const h = setup({ first: page([workspace()], 'next'), listPage: () => next.promise, read: () => read.promise });
  await tick();
  h.stop();
  next.resolve(page([workspace('late')]));
  read.resolve({ status: 'ready', revision: '1', values: settings });
  h.workspaces.update(update(workspace('later')));
  await tick();
  assert.equal(h.buttons.size, 0);
  assert.equal(h.scheduled.length, 0);
});

test('failed observation clears stale actions and schedules cancellable recovery', async () => {
  const h = setup();
  await tick();
  assert.equal(h.buttons.size, 1);
  h.workspaces.error();
  assert.equal(h.buttons.size, 0);
  assert.equal(h.scheduled.length, 1);
  h.scheduled[0].callback();
  await tick();
  assert.equal(h.buttons.size, 1);
  h.stop();
});

test('invalid saved settings produce a clear error instead of destinations', async () => {
  const h = setup({ read: () => Promise.resolve({ status: 'ready', revision: '1', values: { projects: { p: [{ prefix: 'IC', urlTemplate: 'http://unsafe/{ticket}' }] } } }) });
  await tick();
  assert.equal(h.buttons.size, 0);
  await assert.rejects(async () => h.controller.submit('w', ''), /settings.*invalid|invalid.*settings/i);
  h.stop();
});

test('subscription that arrives after disposal is released without adding headers', async () => {
  const h = harness();
  const bootstrap = deferred();
  const events = observation({ subscriptionId: 'e' });
  const workspaces = observation(page([workspace()]));
  const stop = watchJira({
    paseo: { observeEvents: () => events, workspaces: { list: () => bootstrap.promise } },
    rpc: async () => ({ status: 'ready', revision: '1', values: settings }),
  }, h.controller);
  stop();
  bootstrap.resolve({ ...page([workspace()]), subscription: workspaces });
  await tick();
  assert.equal(workspaces.released, 1);
  assert.equal(events.released, 1);
  assert.equal(h.buttons.size, 0);
});

test('new snapshot wins over old pagination and cleanup cancels pending retry', async () => {
  const next = deferred();
  const h = setup({ first: page([workspace()], 'next'), listPage: () => next.promise });
  await tick();
  h.workspaces.snapshot(page([workspace('fresh', 'IC-77')]));
  next.resolve(page([workspace('stale')]));
  await tick();
  assert.deepEqual([...h.buttons.keys()], ['fresh']);
  h.events.error();
  h.stop();
  assert.equal(h.scheduled[0].cancelled, true);
  h.scheduled[0].callback();
  assert.equal(h.buttons.size, 0);
});

test('RPC failures retry without keeping stale links', async () => {
  const h = setup({ read: () => Promise.reject(new Error('network')) });
  await tick();
  assert.equal(h.buttons.size, 0);
  assert.equal(h.scheduled.length, 1);
  await assert.rejects(async () => h.controller.submit('w', ''), /Reconnecting/);
  h.stop();
});

test('reconnect pagination hides stale workspace actions until the new snapshot is assembled', async () => {
  const next = deferred();
  const h = setup({ listPage: () => next.promise });
  await tick();
  assert.equal(h.buttons.size, 1);
  h.workspaces.snapshot(page([workspace('new')], 'next'));
  assert.equal(h.buttons.size, 0);
  next.resolve(page([]));
  await tick();
  assert.deepEqual([...h.buttons.keys()], ['new']);
  h.stop();
});
