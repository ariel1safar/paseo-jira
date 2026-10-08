import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('..', import.meta.url));
// Official 0.11.1 compiler.js/createRuntimeBoundaryPlugin and plugin-sdk-specifiers.js:
// https://github.com/getpaseo/paseo/tree/v0.11.1/packages/server/src/server/plugins
// Host modules bypass local resolution. All other dependencies, including erased types,
// must resolve inside the artifact; this plugin deliberately ships no runtime dependencies.
const hostModules = new Set([
  '@getpaseo/plugin', '@getpaseo/plugin/client', '@getpaseo/plugin/client/ui',
  '@getpaseo/plugin/client/react-native', 'react', 'react/jsx-runtime',
  'react-native', '@tanstack/react-query', 'zod',
]);
function artifact(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'jira-import-contract-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.deepEqual(manifest.dependencies ?? {}, {}, 'The artifact contract assumes no runtime dependencies');
  for (const entry of manifest.files) {
    if (existsSync(path.join(root, entry))) cpSync(path.join(root, entry), path.join(directory, entry), { recursive: true });
  }
  assert.equal(existsSync(path.join(directory, 'node_modules')), false);
  return directory;
}
function checkClientImports(directory) {
  const inside = file => path.resolve(file).startsWith(directory + path.sep);
  // Restrict even TypeScript's ancestor searches, so developer/CI node_modules cannot mask a missing dependency.
  const host = {
    fileExists: file => inside(file) && ts.sys.fileExists(file),
    readFile: file => inside(file) ? ts.sys.readFile(file) : undefined,
    directoryExists: file => (file === directory || inside(file)) && ts.sys.directoryExists(file),
  };
  const options = { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowJs: true };
  const checked = new Set();
  function visit(file) {
    if (checked.has(file)) return;
    checked.add(file);
    const location = path.relative(directory, file).split(path.sep).join('/');
    assert.ok(location === 'index.client.tsx' || /^(client|shared)\//.test(location), `Invalid client boundary: ${location}`);
    // preprocess reads import/export/type-import/dynamic-import/require syntax before type erasure.
    const imports = ts.preProcessFile(readFileSync(file, 'utf8'), true, true);
    assert.equal(imports.typeReferenceDirectives.length, 0, `${location} must not need external ambient types`);
    for (const { fileName: specifier } of [...imports.importedFiles, ...imports.referencedFiles]) {
      if (hostModules.has(specifier)) {
        assert.ok(!location.startsWith('shared/') || specifier === '@getpaseo/plugin' || specifier === 'zod', `Client-only host import in ${location}: ${specifier}`);
        continue;
      }
      const resolved = ts.resolveModuleName(specifier, file, options, host).resolvedModule?.resolvedFileName;
      assert.ok(resolved, `Dependency-free client artifact cannot resolve ${specifier} imported by ${location} (type-only imports count)`);
      visit(resolved);
    }
  }
  visit(path.join(directory, 'index.client.tsx'));
}

test('packaged client graph resolves without developer dependencies, including type-only edges', t => {
  checkClientImports(artifact(t));
});

test('artifact contract rejects an erased transitive SDK type import', t => {
  const directory = artifact(t);
  appendFileSync(path.join(directory, 'client/watch.ts'), "\nimport type { PaseoWorkspaceListResult as UnshippedType } from '@getpaseo/client';\n");
  assert.throws(() => checkClientImports(directory), /cannot resolve @getpaseo\/client imported by client\/watch.ts/);
});
