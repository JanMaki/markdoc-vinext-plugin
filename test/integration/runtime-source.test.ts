import {expect, test} from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import {resolveConfig} from 'vite';
import {INLINE_RUNTIME_SOURCE} from '../../src/runtime/source';
import {tmpDirFor} from '../helpers/paths';

const dir = tmpDirFor(import.meta);

test('config file bundled by Vite still serves the virtual runtime source', async () => {
  const pluginPath = path.resolve(import.meta.dir, '../../src/index.ts').replaceAll(path.sep, '/');
  fs.mkdirSync(dir, {recursive: true});
  const configFile = path.join(dir, 'vite.config.ts');
  fs.writeFileSync(
    configFile,
    `import markdoc from ${JSON.stringify(pluginPath)};\nexport default {root: ${JSON.stringify(dir)}, plugins: [markdoc()]};\n`,
  );
  const config = await resolveConfig({configFile, root: dir, logLevel: 'silent'}, 'serve');
  const plugin = config.plugins.find((p) => p.name.includes('markdoc'));
  expect(plugin).toBeDefined();
  const load = plugin?.load as ((this: unknown, id: string) => Promise<unknown> | unknown) | {handler: never};
  const handler = typeof load === 'function' ? load : (load as {handler: (id: string) => unknown}).handler;
  const result = await handler.call({}, '\0virtual:markdoc-vinext/runtime');
  expect(result).toBe(INLINE_RUNTIME_SOURCE);
});
