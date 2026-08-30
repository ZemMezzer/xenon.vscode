import { main } from "./runTest";

process.env.XENON_TEST_INSTALLED = "1";

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
