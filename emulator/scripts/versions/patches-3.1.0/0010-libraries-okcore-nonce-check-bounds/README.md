# libraries: the nonce check reads 20 bytes past a 12-byte stack buffer

**Patch:** `0010-okcore-the-nonce-check-sums-the-bytes-it-read-not-always-32.patch`
**For:** trustcrypto/libraries PR #33, branch `release-3.1.0` @ `37aa531`
**Size:** 1 file, +3 / -2: `onlykey/okcore.cpp` (inside `okcore_flashget_noncehash()` only).
**Order:** applies to `37aa531` alone (`git am` clean), and on top of 0008 and 0009. Firmware only.
**Status:** tested (see section 3). Brad decides whether it is sent.

---

## 1. How it is broken

```c
int okcore_flashget_noncehash(uint8_t *ptr, int size) {
    ...
    okcore_flashget_common(ptr, (unsigned long *)adr, size);   // reads `size` bytes into ptr
    for (int i = 0; i < 32; i++) {                             // but always sums 32
        set = *(ptr + i) + set;
    }
    ...
    if (set == 8160) { //0xFF * 32
```

`okcrypto_aes_gcm_encrypt()` and `okcrypto_aes_gcm_decrypt()` - which seal and open keys stored in flash - call
it with a **12-byte** stack buffer (`uint8_t iv2[12]`), so every call reads **20 bytes past that buffer**. It
runs on every PIN set and every sealed-key read.

Found by building the 3.1.0 release candidate's emulator with AddressSanitizer:

```
AddressSanitizer: stack-buffer-overflow ... READ of size 1
  #0 okcore_flashget_noncehash
  #1 okcrypto_aes_gcm_encrypt      (and okcrypto_aes_gcm_decrypt)
  #2 ecc_priv_flash  #3 set_private  #4 okcore_flashset_pinhashpublic  #5 set_primary_pin
Address ... is located in stack ... 'iv2' (line 1623) <== Memory access at offset 812 overflows this variable
```

Read-only, and these two callers ignore the result, so nothing leaks or breaks today; it is undefined
behaviour in key-handling code on every PIN set.

## 2. The fix

The sum covers the `size` bytes that were read, and the "never written" test compares with `0xFF * size`.
The callers that use the result (`initcheck`, the first-use checks in `okcore.cpp` and `OnlyKey.ino`) pass 32,
so for them `0xFF * size` is 8160 - exactly the old check.

## 3. Tested

| Check | Result |
|---|---|
| `git am` on `37aa531` alone, and on top of 0008 + 0009 | clean |
| Test hex and prod hex build (0008 + 0009 + 0010) | both build |
| Emulator, AddressSanitizer with recovery, 0008 + 0009 + 0010 in the build tree, kit fixture (PINs set 3 times) + `01-protocol/12-webauthn-tunnel` | **0 reports** (the RC: the over-read on every encrypt and decrypt) |
| Both developer keys flashed (0008 + 0009 + 0010), provisioned (PIN set runs through this function), v3.0.4 backup restored | 7/7 each |
| Final build (0008 + 0009 + 0010) on both keys: kit protocol + security | Windows 128 passed, 0 failed; Linux 159 passed, 0 failed |
| Same: upgrade path (v3.0.4 backup restored), web age/PGP/PQC, App 6.0.0 Preferences | all pass on both platforms |
| Same: CLI by hand (onlykey-cli, onlykey-agent, onlykey-gpg, age) | all pass; on Windows onlykey-agent SSH sign fails as on the RC (software: no AF_UNIX) |
| Kit CLI section + GUI section on the emulated final build (0008 + 0009 + 0010 in the build tree, checked) | 202 passed, 0 failed, 1 skipped |
