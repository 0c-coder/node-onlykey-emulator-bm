'use strict';
/*
 * derive_secret's tests (the onlykey-testing kit), side-loaded: they leave with the plugin. Everything from the kit
 * comes in through `ctx`. The lib is composed as a page composes it (kit lib/webenv.js) and asked through its own
 * okcrypto.deriveSecret, so the test covers the request the apps will make, not a hand-built one.
 */
const hex = (b) => Buffer.from(b).toString('hex');

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

  /* touch: the code is pressed once the key has had a moment to start waiting (the gate holds the request) */
  const confirmBy = (device, log) => async ({ digits }) => {
    log(`the code the host shows: ${digits.join(' ')}`);
    await device.sleep(1500);
    device.pressLine(digits);
  };

  it('derive_secret: touchless and touch secrets - stable, unrelated to each other, per label and per site', async ({ device, assert, signal, log }) => {
    await device.restart({ signal });
    await device.unlock(ctx.PINS.primary, { signal });
    const app = await browser(device, signal);
    let a1, a2, b, t1, t2;
    try {
      const ok = app.services.okcrypto;
      a1 = hex(await ok.deriveSecret('okedge/test/a'));
      a2 = hex(await ok.deriveSecret('okedge/test/a'));
      b = hex(await ok.deriveSecret('okedge/test/b'));
      t1 = hex(await ok.deriveSecret('okedge/test/a', { touch: true, confirm: confirmBy(device, log), timeoutMs: 40000 }));
      t2 = hex(await ok.deriveSecret('okedge/test/a', { touch: true, confirm: confirmBy(device, log), timeoutMs: 40000 }));
    } finally {
      await app.destroy();
    }
    log(`touchless a ${a1.slice(0, 16)}, b ${b.slice(0, 16)}; touch a ${t1.slice(0, 16)}`);
    assert.equal(a1.length, 64, 'a secret is 32 bytes');
    assert.equal(a2, a1, 'one label, one touchless secret');
    assert.notEqual(b, a1, 'another label, another secret');
    assert.equal(t2, t1, 'one label, one touch secret');
    assert.notEqual(t1, a1, 'touch and touchless are two unrelated secrets');

    /* another site the key trusts: another secret for the same label and mode */
    const other = await browser(device, signal, { rpId: 'apps.onlykey.io' });
    let o;
    try { o = hex(await other.services.okcrypto.deriveSecret('okedge/test/a')); } finally { await other.destroy(); }
    log(`touchless a at apps.onlykey.io: ${o.slice(0, 16)}`);
    assert.notEqual(o, a1, 'another rpId, another secret');

    /* a host that checks each credential silently first (Windows): the same secret, one derivation */
    const win = await browser(device, signal, { silentCheck: true });
    let w;
    try { w = hex(await win.services.okcrypto.deriveSecret('okedge/test/a')); } finally { await win.destroy(); }
    assert.equal(w, a1, 'the Windows host derives the same secret');
  });

  it('derive_secret: a touch request without its press is refused, and derives nothing', async ({ device, assert, signal }) => {
    await device.restart({ signal });
    await device.unlock(ctx.PINS.primary, { signal });
    const app = await browser(device, signal);
    try {
      await assert.rejects(() => app.services.okcrypto.deriveSecret('okedge/test/a', { touch: true, timeoutMs: 40000 }),
        'a touch secret came back with no press');
    } finally {
      await app.destroy();
    }
  });
};
