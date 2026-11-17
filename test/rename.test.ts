import { describe, expect, test } from "bun:test";
import {
  isValidName,
  renameText,
  resetChangelog,
  spellings,
  TEMPLATE_DESCRIPTION,
} from "../scripts/rename.ts";

describe("rename", () => {
  test("derives every spelling", () => {
    expect(spellings("my-tool")).toEqual([
      ["bun-templ", "my-tool"],
      ["bun_templ", "my_tool"],
      ["BUN_TEMPL", "MY_TOOL"],
      ["BunTempl", "MyTool"],
    ]);
  });

  test("validates kebab-case names", () => {
    expect(isValidName("lykta")).toBe(true);
    expect(isValidName("my-tool2")).toBe(true);
    for (const bad of ["My", "-x", "x-", "a--b", "a_b", ""]) expect(isValidName(bad)).toBe(false);
  });

  test("replaces all spellings and the description", () => {
    const text = `bun-templ BUN_TEMPL_X class BunTempl bun_templ: ${TEMPLATE_DESCRIPTION}`;
    expect(renameText(text, "lykta", "A dashboard")).toBe(
      "lykta LYKTA_X class Lykta lykta: A dashboard",
    );
  });

  test("keeps lineage blocks and drops template-only blocks", () => {
    const text = [
      "# bun-templ",
      "<!-- template-only:start -->",
      "## Using this template",
      "<!-- template-only:end -->",
      "<!-- lineage:start -->",
      "Upstream: mklab-se/bun-templ",
      "<!-- lineage:end -->",
      "Run bun-templ.",
    ].join("\n");
    const out = renameText(text, "lykta");
    expect(out).not.toContain("Using this template");
    expect(out).toContain("Upstream: mklab-se/bun-templ");
    expect(out).toContain("# lykta");
    expect(out).toContain("Run lykta.");
  });

  test("handles several lineage blocks", () => {
    const text =
      "a bun-templ <!-- lineage:start -->bun-templ<!-- lineage:end --> b <!-- lineage:start -->bun-templ<!-- lineage:end --> bun-templ";
    expect(renameText(text, "x")).toBe(
      "a x <!-- lineage:start -->bun-templ<!-- lineage:end --> b <!-- lineage:start -->bun-templ<!-- lineage:end --> x",
    );
  });

  test("the changelog is cut down to an empty Unreleased section", () => {
    expect(resetChangelog("# Changelog\n\nintro\n\n## [Unreleased]\n\n- old\n\n## [0.1.0]\n")).toBe(
      "# Changelog\n\nintro\n\n## [Unreleased]\n",
    );
  });
});
