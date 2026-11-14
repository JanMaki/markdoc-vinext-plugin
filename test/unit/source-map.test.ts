import {beforeAll, describe, expect, test} from 'bun:test';
import fs from 'node:fs';
import type {SourceMapV3} from '../../src/types';
import {pagesSample} from '../helpers/paths';
import {type TransformResult, transformSample} from '../helpers/transform';

let result: TransformResult;
let map: SourceMapV3;

beforeAll(async () => {
  result = await transformSample(pagesSample);
  map = result.map as SourceMapV3;
});

describe('source maps', () => {
  test('map.sources and sourcesContent are the Markdown file', () => {
    expect(map.sources).toEqual([pagesSample]);
    expect(map.sourcesContent).toEqual([fs.readFileSync(pagesSample, 'utf8')]);
  });

  test('map covers every generated line', () => {
    expect(map.mappings.split(';').length).toBe(result.code.split('\n').length);
  });

  test("compile: 'build' client modules use Rollup's no-map form; server modules keep the map", async () => {
    const client = await transformSample(pagesSample, {compile: 'build'}, {consumer: 'client'});
    expect(client.map).toEqual({mappings: ''});
    const server = await transformSample(pagesSample, {compile: 'build'}, {consumer: 'server'});
    expect((server.map as SourceMapV3).sources).toEqual([pagesSample]);
  });
});
