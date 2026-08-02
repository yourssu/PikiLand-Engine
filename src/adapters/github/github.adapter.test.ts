import { describe, expect, test } from "bun:test";
import * as fflate from "fflate";
import { GithubAdapter } from "./github.adapter";

describe("GithubAdapter Test", () => {
  const adapter = new GithubAdapter();

  test("should unzip workflow log zip buffer and extract text files", async () => {
    // Create a mock zip buffer using fflate
    const zipData = fflate.zipSync({
      "1_build.txt": new TextEncoder().encode("Build step output log line 1\nBuild step output log line 2\n"),
      "2_test.txt": new TextEncoder().encode("Test step output log line 1\nERROR: Test failed\n"),
    });

    const buffer = Buffer.from(zipData);
    // Access private/internal method extractAndTruncateLogsFromZip via any cast for testing
    const result = await (adapter as any).extractAndTruncateLogsFromZip(buffer);

    expect(result).toContain("=== File: 1_build.txt ===");
    expect(result).toContain("Build step output log line 1");
    expect(result).toContain("=== File: 2_test.txt ===");
    expect(result).toContain("ERROR: Test failed");
  });
});
