/**
 * chinook-dsh-plugin package entry.
 *
 * The cordis loader accepts the plugin object either as the module's default
 * export or as named exports ({ name, inject, apply }); we provide both so
 * the plugin works under plain ESM imports and through the loader.
 */

import * as plugin from "./plugin.js";

export default plugin;
export { name, inject, apply } from "./plugin.js";
