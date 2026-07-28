package com.yourssu.pikiland.domain.port;

import com.yourssu.pikiland.domain.model.HarnessResult;
import com.yourssu.pikiland.domain.model.PatchInstruction;
import java.nio.file.Path;
import java.util.List;

public interface WorkspacePort {
    Path cloneRepository(String repoFullName, String token);
    String listDirectory(Path workspace, String relativePath);
    String readFile(Path workspace, String relativePath);
    String grepInFile(Path workspace, String relativePath, String query);
    boolean applyPatches(Path workspace, List<PatchInstruction> patches);
    void commitAndPush(Path workspace, String branchName, String commitMsg, String token, String repo);
    void resetToCleanState(Path workspace, String baseBranch);
    String getCurrentBranch(Path workspace);

    /**
     * Recursively deletes the temporary workspace directory created by {@link #cloneRepository}.
     * Must always be called in a finally block to prevent disk accumulation.
     */
    void deleteWorkspace(Path workspace);

    /**
     * Counts the number of regular source files in the workspace, excluding build artifacts
     * and dependency directories (build, target, node_modules, .git, etc.).
     * Used by the AI adapter to calibrate the agent loop iteration budget proportionally.
     *
     * @return number of source files, or a safe conservative default on error
     */
    int countSourceFiles(Path workspace);

    /**
     * Executes the harness verification command in the workspace directory.
     *
     * @param workspace the workspace path
     * @param command the harness command string to execute
     * @return the harness execution success status and captured output logs
     */
    HarnessResult runHarness(Path workspace, String command);
}
