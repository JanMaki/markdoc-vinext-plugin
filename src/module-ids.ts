/** 仮想モジュール id とクエリ名。 */

/** プラグインの仮想モジュール id の接頭辞。 */
export const VIRTUAL_ID_PREFIX = 'virtual:markdoc-vinext/';
/** 生成モジュールが import する仮想モジュール id。 */
export const RUNTIME_MODULE_ID = `${VIRTUAL_ID_PREFIX}runtime`;
export const RESOLVED_RUNTIME_MODULE_ID = `\0${RUNTIME_MODULE_ID}`;
/** `fastRefresh: true` で分離したコンポーネント側モジュールを示すクエリ。 */
export const COMPONENT_QUERY = 'markdoc-component';
