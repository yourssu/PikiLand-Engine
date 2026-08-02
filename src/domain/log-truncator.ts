const ANSI_ESCAPE = /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const PROGRESS_BAR = /\[[=#>-]+\s*]\s*\d+[%/]/g;

const ERROR_KEYWORDS = [
  "error",
  "exception",
  "failed",
  "failure",
  "fatal",
  "traceback",
  "segfault",
  "panic",
  "killed",
  "timeout",
  "abort",
  "syntax",
  "denied",
  "caused by",
  "assert"
];

export class LogTruncator {
  public cleanAnsi(text: string | null | undefined): string {
    if (!text) return "";
    return text.replace(ANSI_ESCAPE, "");
  }

  public cleanProgressBars(text: string | null | undefined): string {
    if (!text) return "";
    return text.replace(PROGRESS_BAR, "[PROGRESS]");
  }

  public truncateLogForAi(rawLog: string | null | undefined, maxLines: number = 300): string {
    if (!rawLog || rawLog.trim().length === 0) {
      return "";
    }

    const cleaned = this.cleanProgressBars(this.cleanAnsi(rawLog));
    const lines = cleaned.split(/\r?\n/);
    const totalLines = lines.length;

    if (totalLines <= maxLines) {
      return cleaned;
    }

    const headCount = Math.floor(maxLines * 0.15);
    const tailCount = maxLines - headCount;

    const headLines = lines.slice(0, headCount);
    const tailLines = lines.slice(totalLines - tailCount);
    const middleLines = lines.slice(headCount, totalLines - tailCount);

    const errorIndices: number[] = [];
    for (let i = 0; i < middleLines.length; i++) {
      const lineLower = middleLines[i]!.toLowerCase();
      if (ERROR_KEYWORDS.some(keyword => lineLower.includes(keyword))) {
        errorIndices.push(i);
      }
    }

    const contextSize = 5;
    const intervals: Array<[number, number]> = [];
    for (const idx of errorIndices) {
      const start = Math.max(0, idx - contextSize);
      const end = Math.min(middleLines.length, idx + contextSize + 1);

      if (intervals.length === 0) {
        intervals.push([start, end]);
      } else {
        const last = intervals[intervals.length - 1]!;
        if (start <= last[1]) {
          last[1] = Math.max(last[1], end);
        } else {
          intervals.push([start, end]);
        }
      }
    }

    const extraLines: string[] = [];
    for (const [start, end] of intervals) {
      extraLines.push("\n--- [Error Context Detected (Middle)] ---");
      for (let i = start; i < end; i++) {
        extraLines.push(middleLines[i]!);
      }
      extraLines.push("----------------------------------------\n");
    }

    const skippedCount = totalLines - maxLines;
    const systemAlert = `\n... [System Alert: Truncated - ${skippedCount} lines omitted] ...\n... [Normal logs omitted to fit AI context limit] ...\n`;

    let result = headLines.join("\n") + systemAlert;

    if (extraLines.length > 0) {
      result += extraLines.join("\n") + systemAlert;
    }

    result += tailLines.join("\n");
    return result;
  }
}

