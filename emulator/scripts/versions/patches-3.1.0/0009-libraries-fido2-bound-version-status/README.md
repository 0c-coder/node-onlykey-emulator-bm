# libraries: the version status after the transit key can be written past its buffer

**Patch:** `0009-fido2-bound-the-version-status-copied-after-the-transit-key.patch`
**For:** trustcrypto/libraries PR #33, branch `release-3.1.0` @ `37aa531`
**Size:** 1 file, +10 / -1: `fido2/ok_extension.cpp`.
**Order:** applies to `37aa531` alone (`git am` clean), and on top of 0008. Firmware only.
**Status:** tested (see section 3). Brad decides whether it is sent.

---

## 1. How it is broken

`fido2/ok_extension.cpp` (bridge_to_onlykey, the OKCONNECT reply of the WebAuthn tunnel):

```c
memcpy(ecc_public_key + 32, HW_MODEL(UNLOCKED), sizeof(UNLOCKED) + 1);
```

`ecc_public_key` is `MAX_ECC_KEY_SIZE * 2 + 1` = 65 bytes (`okcrypto.cpp:150`), so 33 bytes follow the
32-byte transit key. The copy is sized by the string: `UNLOCKED` is `"UNLOCKED" OKversion`, and `HW_MODEL()`
returns it with the model letter appended (`c`, `p`, `n`) - so `sizeof(UNLOCKED) + 1` is exactly the
string, its model letter and the terminator. Any version name longer than 23 characters writes past the
buffer.

| Build | Status string | Bytes copied | Room | |
|---|---|---|---|---|
| The RC test hex (rig keyword `-test-9fceea1-37aa531`) | `UNLOCKEDv3.1.0-test-9fceea1-37aa531c` (36) | 37 | 33 | **4 bytes past the buffer** |
| Release prod hex | `UNLOCKEDv3.1.0-prodc` (20) | 21 | 33 | fits |

Seen on both developer keys on the RC test hex: the version in the tunnel's OKCONNECT reply comes back cut
(`UNLOCKEDv3.1.0-test-9fceea1-37aa5`), because the next line copies only the buffer's 65 bytes into the
reply. What the 4 stray bytes overwrite depends on the link map; the transit itself kept working.

## 2. The fix

The copy is bounded by the room left in `ecc_public_key`. A status that fits is copied exactly as before
(string, model letter, terminator); one that does not is cut at the buffer's end - the same bytes the reply
already carried - with nothing written past it.

## 3. Tested

| Check | Result |
|---|---|
| `git am` on `37aa531` alone, and on top of 0008 | clean |
| Test hex and prod hex build (0008 + 0009) | both build |
| Both developer keys flashed (0008 + 0009), provisioned, v3.0.4 backup restored (upgrade path) | 7/7 each |
| Emulator (v3.1.0 DEBUG + 0008), AddressSanitizer, the rig's long version keyword, kit `01-protocol/12-webauthn-tunnel`, **WITHOUT 0009** | caught: `WRITE of size 37 in bridge_to_onlykey`, "0 bytes after global variable 'ecc_public_key' defined in okcrypto.cpp:150:9 of size 65"; the firmware then aborts (`_FORTIFY_SOURCE`) and the tunnel test crashes at its second step |
| Same, **WITH 0009** | no write past `ecc_public_key`; the tunnel test runs - its one failure is the version read back cut by the reply's fixed size (`...-37aa5` vs `...-37aa531c`), which is the format, not memory |
| Final build (0008 + 0009 + 0010) on both keys: kit protocol + security | Windows 128 passed, 0 failed; Linux 159 passed, 0 failed |
| Same: upgrade path (v3.0.4 backup restored), web age/PGP/PQC, App 6.0.0 Preferences | all pass on both platforms |
| Same: CLI by hand (onlykey-cli, onlykey-agent, onlykey-gpg, age) | all pass; on Windows onlykey-agent SSH sign fails as on the RC (software: no AF_UNIX) |
| Kit CLI section + GUI section on the emulated final build (0008 + 0009 + 0010 in the build tree, checked) | 202 passed, 0 failed, 1 skipped |
