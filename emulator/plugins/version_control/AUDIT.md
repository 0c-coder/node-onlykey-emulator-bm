# version_control - audit

**What it is for:** our release on the maintainer's base. A build with this plugin reports our version - his base
with our build number appended to its patch (`3.1.0` + build 1 = `v3.1.01`) - and carries exactly the patches its
`version.json` lists. A build without it is the maintainer's release as he published it: his version, no patches. It
adds no request and no code; it only names the version.

## version.json

```json
{ "base": "3.1.0", "build": 1, "patches": ["0012", "0013", "0015", "0016"] }
```

- `base`: the maintainer's release the build stages (one-digit patch: he has never used two).
- `build`: ours on top of it, 1 to 9 - reported as the patch's second digit.
- `patches`: the patch folders of `scripts/versions/patches-<base>/` the build applies, by number. The stager
  (`scripts/versions/v3.1.0.js`) and the hard key's build (`plugins/edge/tools/build-hardkey.sh`) both apply exactly
  this list; a listed patch that is held (a `HOLD` file) or missing stops the build.

A new release of ours raises `build` and changes the list together, so one version always names one set of patches.

## Hooks

| File | Where | What |
|---|---|---|
| onlykey/onlykey.h | before `#define OKversion "v" OKversionmaj "." OKversionmin "." OKversionpat OKversionkeyword` | `#undef` and `#define` of `OKversionmaj`, `OKversionmin`, `OKversionpat` from `version.json` (the patch as base patch then build) |

## What changes on the key

- **The version string**, everywhere the base builds it from those three: the status a host reads
  (`UNLOCKEDv3.1.01-prodc`), the version the key prints. The release keyword (`-prod` / `-test`) and the model letter
  are the base's.
- **Nothing else.** The base writes only the major to EEPROM 1984 (its downgrade guard), so a build bump never stops a
  key from going back to the maintainer's firmware of the same major.

## Hosts

- node-onlykey-lib (`src/device/version.js`) reads a two-digit patch as the base's patch, then our build: `v3.1.01` is
  at least 3.1.0 and below the maintainer's 3.1.1, so every 3.1.0 capability holds and a later release of his still
  compares as newer.
- A host that reads the patch as a plain number sees 3.1.1 - newer than 3.1.0, which asks it for nothing.

## Storage

Stateless: no storage of its own, so it does not move a soft key to another storage slot.
