'use strict';
/*
 * THE TEST FOR PATCH 0013 - okcore: wiping an RSA slot clears its key type, so the wiped slot reads as empty. It FAILS
 * on 3.1.0 as released (libraries fe9e293) and PASSES with the patch.
 *
 * rsa_priv_flash() handles a wipe first and returns before it reaches okeeprom_eeset_rsakey(), so the flash region is
 * zeroed and the slot's KEY TYPE stays in EEPROM. A wiped RSA slot then does not answer "Error no RSA Private Key set in
 * this slot" as a never-loaded one does: okcore_flashget_RSA() believes the stale type, decrypts 256 zero bytes into P
 * and Q, multiplies them and publishes the result - the slot goes on reporting a 2048-bit key that is not a key. (The
 * ECC path has not this shape: ecc_priv_flash() writes the type byte on the way in, so an ECC wipe records type 0.)
 *
 * The test loads an RSA-2048 key into slot 1, checks the slot publishes its modulus, wipes the slot (config mode, as the
 * write), restarts, and asks for the public key again: the answer must be the empty slot's refusal. Run by
 * onlykey-testing's 09-patches (OKT_PATCHES=0013 runs it on any build); any key, emulated or hard.
 */
module.exports = function register({ it }, ctx) {
  const rsa = ctx.kit.rsaSlots;
  it('0013: a wiped RSA slot reads as empty - OKGETPUBKEY answers "no RSA Private Key set", not a modulus',
    async ({ device, assert, signal, log }) => {
      const key = rsa.keypair();
      await rsa.loadKeys(device, [
        { slot: rsa.SLOT_DECRYPT, typeByte: rsa.RSA_2048 | rsa.FEATURE_DECRYPT, pq: key.pq },
      ], { signal, assert });
      const before = (await rsa.modulus(device, rsa.SLOT_DECRYPT, { signal })).bytes;
      assert.bytes(before, key.n, 'the slot did not hold the key that was written to it');

      /* OKWIPEPRIV needs config mode, like the write it undoes */
      await ctx.kit.pqc.readyForKeygen(device, { signal });
      const since = device.mark(ctx.IFACE.VENDOR);
      device.sendVendor({ msg: ctx.okmsg.MSG.OKWIPEPRIV, slot: rsa.SLOT_DECRYPT, field: 0 });
      const ack = await device.waitHid(ctx.IFACE.VENDOR, { since, match: /Successfully|Error/, timeoutMs: 20000, signal });
      const said = ctx.okmsg.text(ack).trim();
      log(`wipe: ${said}`);
      assert.match(said, /Successfully wiped RSA Private Key/, `expected the wipe acknowledgement, got: ${said}`);

      await device.restart({ signal });
      await device.ensureUnlocked(ctx.PINS.primary, { signal });

      /* the bug: without the patch the slot answers a modulus computed from the zeroed flash, never this refusal */
      const asked = device.mark(ctx.IFACE.VENDOR);
      device.sendVendor({ msg: ctx.okmsg.MSG.OKGETPUBKEY, slot: rsa.SLOT_DECRYPT, field: 0 });
      const { bytes } = await rsa.collect(device, asked, rsa.MODULUS, { signal, timeoutMs: 15000 });
      const answer = ctx.okmsg.text(bytes.subarray(0, rsa.REPORT)).trim();
      log(`after the wipe: ${answer || `${bytes.length} bytes of modulus, first ${bytes.subarray(0, 8).toString('hex')}`}`);
      assert.match(answer, /Error no RSA Private Key set in this slot/,
        'the wiped RSA slot still publishes a modulus (its key type was left set) - it must read as empty');
    });
};
