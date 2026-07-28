package com.yourssu.pikiland;

import com.yourssu.pikiland.domain.service.LogTruncator;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

public class LogTruncatorTest {

    private final LogTruncator logTruncator = new LogTruncator();

    @Test
    public void testCleanAnsi() {
        String input = "\u001B[31mError occurred\u001B[0m";
        String expected = "Error occurred";
        assertEquals(expected, logTruncator.cleanAnsi(input));
    }

    @Test
    public void testCleanProgressBars() {
        String input = "Compiling... [=====>    ] 50% done";
        String expected = "Compiling... [PROGRESS] done";
        assertEquals(expected, logTruncator.cleanProgressBars(input));
    }

    @Test
    public void testTruncateLogForAi() {
        // Build a mock log larger than 10 lines
        StringBuilder sb = new StringBuilder();
        for (int i = 1; i <= 20; i++) {
            if (i == 10) {
                sb.append("Line ").append(i).append(": Fatal compilation error occurred!\n");
            } else {
                sb.append("Line ").append(i).append(": Normal logging statement\n");
            }
        }
        
        // Truncate down to max 10 lines
        String truncated = logTruncator.truncateLogForAi(sb.toString(), 10);
        
        // Assert that the system alert and error context were preserved
        assertTrue(truncated.contains("Fatal compilation error occurred"));
        assertTrue(truncated.contains("System Alert: Truncated"));
    }
}
