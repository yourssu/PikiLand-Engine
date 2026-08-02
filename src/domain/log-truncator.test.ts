import { describe, expect, test } from "bun:test";
import { LogTruncator } from "./log-truncator";

describe("LogTruncator Test", () => {
  const truncator = new LogTruncator();

  test("should clean ANSI escape sequences and progress bars", () => {
    const raw = "\u001B[31mError!\u001B[0m [===>  ] 50%";
    expect(truncator.cleanAnsi(raw)).toBe("Error! [===>  ] 50%");
    expect(truncator.cleanProgressBars(raw)).toContain("[PROGRESS]");
  });

  test("should return raw log if line count is within limit", () => {
    const rawLog = "line 1\nline 2\nline 3";
    const result = truncator.truncateLogForAi(rawLog, 10);
    expect(result).toBe(rawLog);
  });

  test("should truncate large log retaining head, error lines context, and tail", () => {
    const lines: string[] = [];
    for (let i = 0; i < 500; i++) {
      if (i === 250) {
        lines.push("ERROR: NullPointerException occurred at Main.java:42");
      } else {
        lines.push(`Info log line ${i}`);
      }
    }
    const rawLog = lines.join("\n");
    const result = truncator.truncateLogForAi(rawLog, 50);

    expect(result).toContain("System Alert: Truncated");
    expect(result).toContain("ERROR: NullPointerException occurred at Main.java:42");
    expect(result).toContain("Error Context Detected (Middle)");
  });
});
