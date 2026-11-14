import {describe, expect, test} from 'bun:test';
import {pagesSample} from '../helpers/paths';
import {noParserOrRaw, transformSample} from '../helpers/transform';

describe('transform: Pages Router module', () => {
  test('the runtime module embeds the parser and the raw source', async () => {
    const {code} = await transformSample(pagesSample);
    expect(noParserOrRaw(code)).toEqual(expect.arrayContaining(['Tokenizer', 'js-yaml', 'const source']));
  });
});
