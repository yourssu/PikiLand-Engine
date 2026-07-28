package com.yourssu.pikiland.domain.service;

import org.springframework.stereotype.Component;
import java.util.*;
import java.util.regex.Pattern;

@Component
public class LogTruncator {
    private static final Pattern ANSI_ESCAPE = Pattern.compile("\\u001B(?:[@-Z\\\\-_]|\\[[0-?]*[ -/]*[@-~])");
    private static final Pattern PROGRESS_BAR = Pattern.compile("\\[[=#>-]+\\s*\\]\\s*\\d+[%/]");
    
    private static final List<String> ERROR_KEYWORDS = Arrays.asList(
        "error", "exception", "failed", "fatal", "traceback",
        "segfault", "panic", "killed", "timeout", "abort", "syntax", "denied"
    );

    public String cleanAnsi(String text) {
        if (text == null) return "";
        return ANSI_ESCAPE.matcher(text).replaceAll("");
    }

    public String cleanProgressBars(String text) {
        if (text == null) return "";
        return PROGRESS_BAR.matcher(text).replaceAll("[PROGRESS]");
    }

    public String truncateLogForAi(String logText, int maxLines) {
        if (logText == null) return "";
        
        String cleaned = cleanProgressBars(cleanAnsi(logText));
        String[] lines = cleaned.split("\\r?\\n");
        int totalLines = lines.length;

        if (totalLines <= maxLines) {
            return cleaned;
        }

        int headCount = (int) (maxLines * 0.15);
        int tailCount = maxLines - headCount;

        List<String> headLines = Arrays.asList(Arrays.copyOfRange(lines, 0, headCount));
        List<String> tailLines = Arrays.asList(Arrays.copyOfRange(lines, totalLines - tailCount, totalLines));
        
        // Middle lines
        String[] middleLines = Arrays.copyOfRange(lines, headCount, totalLines - tailCount);
        
        // Find indices containing error keywords in middle section
        List<Integer> errorIndices = new ArrayList<>();
        for (int i = 0; i < middleLines.length; i++) {
            String lineLower = middleLines[i].toLowerCase();
            for (String keyword : ERROR_KEYWORDS) {
                if (lineLower.contains(keyword)) {
                    errorIndices.add(i);
                    break;
                }
            }
        }

        // Merge overlapping context intervals (context size = 5)
        int contextSize = 5;
        List<int[]> intervals = new ArrayList<>();
        for (int idx : errorIndices) {
            int start = Math.max(0, idx - contextSize);
            int end = Math.min(middleLines.length, idx + contextSize + 1);

            if (intervals.isEmpty()) {
                intervals.add(new int[]{start, end});
            } else {
                int[] last = intervals.get(intervals.size() - 1);
                if (start <= last[1]) {
                    last[1] = Math.max(last[1], end);
                } else {
                    intervals.add(new int[]{start, end});
                }
            }
        }

        List<String> extraLines = new ArrayList<>();
        for (int[] interval : intervals) {
            extraLines.add("\n--- [Error Context Detected (Middle)] ---");
            for (int i = interval[0]; i < interval[1]; i++) {
                extraLines.add(middleLines[i]);
            }
            extraLines.add("----------------------------------------\n");
        }

        int skippedCount = totalLines - maxLines;
        String systemAlert = String.format("\n... [System Alert: Truncated - %d lines omitted] ...\n... [Normal logs omitted to fit AI context limit] ...\n", skippedCount);

        StringBuilder sb = new StringBuilder();
        sb.append(String.join("\n", headLines));
        sb.append(systemAlert);
        
        if (!extraLines.isEmpty()) {
            sb.append(String.join("\n", extraLines));
            sb.append(systemAlert);
        }
        
        sb.append(String.join("\n", tailLines));
        return sb.toString();
    }
}
