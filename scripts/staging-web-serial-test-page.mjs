import { copyFileSync, existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

export const WEB_SERIAL_TEST_PAGE = "printer-webserial-test.html";
const SOURCE_PAGE = resolve("prototypes", "web-serial-windows-poc.html");

/**
 * Keeps the Web Serial proof of concept out of Vite's public assets. It is
 * copied into the Hosting artifact only for an explicitly requested staging
 * build, and removed from a production artifact even if dist was reused.
 */
export function publishWebSerialTestPage(environment, outputDirectory = resolve("dist")) {
  if (!new Set(["staging", "production"]).has(environment)) {
    throw new Error("Web Serial test page builds must target staging or production.");
  }

  const destination = resolve(outputDirectory, WEB_SERIAL_TEST_PAGE);
  rmSync(destination, { force: true });

  if (environment === "staging") {
    if (!existsSync(SOURCE_PAGE)) {
      throw new Error(`Missing Web Serial test page source: ${SOURCE_PAGE}`);
    }
    copyFileSync(SOURCE_PAGE, destination);
  }

  if (environment === "production" && existsSync(destination)) {
    throw new Error("Production Hosting artifact must not contain the Web Serial test page.");
  }
}
