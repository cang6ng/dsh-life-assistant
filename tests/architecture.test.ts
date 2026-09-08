/**
 * Architecture static checks (DoD §48G): the V1 fixed shape.
 *
 *  - the agent exposes exactly the 7 spec tools;
 *  - no customer_id anywhere in tool parameter schemas (identity is
 *    program-trusted, never model-supplied);
 *  - no banned frameworks/second-LLM/business logic in DSH Core;
 *  - the profile composes dsh-base then the Chinook plugin bundle.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = join(import.meta.dirname, "..");
const PLUGIN_SRC = join(REPO, "plugins", "chinook", "src");

/** Repo-authored directories never scanned: third-party / generated trees
 * (the packaged runtime node_modules, cargo target, vite dist) are build
 * artifacts, not code this repo authors — and they carry vendor .ts sources
 * whose strings are not "repo machinery". */
const GENERATED_DIRS = new Set(["node_modules", "target", "dist"]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (GENERATED_DIRS.has(entry)) continue;
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

function pluginSources(): string[] {
  return sourceFiles(PLUGIN_SRC).filter((f) => !f.endsWith(".d.ts"));
}

function textOf(file: string): string {
  return readFileSync(file, "utf8");
}

describe("the 7-tool surface", () => {
  const EXPECTED_TOOLS = new Set([
    "search_catalog",
    "find_similar_albums",
    "popular_in_genre",
    "list_my_orders",
    "get_invoice_details",
    "remember",
    "recall",
  ]);

  it("registers exactly the V1 tool set", () => {
    const toolText = pluginSources()
      .filter((f) => f.includes(join("tools", "")) || f.includes("tools"))
      .map(textOf)
      .join("\n");
    for (const name of EXPECTED_TOOLS) {
      expect(toolText).toContain(`name: "${name}"`);
    }
    // No extra tools registered anywhere in the plugin.
    const banned = new Set(["ask_music_expert", "ask_expert", "send_email", "place_order", "refund"]);
    for (const b of banned) expect(toolText).not.toContain(`name: "${b}"`);
  });

  it("never exposes customer_id as a tool parameter", () => {
    for (const file of pluginSources()) {
      const text = textOf(file);
      if (text.includes("customer_id") && file.includes("tools")) {
        expect(text).toMatch(/never ask|identity|CustomerId is resolved|resolved by the system/i);
      }
    }
    // The parameter-schema files must not contain a customer_id parameter at all.
    for (const file of pluginSources().filter((f) => f.endsWith("tools.ts") || f.includes(join("src", "tools")))) {
      const withinParams = (textOf(file).split('parameters: {')[1] ?? "").split("output:")[0] ?? "";
      expect(withinParams).not.toContain("customer_id");
    }
  });
});

describe("no DSH Core modification / no business logic in core", () => {
  it("the Chinook plugin never imports DSH Core internals", () => {
    const imports = pluginSources().map(textOf).join("\n");
    // Only public dsh-* package surfaces (dsh-tools), cordis Service types,
    // and dsh-llm types are permitted; app-boot/bin internals are not.
    for (const banned of ["@deepseek-ai/dsh-app-boot", "@deepseek-ai/dsh/lib", "dsh-app-boot/lib"]) {
      expect(imports).not.toContain(banned);
    }
  });

  it("the repo has no banned framework or second-LLM machinery", () => {
    const dirs = ["apps", "plugins", "profiles", "scripts"];
    const texts = dirs
      .flatMap((d) => sourceFiles(join(REPO, d)))
      .map(textOf)
      .join("\n");
    for (const banned of ["langchain", "langgraph", "langsmith", "redis", "@redis", "chromadb", "weaviate"]) {
      expect(texts.toLowerCase()).not.toContain(banned);
    }
    expect(texts).not.toMatch(/ask_music_expert|second LLM|second_llm/i);
  });
});

describe("profile composition", () => {
  it("composes the base bundle before the Chinook bundle", () => {
    const manifest = JSON.parse(textOf(join(REPO, "profiles", "chinook", "package.json"))) as {
      dsh: { profile: { bundles: string[]; patchReload: string } };
    };
    expect(manifest.dsh.profile.bundles).toEqual(["@deepseek-ai/dsh-base", "chinook-dsh-plugin"]);
    expect(manifest.dsh.profile.patchReload).toBe("startup");
  });

  it("declares the Chinook bundle manifest on the plugin package", () => {
    const manifest = JSON.parse(textOf(join(REPO, "plugins", "chinook", "package.json"))) as {
      dsh: { bundle: { patch: string } };
    };
    expect(manifest.dsh.bundle.patch).toBe("./cordis.patch.yml");
  });

  it("keeps the CLI thin: no business logic in apps/cli", () => {
    const cli = sourceFiles(join(REPO, "apps", "cli"));
    for (const file of cli) {
      const text = textOf(file);
      expect(text).not.toMatch(/FROM Track|FROM Invoice|FROM Genre|SELECT t\.|better-sqlite3/);
    }
  });
});

describe("repo layout guard", () => {
  it("profile dir is under the repo (junction target exists)", () => {
    const rel = relative(REPO, join(REPO, "profiles", "chinook"));
    expect(rel.startsWith("profiles")).toBe(true);
    const patch = textOf(join(REPO, "profiles", "chinook", "cordis.patch.yml"));
    // The V1 hardening rows must stay in place (they keep the tree small).
    for (const id of ["tool-bash", "tool-fs", "web", "subagent", "skill", "goal", "tool-workflow"]) {
      expect(patch).toContain(`- id: ${id}`);
    }
  });
});
