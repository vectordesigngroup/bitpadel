import path from "node:path";
import { UnimplementedDesfirePersonalizer } from "./desfire-stub.js";

const executed = process.argv[1]?.includes(`${path.sep}desfire-cli`);
if (executed) {
  const tool = new UnimplementedDesfirePersonalizer();
  tool.personalize({ uid: "not-programmed" }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "DESFire personalization is not implemented");
    process.exit(1);
  });
}
