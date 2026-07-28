package com.yourssu.pikiland.infrastructure.workspace;

import com.yourssu.pikiland.domain.model.HarnessResult;
import com.yourssu.pikiland.domain.model.PatchInstruction;
import com.yourssu.pikiland.domain.port.WorkspacePort;
import org.springframework.stereotype.Component;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Collectors;

@Component
public class LocalWorkspaceAdapter implements WorkspacePort {

    private static final List<String> RESTRICTED_DIRS = Arrays.asList(".git", ".venv", "node_modules", "build", "dist", "target", "out");
    private static final List<String> RESTRICTED_FILES = Arrays.asList(".env", "secrets.json", "credentials");

    @Override
    public Path cloneRepository(String repoFullName, String token) {
        try {
            Path tempDir = Files.createTempDirectory("pikiland-workspace-");
            String cloneUrl = String.format("https://x-access-token:%s@github.com/%s.git", token, repoFullName);
            
            runCommand(new File("."), "git", "clone", cloneUrl, tempDir.toAbsolutePath().toString());
            return tempDir;
        } catch (Exception e) {
            throw new RuntimeException("Failed to clone repository: " + repoFullName, e);
        }
    }

    @Override
    public String listDirectory(Path workspace, String relativePath) {
        try {
            Path targetDir = workspace.resolve(relativePath).toAbsolutePath().normalize();
            if (!targetDir.startsWith(workspace.toAbsolutePath().normalize())) {
                return "Access Denied: Path is outside the project workspace.";
            }

            File dir = targetDir.toFile();
            if (RESTRICTED_DIRS.contains(dir.getName())) {
                return "Access Denied: Restricted directory.";
            }

            if (!dir.exists() || !dir.isDirectory()) {
                return "Directory not found: " + relativePath;
            }

            File[] items = dir.listFiles();
            if (items == null) return "Directory empty.";

            List<String> subdirs = new ArrayList<>();
            List<String> files = new ArrayList<>();

            Arrays.sort(items);
            for (File item : items) {
                String name = item.getName();
                if (RESTRICTED_DIRS.contains(name) || RESTRICTED_FILES.contains(name)) {
                    continue;
                }
                if (item.isDirectory()) {
                    subdirs.add(name);
                } else {
                    files.add(name);
                }
            }

            StringBuilder sb = new StringBuilder();
            sb.append("[Directory: ").append(relativePath.isEmpty() ? "." : relativePath).append("]\n");
            sb.append("- Subdirectories: ").append(subdirs.isEmpty() ? "(None)" : String.join(", ", subdirs)).append("\n");
            sb.append("- Files: ").append(files.isEmpty() ? "(None)" : String.join(", ", files));
            return sb.toString();
        } catch (Exception e) {
            return "Error reading directory: " + e.getMessage();
        }
    }

    @Override
    public String readFile(Path workspace, String relativePath) {
        try {
            Path targetFile = workspace.resolve(relativePath).toAbsolutePath().normalize();
            if (!targetFile.startsWith(workspace.toAbsolutePath().normalize())) {
                return "Access Denied: Path is outside the project workspace.";
            }

            File file = targetFile.toFile();
            if (RESTRICTED_FILES.contains(file.getName()) || isRestrictedPath(workspace, targetFile)) {
                return "Access Denied: Restricted file path.";
            }

            if (!file.exists() || !file.isFile()) {
                return "File not found: " + relativePath;
            }

            List<String> lines = Files.readAllLines(targetFile);
            int maxLines = 300;
            if (lines.size() > maxLines) {
                String truncated = lines.stream().limit(maxLines).collect(Collectors.joining("\n"));
                return truncated + "\n... [Content Truncated - File has " + lines.size() + " lines total, showing first " + maxLines + "] ...";
            }
            return String.join("\n", lines);
        } catch (Exception e) {
            return "Error reading file: " + e.getMessage();
        }
    }

    @Override
    public String grepInFile(Path workspace, String relativePath, String query) {
        try {
            Path targetFile = workspace.resolve(relativePath).toAbsolutePath().normalize();
            if (!targetFile.startsWith(workspace.toAbsolutePath().normalize())) {
                return "Access Denied: Path is outside the project workspace.";
            }

            File file = targetFile.toFile();
            if (RESTRICTED_FILES.contains(file.getName()) || isRestrictedPath(workspace, targetFile)) {
                return "Access Denied: Restricted file path.";
            }

            if (!file.exists() || !file.isFile()) {
                return "File not found: " + relativePath;
            }

            List<String> lines = Files.readAllLines(targetFile);
            List<String> matches = new ArrayList<>();
            String queryLower = query.toLowerCase();

            for (int i = 0; i < lines.size(); i++) {
                String line = lines.get(i);
                if (line.toLowerCase().contains(queryLower)) {
                    matches.add("[Line " + (i + 1) + "]: " + line.strip());
                    if (matches.size() >= 50) {
                        matches.add("... [Matches capped at 50 results] ...");
                        break;
                    }
                }
            }

            if (matches.isEmpty()) {
                return "No matches found for '" + query + "' inside " + relativePath + ".";
            }
            return "[Matches in " + relativePath + " for '" + query + "']:\n" + String.join("\n", matches);
        } catch (Exception e) {
            return "Error searching file: " + e.getMessage();
        }
    }

    @Override
    public boolean applyPatches(Path workspace, List<PatchInstruction> patches) {
        int appliedCount = 0;
        for (PatchInstruction patch : patches) {
            try {
                Path targetFile = workspace.resolve(patch.getFilePath()).toAbsolutePath().normalize();
                if (!targetFile.startsWith(workspace.toAbsolutePath().normalize())) {
                    System.err.println("Access Denied: Patch target outside workspace: " + patch.getFilePath());
                    continue;
                }

                File file = targetFile.toFile();
                if (RESTRICTED_FILES.contains(file.getName()) || isRestrictedPath(workspace, targetFile)) {
                    System.err.println("Access Denied: Restricted patch target: " + patch.getFilePath());
                    continue;
                }

                if (!file.exists()) {
                    System.err.println("File not found for patch: " + patch.getFilePath());
                    continue;
                }

                String content = Files.readString(targetFile, StandardCharsets.UTF_8);
                String newContent = applyRobustPatch(content, patch.getOldCode(), patch.getNewCode());
                if (newContent != null) {
                    System.out.println("Applying patch to: " + patch.getFilePath());
                    Files.writeString(targetFile, newContent, StandardCharsets.UTF_8);
                    appliedCount++;
                } else {
                    System.err.println("Warning: Target old_code not found in: " + patch.getFilePath());
                }
            } catch (Exception e) {
                System.err.println("Failed to apply patch for: " + patch.getFilePath() + ", error: " + e.getMessage());
            }
        }
        return appliedCount > 0 && appliedCount == patches.size();
    }

    private String applyRobustPatch(String content, String oldCode, String newCode) {
        if (content == null || oldCode == null || newCode == null) return null;
        if (oldCode.isEmpty()) return null;

        // Step 1: Direct Exact Match
        int matchIndex = content.indexOf(oldCode);
        if (matchIndex >= 0) {
            return content.substring(0, matchIndex)
                    + newCode
                    + content.substring(matchIndex + oldCode.length());
        }

        // Step 2: EOL Normalized Match (\r\n -> \n)
        boolean hasCrlf = content.contains("\r\n");
        String normContent = content.replace("\r\n", "\n");
        String normOld = oldCode.replace("\r\n", "\n");
        String normNew = newCode.replace("\r\n", "\n");

        int normIndex = normContent.indexOf(normOld);
        if (normIndex >= 0) {
            String patchedNorm = normContent.substring(0, normIndex)
                    + normNew
                    + normContent.substring(normIndex + normOld.length());
            return hasCrlf ? patchedNorm.replace("\n", "\r\n") : patchedNorm;
        }

        // Step 3: Line-by-Line Trimmed Matching
        return replaceByTrimmedLines(content, oldCode, newCode);
    }

    private String replaceByTrimmedLines(String content, String oldCode, String newCode) {
        boolean hasCrlf = content.contains("\r\n");
        String[] contentLines = content.split("\\r?\\n", -1);
        String[] oldLines = oldCode.split("\\r?\\n", -1);

        List<String> targetTrimmed = new ArrayList<>();
        for (String line : oldLines) {
            targetTrimmed.add(line.trim());
        }
        while (!targetTrimmed.isEmpty() && targetTrimmed.get(targetTrimmed.size() - 1).isEmpty()) {
            targetTrimmed.remove(targetTrimmed.size() - 1);
        }
        if (targetTrimmed.isEmpty()) return null;

        int matchStartLine = -1;
        int matchEndLine = -1;

        for (int i = 0; i <= contentLines.length - targetTrimmed.size(); i++) {
            boolean matched = true;
            for (int j = 0; j < targetTrimmed.size(); j++) {
                if (!contentLines[i + j].trim().equals(targetTrimmed.get(j))) {
                    matched = false;
                    break;
                }
            }
            if (matched) {
                matchStartLine = i;
                matchEndLine = i + targetTrimmed.size() - 1;
                break;
            }
        }

        if (matchStartLine == -1) {
            return null;
        }

        List<String> newContentLines = new ArrayList<>();
        for (int i = 0; i < matchStartLine; i++) {
            newContentLines.add(contentLines[i]);
        }
        String[] replacementLines = newCode.split("\\r?\\n", -1);
        for (String line : replacementLines) {
            newContentLines.add(line);
        }
        for (int i = matchEndLine + 1; i < contentLines.length; i++) {
            newContentLines.add(contentLines[i]);
        }

        String delimiter = hasCrlf ? "\r\n" : "\n";
        return String.join(delimiter, newContentLines);
    }

    @Override
    public void commitAndPush(Path workspace, String branchName, String commitMsg, String token, String repo) {
        try {
            File dir = workspace.toFile();
            runCommand(dir, "git", "config", "user.name", "github-actions[bot]");
            runCommand(dir, "git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com");
            runCommand(dir, "git", "checkout", "-b", branchName);
            runCommand(dir, "git", "add", ".");
            runCommand(dir, "git", "commit", "-m", commitMsg);
            
            String remoteUrl = String.format("https://x-access-token:%s@github.com/%s.git", token, repo);
            runCommand(dir, "git", "remote", "set-url", "origin", remoteUrl);
            runCommand(dir, "git", "push", "origin", branchName);
            System.out.println("Successfully pushed branch: " + branchName);
        } catch (Exception e) {
            throw new RuntimeException("Git commit & push operations failed", e);
        }
    }

    @Override
    public void resetToCleanState(Path workspace, String baseBranch) {
        try {
            File dir = workspace.toFile();
            runCommand(dir, "git", "checkout", "-f", baseBranch);
            runCommand(dir, "git", "reset", "--hard", "HEAD");
            runCommand(dir, "git", "clean", "-fd");
        } catch (Exception e) {
            throw new RuntimeException("Failed to reset workspace to clean state for branch " + baseBranch, e);
        }
    }

    @Override
    public String getCurrentBranch(Path workspace) {
        try {
            File dir = workspace.toFile();
            ProcessBuilder pb = new ProcessBuilder("git", "symbolic-ref", "--short", "HEAD");
            pb.directory(dir);
            Process p = pb.start();
            try (BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream()))) {
                String branch = r.readLine();
                if (branch != null && !branch.isBlank()) {
                    return branch.trim();
                }
            }
            // Fallback for detached HEAD
            ProcessBuilder pb2 = new ProcessBuilder("git", "rev-parse", "--abbrev-ref", "HEAD");
            pb2.directory(dir);
            Process p2 = pb2.start();
            try (BufferedReader r = new BufferedReader(new InputStreamReader(p2.getInputStream()))) {
                String branch = r.readLine();
                if (branch != null && !branch.isBlank()) {
                    return branch.trim();
                }
            }
            return "main";
        } catch (Exception e) {
            System.err.println("Failed to detect current branch in git, defaulting to 'main': " + e.getMessage());
            return "main";
        }
    }

    @Override
    public void deleteWorkspace(Path workspace) {
        if (workspace == null) return;
        Path target = workspace.toAbsolutePath().normalize();
        System.out.println("[Workspace] Deleting temp workspace: " + target);
        try {
            Files.walk(target)
                 .sorted(Comparator.reverseOrder()) // children before parents
                 .forEach(p -> {
                     try {
                         Files.deleteIfExists(p);
                     } catch (Exception ex) {
                         // best-effort: log but don't abort the rest of the cleanup
                         System.err.println("[Workspace] Could not delete " + p + ": " + ex.getMessage());
                     }
                 });
            System.out.println("[Workspace] Cleanup complete: " + target);
        } catch (Exception e) {
            System.err.println("[Workspace] Failed to walk workspace for deletion " + target + ": " + e.getMessage());
        }
    }

    @Override
    public int countSourceFiles(Path workspace) {
        if (workspace == null) return 50;
        Path normalizedWorkspace = workspace.toAbsolutePath().normalize();
        try {
            return (int) Files.walk(normalizedWorkspace)
                    .filter(Files::isRegularFile)
                    .filter(p -> {
                        Path relative = normalizedWorkspace.relativize(p.toAbsolutePath().normalize());
                        // Exclude any file whose path contains a restricted directory segment
                        for (Path component : relative) {
                            if (RESTRICTED_DIRS.contains(component.toString())) {
                                return false;
                            }
                        }
                        return true;
                    })
                    .count();
        } catch (Exception e) {
            System.err.println("[Workspace] Failed to count source files: " + e.getMessage());
            return 50; // conservative default keeps the loop budget reasonable
        }
    }


    private boolean isRestrictedPath(Path workspace, Path target) {
        Path relative = workspace.toAbsolutePath().normalize().relativize(target.toAbsolutePath().normalize());
        for (Path element : relative) {
            if (RESTRICTED_DIRS.contains(element.toString())) {
                return true;
            }
        }
        return false;
    }

    private void runCommand(File directory, String... command) throws Exception {
        ProcessBuilder pb = new ProcessBuilder(command);
        pb.directory(directory);
        Process p = pb.start();
        boolean finished = p.waitFor(10, java.util.concurrent.TimeUnit.MINUTES);
        if (!finished) {
            p.destroyForcibly();
            throw new RuntimeException("Command timed out: " + redactSecrets(String.join(" ", command)));
        }
        int exitCode = p.exitValue();
        if (exitCode != 0) {
            BufferedReader r = new BufferedReader(new InputStreamReader(p.getErrorStream()));
            String err = r.lines().collect(Collectors.joining("\n"));
            throw new RuntimeException("Command failed: " + redactSecrets(String.join(" ", command))
                    + " with exit code " + exitCode + ". Error: " + redactSecrets(err));
        }
    }

    // The GitHub installation token is embedded in git remote URLs; strip it from any text
    // that may be thrown, logged, or forwarded so the credential never leaks into logs/Slack/PRs.
    private static String redactSecrets(String text) {
        if (text == null) return null;
        return text.replaceAll("x-access-token:[^@\\s]+@", "x-access-token:***@");
    }

    private static final List<String> DANGEROUS_SUB_SHELL_PATTERNS = Arrays.asList("$(", "`", "eval ", "exec ");

    @Override
    public HarnessResult runHarness(Path workspace, String command) {
        if (command == null || command.isBlank()) {
            return new HarnessResult(false, "Empty harness command.");
        }

        // Subshell Injection Guard: block dynamic code execution subshells while allowing shell chaining (&&, ||, ;, |)
        for (String pattern : DANGEROUS_SUB_SHELL_PATTERNS) {
            if (command.contains(pattern)) {
                String errMsg = "Security Error: Harness command contains disallowed subshell pattern '" + pattern + "'. Execution aborted.";
                System.err.println("[Harness Security] " + errMsg);
                return new HarnessResult(false, errMsg);
            }
        }

        try {
            File dir = workspace.toFile();
            ProcessBuilder pb = new ProcessBuilder("sh", "-c", command);
            pb.directory(dir);
            pb.redirectErrorStream(true);
            Process p = pb.start();

            // Close process stdin immediately to prevent child process from hanging while waiting for input
            try {
                p.getOutputStream().close();
            } catch (Exception ignored) {}

            // Asynchronously read output stream to prevent IO stream deadlock or hanging
            java.util.concurrent.CompletableFuture<String> outputFuture = java.util.concurrent.CompletableFuture.supplyAsync(() -> {
                StringBuilder output = new StringBuilder();
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        System.out.println("[Harness] " + line);
                        output.append(line).append("\n");
                    }
                } catch (Exception e) {
                    output.append("\n[Error reading harness output: ").append(e.getMessage()).append("]");
                }
                return output.toString();
            });

            boolean completed = p.waitFor(15, java.util.concurrent.TimeUnit.MINUTES);
            if (!completed) {
                p.destroyForcibly();
                System.err.println("[Harness] Command '" + command + "' timed out after 15 minutes.");
                return new HarnessResult(false, "[Error] Harness command timed out after 15 minutes.");
            }

            String outputText = "";
            try {
                outputText = outputFuture.get(5, java.util.concurrent.TimeUnit.SECONDS);
            } catch (Exception ex) {
                outputText = "[Warning: Output stream read timed out or failed]";
            }

            int exitCode = p.exitValue();
            System.out.println("[Harness] Command '" + command + "' exited with code: " + exitCode);
            return new HarnessResult(exitCode == 0, outputText);
        } catch (Exception e) {
            String errMsg = "Failed to execute command '" + command + "': " + e.getMessage();
            System.err.println("[Harness] " + errMsg);
            return new HarnessResult(false, errMsg);
        }
    }
}
