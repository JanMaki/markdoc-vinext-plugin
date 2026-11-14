import {beforeAll, describe, expect, test} from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import {createLogger, type InlineConfig, normalizePath, resolveConfig, searchForWorkspaceRoot} from 'vite';
import type {MarkdocVitePluginOptions} from '../../src/types';
import {markdoc} from '../../src/vite/plugin';
import {writeFile} from '../helpers/fixtures';
import {tmpDirFor} from '../helpers/paths';

const dir = tmpDirFor(import.meta);
const fxVite = path.join(dir, 'fx-vite');
const outsideSchema = path.join(dir, 'outside-schema');
const userAllow = path.join(dir, 'user-allowed');

beforeAll(() => {
  writeFile(path.join(outsideSchema, 'tags.ts'), 'export default {};\n');
  writeFile(path.join(fxVite, 'index.html'), '');
});

/** fxVite を root に serve の設定を解決する。warn と info を記録する。 */
async function resolveServe(options: MarkdocVitePluginOptions, extra: InlineConfig = {}) {
  const warns: string[] = [];
  const infos: string[] = [];
  const customLogger = createLogger('silent');
  customLogger.warn = (msg) => {
    warns.push(msg);
  };
  customLogger.info = (msg) => {
    infos.push(msg);
  };
  const config = await resolveConfig(
    {root: fxVite, configFile: false, envFile: false, customLogger, plugins: [markdoc(options)], ...extra},
    'serve',
  );
  // fs.allow を指定すると Vite は自身の client ディレクトリを加える。
  const allow = config.server.fs.allow.filter((a) => !a.includes('/node_modules/vite/'));
  return {config, allow, warns, infos};
}

/** Vite の既定の fs.allow (ワークスペースルートのみ)。 */
const defaultAllow = () => [normalizePath(searchForWorkspaceRoot(fxVite))];

describe('config(): optimizeDeps.include and server.fs.allow', () => {
  test('out-of-root schemaPath with user values: deps added and schema dir appended, user entries kept', async () => {
    const {config, allow, infos} = await resolveServe(
      {schemaPath: outsideSchema},
      {optimizeDeps: {include: ['react']}, server: {fs: {allow: [userAllow]}}},
    );
    expect(config.optimizeDeps.include).toEqual(['react', '@markdoc/markdoc', 'js-yaml']);
    expect(allow).toEqual([normalizePath(userAllow), normalizePath(outsideSchema)]);
    expect(infos.filter((m) => m.includes('schemaPath points outside the project root'))).toHaveLength(1);
  });

  test("out-of-root schemaPath without user fs.allow keeps Vite's default workspace root", async () => {
    expect((await resolveServe({schemaPath: outsideSchema})).allow).toEqual([
      ...defaultAllow(),
      normalizePath(outsideSchema),
    ]);
  });

  test('in-root schema adds nothing to fs.allow', async () => {
    expect((await resolveServe({})).allow).toEqual(defaultAllow());
  });

  test('no duplicate optimizeDeps entry when the user already lists js-yaml', async () => {
    const {config} = await resolveServe({}, {optimizeDeps: {include: ['js-yaml']}});
    expect(config.optimizeDeps.include).toEqual(['js-yaml', '@markdoc/markdoc']);
  });
});

describe('schemaPath containing or equal to the root', () => {
  test("schemaPath '.' (the project root) warns and adds nothing", async () => {
    const {allow, warns} = await resolveServe({schemaPath: '.'});
    expect(allow).toEqual(defaultAllow());
    expect(warns.filter((w) => w.includes('is the project root'))).toHaveLength(1);
  });

  for (const broad of ['..', '/']) {
    test(`schemaPath ${JSON.stringify(broad)} contains the root: not added, warns`, async () => {
      const {allow, warns} = await resolveServe({schemaPath: broad});
      expect(allow).toEqual(defaultAllow());
      expect(warns.filter((w) => w.includes('contains the project root'))).toHaveLength(1);
    });
  }

  const sameFsRoot = path.parse(dir).root;
  test(`filesystem root ${JSON.stringify(sameFsRoot)} contains the root: not added, warns`, async () => {
    const {allow, warns} = await resolveServe({schemaPath: sameFsRoot});
    expect(allow).toEqual(defaultAllow());
    expect(warns.filter((w) => w.includes('contains the project root'))).toHaveLength(1);
  });

  // 別ドライブのルートはプロジェクトを含まない (Windows のみ)。
  const otherFsRoot =
    process.platform === 'win32'
      ? 'CDEFGHIJ'
          .split('')
          .map((letter) => `${letter}:\\`)
          .find((r) => r.toLowerCase() !== sameFsRoot.toLowerCase() && fs.existsSync(r))
      : undefined;

  test.skipIf(!otherFsRoot)(`other filesystem root ${JSON.stringify(otherFsRoot)}: not added, warns`, async () => {
    const {allow, warns} = await resolveServe({schemaPath: otherFsRoot ?? ''});
    expect(allow).toEqual(defaultAllow());
    expect(warns.filter((w) => w.includes('filesystem root or contains the home directory'))).toHaveLength(1);
  });
});
