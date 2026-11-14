import ts from 'typescript';

function parse(code: string): ts.SourceFile {
  return ts.createSourceFile('generated.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);
}

/** 生成モジュールの export 名と、トップレベルの async 関数の名前 (いずれも昇順)。 */
export type ModuleShape = {exports: readonly string[]; asyncFunctions: readonly string[]};

export function moduleShape(code: string): ModuleShape {
  const exports = new Set<string>();
  const asyncFunctions = new Set<string>();
  for (const statement of parse(code).statements) {
    if (ts.isFunctionDeclaration(statement)) {
      const name = statement.name?.text ?? 'default';
      if (hasModifier(statement, ts.SyntaxKind.AsyncKeyword)) asyncFunctions.add(name);
      if (hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
        exports.add(hasModifier(statement, ts.SyntaxKind.DefaultKeyword) ? 'default' : name);
      }
    } else if (ts.isVariableStatement(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) exports.add(declaration.name.text);
      }
    } else if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) exports.add(element.name.text);
    }
  }
  return {exports: [...exports].sort(), asyncFunctions: [...asyncFunctions].sort()};
}

/** `node` 以下を深さ優先で走査し、`match` が最初に値を返したノードの値。 */
function findFirst<T>(node: ts.Node, match: (n: ts.Node) => T | undefined): T | undefined {
  const found = match(node);
  if (found !== undefined) return found;
  return ts.forEachChild(node, (child) => findFirst(child, match));
}

/** 文字列リテラル、`JSON.parse("…")`、JSON として読めるリテラルの値。それ以外は例外。 */
function literalValue(expression: ts.Expression): unknown {
  if (ts.isStringLiteral(expression)) return expression.text;
  if (ts.isIdentifier(expression) && expression.text === 'undefined') return undefined;
  if (ts.isCallExpression(expression) && expression.expression.getText() === 'JSON.parse') {
    const [arg] = expression.arguments;
    if (arg && ts.isStringLiteral(arg)) return JSON.parse(arg.text);
  }
  return JSON.parse(expression.getText());
}

/** 入れ子の関数内も含め、最初の `const <name> = <リテラル>` の値。宣言がなければ例外。 */
export function constValue(code: string, name: string): unknown {
  const init = findFirst(parse(code), (n) =>
    ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name ? n.initializer : undefined,
  );
  if (!init) throw new Error(`const ${name} not found`);
  return literalValue(init);
}

/** `new <callee>(<JSON リテラル>)` の引数の値。引数なしは undefined。式がなければ例外。 */
export function newExpressionArg(code: string, callee: string): unknown {
  const call = findFirst(parse(code), (n) =>
    ts.isNewExpression(n) && n.expression.getText() === callee ? n : undefined,
  );
  if (!call) throw new Error(`new ${callee}() not found`);
  const [arg] = call.arguments ?? [];
  return arg && literalValue(arg);
}
