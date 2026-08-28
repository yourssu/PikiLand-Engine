import { describe, expect, test } from "bun:test";
import { HarnessInferenceService } from "./harness-inference.service";

describe("HarnessInferenceService Test", () => {
  const service = new HarnessInferenceService();

  test("should infer harness command from filenames", () => {
    expect(service.inferHarnessCmdFromFilenames(["build.gradle.kts", "gradlew"])).toBe("./gradlew test");
    expect(service.inferHarnessCmdFromFilenames(["pom.xml", "mvnw"])).toBe("./mvnw test");
    expect(service.inferHarnessCmdFromFilenames(["package.json", "bun.lock"])).toBe("bun test");
    expect(service.inferHarnessCmdFromFilenames(["package.json", "pnpm-lock.yaml"])).toBe("pnpm test");
    expect(service.inferHarnessCmdFromFilenames(["package.json", "yarn.lock"])).toBe("yarn test");
    expect(service.inferHarnessCmdFromFilenames(["package.json"])).toBe("npm test");
    expect(service.inferHarnessCmdFromFilenames(["requirements.txt"])).toBe("pytest");
    expect(service.inferHarnessCmdFromFilenames(["Cargo.toml"])).toBe("cargo test");
    expect(service.inferHarnessCmdFromFilenames(["go.mod"])).toBe("go test ./...");
    expect(service.inferHarnessCmdFromFilenames(["Makefile"])).toBe("make test");
    expect(service.inferHarnessCmdFromFilenames(["Gemfile"])).toBe("bundle exec rspec");
  });

  test("should return null for unknown project structures", () => {
    expect(service.inferHarnessCmdFromFilenames(["random.txt"])).toBeNull();
  });
});
