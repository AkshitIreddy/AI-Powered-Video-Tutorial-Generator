import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface TauriConfiguration {
  readonly app: {
    readonly security: {
      readonly csp: string;
    };
  };
}

function directive(csp: string, name: string): readonly string[] {
  const value = csp.split(";")
    .map((part) => part.trim().split(/\s+/u))
    .find(([candidate]) => candidate === name);
  return value?.slice(1) ?? [];
}

describe("native content security policy", () => {
  it("lets the verified project preview re-read Tauri asset URLs before creating a blob", () => {
    const config = JSON.parse(readFileSync(resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf8")) as TauriConfiguration;
    const connectSources = directive(config.app.security.csp, "connect-src");
    const imageSources = directive(config.app.security.csp, "img-src");

    // convertFileSrc uses the custom `asset:` scheme outside Windows and the
    // asset.localhost transport in WebView2. ScenePreview fetches that scoped,
    // backend-verified CAS object to confirm its SHA-256 before displaying it.
    expect(connectSources).toEqual(expect.arrayContaining(["asset:", "http://asset.localhost"]));
    expect(imageSources).toEqual(expect.arrayContaining(["asset:", "http://asset.localhost", "blob:"]));
    expect(connectSources).not.toContain("blob:");
    expect(connectSources).not.toContain("http:");
    expect(connectSources).not.toContain("https:");
  });
});
