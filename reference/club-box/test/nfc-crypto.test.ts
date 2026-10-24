import assert from "node:assert/strict";
import test from "node:test";
import { aesCmac, ntagCrc32 } from "../src/nfc/aes.js";
import { fromHex, toHex } from "../src/nfc/bytes.js";
import { diversifyAes128, diversifyNtagKey } from "../src/nfc/diversify.js";
import { authenticateEv2FirstPart1, commandIv, selectNdefApplication, sessionVectors } from "../src/nfc/ev2.js";
import { sdmSettings } from "../src/nfc/ndef.js";
import { programCard } from "../src/nfc/program.js";
import { programFromArgs } from "../src/nfc/program-cli.js";
import { NtagSim } from "../src/nfc/sim.js";
import { counterToLe, decryptSunPicc, sunCmac, verifySunMessage } from "../src/nfc/sun.js";

test("AES-CMAC matches the RFC 4493 empty-message vector", () => {
  const key = fromHex("2b7e151628aed2a6abf7158809cf4f3c");
  assert.equal(toHex(aesCmac(key, Buffer.alloc(0))), "bb1d6929e95937287fa37d129b756746");
});

test("AN10922 diversification matches the published example", () => {
  const master = fromHex("00112233445566778899AABBCCDDEEFF");
  const input = fromHex("04782E21801D803042F54E585020416275");
  assert.equal(toHex(diversifyAes128(master, input)), "a8dd63a3b89d54b37ca802473fda9175");
});

test("SUN PICCData and CMAC match the AN12196 zero-key example", () => {
  const key = Buffer.alloc(16);
  const opened = decryptSunPicc(key, "EF963FF7828658A599F3041510671E88");
  assert.ok(opened);
  assert.equal(toHex(opened.uid), "04de5f1eacc040");
  assert.equal(opened.counter, 61);
  assert.equal(toHex(sunCmac(key, opened.uid, counterToLe(61))), "94eed9ee65337086");
  const verified = verifySunMessage({
    piccDataHex: "EF963FF7828658A599F3041510671E88",
    cmacHex: "94EED9EE65337086",
    metaReadKey: key,
    fileReadKey: key,
  });
  assert.equal(verified?.counter, 61);
  assert.equal(
    verifySunMessage({
      piccDataHex: "EF963FF7828658A599F3041510671E88",
      cmacHex: "0000000000000000",
      metaReadKey: key,
      fileReadKey: key,
    }),
    null,
  );
});

test("EV2 session keys and change-key CRC match AN12196", () => {
  const key = Buffer.alloc(16);
  const rndA = fromHex("13C5DB8A5930439FC3DEF9A4C675360F");
  const rndB = fromHex("B9E2FC789B64BF237CCCAA20EC7E6E48");
  const vectors = sessionVectors(rndA, rndB);
  assert.equal(toHex(aesCmac(key, vectors.sv1)), "1309c877509e5a215007ff0ed19ca564");
  assert.equal(toHex(aesCmac(key, vectors.sv2)), "4c6626f5e72ea694202139295c7a7fc7");
  const iv = commandIv({
    encKey: aesCmac(key, vectors.sv1),
    macKey: aesCmac(key, vectors.sv2),
    ti: fromHex("9D00C4DF"),
    cmdCtr: 0,
  });
  assert.equal(toHex(iv), "d2cb7277a17841a06654a48188c1f8f5");
  assert.equal(toHex(ntagCrc32(fromHex("F3847D627727ED3BC9C4CC050489B966"))), "789dfadc");
  assert.equal(toHex(authenticateEv2FirstPart1(0)), "9071000002000000");
  assert.equal(toHex(selectNdefApplication()), "00a4040c07d276000085010100");
});

test("SDM settings name the meta and file-read key slots", () => {
  assert.equal(toHex(sdmSettings(10, 20)).slice(0, 12), "4000e0c1f123");
});

test("programming against the card simulator personalizes keys and NDEF", async () => {
  const uid = fromHex("04de5f1eacc040");
  const sim = new NtagSim(uid);
  const masterKey = fromHex("00112233445566778899aabbccddeeff");
  const metaReadKey = Buffer.alloc(16);
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    await programFromArgs(["--dry-run", "--uid", toHex(uid), "--area", "lounge", "--skip-register"], {
      NFC_MASTER_KEY: toHex(masterKey),
      NFC_SDM_META_READ_KEY: toHex(metaReadKey),
      NFC_SYSTEM_ID: "club-box",
      PUBLIC_BASE_URL: "http://127.0.0.1:9",
    });
  } finally {
    console.log = original;
  }
  assert.match(lines.join("\n"), /00a4040c07d276000085010100/);
  const again = new NtagSim(uid);
  await programCard(
    { transceive: async (apdu) => again.handle(apdu) },
    {
      keys: { masterKey, metaReadKey, systemId: "club-box", transportKey: Buffer.alloc(16) },
      publicBaseUrl: "http://127.0.0.1:9",
      area: "lounge",
      uid,
    },
  );
  const key2 = again.keys[2];
  const key3 = again.keys[3];
  assert.ok(key2);
  assert.ok(key3);
  assert.equal(toHex(key2), toHex(metaReadKey));
  assert.equal(toHex(key3), toHex(diversifyNtagKey(masterKey, uid, 3, "club-box")));
});
