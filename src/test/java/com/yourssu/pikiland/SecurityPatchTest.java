package com.yourssu.pikiland;

import com.yourssu.pikiland.domain.model.HarnessResult;
import com.yourssu.pikiland.infrastructure.workspace.LocalWorkspaceAdapter;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.nio.file.Paths;

import static org.junit.jupiter.api.Assertions.*;

class SecurityPatchTest {

    private final LocalWorkspaceAdapter workspaceAdapter = new LocalWorkspaceAdapter();

    @Test
    @DisplayName("Command Injection Guard: 동적 서브쉘 메타문자가 포함된 하네스 커맨드는 즉시 거부되어야 함")
    void testCommandInjectionGuard() {
        HarnessResult res1 = workspaceAdapter.runHarness(Paths.get("."), "echo $(whoami)");
        assertFalse(res1.isSuccess());
        assertTrue(res1.getOutput().contains("Security Error") || res1.getOutput().contains("disallowed subshell pattern"));

        HarnessResult res2 = workspaceAdapter.runHarness(Paths.get("."), "echo `whoami`");
        assertFalse(res2.isSuccess());
        assertTrue(res2.getOutput().contains("Security Error") || res2.getOutput().contains("disallowed subshell pattern"));

        HarnessResult res3 = workspaceAdapter.runHarness(Paths.get("."), "eval rm -rf /");
        assertFalse(res3.isSuccess());
        assertTrue(res3.getOutput().contains("Security Error") || res3.getOutput().contains("disallowed subshell pattern"));
    }
}
