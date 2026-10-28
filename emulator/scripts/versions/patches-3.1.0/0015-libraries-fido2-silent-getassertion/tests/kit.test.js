'use strict';
/*
 * THE TEST FOR PATCH 0015 - fido2: a getAssertion with up false does not run the extension request. It FAILS on 3.1.0
 * as released (libraries fe9e293) and PASSES with the patch.
 *
 * Windows' WebAuthn (webauthn.dll, which Chrome and Edge use there) sends every allowCredentials request twice: a silent
 * check first (options.up false), then the real request (up true). The firmware ran the extension request - the web
 * apps' WebAuthn tunnel - on the silent check: the transit layer took its data and stored the answer, and the real
 * request that followed was dropped as a repeated packet ("Repeated data packet ignored"). The page never got its answer
 * and started over, for ever. Chrome on Linux sends the real request alone, so the web apps worked there. The tunnel's
 * connect (OKCONNECT, and the derivations it carries) is not hit; every request after it is.
 *
 * The test is the web apps' classic use: an RSA-2048 key in the sign slot (slot 2, as onlykey-pgp.js uses it), and
 * OKSIGN of one digest through the tunnel (the kit's browser, onlykey-testing lib/webenv.js, and node-onlykey-lib's
 * okcrypto - sealed by the transit key, polled, one press). Once as Linux sends it; once behind a silent check, as
 * Windows does. An RSA PKCS#1 v1.5 signature is deterministic, so both answers must be the same bytes. A DEBUG build
 * (the press goes through the debug console). Run by onlykey-testing's 09-patches (OKT_PATCHES=0015 runs it on any
 * build); any key, emulated or hard.
 */
const crypto = require('crypto');

/* set_slot()'s webcrypt policy field, and its bit for stored-slot OKSIGN/OKDECRYPT over FIDO2 (okcore.h). A DEBUG build
   trusts every origin before reading it; a release build's default (level 1) needs it */
const FIELD_WEBCRYPT_POLICY = 31;
const OKWC_ALLOW_STORED_KEY = 0x01;
/* done_process_packets()' last line before it waits for the press */
const PRIMED = /Encrypted Buffer/g;

module.exports = function register({ it }, ctx) {
  const rsa = ctx.kit.rsaSlots;

  const signThrough = async (device, digest, opts) => {
    const { lib, okcrypto } = await ctx.kit.webenv.browserLib(device, opts);
    try {
      device.log.clear();
      const primed = device.log.count(PRIMED);
      const answer = okcrypto.tunnelRequest(ctx.okmsg.MSG.OKSIGN, rsa.SLOT_SIGN, digest);
      answer.catch(() => {});
      await device.log.waitForCount(PRIMED, primed + 1, { timeoutMs: 30000, signal: opts.signal });
      await device.sleep(300, { signal: opts.signal });
      device.press(1);
      const r = await answer;
      if (!r || !r.data) throw new Error(`the key answered: ${r && r.text}`);
      return Buffer.from(r.data).toString('hex');
    } finally {
      await lib.destroy();
    }
  };
  const settle = (promise, ms) => Promise.race([
    promise.then((value) => ({ value }), (error) => ({ error })),
    new Promise((resolve) => setTimeout(() => resolve({ error: new Error(`no answer in ${ms / 1000} s`) }), ms)),
  ]);

  it('0015: a stored-key sign over the WebAuthn tunnel is answered when a silent check (up false) comes first - Windows',
    async ({ device, assert, signal, log, skip }) => {
      if (!ctx.build.debug) return skip('needs a DEBUG build: the press goes through the debug console');
      const key = rsa.keypair();
      await rsa.loadKeys(device, [{ slot: rsa.SLOT_SIGN, typeByte: rsa.RSA_2048 | rsa.FEATURE_SIGN, pq: key.pq }], { signal, assert });

      /* stored-key use over FIDO2 (config mode, as every setting) */
      await ctx.kit.pqc.readyForKeygen(device, { signal });
      const since = device.mark(ctx.IFACE.VENDOR);
      device.sendVendor({ msg: ctx.okmsg.MSG.OKSETSLOT, slot: 1, field: FIELD_WEBCRYPT_POLICY, payload: Buffer.from([OKWC_ALLOW_STORED_KEY]) });
      const policy = await device.waitHid(ctx.IFACE.VENDOR, { since, match: /Success|Error/, timeoutMs: 8000, signal });
      assert.match(ctx.okmsg.text(policy).trim(), /Successfully set webcrypt policy/, `the webcrypt policy: ${ctx.okmsg.text(policy).trim()}`);
      await device.restart({ signal });
      await device.ensureUnlocked(ctx.PINS.primary, { signal });

      const digest = crypto.createHash('sha256').update('onlykey-testing patch 0015 silent check').digest();
      const plain = await signThrough(device, digest, { signal, silentCheck: false });
      log(`one request (Linux): signature ${plain.slice(0, 16)}... (${plain.length / 2} bytes)`);
      const windows = await settle(signThrough(device, digest, { signal, silentCheck: true }), 60000);
      log(`silent check first (Windows): ${windows.error ? `failed - ${windows.error.message}` : `signature ${windows.value.slice(0, 16)}...`}`);
      assert.ok(!windows.error,
        `behind a silent check the tunnel sign was not answered (the firmware ran it on the check and dropped the real request): ${windows.error && windows.error.message}`);
      assert.equal(windows.value, plain, 'behind a silent check the tunnel answered another signature');
    });
};
