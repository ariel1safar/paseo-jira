import { test } from 'node:test';
import assert from 'node:assert/strict';

import { settings, workspace, harness } from './helpers.mjs';

test('header responds to branch and settings changes, switches to menu, removes no-match', () => {
  const { controller: c, buttons } = harness();
  c.upsert(workspace());
  assert.equal(buttons.size, 0);
  c.setSettings({ status: 'ready', values: settings });
  assert.equal(buttons.get('w').label, 'IC-01');
  c.upsert(workspace('w', 'IC-4 WEB-5'));
  assert.deepEqual(buttons.get('w').behavior.items.map(i => i.title), ['IC-4', 'WEB-5']);
  c.setSettings({ status: 'ready', values: { projects: {} } });
  assert.equal(buttons.size, 0);
  c.setSettings({ status: 'ready', values: settings });
  assert.equal(buttons.size, 1);
  c.upsert({ ...workspace(), name: 'plain', title: null, gitRuntime: null });
  assert.equal(buttons.size, 0);
});

test('header action, menu and slash open immediately using cached destinations', async () => {
  const { controller: c, buttons, opened } = harness();
  c.setSettings({ status: 'ready', values: settings });
  c.upsert(workspace());
  const pressed = buttons.get('w').behavior.onPress();
  assert.deepEqual(opened, ['https://jira.test/IC-01']);
  await pressed;
  const submitted = c.submit('w', 'web-009');
  assert.equal(opened[1], 'https://web.test/WEB-009');
  await submitted;
  await c.submit('w', '');
  assert.equal(opened[2], 'https://jira.test/IC-01');
  c.upsert(workspace('w', 'IC-4 WEB-5'));
  const selected = buttons.get('w').behavior.items[1].behavior.onPress();
  assert.equal(opened[3], 'https://web.test/WEB-5');
  await selected;
});

test('slash reports loading, missing config, invalid input, ambiguity and missing matches', async () => {
  const { controller: c } = harness();
  await assert.rejects(async () => c.submit('w', ''), /loading/i);
  c.setSettings({ status: 'error', error: 'Could not load Jira settings.' });
  await assert.rejects(async () => c.submit('w', ''), /load.*settings/i);
  c.setSettings({ status: 'ready', values: settings });
  await assert.rejects(async () => c.submit('w', ''), /loading/i);
  c.upsert(workspace());
  await assert.rejects(async () => c.submit('w', 'IC-1 extra'), /ticket key/i);
  await assert.rejects(async () => c.submit('w', 'OTHER-1'), /prefix/i);
  c.upsert(workspace('w', 'IC-1 WEB-2'));
  await assert.rejects(async () => c.submit('w', ''), /header menu|explicit/i);
  c.upsert({ ...workspace(), title: null, name: 'plain', gitRuntime: null });
  await assert.rejects(async () => c.submit('w', ''), /no.*ticket/i);
  c.setSettings({ status: 'ready', values: { projects: {} } });
  await assert.rejects(async () => c.submit('w', ''), /configur/i);
});

test('opener failures are clear and failed actions may be retried', async () => {
  const { controller: c, buttons } = harness(() => Promise.reject(new Error('OS failure')));
  c.setSettings({ status: 'ready', values: settings });
  c.upsert(workspace());
  await assert.rejects(c.submit('w', 'IC-1'), /open.*IC-1/i);
  await assert.rejects(buttons.get('w').behavior.onPress(), /open.*IC-01/i);
});

test('snapshot replacement, removal and disposal clean headers and invalidate stale actions', async () => {
  const { controller: c, buttons, opened } = harness();
  c.setSettings({ status: 'ready', values: settings });
  c.replace([workspace(), workspace('w2')]);
  const stale = buttons.get('w').behavior.onPress;
  c.replace([workspace('w2')]);
  assert.deepEqual([...buttons.keys()], ['w2']);
  await assert.rejects(async () => stale(), /changed|available/i);
  c.remove('w2');
  assert.equal(buttons.size, 0);
  c.dispose();
  c.upsert(workspace());
  c.setSettings({ status: 'ready', values: settings });
  assert.equal(buttons.size, 0);
  assert.equal(opened.length, 0);
});

test('changing a URL replaces cached actions and rejects an obsolete destination', async () => {
  const { controller: c, buttons, opened } = harness();
  c.setSettings({ status: 'ready', values: settings });
  c.upsert(workspace());
  const previous = buttons.get('w').behavior.onPress;
  c.setSettings({ status: 'ready', values: { projects: { p: [{ prefix: 'IC', urlTemplate: 'https://new.test/{ticket}' }] } } });
  await assert.rejects(async () => previous(), /changed/);
  const pending = buttons.get('w').behavior.onPress();
  assert.deepEqual(opened, ['https://new.test/IC-01']);
  await pending;
});

test('synchronously throwing platform opener becomes an actionable failure', async () => {
  const { controller: c } = harness(() => { throw new Error('blocked'); });
  c.setSettings({ status: 'ready', values: settings });
  c.upsert(workspace());
  await assert.rejects(c.submit('w', 'IC-1'), /Could not open IC-1/);
});
