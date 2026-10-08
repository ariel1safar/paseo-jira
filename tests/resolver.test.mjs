import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settingsSchema, validateTemplate } from '../shared/settings.ts';
import { detectTickets, manualTicket } from '../shared/resolver.ts';

const values = { projects: {
  alpha: [{ prefix: 'IC', urlTemplate: 'https://jira.example.com/browse/{ticket}' }, { prefix: 'WEB', urlTemplate: 'https://other.example.com/?issue={ticket}' }],
  beta: [{ prefix: 'IC', urlTemplate: 'https://beta.example.com/{ticket}' }],
}};
const workspace = (overrides = {}) => ({ projectId: 'alpha', name: 'IC-3', title: 'IC-2', gitRuntime: { currentBranch: 'feature/ic-001' }, ...overrides });
const keys = w => detectTickets(w, values).map(t => t.key);

test('settings default empty, normalize literal prefixes and reject duplicates within a project', () => {
  assert.deepEqual(settingsSchema.parse({}), { projects: {} });
  assert.equal(settingsSchema.parse({ projects: { p: [{ prefix: 'ic', urlTemplate: 'https://jira.test/{ticket}' }] } }).projects.p[0].prefix, 'IC');
  assert.throws(() => settingsSchema.parse({ projects: { p: [values.projects.alpha[0], { ...values.projects.alpha[0], prefix: 'ic' }] } }));
  for (const prefix of ['I.*', '', 'IC-1', 'IC X', '1IC']) {
    assert.throws(() => settingsSchema.parse({ projects: { p: [{ prefix, urlTemplate: 'https://jira.test/{ticket}' }] } }));
  }
  assert.doesNotThrow(() => settingsSchema.parse(values));
});

test('validates HTTPS templates and confines every placeholder to path or query', () => {
  for (const template of ['https://jira.test/browse/{ticket}', 'https://jira.test/?issue={ticket}', 'https://jira.test/{ticket}?key={ticket}#details']) assert.equal(validateTemplate(template), undefined, template);
  for (const template of ['http://jira.test/{ticket}', 'javascript:{ticket}', '//jira.test/{ticket}', 'https://user:pass@jira.test/{ticket}', 'https://{ticket}.test/browse', 'https://jira.test/#issue={ticket}', 'https://jira.test/{ticket}#{ticket}', 'https://jira.test/browse', 'https://jira.test/\\{ticket}', 'https://jira.test/\n{ticket}']) assert.equal(typeof validateTemplate(template), 'string', template);
});

test('branch then title then name, skipping sources without configured matches', () => {
  assert.deepEqual(keys(workspace()), ['IC-001']);
  assert.deepEqual(keys(workspace({ gitRuntime: { currentBranch: 'OTHER-9' } })), ['IC-2']);
  assert.deepEqual(keys(workspace({ gitRuntime: null, title: 'plain' })), ['IC-3']);
  assert.deepEqual(keys(workspace({ gitRuntime: null, title: null, name: 'plain' })), []);
});

test('whole token boundaries, case, repeated keys and multiple mappings preserve digit strings', () => {
  assert.deepEqual(keys(workspace({ gitRuntime: { currentBranch: 'feature/ic-001-thing/WEB-2 ic-001 (IC-4)' } })), ['IC-001', 'WEB-2', 'IC-4']);
  assert.deepEqual(keys(workspace({ gitRuntime: null, title: null, name: 'XIC-1 IC-1x _IC-2 IC-3_ éIC-4 IC-5é' })), []);
});

test('projects isolate destinations while worktrees share mappings, with no fallback', () => {
  assert.equal(detectTickets(workspace(), values)[0].url, 'https://jira.example.com/browse/IC-001');
  assert.equal(detectTickets(workspace({ projectId: 'beta' }), values)[0].url, 'https://beta.example.com/IC-001');
  assert.deepEqual(keys(workspace({ projectId: 'missing' })), []);
  assert.equal(detectTickets(workspace({ id: 'another-worktree' }), values)[0].url, 'https://jira.example.com/browse/IC-001');
});

test('manual ticket must be one exact configured key and preserves leading zeros', () => {
  assert.deepEqual(manualTicket('web-0002', 'alpha', values), { key: 'WEB-0002', url: 'https://other.example.com/?issue=WEB-0002' });
  for (const key of ['IC', 'IC-1 extra', 'IC-1/IC-2', 'IC-1x', 'IC--1']) assert.throws(() => manualTicket(key, 'alpha', values), /ticket key/i);
  assert.throws(() => manualTicket('NO-1', 'alpha', values), /prefix/i);
  assert.throws(() => manualTicket('IC-1', 'missing', values), /configur/i);
});
