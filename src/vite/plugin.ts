/** Vite プラグイン本体。 */

import type {Plugin} from 'vite';
import {validatePluginOptions} from '../options';
import type {MarkdocVitePluginOptions} from '../types';
import {createConfigHook, createConfigResolvedHook} from './config-hooks';
import {createConfigureServerHook, createWatchChangeHook} from './dev-watch';
import {createHotUpdateHook} from './hot-update';
import {createPluginState} from './state';
import {createTransformHook} from './transform-hook';
import {createLoadHook, createResolveIdHook} from './virtual-runtime';

/** Markdoc ファイルを変換する Vite プラグイン。 */
export function markdoc(pluginOptions: MarkdocVitePluginOptions = {}): Plugin {
  validatePluginOptions(pluginOptions);
  const state = createPluginState(pluginOptions);
  return {
    name: 'markdoc-vinext',
    enforce: 'pre',
    config: createConfigHook(state),
    configResolved: createConfigResolvedHook(state),
    configureServer: createConfigureServerHook(state),
    watchChange: createWatchChangeHook(state),
    hotUpdate: createHotUpdateHook(state),
    resolveId: createResolveIdHook(),
    load: createLoadHook(),
    transform: createTransformHook(state),
  };
}
