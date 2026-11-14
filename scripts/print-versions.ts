/** 検証に使った依存パッケージのバージョンを表示する。 */
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
for (const pkg of ['vite', '@markdoc/markdoc', 'js-yaml', 'react', 'react-dom', 'typescript']) {
  const {version} = require(`${pkg}/package.json`) as {version: string};
  console.log(`${pkg}@${version}`);
}
console.log(`bun@${Bun.version}`);
