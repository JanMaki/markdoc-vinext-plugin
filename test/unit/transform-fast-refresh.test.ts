import {describe, expect, test} from 'bun:test';
import {fastRefreshComponentModule} from '../../src/page-detection';
import {moduleShape} from '../helpers/ast';
import {appSample, exampleRoot} from '../helpers/paths';

describe('fastRefresh: component module', () => {
  test('options.dir is the root for page detection', () => {
    const {code} = fastRefreshComponentModule(appSample, '/elsewhere', {dir: exampleRoot});
    expect(moduleShape(code).asyncFunctions).toEqual(['MarkdocComponent']);
  });
});
