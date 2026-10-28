'use strict';
/*
 * THE TEST FOR PATCH 0015 - fido2: a getAssertion with up false does not run the extension request. It FAILS on 3.1.0
 * as released (libraries fe9e293) and PASSES with the patch.
 *
 * Windows' WebAuthn (webauthn.dll, which Chrome and Edge use there) sends every allowCredentials request twice: a silent
 * check first (options.up false), then the real request (up true). The firmware ran the extension request - the web
 * apps' WebAuthn tunnel - on the silent check: the transit layer took its data and stored the answer, and the real
 * request that followed was dropped as a repeated packet ("Repeated data packet ignored"). The page never got its answer
 * and started over, for ever. Chrome on Linux sends the real request alone, so the web apps worked there.
 *
 * The kit's browser (onlykey-testing lib/webenv.js, silentCheck) sends what Windows sends. The test reads, over the
 * tunnel, the key the OnlyKey web apps derive for a label (okcrypto.derivePublicKey: the released firmware's own web
 * derivation, slot 128) - once as Linux sends it, once behind a silent check as Windows does: both must be answered, the
 * same key. Run by onlykey-testing's 09-patches (OKT_PATCHES=0015 runs it on any build); any key, emulated or hard.
 */
const LABEL = 'onlykey-testing patch 0015 silent check';

module.exports = function register({ it }, ctx) {
  const derivedThrough = async (device, opts) => {
    const { lib, okcrypto } = await ctx.kit.webenv.browserLib(device, opts);
    try {
      return Buffer.from(await okcrypto.derivePublicKey(LABEL)).toString('hex');
    } finally {
      await lib.destroy();
    }
  };
  const settle = (promise, ms) => Promise.race([
    promise.then((value) => ({ value }), (error) => ({ error })),
    new Promise((resolve) => setTimeout(() => resolve({ error: new Error(`no answer in ${ms / 1000} s`) }), ms)),
  ]);

  it('0015: the WebAuthn tunnel answers a request with data when a silent check (up false) comes first - Windows',
    async ({ device, assert, signal, log }) => {
      await device.ensureUnlocked(ctx.PINS.primary, { signal });
      const plain = await derivedThrough(device, { signal, silentCheck: false });
      log(`one request (Linux): ${plain.slice(0, 16)}`);
      const windows = await settle(derivedThrough(device, { signal, silentCheck: true }), 60000);
      log(`silent check first (Windows): ${windows.error ? `failed - ${windows.error.message}` : windows.value.slice(0, 16)}`);
      assert.ok(!windows.error,
        `behind a silent check the tunnel request was not answered (the extension ran on the check): ${windows.error && windows.error.message}`);
      assert.equal(windows.value, plain, 'behind a silent check the tunnel answered another key');
    });
};
