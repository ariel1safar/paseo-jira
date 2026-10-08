import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beginProjectEdit, prepareProjectSave } from '../client/editor.ts';
import { settings } from './helpers.mjs';

test('draft keeps opening revision and saves only selected project while preserving others', () => {
  const values = { projects: { ...settings.projects, other: [{ prefix: 'X', urlTemplate: 'https://other.test/{ticket}' }] } };
  const draft = beginProjectEdit(values, 'original-revision', 'p');
  draft.mappings[0].prefix = 'new';
  draft.mappings.push({ prefix: 'MORE', urlTemplate: 'https://more.test/?q={ticket}' });
  const write = prepareProjectSave(draft);
  assert.equal(write.revision, 'original-revision');
  assert.equal(write.values.projects.p[0].prefix, 'NEW');
  assert.equal(write.values.projects.p.length, 3);
  assert.deepEqual(write.values.projects.other, [{ prefix: 'X', urlTemplate: 'https://other.test/{ticket}' }]);
  assert.equal(values.projects.p[0].prefix, 'IC');
});

test('new project starts empty; removing all mappings disables it; invalid or duplicate rows cannot save', () => {
  const draft = beginProjectEdit(settings, 'r', 'new');
  assert.deepEqual(draft.mappings, []);
  assert.deepEqual(prepareProjectSave(draft).values.projects.new, []);
  draft.mappings.push({ prefix: 'IC', urlTemplate: 'https://jira.test/{ticket}' }, { prefix: 'ic', urlTemplate: 'https://jira2.test/{ticket}' });
  assert.throws(() => prepareProjectSave(draft), /Duplicate prefix/);
  draft.mappings = [{ prefix: 'IC', urlTemplate: 'http://jira.test/{ticket}' }];
  assert.throws(() => prepareProjectSave(draft), /HTTPS/);
});
