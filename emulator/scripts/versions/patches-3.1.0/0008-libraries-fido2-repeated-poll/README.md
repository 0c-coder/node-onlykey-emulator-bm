# libraries: Windows' duplicate WebAuthn requests lose large replies and restart finished operations

**Patch:** `0008-fido2-windows-duplicate-requests.patch` (2 commits, one `git am`)
**For:** trustcrypto/libraries PR #33, branch `release-3.1.0` @ `37aa531`
**Size:** 3 files, +42 / -1: `fido2/ok_extension.cpp`, `onlykey/okcrypto.cpp`, `onlykey/okcrypto.h`.
**Order:** applies to `37aa531` as it is (`git am` clean). Firmware only - no web app change.
**Status:** tested (see section 3). Brad decides whether it is sent.

---

## 1. How it is broken (Windows only)

Windows' WebAuthn layer sends every request twice and keeps the second answer. The web app (live
`apps.onlykey.io`, app code `c7c59d6`) talks to the key through WebAuthn, so on Windows every message
arrives twice. The firmware already absorbs some of these duplicates (the `opt3` sequence of multi-packet
requests, the `'W'` check of the classic derive); two paths fall between them:

**A. Large replies lose a chunk.** A reply longer than 512 bytes is read with `OKPING` polls whose `opt3`
is 0, which `send_stored_response()`'s duplicate check (`opt3 && last_opt3 && opt3 <= last_opt3`) cannot
see. Both copies of a poll advanced the cursor, and the copy Windows kept was one chunk ahead. The key's
console on the release candidate:

```
chunk opt3=2 last=0 dup=0 start=0    len=512 of=1305   <- the reply's first chunk
chunk opt3=0 last=2 dup=0 start=512  len=512 of=1305   <- poll, copy 1: chunk 2, discarded by Windows
chunk opt3=0 last=0 dup=0 start=1024 len=281 of=1305   <- poll, copy 2: chunk 3, what the page got
```

**B. A finished operation is restarted.** The `opt3` duplicate check is reset by a message's final packet,
so Windows' copy of that final packet - which can arrive after the operation was already confirmed -
starts a new one-packet message, and its result replaces the real one. Seen on a composite PQC decrypt:

```
transit open ctr=8 len=62            <- the last packet of a 1088-byte ML-KEM ciphertext
Challenge3 entered4                  <- confirmed
Stored Data for FIDO Response 52     <- the real result
transit open ctr=8 repeat len=62     <- Windows' copy of the same packet
Received Message ... Stored Data for FIDO Response 33   <- a new 62-byte "message": an error replaces the result
```

## 2. The fix

Every message the page sends is sealed (transit v2) with a counter that grows by one per message, so a
repeated counter is the same request sent again, never a new one.

- `okcrypto_transit_open()` records whether the frame it opened repeated the previous frame's counter;
  `okcrypto_transit_repeated()` reports it; `okcrypto_transit_reset()` clears it with the transit key.
- **Commit 1:** an `OKPING` whose frame is a repeat re-serves the chunk it served last (fixes A).
- **Commit 2:** a repeated sealed data packet (`OKDECRYPT`/`OKSIGN`) is answered as the existing duplicate
  check answers (`return 0`) and never acted on (fixes B).

Nothing changes where requests are not duplicated (Linux, macOS, a CLI over CTAPHID): no counter repeats.

## 3. Tested

Developer keys (Teensy 3.2) on the 3.1.0 test hex built from `9fceea1` + `37aa531` + the patches; the
pinned python-onlykey `8d77586`, lib-agent `e70f7ee`, live `apps.onlykey.io`, OnlyKey App 6.0.0 `7dae150`.
Final build: 0008 + 0009 + 0010 (0009 and 0010 are independent fixes in other functions).

**Web app in NW.js, the release candidate as published vs. with the patch (Windows 11):**

| Page | RC as published | With 0008 |
|---|---|---|
| `/app/age-encrypt.html` then `/app/age-decrypt.html` | encrypt fails: "transit: message failed authentication" | the age file, and it decrypts to the same text |
| `/app/pqc-encrypt.html` Sign (ML-DSA-65 + Ed25519) | "Incomplete composite response: got 1536 of 3329 bytes" | 4809-character signature; "Signature VALID" |
| `/app/pqc-decrypt.html` Decrypt | "Composite poll failed: Error" (B) | the plaintext |
| `/app/encrypt.html` / `/app/decrypt.html` (PGP, stored RSA key) | works | works |

The key's console during the patched runs: every repeated poll re-served (`transit open ctr=N repeat` /
`dup=1`), every repeated data packet dropped (`Repeated data packet ignored`) - e.g. 35 repeats and 20
dropped packets in one age + PGP + PQC pass.

**Everything else, on the final build (0008 + 0009 + 0010):**

| Check | Windows 11 (key 1) | Linux (key 2) |
|---|---|---|
| Kit protocol + security sections (hard key) | 128 passed, 0 failed (*) | 159 passed, 0 failed |
| Upgrade path: a v3.0.4 backup restored with `onlykey-cli restore`, then the same SSH key, the same GnuPG fingerprints, the stored PGP key decrypts and signs | 7/7 | 7/7 |
| Web app: age encrypt/decrypt, PGP, PQC sign/decrypt/verify | all pass | all pass |
| OnlyKey App 6.0.0 Preferences (User Input Modes, Webcrypt Access) | 9/9 | 9/9 |
| CLI by hand: onlykey-cli, onlykey-agent SSH key, onlykey-gpg init/sign, age | all pass except onlykey-agent SSH sign - the same software failure as the RC (no AF_UNIX on Windows) | all pass |
| Kit CLI section + GUI section on the emulated final build | - | 202 passed, 0 failed, 1 skipped |
| `git am` on `37aa531`; test and prod hex build | clean; both build | |

(*) The Windows test harness (node-hid) crashed the test process itself a few times around device
reconnects; each run was resumed from the file after the crash so every test has a result. One wipe-timer
check failed once in a long run just before such a crash and passed 3 of 3 on its own, and passes on
Linux with the same firmware. These are harness issues, not the firmware.
