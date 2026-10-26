# Soft-key firmware plugins

Firmware changes for the **soft key**, each in its own folder: experimental features, and fixes to the base firmware that are tested here before they are proposed upstream. Because each plugin is its own folder:
- it is **removed** by deleting the folder;
- it is **audited** by reading just the folder.

Hard keys never get the feature plugins. A fix plugin is how a fix for every key is built and tested first (see "Firmware fixes" below).

**This is the plugins' one home** (Brad, 2026-10-21: one soft key, fixed in one place). The emulator's Node build, its Android build (`emulator/android/`, used by ok-edge) and the test kit all stage from here. The loader is the library's (`node-onlykey-lib/cli/firmware-plugins`). ok-rn keeps its own copy in `android/okemu/plugins/` until ok-edge replaces it; **edit plugins here**, not there.

## Use one
Name the plugins when you stage or build. Without the variable nothing is staged, and the soft key is the base build, byte for byte (the staged digest is unchanged):
```
OKEMU_PLUGINS=edge npm run rebuild                                   # Node addon, from emulator/
OKEMU_PLUGINS=config,edge,key_chain ./gradlew -p android assembleRelease   # Android library
OKEMU_PLUGINS=edge node scripts/stage.js                             # stage only
```
`OKEMU_PLUGINS_DIR` stages from another folder instead of this one.

**What a plugin build does differently:**
- **Its own storage:** a plugin build keeps its own storage (the emulator: `.onlykey-storage-plugins-<names>`; an app: its own slot), so it never boots against the base soft key's flash.
- **It says so:** `.stage/build.json` records `plugins` and `pluginsDir`; an app shows them (ok-rn's start page "plugins" row).
- **Soft-key-only features:** an app treats a plugin's features as the soft key's alone (ok-rn: `hasSoftKeyPlugin(name)`), never through a firmware version.

## Folder layout: `plugins/<name>/`
| File | What |
|---|---|
| `plugin.js` | the manifest: `name`, `minBase` (oldest firmware it is written for), `hooks`, `notes` |
| `src/` | the plugin's own C/C++, prefixed `okplugin_<name>_`; staged to `.stage/libraries/onlykey/plugins/<name>/`, which the build already compiles and includes |
| `AUDIT.md` | every hook, every new message, every byte stored, and what it does not do |
| `tests/kit.test.js` | its emulator tests (the onlykey-testing kit): `module.exports = function register({it}, ctx)` |
| `tests/e2e.js` | its on-device tests (an app's in-app e2e): same shape |

**Tests live in the plugin and are side-loaded,** so they leave with it.
- **Kit:** the kit's `01-protocol/38-softkey-plugins.test.js` reads `.stage/build.json` and registers each `<pluginsDir>/<name>/tests/kit.test.js`. Against a base emulator it skips.
- **App:** with `OKEMU_APP_OUT` set, the stager copies each staged plugin's `tests/e2e.js` under it, with a generated list the app's suite registers.

A test gets the app or the kit through `ctx` (device access, `IFACE`, `okmsg` or `protocol`, the PIN), never by a relative path.

**Hooks:** `{file, anchor, insert: 'before' | 'after', text}`.
- The anchor must occur **exactly once** in the staged file. Otherwise the stage stops, so a plugin never builds into a firmware it wasn't written against.
- Keep hooks to the minimum: an `#include`, and a `case` in the vendor switch.

**The mechanism:** `scripts/stage.js` calls the library's loader after the literal patches and before the digest.

## Plugins
| Name | What |
|---|---|
| `hello` | demo: `OKHELLO` (0x7E) answers a fixed sentence while unlocked |
| `config` | OKGETCONFIG prints the settings as INI; OKSETCONFIG imports one (config mode, DEBUG builds only) |
| `edge` | OnlyKey Edge: budgets opened at a press, each use linked in the key's hash chain ([edge/README.md](edge/README.md)); its rules are [edge/SPEC.md](edge/SPEC.md) |
| `key_chain` | reports each derived public key the soft key makes, and a record of each press for the press sheet |

## Firmware fixes

A fix to the BASE firmware is not a plugin: it is a maintainer patch (owner, 2026-10-26), so what we test is exactly what goes upstream:
- `scripts/versions/patches-<version>/<nnnn>-<repo>-<topic>/` holds the `git am` patch made on the release pin, and its README: the issue, why it happens, the fix, what it does not change, and the test;
- `scripts/versions/fixes-<version>.js` stages it on the soft key, generated from the patch by `scripts/versions/gen-fixes.js <version>` (`--check`, `--verify <checkout>`) - never edited by hand;
- `plugins/edge/tools/build-hardkey.sh` `git am`s the same patch files for a developer hard key;
- the onlykey-testing kit reproduces the issue (it fails without the patch and passes with it), as a test of its own.

When upstream takes a fix, the re-pin removes its folder and `gen-fixes.js` drops it (fix_usertimeout was a plugin until it became patch 0012, 2026-10-26).
