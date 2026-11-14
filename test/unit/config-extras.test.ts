import {describe, expect, test} from 'bun:test';
import path from 'node:path';
import {computeConfigExtras, diagnoseSchemaPath} from '../../src/vite/config-hooks';

/** 実在しない絶対パス。fs には触れない。 */
const abs = (...parts: string[]): string => path.resolve('/cfg-extras', ...parts);
const fsRoot = path.parse(abs()).root;
const root = abs('ws', 'proj');
const home = abs('home', 'me');
const env = {cwd: root, home, workspaceRoot: (r: string) => `WS(${r})`, realpath: (p: string) => p};
/** `link` の実パスを `real` とする env。 */
const linkedEnv = (link: string, real: string) => ({...env, realpath: (p: string) => (p === link ? real : p)});

describe('computeConfigExtras', () => {
  test('schema dir inside the root → only optimizeDeps', () => {
    expect(computeConfigExtras({root}, {}, env)).toEqual({optimizeDeps: {include: ['@markdoc/markdoc', 'js-yaml']}});
  });

  test('root defaults to env.cwd', () => {
    expect(computeConfigExtras({}, {schemaPath: '../shared'}, env).server?.fs?.allow).toEqual([
      `WS(${root})`,
      abs('ws', 'shared'),
    ]);
  });

  test('out-of-root schema dir without user fs.allow → workspace root + schema dir', () => {
    const extra = computeConfigExtras({root}, {schemaPath: '../shared'}, env);
    expect(extra.server).toEqual({fs: {allow: [`WS(${root})`, abs('ws', 'shared')]}});
  });

  test('out-of-root schema dir with user fs.allow → schema dir only', () => {
    const extra = computeConfigExtras({root, server: {fs: {allow: ['/x']}}}, {schemaPath: '../shared'}, env);
    expect(extra.server).toEqual({fs: {allow: [abs('ws', 'shared')]}});
  });

  test('dir option is the base of schemaPath', () => {
    const extra = computeConfigExtras({root}, {dir: abs('other'), schemaPath: 'schema'}, env);
    expect(extra.server?.fs?.allow).toEqual([`WS(${root})`, abs('other', 'schema')]);
  });

  test('schema dir containing the root is not allowed', () => {
    expect(computeConfigExtras({root}, {schemaPath: '..'}, env).server).toBeUndefined();
  });

  test('filesystem root is not allowed', () => {
    expect(computeConfigExtras({root}, {schemaPath: fsRoot}, env).server).toBeUndefined();
  });

  test('directory containing home is not allowed', () => {
    const extra = computeConfigExtras({root}, {schemaPath: abs('home')}, env);
    expect(extra.server).toBeUndefined();
  });

  test('home itself is not allowed', () => {
    expect(computeConfigExtras({root}, {schemaPath: home}, env).server).toBeUndefined();
  });

  test('linked schema dir inside the root whose real path is outside → the real path is allowed', () => {
    const extra = computeConfigExtras({root}, {}, linkedEnv(path.join(root, 'markdoc'), abs('ext', 'schema')));
    expect(extra.server?.fs?.allow).toEqual([`WS(${root})`, abs('ext', 'schema')]);
  });

  test('linked schema dir outside the root → both the given and the real path are allowed', () => {
    const extra = computeConfigExtras({root}, {schemaPath: '../shared'}, linkedEnv(abs('ws', 'shared'), abs('ext')));
    expect(extra.server?.fs?.allow).toEqual([`WS(${root})`, abs('ws', 'shared'), abs('ext')]);
  });

  test('linked schema dir whose real path contains home or the root is not allowed', () => {
    for (const real of [abs('home'), abs('ws')]) {
      const extra = computeConfigExtras({root}, {schemaPath: '../shared'}, linkedEnv(abs('ws', 'shared'), real));
      expect(extra.server).toBeUndefined();
    }
  });

  test('optimizeDeps.include skips deps the user already listed', () => {
    const extra = computeConfigExtras({root, optimizeDeps: {include: ['js-yaml']}}, {}, env);
    expect(extra.optimizeDeps).toEqual({include: ['@markdoc/markdoc']});
    const none = computeConfigExtras({root, optimizeDeps: {include: ['js-yaml', '@markdoc/markdoc']}}, {}, env);
    expect(none.optimizeDeps).toEqual({include: []});
  });

  test('workspaceRoot is not called when the user sets fs.allow', () => {
    let called = false;
    const spy = {
      ...env,
      workspaceRoot: () => {
        called = true;
        return '';
      },
    };
    computeConfigExtras({root, server: {fs: {allow: []}}}, {schemaPath: '../shared'}, spy);
    expect(called).toBe(false);
  });
});

describe('diagnoseSchemaPath', () => {
  const diagnose = (schemaDir: string, real = schemaDir) =>
    diagnoseSchemaPath({schemaDir, realSchemaDir: real, root, realRoot: root}, home);
  const NARROWED =
    'Only its existing partials folder is watched; restart the dev server (or build --watch) after adding ' +
    'config/tags/nodes/functions files or a new partials folder.';

  test('inside the root → no diagnostic', () => {
    expect(diagnose(path.join(root, 'markdoc'))).toBeUndefined();
  });

  test('equal to the root → warn (only partials and entries are schema files)', () => {
    const d = diagnose(root);
    expect(d?.level).toBe('warn');
    expect(d?.message).toContain(`schemaPath (${root}) is the project root.`);
    expect(d?.message).toContain('Only files in its partials folder and its config/tags/nodes/functions entries');
  });

  test('containing the root → warn (not added to fs.allow)', () => {
    const d = diagnose(abs('ws'));
    expect(d?.level).toBe('warn');
    expect(d?.message).toContain('contains the project root, so it was not added');
    expect(d?.message).toContain(NARROWED);
  });

  test('filesystem root of the same drive contains the root → warn (contains the project root)', () => {
    expect(diagnose(fsRoot)?.message).toContain('contains the project root');
  });

  test.skipIf(process.platform !== 'win32')('filesystem root of another drive → warn (filesystem root)', () => {
    const otherDrive = fsRoot.toUpperCase().startsWith('Z') ? 'Y:\\' : 'Z:\\';
    const d = diagnose(otherDrive);
    expect(d?.level).toBe('warn');
    expect(d?.message).toContain(`schemaPath (${otherDrive}) is a filesystem root or contains the home directory`);
  });

  test('directory containing home → warn (filesystem root or home)', () => {
    const d = diagnose(abs('home'));
    expect(d?.level).toBe('warn');
    expect(d?.message).toContain(`schemaPath (${abs('home')}) is a filesystem root or contains the home directory`);
    expect(d?.message).toContain(NARROWED);
  });

  test('outside the root → info (added to fs.allow)', () => {
    const d = diagnose(abs('ws', 'shared'));
    expect(d).toEqual({
      level: 'info',
      message: `[markdoc-vinext] schemaPath points outside the project root (${abs('ws', 'shared')}); it was added to \`server.fs.allow\`.`,
    });
  });

  test('symlinked schema dir whose real path is inside the root → no diagnostic', () => {
    expect(diagnose(abs('link'), path.join(root, 'markdoc'))).toBeUndefined();
  });

  test('message uses the given path, comparison uses the real path', () => {
    const d = diagnose(abs('link'), root);
    expect(d?.message).toContain(`schemaPath (${abs('link')}) is the project root.`);
  });

  test('linked schema dir inside the root whose real path is outside → info, matching the allowed real path', () => {
    expect(diagnose(path.join(root, 'markdoc'), abs('ext', 'schema'))?.level).toBe('info');
  });

  test('linked schema dir whose real path contains home → warn (filesystem root or home)', () => {
    expect(diagnose(abs('ws', 'shared'), abs('home'))?.message).toContain('contains the home directory');
  });

  test('linked schema dir whose real path contains the root → warn (contains the project root)', () => {
    expect(diagnose(path.join(root, 'markdoc'), abs('ws'))?.message).toContain('contains the project root');
  });
});
