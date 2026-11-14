import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'vite';
import type {MarkdocVitePluginOptions} from '../../src';
import {markdoc} from '../../src';
import {errorMessage, excerpt, sleep} from './code';
import {exampleRoot} from './paths';

/** ライブラリモードで `entry` を ESM バンドルし、出力ファイルのパスを返す。 */
export async function bundleEntry(
  entry: string,
  outDir: string,
  outFileName: string,
  options: MarkdocVitePluginOptions = {},
): Promise<string> {
  await build({
    root: exampleRoot,
    // サンプルの vite.config.ts を読み込ませない。
    configFile: false,
    envFile: false,
    logLevel: 'error',
    plugins: [markdoc(options)],
    build: {
      lib: {entry, name: 'MarkdocVerify', formats: ['es'], fileName: () => outFileName},
      outDir,
      emptyOutDir: false,
      write: true,
      minify: false,
      sourcemap: false,
      rollupOptions: {
        external: [
          'react',
          'react/jsx-runtime',
          'react/jsx-dev-runtime',
          'react-dom',
          'react-dom/server',
          'js-yaml',
          '@markdoc/markdoc',
        ],
      },
    },
  });
  return path.join(outDir, outFileName);
}

/**
 * サイズ計測用のビルド: rollup input (ライブラリモードではない)、external は React のみ、Vite の既定 (Vite 6 は esbuild、Vite 8 は Oxc) で minify。
 */
export async function measureBuild(
  entry: string,
  outDir: string,
  outFileName: string,
  options: MarkdocVitePluginOptions = {},
  extra: {ssr?: boolean; minify?: boolean; sourcemap?: boolean} = {},
): Promise<string> {
  await build({
    root: exampleRoot,
    configFile: false,
    envFile: false,
    logLevel: 'error',
    plugins: [markdoc(options)],
    build: {
      outDir,
      emptyOutDir: false,
      write: true,
      minify: extra.minify !== false,
      sourcemap: extra.sourcemap ?? false,
      ssr: extra.ssr ?? false,
      rollupOptions: {
        input: entry,
        external: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/server'],
        output: {format: 'es', entryFileNames: outFileName, chunkFileNames: `chunks/${outFileName}-[hash].js`},
        preserveEntrySignatures: 'exports-only',
      },
    },
  });
  return path.join(outDir, outFileName);
}

let importCounter = 0;

/** ESM を毎回新しいモジュールとして import する (`?t=` を単調増加させる)。 */
export async function importBundle(file: string): Promise<Record<string, unknown>> {
  importCounter += 1;
  return (await import(`${pathToFileURL(file).href}?t=${Date.now()}-${importCounter}`)) as Record<string, unknown>;
}

/**
 * `probe` が true を返すまで 100ms 間隔で待つ。
 * タイムアウト時は最後の例外を含めて throw する。
 */
export async function waitFor(label: string, probe: () => Promise<boolean>, timeoutMs = 10000): Promise<void> {
  const start = Date.now();
  let lastError: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      if (await probe()) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  const last = lastError === undefined ? '' : `; last error: ${excerpt(errorMessage(lastError))}`;
  throw new Error(`waitFor timed out after ${timeoutMs}ms: ${label}${last}`);
}
