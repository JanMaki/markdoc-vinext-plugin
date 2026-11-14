/**
 * カスタム Markdoc 関数。本文中で `{% upper("hello") %}` のように呼び出す。
 */
export const upper = {
  transform(parameters: Record<string | number, unknown>) {
    const value = parameters[0];
    return typeof value === 'string' ? value.toUpperCase() : value;
  },
};

export default {upper};
