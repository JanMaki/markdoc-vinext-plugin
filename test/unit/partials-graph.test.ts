import {beforeAll, describe, expect, test} from 'bun:test';
import path from 'node:path';
import {MAX_PARTIAL_DEPTH} from '../../src/partials';
import {constValue} from '../helpers/ast';
import {writeFile, writeTree} from '../helpers/fixtures';
import {tmpDirFor} from '../helpers/paths';
import {fixtureTransform} from '../helpers/transform';

const fx = tmpDirFor(import.meta);
const partials = path.join(fx, 'markdoc/partials');
const transform = fixtureTransform(fx);

beforeAll(() => {
  writeTree(fx, {
    'markdoc/tags.ts': 'export default {};\n',
    'markdoc/partials/a.md': 'A {% partial file="b.md" /%}\n',
    'markdoc/partials/b.md': 'B {% partial file="a.md" /%}\n',
    'markdoc/partials/self.md': 'S {% partial file="self.md" /%}\n',
    'markdoc/partials/diamond.md': '{% partial file="left.md" /%}\n\n{% partial file="right.md" /%}\n',
    'markdoc/partials/left.md': 'LEFT {% partial file="shared/leaf.md" /%}\n',
    'markdoc/partials/right.md': 'RIGHT {% partial file="shared/leaf.md" /%}\n',
    'markdoc/partials/shared/leaf.md': 'LEAF-CONTENT\n',
    'markdoc/partials/empty.md': '',
  });
  // deep0 → deep1 → … → deep40 の連鎖
  for (let i = 0; i < 40; i++) {
    writeFile(path.join(partials, `deep${i}.md`), `D${i} {% partial file="deep${i + 1}.md" /%}\n`);
  }
  writeFile(path.join(partials, 'deep40.md'), 'BOTTOM\n');
});

const partialsOf = async (source: string) => constValue((await transform(source)).code, 'partials');

describe('partials: cycles, depth, diamond, missing', () => {
  test('A → B → A cycle errors with the chain', async () => {
    await expect(transform('{% partial file="a.md" /%}\n')).rejects.toThrow(
      /Circular partial in .* -> a\.md -> b\.md -> a\.md$/,
    );
  });

  test('a self-including partial errors', async () => {
    await expect(transform('{% partial file="self.md" /%}\n')).rejects.toThrow('Circular partial');
  });

  test(`nesting deeper than ${MAX_PARTIAL_DEPTH} levels errors`, async () => {
    await expect(transform('{% partial file="deep0.md" /%}\n')).rejects.toThrow(
      `Partials nested deeper than ${MAX_PARTIAL_DEPTH} levels`,
    );
  });

  test('diamond includes register the shared leaf once', async () => {
    expect(await partialsOf('{% partial file="diamond.md" /%}\n')).toEqual({
      'diamond.md': '{% partial file="left.md" /%}\n\n{% partial file="right.md" /%}\n',
      'left.md': 'LEFT {% partial file="shared/leaf.md" /%}\n',
      'shared/leaf.md': 'LEAF-CONTENT\n',
      'right.md': 'RIGHT {% partial file="shared/leaf.md" /%}\n',
    });
  });

  test('an empty partial does not error and is not registered', async () => {
    expect(await partialsOf('{% partial file="empty.md" /%}\n')).toEqual({});
  });

  test('a missing partial names the file and the importer, and is still watched', async () => {
    const watched: string[] = [];
    const run = transform('{% partial file="later.md" /%}\n', 'pages/t.md', {}, {addWatchFile: (f) => watched.push(f)});
    await expect(run).rejects.toThrow(
      `Partial "later.md" referenced from ${path.join(fx, 'pages/t.md')} was not found at ${path.join(partials, 'later.md')}`,
    );
    expect(watched).toContain(path.join(partials, 'later.md'));
  });
});
