import { describe, expect, test } from "bun:test";
import { HarnessInferenceService } from "./harness-inference.service";

describe("HarnessInferenceService Test", () => {
  const service = new HarnessInferenceService();

  test("should infer harness command from filenames", () => {
    expect(service.inferHarnessCmdFromFilenames(["build.gradle.kts", "gradlew"])).toBe("./gradlew test");
    expect(service.inferHarnessCmdFromFilenames(["pom.xml", "mvnw"])).toBe("./mvnw test");
    expect(service.inferHarnessCmdFromFilenames(["package.json", "bun.lock"])).toBe("bun test");
    expect(service.inferHarnessCmdFromFilenames(["requirements.txt"])).toBe("pytest");
    expect(service.inferHarnessCmdFromFilenames(["Cargo.toml"])).toBe("cargo test");
    expect(service.inferHarnessCmdFromFilenames(["go.mod"])).toBe("go test ./...");
    expect(service.inferHarnessCmdFromFilenames(["Makefile"])).toBe("make test");
  });

  test("should return null for unknown project structures", () => {
    expect(service.inferHarnessCmdFromFilenames(["random.txt"])).toBeNull();
  });
});
