import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInThisContext } from 'node:vm';
import ts from 'typescript';
import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { settings } from './helpers.mjs';

// Execute the real TSX and callbacks without a native renderer. Only hook storage and
// host UI leaves are substituted; validation, JSX and the mutation error state are real.
function settingsScreen(hostSettings) {
  const path = new URL('../client/settings.tsx', import.meta.url);
  const require = createRequire(path);
  const states = new Map();
  let current, cursor;
  const react = {
    useState(initial) {
      const slot = cursor++;
      if (!(slot in current)) current[slot] = typeof initial === 'function' ? initial() : initial;
      const owner = current;
      return [owner[slot], value => { owner[slot] = typeof value === 'function' ? value(owner[slot]) : value; }];
    },
    useEffect(effect) {
      const slot = cursor++;
      if (!(slot in current)) { current[slot] = true; effect(); }
    },
  };
  const paseo = { projects: { list: async () => ({ projects: [{ projectId: 'p', projectDisplayName: 'Project', projectRootPath: '/project' }] }) } };
  const source = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const load = id => {
    if (id === 'react') return react;
    if (id === 'react-native') return { Text: 'Text', TextInput: 'TextInput', View: 'View' };
    if (id === '@getpaseo/plugin/client') return { usePaseo: () => paseo, useSettings: () => hostSettings };
    if (id === '@getpaseo/plugin/client/ui') return Object.fromEntries(['SettingsAction', 'SettingsCard', 'SettingsRow', 'SettingsSection', 'SettingsSelect'].map(name => [name, name]));
    return require(id);
  };
  runInThisContext(`(function(require, module, exports) { ${source}\n})`, { filename: path.pathname })(load, module, module.exports);
  function render(Component, props) {
    if (!states.has(Component)) states.set(Component, []);
    current = states.get(Component);
    cursor = 0;
    return Component(props);
  }
  const props = { theme: { colors: { foreground: '#fff', foregroundMuted: '#aaa', surface0: '#000' } }, layout: { compact: false } };
  return { root: () => render(module.exports.JiraSettingsScreen, props), render };
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
const find = (tree, predicate) => {
  const result = nodes(tree).find(predicate);
  assert.ok(result, 'Expected editor control to be rendered');
  return result;
};
const settle = () => new Promise(resolve => setImmediate(resolve));

test('failed save followed by an invalid draft shows current validation instead of stale transport error', async () => {
  const queryClient = new QueryClient();
  let connected = false, writes = 0;
  const mutation = new MutationObserver(queryClient, {
    gcTime: Infinity,
    mutationFn: async () => {
      writes++;
      if (!connected) throw new Error('Transport disconnected');
    },
  });
  const hostSettings = {
    status: 'ready', values: settings, revision: 'r1',
    get saving() { return mutation.getCurrentResult().isPending; },
    get saveError() { return mutation.getCurrentResult().error?.message ?? null; },
    async save(values, revision) { try { await mutation.mutate({ values, revision }); return true; } catch { return false; } },
  };
  try {
    const ui = settingsScreen(hostSettings);
    ui.root();
    await settle();
    find(ui.root(), node => node.type === 'SettingsSelect').props.onValueChange('p');
    const editor = find(ui.root(), node => typeof node.type === 'function');
    const render = () => ui.render(editor.type, editor.props);
    const changeUrl = value => find(render(), node => node.props?.accessibilityLabel === 'Jira URL template 1').props.onChangeText(value);
    const save = () => find(render(), node => node.props?.actionLabel === 'Save').props.onPress();
    const alert = () => find(render(), node => node.props?.accessibilityRole === 'alert').props.children;

    changeUrl('https://new.test/{ticket}');
    save();
    await settle();
    assert.equal(alert(), 'Transport disconnected');
    assert.equal(writes, 1);

    connected = true;
    changeUrl('http://unsafe.test/{ticket}');
    save();
    await settle();
    assert.equal(writes, 1, 'Invalid draft must fail local validation before another SDK save');
    assert.equal(hostSettings.saveError, 'Transport disconnected', 'The hook still retains the preceding mutation failure');
    assert.match(alert(), /HTTPS/, 'The displayed error must explain this attempt’s invalid URL');

    changeUrl('https://valid.test/{ticket}');
    save();
    await settle();
    assert.equal(writes, 2);
    assert.match(alert(), /Mappings saved/);
  } finally {
    queryClient.clear();
  }
});
