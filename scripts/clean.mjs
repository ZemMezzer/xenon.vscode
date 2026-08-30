import { rm } from "node:fs/promises";

for (const path of ["dist", "dist-test"]) {
  await rm(path, { recursive: true, force: true });
}
