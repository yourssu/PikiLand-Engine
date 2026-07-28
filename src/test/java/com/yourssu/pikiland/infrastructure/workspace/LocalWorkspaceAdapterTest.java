package com.yourssu.pikiland.infrastructure.workspace;

import com.yourssu.pikiland.domain.model.PatchInstruction;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class LocalWorkspaceAdapterTest {

    private LocalWorkspaceAdapter adapter;

    @BeforeEach
    void setUp() {
        adapter = new LocalWorkspaceAdapter();
    }

    @Test
    @DisplayName("Step 1 - Exact match: oldCode가 파일 내용과 완전히 일치하면 패치가 적용된다")
    void applyPatches_ExactMatch_Success(@TempDir Path tempDir) throws IOException {
        Path sampleFile = tempDir.resolve("Sample.java");
        Files.writeString(sampleFile, "public class Sample {\n    int a = 1;\n}");

        PatchInstruction patch = new PatchInstruction("Sample.java", "int a = 1;", "int a = 2;");
        boolean success = adapter.applyPatches(tempDir, List.of(patch));

        assertTrue(success);
        String updated = Files.readString(sampleFile);
        assertTrue(updated.contains("int a = 2;"));
    }

    @Test
    @DisplayName("Step 2 - EOL Difference: 파일이 Windows(\\r\\n)이고 패치가 Unix(\\n)여도 패치가 정상 적용된다")
    void applyPatches_EolDifference_Success(@TempDir Path tempDir) throws IOException {
        Path sampleFile = tempDir.resolve("Sample.java");
        Files.writeString(sampleFile, "public class Sample {\r\n    int value = 100;\r\n}");

        PatchInstruction patch = new PatchInstruction("Sample.java", "public class Sample {\n    int value = 100;\n}", "public class Sample {\n    int value = 200;\n}");
        boolean success = adapter.applyPatches(tempDir, List.of(patch));

        assertTrue(success);
        String updated = Files.readString(sampleFile);
        assertTrue(updated.contains("int value = 200;"));
    }

    @Test
    @DisplayName("Step 3 - Trimmed Match: 인덴테이션 및 트림 공백 차이가 있어도 라인 매칭으로 패치가 적용된다")
    void applyPatches_TrimmedMatch_Success(@TempDir Path tempDir) throws IOException {
        Path sampleFile = tempDir.resolve("Sample.java");
        Files.writeString(sampleFile, "public class Sample {\n        String name = \"PikiLand\";   \n}");

        PatchInstruction patch = new PatchInstruction("Sample.java", "String name = \"PikiLand\";", "String name = \"PikiLand Verified\";");
        boolean success = adapter.applyPatches(tempDir, List.of(patch));

        assertTrue(success);
        String updated = Files.readString(sampleFile);
        assertTrue(updated.contains("String name = \"PikiLand Verified\";"));
    }

    @Test
    @DisplayName("runHarness - Shell chaining(&&, ;) 연쇄 명령이 성공적으로 실행된다")
    void runHarness_ShellChaining_Success(@TempDir Path tempDir) {
        var result = adapter.runHarness(tempDir, "echo step1 && echo step2");

        assertTrue(result.isSuccess());
        assertTrue(result.getOutput().contains("step1"));
        assertTrue(result.getOutput().contains("step2"));
    }

    @Test
    @DisplayName("runHarness - 동적 서브쉘인젝션 패턴($())이 포함되면 보안 차단된다")
    void runHarness_SubshellInjection_Blocked(@TempDir Path tempDir) {
        var result = adapter.runHarness(tempDir, "echo $(whoami)");

        assertFalse(result.isSuccess());
        assertTrue(result.getOutput().contains("Security Error: Harness command contains disallowed subshell pattern"));
    }
}
