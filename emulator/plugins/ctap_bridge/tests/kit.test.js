'use strict';
/*
 * ctap_bridge's emulator tests (the onlykey-testing kit), side-loaded: they leave with the plugin. Everything from
 * the kit comes in through `ctx` (IFACE, okmsg, PINS).
 */
const OKCTAPBRIDGE = 0x80 | 0x7b;
module.exports = function register({ it }, ctx) {
  it('ctap_bridge: on while unset; a change outside config mode is refused', async ({ device, assert, signal, log }) => {
    await device.restart({ signal });
    await device.unlock(ctx.PINS.primary, { signal });
    let since = device.mark(ctx.IFACE.VENDOR);
    device.sendVendor({ msg: OKCTAPBRIDGE, slot: 0 });
    let reply = await device.waitHid(ctx.IFACE.VENDOR, { since, match: /ctap_bridge|Error/, timeoutMs: 6000, signal });
    const state = ctx.okmsg.text(reply).trim();
    log(`report: ${JSON.stringify(state)}`);
    assert.match(state, /^ctap_bridge on site \S+$/);
    since = device.mark(ctx.IFACE.VENDOR);
    device.sendVendor({ msg: OKCTAPBRIDGE, slot: 2 });
    reply = await device.waitHid(ctx.IFACE.VENDOR, { since, match: /ctap_bridge|Error/, timeoutMs: 6000, signal });
    assert.equal(ctx.okmsg.text(reply).trim(), 'Error not in config mode');
  });
};
