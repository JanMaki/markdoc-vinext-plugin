import {beforeAll, describe, expect, test} from 'bun:test';
import Markdoc from '@markdoc/markdoc';
import {createElement, Fragment} from 'react';
import {renderToString} from 'react-dom/server';
import {renderReact} from '../../src/runtime/runtime.js';
import {pagesSample} from '../helpers/paths';
import {PARITY_COMPONENTS} from '../helpers/render';
import {extractMarkdocData, transformSample} from '../helpers/transform';

const reactLike = {createElement, Fragment};

/** `render` の結果を div で包んで HTML にする。 */
function html(render: typeof Markdoc.renderers.react, node: unknown): string {
  return renderToString(
    createElement('div', null, render(node as never, reactLike, {components: PARITY_COMPONENTS}) as never),
  );
}

const extraTree = {
  $$mdtype: 'Tag',
  name: 'div',
  attributes: {class: 'x', data: {$$mdtype: 'Tag', name: 'i', attributes: {}, children: []}, list: [1, 'a']},
  children: ['t', null, 3],
};

let sampleTree: unknown;

beforeAll(async () => {
  const clientGen = await transformSample(pagesSample, {compile: 'build'}, {consumer: 'client'});
  sampleTree = extractMarkdocData(clientGen.code)?.content;
});

describe('renderReact matches Markdoc.renderers.react', () => {
  for (const [label, node] of [
    ['class / nested attrs', () => extraTree],
    ['sample tree', () => sampleTree],
    ['array root', () => [sampleTree, 'x']],
  ] as const) {
    test(`renderReact parity: ${label}`, () => {
      const expected = html(Markdoc.renderers.react, node());
      expect(html(renderReact as typeof Markdoc.renderers.react, node())).toBe(expected);
      expect(expected.length).toBeGreaterThan(20);
    });
  }
});
