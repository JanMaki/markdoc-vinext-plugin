/** 仮想 runtime モジュールの resolveId / load フック。 */

import type {Plugin} from 'vite';
import {RESOLVED_RUNTIME_MODULE_ID, RUNTIME_MODULE_ID, VIRTUAL_ID_PREFIX} from '../module-ids';
import {INLINE_RUNTIME_SOURCE} from '../runtime/source';

const escapedPrefix = VIRTUAL_ID_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `virtual:markdoc-vinext/runtime` を `\0` 付きの id に解決する。 */
export function createResolveIdHook(): NonNullable<Plugin['resolveId']> {
  return {
    filter: {id: new RegExp(`^${escapedPrefix}`)},
    handler(id) {
      if (id === RUNTIME_MODULE_ID) {
        return RESOLVED_RUNTIME_MODULE_ID;
      }
      return null;
    },
  };
}

/** 解決済みの runtime の id に INLINE_RUNTIME_SOURCE を返す。 */
export function createLoadHook(): NonNullable<Plugin['load']> {
  return {
    filter: {id: new RegExp(`^\\0${escapedPrefix}`)},
    handler(id) {
      if (id === RESOLVED_RUNTIME_MODULE_ID) {
        return INLINE_RUNTIME_SOURCE;
      }
      return null;
    },
  };
}
