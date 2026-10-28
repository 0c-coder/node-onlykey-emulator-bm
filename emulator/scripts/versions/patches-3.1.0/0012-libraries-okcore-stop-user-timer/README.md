# libraries: a stale 20 s timer answers "Timeout" for the next request

**Patch:** `0012-okcore-stop-the-20-s-user-timer-when-a-request-is-decided.patch`
**For:** trustcrypto/libraries `master` @ `fe9e293` (3.1.0 with the security review fixes; the pins ok-80e3ba0-fe9e293)
**Size:** 1 file, +1: `onlykey/okcore.cpp` (the first line of `okcore_run_pending_op()`).
**Order:** applies to `fe9e293` alone (`git am` clean). Firmware only - no web app change.
**Status:** SENT to the maintainer 2026-10-26 (by Brad: the patch alone, in `0012-okcore-stop-the-20-s-user-timer-when-a-request-is-decided.tar.gz`, for ok-80e3ba0-fe9e293-test). Staged on our builds until a pin carries it; then the re-pin removes this folder. Tests: section 3.

---

## 1. How it is broken

`okcore_prime_user_confirmation()` starts the 20 s user timer (`fadeoffafter20()` -> `Usertimeout`, a `DelayRun`)
every time a request is primed for confirmation. Nothing stops the timer when the request is decided:
`okcore_run_pending_op()` clears `CRYPTO_AUTH` and fades off, but the timer keeps running and expires 20 s after the
last prime.

When it expires, `fadeoffafter20sec()` checks `isfade || CRYPTO_AUTH` and `pending_operation`. If the next request's
packets are arriving at that moment, its first `OKSIGN` or `OKDECRYPT` packet has already set `pending_operation` to
`OK*_ERR_USER_ACTION_PENDING`, while its own prime (which would restart the timer) has not run yet. The old timer
then:

- sends `Timeout occured while waiting for confirmation on OnlyKey` to the host, which reads it as the answer to the
  new request - a refusal;
- fades red and wipes the packet details.

The new request is then primed and may even complete, but the host has already given up on it.

**When it happens:** any sign or decrypt whose packets start arriving about 20 s after the previous prime - for
example an ssh login 20 s after a confirmed sign. A multi-packet request over a slow link widens the window. It was
first seen on a phone: an ssh login made 20 s after a confirmed request received "Timeout occured" although the key
primed it once and signed it.

## 2. The fix

One line, at the start of `okcore_run_pending_op()`:

```c
cancelfadeoffafter20(); /* the request is decided: its 20 s wait for the user is over */
```

`okcore_run_pending_op()` runs once a primed request is decided - after the press or challenge, or at once for a
request that needs no press. From then on the timer has nothing left to guard. `cancelfadeoffafter20()` already
exists (it removes `Usertimeout` from the timer list); the FIDO2 code uses it the same way.

**What it does not change:** a request that is never decided still times out after 20 s, with the same message, the
same red fade and the same wipe. Paths that end a waiting request without `okcore_run_pending_op()` (for example a
wrong challenge) are unchanged; they leave the timer running as before.

## 3. The test

**The test that ships with this patch:** `tests/kit.test.js`, beside this README. It is strict: it FAILS on 3.1.0 as
released and PASSES with the patch - the failure shows the bug, the pass shows the fix. It runs in onlykey-testing
(github.com/bm-ok/onlykey-testing), section 09-patches, on an emulator or a DEBUG developer key:

    OKT_PATCHES=0012 OKT_PATCHES_DIR=<this patch's parent folder> node bin/okt.js run 09-patches
    OKT_PATCHES=0012 OKT_PATCHES_DIR=<this patch's parent folder> node bin/okt.js run 09-patches --hardware

**Measured 2026-10-28** (Linux, two DEBUG emulators built from one node-onlykey-emulator commit, ok-edge
`tools/box/patch-proof.sh`):

| firmware | result |
|---|---|
| 3.1.0 as released | FAIL - request B is answered "Timeout occured while waiting for confirmation on OnlyKey" before it can be pressed |
| 3.1.0 + 0012 + 0013 + 0015 | pass |

What the test does (it was this fix's plugin test while the fix was staged as the emulator plugin `fix_usertimeout`, then
onlykey-testing `01-protocol/42-user-timer`):

1. Request A, a two-packet `OKSIGN`, is primed and pressed.
2. Request B's first packet is sent 19 s after A's prime. Its last packet is sent once the emulator's DEBUG console
   reports that the 20 s timer has expired.
3. Before B is pressed, the host must not have received "Timeout occured". After the press, B must be signed.

Without the fix the test fails: B is answered "Timeout occured while waiting for confirmation on OnlyKey" before it
can be pressed. With the fix it passes.

**Recorded runs** (desktop emulator, 3.1.0 tree, DEBUG build, 2026-10-10, as the plugin):

| Build | Result |
|---|---|
| without the line | fail: the old timer ran out 20,068 ms after A's prime, between B's packets; B was answered "Timeout occured while waiting for confirmation on OnlyKey" before its press |
| with the line | pass: no timer ran out by 21,512 ms; B received nothing before its press and was signed after it |

On `fe9e293` (2026-10-26): kit 42 passes on the DEBUG emulator staging 0012 + 0013 (8/0 with test 19); the whole kit on the emulator (205/0) and on developer hard key 2 (178/0, `OKT_FIRMWARE_FIXES=0012,0013`).
