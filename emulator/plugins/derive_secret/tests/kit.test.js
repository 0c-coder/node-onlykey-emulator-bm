'use strict';
/*
 * derive_secret's tests (the onlykey-testing kit), side-loaded: they leave with the plugin. Everything from the kit
 * comes in through `ctx`. The lib is composed as a page composes it (kit lib/webenv.js) and asked through its own
 * okcrypto.deriveSecret, so the test covers the request the apps will make, not a hand-built one.
 *
 * Two keys, the same settings, a flag in the request, one gate: touchless goes through the key's derive setting
 * (field 30) like every derive - the code by default, so it is protected until the person unprotects it (field 30 =
 * none); touch through the same gate with a press as its floor - the code at the default, one press at none.
 */
const hex = (b) => Buffer.from(b).toString('hex');
const FIELD_DERIVE_MODE = 30;
const MODE_CHALLENGE = 0; /* the default */
const MODE_NONE = 2;

module.exports = function register({ it }, ctx) {
  /* the lib's browser stack on the kit's device, at `rpId`, optionally as Windows (a silent check before each request) */
  async function browser(device, signal, { rpId, silentCheck } = {}) {
    const Rectify = ctx.requireLib('@bmatusiak/rectify');
    const plugins = ['host', 'transport/tunnel', 'session', 'device', 'okcrypto']
      .map((p) => ctx.requireLib(`node-onlykey-lib/plugins/${p}`));
    const { createWebAuthnCtap } = ctx.requireLib('node-onlykey-lib/transport/webauthn');
    const { window } = ctx.kit.webenv.create(device, { signal, rpId, silentCheck });
    plugins.config = {
      okcrypto: {
        ctap: createWebAuthnCtap({ credentials: window.navigator.credentials, ...(rpId ? { rpId } : {}) }),
        ...(rpId ? { rpIds: [rpId] } : {}),
      },
    };
    const app = await new Promise((resolve, reject) => {
      const a = Rectify.build(plugins, (err, started) => (err ? reject(err) : resolve(started)));
      a.start();
    });
    await app.services.okcrypto.connectTunnel();
    return app;
  }
  async function derive(device, signal, label, opts = {}, where = {}) {
    const app = await browser(device, signal, where);
    try { return hex(await app.services.okcrypto.deriveSecret(label, { timeoutMs: 40000, ...opts })); } finally { await app.destroy(); }
  }

  /* the key holds the request while it waits: press once it has had a moment to start - the code, or one button */
  const presser = (device, log) => async ({ digits }) => {
    log(`the host asks for ${digits ? `the code ${digits.join(' ')}` : 'a press'}`);
    await device.sleep(1500);
    if (digits) device.pressLine(digits); else device.press(1);
  };
  /* a key whose derive setting asks one press: one button, whatever code the host shows */
  const pressOne = (device, log) => async () => {
    log('one press');
    await device.sleep(1500);
    device.press(1);
  };

  /* field 30 in config mode, then a restart (config mode ends there) and the unlock */
  async function setDeriveMode(device, signal, assert, mode) {
    await device.restart({ signal });
    await device.unlock(ctx.PINS.primary, { signal });
    await device.enterConfigMode(ctx.PINS.primary, { signal });
    const since = device.mark(ctx.IFACE.VENDOR);
    device.sendVendor({ msg: ctx.okmsg.MSG.OKSETSLOT, slot: 1, field: FIELD_DERIVE_MODE, payload: Buffer.from([mode]) });
    const reply = await device.waitHid(ctx.IFACE.VENDOR, { since, match: /Success|Error/, timeoutMs: 6000, signal });
    assert.match(ctx.okmsg.text(reply), /Success/, `field 30 = ${mode} was refused`);
    await device.restart({ signal });
    await device.unlock(ctx.PINS.primary, { signal });
  }

  it('derive_secret: the touchless key is protected until unprotected; touch always asks; modes, labels and sites are separate keys', async ({ device, assert, signal, log }) => {
    await device.restart({ signal });
    await device.unlock(ctx.PINS.primary, { signal });

    /* protected: field 30 at its default asks for the code even for touchless */
    const guarded = await derive(device, signal, 'okedge/test/a', { confirm: presser(device, log) });
    log(`touchless a (field 30 default, the code pressed): ${guarded.slice(0, 16)}`);
    assert.equal(guarded.length, 64, 'a secret is 32 bytes');
    /* touch at the default: the gate's code too - its own code, the mode is in the payload */
    const touchCode = await derive(device, signal, 'okedge/test/a', { touch: true, confirm: presser(device, log) });
    assert.notEqual(touchCode, guarded, 'touch and touchless are two unrelated secrets');

    await setDeriveMode(device, signal, assert, MODE_NONE);
    try {
      /* unprotected: the same key, no press */
      const a1 = await derive(device, signal, 'okedge/test/a');
      const a2 = await derive(device, signal, 'okedge/test/a');
      assert.equal(a1, guarded, 'the touchless key is one key, asked with or without the code');
      assert.equal(a2, a1, 'one label, one touchless secret');
      const b = await derive(device, signal, 'okedge/test/b');
      assert.notEqual(b, a1, 'another label, another secret');

      /* touch: a press even with field 30 = none (its floor), and the same touch key however it was pressed */
      const t1 = await derive(device, signal, 'okedge/test/a', { touch: true, confirm: pressOne(device, log) });
      const t2 = await derive(device, signal, 'okedge/test/a', { touch: true, confirm: pressOne(device, log) });
      assert.equal(t2, t1, 'one label, one touch secret');
      assert.equal(t1, touchCode, 'the touch key is one key, asked by code or by press');
      assert.notEqual(t1, a1, 'touch and touchless are two unrelated secrets');
      let unpressed = null;
      try { unpressed = await derive(device, signal, 'okedge/test/a', { touch: true }); } catch (_) { /* refused: right */ }
      assert.equal(unpressed, null, 'a touch secret came back with no press');

      /* another site the key trusts: another secret; a host that checks silently first (Windows): the same one */
      const other = await derive(device, signal, 'okedge/test/a', {}, { rpId: 'apps.onlykey.io' });
      assert.notEqual(other, a1, 'another rpId, another secret');
      const win = await derive(device, signal, 'okedge/test/a', {}, { silentCheck: true });
      assert.equal(win, a1, 'the Windows host derives the same secret');
      log(`touchless a ${a1.slice(0, 16)}, b ${b.slice(0, 16)}, at apps.onlykey.io ${other.slice(0, 16)}; touch a ${t1.slice(0, 16)}`);
    } finally {
      await setDeriveMode(device, signal, assert, MODE_CHALLENGE);
    }
  });
};
