package com.yourssu.pikiland.application.service;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

public class HarnessInferenceServiceTest {

    private final HarnessInferenceService service = new HarnessInferenceService();

    @Test
    public void testInferGradleFromFilenames() {
        List<String> files = Arrays.asList("build.gradle.kts", "settings.gradle.kts", "gradlew");
        assertEquals("./gradlew test", service.inferHarnessCmdFromFilenames(files));
    }

    @Test
    public void testInferMavenWithWrapperFromFilenames() {
        List<String> files = Arrays.asList("pom.xml", "mvnw", "src");
        assertEquals("./mvnw test", service.inferHarnessCmdFromFilenames(files));
    }

    @Test
    public void testInferMavenWithoutWrapperFromFilenames() {
        List<String> files = Arrays.asList("pom.xml", "src");
        assertEquals("mvn test", service.inferHarnessCmdFromFilenames(files));
    }

    @Test
    public void testInferNodeFromFilenames() {
        List<String> files = Arrays.asList("package.json", "package-lock.json", "index.js");
        assertEquals("npm test", service.inferHarnessCmdFromFilenames(files));
    }

    @Test
    public void testInferPythonFromFilenames() {
        List<String> files = Arrays.asList("requirements.txt", "main.py");
        assertEquals("pytest", service.inferHarnessCmdFromFilenames(files));
    }

    @Test
    public void testInferGoFromFilenames() {
        List<String> files = Arrays.asList("go.mod", "main.go");
        assertEquals("go test ./...", service.inferHarnessCmdFromFilenames(files));
    }

    @Test
    public void testInferRustFromFilenames() {
        List<String> files = Arrays.asList("Cargo.toml", "src");
        assertEquals("cargo test", service.inferHarnessCmdFromFilenames(files));
    }

    @Test
    public void testInferMakefileFromFilenames() {
        List<String> files = Arrays.asList("Makefile", "src");
        assertEquals("make test", service.inferHarnessCmdFromFilenames(files));
    }

    @Test
    public void testInferNullOrEmptyFilenames() {
        assertNull(service.inferHarnessCmdFromFilenames(null));
        assertNull(service.inferHarnessCmdFromFilenames(Collections.emptyList()));
        assertNull(service.inferHarnessCmdFromFilenames(Arrays.asList("README.md", "LICENCE")));
    }

    @Test
    public void testInferFromLocalWorkspace(@TempDir Path tempDir) throws IOException {
        Files.createFile(tempDir.resolve("package.json"));
        assertEquals("npm test", service.inferHarnessCmdFromWorkspace(tempDir));
    }
}
