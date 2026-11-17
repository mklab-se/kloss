#!/usr/bin/env bun
/**
 * Turns a fresh copy of bun-templ into a new tool, in one pass:
 *
 *   bun run rename <new-name> "<one-line description>"
 *
 * - Replaces every spelling of the template name (bun-templ, bun_templ, BUN_TEMPL,
 *   BunTempl) in all tracked text files, and the template description.
 * - Leaves `<!-- lineage:start -->` ... `<!-- lineage:end -->` blocks untouched, so
 *   CLAUDE.md keeps pointing at the upstream template.
 * - Deletes `<!-- template-only:start -->` ... `<!-- template-only:end -->` blocks
 *   (e.g. the README's "Using this template" section).
 * - Renames media/bun-templ-horizontal.png, sets the version to 0.0.1, empties the
 *   CHANGELOG down to `## [Unreleased]`, and finally removes this script and its test.
 */
import { $ } from "bun";

export const TEMPLATE = "bun-templ";
export const TEMPLATE_DESCRIPTION = "A template for building Bun command-line tools";

const TEXT_EXTENSIONS =
  /\.(ts|js|json|jsonc|md|yml|yaml|toml|txt|sh)$|(^|\/)(Dockerfile|LICENSE|\.gitignore)$/;

export function spellings(name: string): [string, string][] {
  const snake = name.replace(/-/g, "_");
  const camel = name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return [
    [TEMPLATE, name],
    ["bun_templ", snake],
    ["BUN_TEMPL", snake.toUpperCase()],
    ["BunTempl", camel],
  ];
}

export function isValidName(name: string): boolean {
  return /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name);
}

const LINEAGE = /<!-- lineage:start -->[\s\S]*?<!-- lineage:end -->/g;
const TEMPLATE_ONLY = /\n?<!-- template-only:start -->[\s\S]*?<!-- template-only:end -->\n?/g;

/** Apply the rename to one file's text. */
export function renameText(text: string, name: string, description?: string): string {
  const out = text.replace(TEMPLATE_ONLY, "\n");
  // Split around lineage blocks and only rewrite the parts outside them.
  const kept = out.match(LINEAGE) ?? [];
  const parts = out.split(LINEAGE);
  const rewritten = parts.map((part) => {
    let p = part;
    if (description) p = p.split(TEMPLATE_DESCRIPTION).join(description);
    for (const [from, to] of spellings(name)) p = p.split(from).join(to);
    return p;
  });
  return rewritten.reduce((acc, part, i) => acc + (kept[i - 1] ?? "") + part);
}

export function resetChangelog(text: string): string {
  const idx = text.indexOf("## [Unreleased]");
  return idx === -1 ? text : `${text.slice(0, idx)}## [Unreleased]\n`;
}

async function main(): Promise<void> {
  const [name, description] = process.argv.slice(2);
  if (!name || !isValidName(name)) {
    console.error('usage: bun run rename <new-name> "<one-line description>"');
    console.error("  <new-name> is lowercase kebab-case, e.g. lykta or my-tool");
    process.exit(2);
  }
  if (name === TEMPLATE) {
    console.error(`"${name}" is already the template name.`);
    process.exit(2);
  }

  const files = (await $`git ls-files`.text()).split("\n").filter(Boolean);
  const self = ["scripts/rename.ts", "test/rename.test.ts"];

  for (const file of files) {
    if (self.includes(file) || !TEXT_EXTENSIONS.test(file)) continue;
    const before = await Bun.file(file).text();
    let after = renameText(before, name, description);
    if (file === "CHANGELOG.md") after = resetChangelog(after);
    if (after !== before) await Bun.write(file, after);
  }

  const pkgFile = Bun.file("package.json");
  const pkg = await pkgFile.json();
  pkg.version = "0.0.1";
  pkg.keywords = (pkg.keywords as string[]).filter((k) => k !== "template" && k !== "starter");
  delete pkg.scripts.rename;
  await Bun.write("package.json", `${JSON.stringify(pkg, null, 2)}\n`);

  const media = `media/${TEMPLATE}-horizontal.png`;
  if (files.includes(media)) await $`git mv ${media} media/${name}-horizontal.png`;
  await $`git rm -q -f ${self}`;

  console.log(`Renamed ${TEMPLATE} -> ${name} (version 0.0.1).`);
  console.log("Next: replace the logo image, rewrite README.md and CLAUDE.md's 'What this is',");
  console.log("then: bun install && bun run check");
}

if (import.meta.main) await main();
