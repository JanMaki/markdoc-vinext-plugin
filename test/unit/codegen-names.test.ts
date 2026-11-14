import {describe, expect, test} from 'bun:test';
import ts from 'typescript';
import {GENERATED_MODULE_NAMES} from '../../src/codegen/names';
import {DEFAULT_NEXTJS_EXPORTS} from '../../src/options';
import {appSample, componentSample, pagesSample} from '../helpers/paths';
import {transformSample} from '../helpers/transform';

/** トップレベルの宣言、import の束縛、export する名前を集める。 */
function topLevelNames(code: string): Set<string> {
  const file = ts.createSourceFile('generated.js', code, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  const names = new Set<string>();
  const addBinding = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) names.add(name.text);
    else for (const element of name.elements) if (!ts.isOmittedExpression(element)) addBinding(element.name);
  };
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause?.name) names.add(clause.name.text);
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) names.add(bindings.name.text);
      if (bindings && ts.isNamedImports(bindings)) for (const el of bindings.elements) names.add(el.name.text);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) addBinding(declaration.name);
    } else if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      if (statement.name) names.add(statement.name.text);
      if (statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) names.add('default');
    } else if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const el of statement.exportClause.elements) names.add(el.name.text);
    }
  }
  return names;
}

describe('codegen: GENERATED_MODULE_NAMES', () => {
  test('top-level names of generated page / component modules are listed', async () => {
    const found = new Set<string>();
    for (const file of [pagesSample, appSample, componentSample]) {
      for (const compile of ['runtime', 'build'] as const) {
        for (const consumer of ['client', 'server'] as const) {
          for (const mode of ['static', 'server'] as const) {
            for (const fastRefresh of [false, true]) {
              const {code} = await transformSample(file, {compile, mode, fastRefresh}, {consumer});
              for (const name of topLevelNames(code)) found.add(name);
            }
          }
        }
      }
    }
    // nextjsExports の名前は利用者の指定値。
    const unlisted = [...found].filter(
      (name) => !GENERATED_MODULE_NAMES.has(name) && !DEFAULT_NEXTJS_EXPORTS.includes(name),
    );
    expect(unlisted).toEqual([]);
    // import、分割代入、関数宣言、default export、再 export の各形式から名前を取れていること。
    for (const name of [
      'React',
      'tags',
      'rest',
      'getStaticProps',
      'MarkdocComponent',
      'default',
      '__markdocInternal',
    ]) {
      expect(found).toContain(name);
    }
  });
});
