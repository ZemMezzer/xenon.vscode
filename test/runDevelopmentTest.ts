import { main } from "./runTest";

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
