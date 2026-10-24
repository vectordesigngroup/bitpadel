import { loadNfcKeys } from "./keys.js";
import { NtagSim } from "./sim.js";
import { fromHex } from "./bytes.js";
import { programCard, type CardTransport } from "./program.js";

type Args = {
  dryRun: boolean;
  area: string;
  uid: string;
  member: string;
  server: string;
  skipRegister: boolean;
  keysFile: string;
};

/**
 * Personalize an NTAG 424 DNA and optionally enroll it.
 * `--dry-run` prints APDUs against an in-memory card and does not open a reader.
 */
export async function programFromArgs(argv: string[], env: Record<string, string | undefined>): Promise<void> {
  const args = parseArgs(argv);
  const keys = loadNfcKeys({ ...env, NFC_KEYS_FILE: args.keysFile || env.NFC_KEYS_FILE });
  if (!keys.masterKey || !keys.metaReadKey) {
    throw new Error("Set NFC_MASTER_KEY and NFC_SDM_META_READ_KEY, or NFC_KEYS_FILE. Do not commit that file.");
  }
  const uid = fromHex(args.uid);
  if (uid.length !== 7) throw new Error("--uid must be 7 bytes of hex");
  const base = env.PUBLIC_BASE_URL?.trim() || args.server;
  if (!base) throw new Error("Set PUBLIC_BASE_URL or pass --server");
  let transport: CardTransport;
  let close = async (): Promise<void> => {};
  if (args.dryRun) {
    const sim = new NtagSim(uid);
    sim.keys[0] = Buffer.from(keys.transportKey);
    transport = { transceive: async (apdu) => sim.handle(apdu) };
  } else {
    const opened = await openReader();
    transport = opened.transport;
    close = opened.close;
  }
  try {
    const result = await programCard(transport, { keys, publicBaseUrl: base, area: args.area, uid });
    console.log(`Programmed UID ${result.uid.toString("hex")}`);
    console.log(`Tap URL template ${result.url}`);
    console.log("APDUs below are encrypted command material. They are not the club keys.");
    for (const apdu of result.apdus) console.log(apdu);
    if (!args.dryRun && !args.skipRegister) {
      if (!args.member) throw new Error("Pass --member to enroll the card, or --skip-register");
      await registerCard(args, env, result.uid.toString("hex"));
    }
  } finally {
    await close();
  }
}

async function openReader(): Promise<{ transport: CardTransport; close: () => Promise<void> }> {
  // Optional native module. Tests and the server do not require pcscd.
  const loaded = await import("./pcsc-transport.js");
  return loaded.openPcscTransport();
}

async function registerCard(args: Args, env: Record<string, string | undefined>, uid: string): Promise<void> {
  const token = env.ADMIN_TOKEN?.trim() ?? "";
  if (!token || !args.server) throw new Error("Registration needs ADMIN_TOKEN and --server");
  const response = await fetch(`${args.server.replace(/\/$/, "")}/api/admin/members/${args.member}/cards`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ uid, scheme: "ntag424-sun", label: "programmed" }),
  });
  if (!response.ok) throw new Error(`Card registration failed with status ${response.status}`);
  console.log("Enrolled the card on the club server.");
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    dryRun: false,
    area: "lounge",
    uid: "",
    member: "",
    server: "",
    skipRegister: false,
    keysFile: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    const next = argv[index + 1] ?? "";
    switch (token) {
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--skip-register":
        args.skipRegister = true;
        break;
      case "--area":
        args.area = next;
        index += 1;
        break;
      case "--uid":
        args.uid = next;
        index += 1;
        break;
      case "--member":
        args.member = next;
        index += 1;
        break;
      case "--server":
        args.server = next;
        index += 1;
        break;
      case "--keys":
        args.keysFile = next;
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument ${token}`);
    }
  }
  if (!args.uid) throw new Error("--uid is required");
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(args.area)) throw new Error("--area must be a lowercase area id");
  return args;
}

const executed = process.argv[1]?.includes("program-cli");
if (executed) {
  programFromArgs(process.argv.slice(2), process.env).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "card programming failed");
    process.exit(1);
  });
}
