import {describe, expect, test} from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import Markdoc from '@markdoc/markdoc';
import {createElement, Fragment, type ReactNode} from 'react';
import {renderToString} from 'react-dom/server';
import sampleNodes from '../../examples/basic/markdoc/nodes';
import sampleTags from '../../examples/basic/markdoc/tags';
import {defaultObject, displayName, getSchema, sanitizeFrontmatter} from '../../src/runtime/runtime.js';
import {INLINE_RUNTIME_SOURCE} from '../../src/runtime/source';
import {repoRoot, tmpDirFor} from '../helpers/paths';

const dir = tmpDirFor(import.meta);
const runtimeFile = path.join(repoRoot, 'src/runtime/runtime.js');

const TagLink = ({children}: {children?: ReactNode}) => createElement('span', {className: 'tag'}, children);
const NodeLink = ({children}: {children?: ReactNode}) => createElement('a', {className: 'node'}, children);

describe('runtime source', () => {
  test('INLINE_RUNTIME_SOURCE is runtime.js and loads as a standalone ES module', async () => {
    expect(INLINE_RUNTIME_SOURCE).toBe(fs.readFileSync(runtimeFile, 'utf8'));
    const file = path.join(dir, 'inline-runtime.mjs');
    fs.writeFileSync(file, INLINE_RUNTIME_SOURCE);
    const inline = await import(pathToFileURL(file).href);
    expect(Object.keys(inline).sort()).toEqual([
      'defaultObject',
      'displayName',
      'getSchema',
      'renderReact',
      'sanitizeFrontmatter',
    ]);
  });

  test('runtime.js does not use Object.hasOwn (browser target)', () => {
    expect(INLINE_RUNTIME_SOURCE).not.toContain('Object.hasOwn(');
  });
});

describe('getSchema / defaultObject / displayName', () => {
  test('getSchema replaces render with the component name and returns the components', () => {
    const schema = getSchema({tags: sampleTags, nodes: sampleNodes, variables: {a: 1}});
    expect(schema.tags?.callout?.render).toBe('Callout');
    expect(schema.components.Callout).toBe(sampleTags.callout.render);
    expect(schema.variables).toEqual({a: 1});
    expect(JSON.parse(JSON.stringify(schema.tags)).callout.render).toBe('Callout');
  });

  test('a registration without render has no render and no component', () => {
    const schema = getSchema({tags: {plain: {attributes: {}}}});
    expect(schema.tags?.plain).toEqual({attributes: {}, render: undefined});
    expect(schema.components).toEqual({});
  });

  test('a tag and a node with the same name each render their own component', () => {
    const schema = getSchema({
      tags: {link: {render: TagLink, children: ['inline']}},
      nodes: {link: {render: NodeLink, attributes: {href: {type: String}}}},
    });
    expect(schema.tags.link?.render).toBe('Link');
    expect(schema.nodes.link?.render).toBe('Link2');
    expect(schema.components).toEqual({Link: TagLink, Link2: NodeLink});

    const {components, ...config} = schema;
    const tree = Markdoc.transform(Markdoc.parse('{% link %}t{% /link %} [n](/x)'), config);
    const html = renderToString(
      Markdoc.renderers.react(tree, {createElement, Fragment}, {components: components as never}) as ReactNode,
    );
    expect(html).toContain('<span class="tag">t</span>');
    expect(html).toContain('<a class="node">n</a>');
  });

  test('names that collide after displayName get distinct components; non-colliding names are unchanged', () => {
    const [A, B, C, D, E] = [1, 2, 3, 4, 5].map((i) => () => i);
    const schema = getSchema({
      tags: {'my-tag': {render: A}, my_tag: {render: B}, callout: {render: C}, h1: {render: D}, h2: {render: D}},
      nodes: {paragraph: {render: E}},
    });
    expect([schema.tags['my-tag'], schema.tags.my_tag].map((s) => s?.render)).toEqual(['MyTag', 'MyTag2']);
    expect([schema.tags.callout, schema.tags.h1, schema.tags.h2].map((s) => s?.render)).toEqual(['Callout', 'H', 'H']);
    expect(schema.nodes.paragraph?.render).toBe('Paragraph');
    expect(schema.components).toEqual({MyTag: A, MyTag2: B, Callout: C, H: D, Paragraph: E});
  });

  test('defaultObject unwraps default, passes plain objects through and maps null / undefined to {}', () => {
    const table: [unknown, unknown][] = [
      [null, {}],
      [undefined, {}],
      [{default: {x: 1}}, {x: 1}],
      [{x: 2}, {x: 2}],
    ];
    expect(table.map(([input]) => defaultObject(input))).toEqual(table.map(([, expected]) => expected));
  });

  test('displayName converts to PascalCase and keeps names without ASCII letters', () => {
    expect(['callout', 'my-tag', 'h1', 'x_y-z', '日本語'].map(displayName)).toEqual([
      'Callout',
      'MyTag',
      'H',
      'XYZ',
      '日本語',
    ]);
  });
});

describe('sanitizeFrontmatter', () => {
  const date = new Date('2024-01-02T00:00:00.000Z');

  test('strips $$mdtype at every depth', () => {
    const nested = {a: 1, $$mdtype: 'Tag', n: {$$mdtype: 'x', k: [{$$mdtype: 'Tag', y: 2}, [1, {$$mdtype: 1}]]}};
    expect(sanitizeFrontmatter(nested)).toEqual({a: 1, n: {k: [{y: 2}, [1, {}]]}});
  });

  test('keeps __proto__ as an own key without changing the prototype', () => {
    const sanitized = sanitizeFrontmatter(JSON.parse('{"__proto__": {"polluted": 1}, "ok": true}')) as object;
    expect(Object.hasOwn(sanitized, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(sanitized)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  test('returns Date instances and scalars unchanged', () => {
    expect((sanitizeFrontmatter({d: date}) as {d: unknown}).d).toBe(date);
    expect(sanitizeFrontmatter([null, 'str', 5, true])).toEqual([null, 'str', 5, true]);
  });

  test('converts typed arrays (`!!binary`) to plain number arrays and counts their length', () => {
    expect(sanitizeFrontmatter({b: new Uint8Array([1, 2, 255]), e: new Uint8Array(0)})).toEqual({
      b: [1, 2, 255],
      e: [],
    });
    expect(() => sanitizeFrontmatter({b: new Uint8Array(100_000)})).toThrow('more than 100000 values');
  });

  test('throws over the value limit', () => {
    expect(() => sanitizeFrontmatter(Array(100_001).fill(0))).toThrow(
      '[markdoc-vinext] Frontmatter has more than 100000 values (including YAML alias expansion).',
    );
  });

  test('throws on a circular reference and accepts shared references', () => {
    const circular: unknown[] = [];
    circular.push({x: circular});
    expect(() => sanitizeFrontmatter(circular)).toThrow('[markdoc-vinext] Frontmatter contains a circular reference.');
    const shared = {v: 1};
    expect(sanitizeFrontmatter({a: shared, b: [shared, shared]})).toEqual({a: {v: 1}, b: [{v: 1}, {v: 1}]});
  });
});
