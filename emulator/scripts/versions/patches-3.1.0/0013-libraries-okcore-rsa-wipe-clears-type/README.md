# libraries: wiping an RSA slot leaves its key type, so the slot goes on answering with a "key"

**Patch:** `0013-okcore-wiping-an-RSA-slot-clears-its-key-type.patch`
**For:** trustcrypto/libraries `master` @ `fe9e293` (the pins ok-80e3ba0-fe9e293)
**Size:** 1 file, +6: `onlykey/okcore.cpp` (`rsa_priv_flash()`, the wipe branch).
**Order:** applies to `fe9e293` alone (`git am` clean), and with 0012 in either order. Firmware only.
**Status:** SENT to the maintainer 2026-10-26 (by Brad: the patch alone, in `0013-okcore-wiping-an-RSA-slot-clears-its-key-type.tar.gz`, for ok-80e3ba0-fe9e293-test). Staged on our builds until a pin carries it; then the re-pin removes this folder.
**Write-up:** the finding in full, in the workspace: `FINDING-rsa-wipe-keeps-key-type.md`, with
`FINDING-rsa-wipe/rsa_wipe_check.py` (the reproduction).

**Severity:** low. The wiped private key really is gone, but the slot does not become empty.

---

## 1. How it is broken

`OKWIPEPRIV` for RSA1-RSA4 (`onlykey-cli wipekey RSA1..RSA4`) zeroes the slot's 512 bytes of flash and answers
"Successfully wiped RSA Private Key". It does not clear the slot's key type, which lives in EEPROM. On the next read the
firmware still finds a type, so it treats the slot as holding a key:

1. `okcore_flashget_RSA()` runs the AES-GCM decryption over the zeroed flash. No tag is checked, so the result is the
   slot's keystream.
2. It takes that keystream as the primes p and q.
3. `rsa_getpub` publishes their product as the slot's public key.

So a wiped RSA slot never reads as empty. It answers `OKGETPUBKEY` with a modulus of the old key's size: not the old
key, and not a valid RSA key. Signing and decrypting requests on it are attempted with that non-key too.

**For comparison, the ECC wipe** clears the type: `wipe_private()` zeroes the type byte and `ecc_priv_flash()` stores
it, and the wiped ECC slot then answers "Error no ECC Private Key set".

## 2. The fix

In the wipe branch of `rsa_priv_flash()`, after the flash is zeroed:

```c
uint8_t no_key = 0;
okeeprom_eeset_rsakey(&no_key, (int)buffer[5]);
```

`okeeprom_eeset_rsakey()` is the only place an RSA slot's type is written (the load path uses it too). With the type 0,
`okcore_flashget_RSA()` answers "Error no RSA Private Key set in this slot", as for a slot never loaded.

**What it does not change:** loading, reading, signing and decrypting with a loaded key; the ECC wipe; the backup.

## 3. The test

**The test that ships with this patch:** `tests/kit.test.js`, beside this README. It is strict: it FAILS on 3.1.0 as
released and PASSES with the patch - the failure shows the bug, the pass shows the fix. It runs in onlykey-testing
(github.com/bm-ok/onlykey-testing), section 09-patches, on an emulator or a DEBUG developer key:

    OKT_PATCHES=0013 OKT_PATCHES_DIR=<this patch's parent folder> node bin/okt.js run 09-patches
    OKT_PATCHES=0013 OKT_PATCHES_DIR=<this patch's parent folder> node bin/okt.js run 09-patches --hardware

**Measured 2026-10-28** (Linux, two DEBUG emulators built from one node-onlykey-emulator commit, ok-edge
`tools/box/patch-proof.sh`):

| firmware | result |
|---|---|
| 3.1.0 as released | FAIL - the wiped RSA slot still publishes a modulus (its key type was left set) |
| 3.1.0 + 0012 + 0013 + 0015 | pass |

`rsa_wipe_check.py` (python-onlykey client; `onlykey-cli` has no public-key read, sign or decrypt command):

1. Load a throwaway RSA-2048 key into RSA4 (config mode, `onlykey-cli setkey RSA4 2 s <p||q>`), replug, unlock, read
   it: the slot answers the key's modulus.
2. Wipe it (config mode, `onlykey-cli wipekey RSA4`), replug, unlock, read again.

Before the fix the wiped slot publishes another modulus (no key; its small prime factors show it is not RSA). After the
fix it answers "Error no RSA Private Key set in this slot". Recorded at 8d28305, before and after, on emulator builds;
the code it touches is the same at `fe9e293`.

**In the kit:** `tests/kit.test.js` above (until 2026-10-28 a branch of onlykey-testing `01-protocol/19-rsa-keys`, which
now asserts only what every build does: the wipe is acknowledged and the old key is gone).

**On `fe9e293` (2026-10-26):** passes on developer hard key 2 (Tim's pins + 0012 + 0013, the whole kit 178/0) and on the DEBUG emulator staging 0012 + 0013: "after the wipe: Error no RSA Private Key set in this slot".
