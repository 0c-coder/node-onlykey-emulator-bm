# libraries: a silent getAssertion (up false) runs the extension request, so Windows breaks the web apps' tunnel

**Patch:** `0015-fido2-a-getAssertion-with-up-false-does-not-run-the-extension-request.patch`
**For:** trustcrypto/libraries `master` @ `fe9e293` (the pins ok-80e3ba0-fe9e293)
**Size:** 1 file, +16 / -2: `fido2/ctap.cpp` (`ctap_get_assertion()` and `ctap_end_get_assertion()`, the
`ENABLE_U2F_EXTENSIONS` path).
**Order:** applies to `fe9e293` (`git am` clean), alone or after 0012 and 0013. Firmware only.
**Status:** staged on our builds (soft key and developer hard key). Not sent - the maintainer gets it when Brad says.

**Severity:** high for the web apps on Windows: every request through the WebAuthn tunnel that carries data fails
there, and the page retries for ever. Nothing is exposed - the request is answered once, to the wrong ceremony.

---

## 1. How it is broken

Windows' WebAuthn (webauthn.dll, which Chrome and Edge use on Windows) sends every `allowCredentials` request to a
security key twice: first a silent check, a getAssertion with `options.up = false` ("is this credential yours?"), and
then the real request with `up = true`. Chrome on Linux sends the real request alone (measured; macOS not tried).

The OnlyKey's extension requests (the custom credential that carries a web app's message - the WebAuthn tunnel)
ignore `up`. `ctap_get_assertion()` sets the user-present flag for them unconditionally, and `ctap_end_get_assertion()`
runs `extend_fido2()` for both requests. So on Windows:

1. the silent check delivers the message: the transit layer opens it, the request is handled, its answer is stored
   ("transit open ctr=0", "Stored Data for FIDO Response");
2. the real request carries the same message: the transit layer drops it as a repeat ("transit open ctr=0 repeat",
   "Repeated data packet ignored"), and the browser hands the page the answer to that request - not the stored one;
3. the page's transit check fails ("stale reply"), and it starts over: connect, request, the same again.

Measured on a developer hard key (3.1.0 @ fe9e293 + 0012 + 0013, DEBUG) with the ok-edge web app served locally as
`https://apps.crp.to:8787` in Chrome on Windows 11: the connect is answered, every request with data loops as above
(the key's console shows the silent check with `A1 62 75 70 F4` - `{"up": false}` - and the real one with `F5`).
The same key in Chrome on Linux answers every request.

## 2. The fix

A getAssertion with `up` false only asks whether the credential is known. For an extension request it is now answered
with a plain assertion - without the user-present flag, and without running the extension:

- `ctap_get_assertion()`: `extension_silent = (GA.up == 0)`; the UP flag is set only when it is false;
- `ctap_end_get_assertion()`: `if (!extension_silent && extend_fido2(...))`, so the silent check takes the ordinary
  signature path;
- the flag is cleared after `ctap_end_get_assertion()` returns.

The real request (up true, or absent: `GA.up` stays 0xff when the host sends no options) runs the extension once, as
before. This is what the non-extension path already does (`device_disable_up(GA.up == 0)`).

## 3. The test

**The test that ships with this patch:** `tests/kit.test.js`, beside this README. It is strict: it FAILS on 3.1.0 as
released and PASSES with the patch - the failure shows the bug, the pass shows the fix. It runs in onlykey-testing
(github.com/bm-ok/onlykey-testing), section 09-patches, on an emulator or a DEBUG developer key:

    OKT_PATCHES=0015 OKT_PATCHES_DIR=<this patch's parent folder> node bin/okt.js run 09-patches
    OKT_PATCHES=0015 OKT_PATCHES_DIR=<this patch's parent folder> node bin/okt.js run 09-patches --hardware

**Measured 2026-10-28** (Linux, two DEBUG emulators built from one node-onlykey-emulator commit, ok-edge
`tools/box/patch-proof.sh`):

| firmware | result |
|---|---|
| 3.1.0 as released | FAIL - the sign behind the silent check is never answered: "transit authentication failed or a stale reply was returned" |
| 3.1.0 + 0012 + 0013 + 0015 | pass |

Earlier, in onlykey-testing `01-protocol/43-silent-check` (`lib/webenv.js`'s `silentCheck` - the kit's browser sending
what Windows sends), it read the agent public key the web app reads as its bucket identity, once plainly and once behind
a silent check (that read needs the ctap_bridge plugin; the test that ships uses the released firmware's own stored-key
sign instead):

| build | plain | silent check first (Windows) |
|---|---|---|
| emulator, 0012 + 0013 | `7944e60dbc5532b5` | fails: "transit authentication failed or a stale reply was returned" |
| emulator, 0012 + 0013 + 0015 | `70a95f95161b85a8` | `70a95f95161b85a8` - the same |

(A new build is a new fixture key, so the two builds' identities differ.) That earlier test recorded the bug and
passed without the fix; the one that ships (above) fails without it.

With the fix, the kit's FIDO and WebAuthn tests (09, 11-18, 23, 24, 26, 29, 30, 32, 33, the plugin tests, 43):
emulator 89 passed / 0 failed; developer hard key (fe9e293 + 0012 + 0013 + 0015, edge + ctap_bridge, DEBUG) 79 passed /
0 failed. `OKT_HOST=windows` runs any kit test with the silent check before every browser request.

**On Windows itself** (Chrome on Windows 11, the same hard key, the ok-edge web app at `https://apps.crp.to:8787`): the
login's identity check went through in two WebAuthn calls, the key's console shows the request opened once and no
repeat, and the page showed the key's bucket identity.

Cost: 64 bytes of flash, no RAM.
