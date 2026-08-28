import * as fs from "fs/promises";
import * as path from "path";

export class HarnessInferenceService {
  public inferHarnessCmdFromFilenames(filenames: string[]): string | null {
    if (!filenames || filenames.length === 0) {
      return null;
    }

    // 1. Gradle
    if (filenames.includes("build.gradle.kts") || filenames.includes("build.gradle")) {
      return filenames.includes("gradlew") ? "./gradlew test" : "gradle test";
    }

    // 2. Maven
    if (filenames.includes("pom.xml")) {
      return filenames.includes("mvnw") ? "./mvnw test" : "mvn test";
    }

    // 3. Node.js / Bun / NPM / PNPM / Yarn
    if (filenames.includes("package.json")) {
      if (filenames.includes("bun.lockb") || filenames.includes("bun.lock")) return "bun test";
      if (filenames.includes("pnpm-lock.yaml")) return "pnpm test";
      if (filenames.includes("yarn.lock")) return "yarn test";
      return "npm test";
    }

    // 4. Python
    if (
      filenames.includes("requirements.txt") ||
      filenames.includes("pytest.ini") ||
      filenames.includes("pyproject.toml")
    ) {
      return "pytest";
    }

    // 5. Go
    if (filenames.includes("go.mod")) {
      return "go test ./...";
    }

    // 6. Rust
    if (filenames.includes("Cargo.toml")) {
      return "cargo test";
    }

    // 7. Makefile
    if (filenames.includes("Makefile") || filenames.includes("makefile")) {
      return "make test";
    }

    // 8. Ruby
    if (filenames.includes("Gemfile") || filenames.includes(".rspec") || filenames.includes("Rakefile")) {
      return "bundle exec rspec";
    }

    return null;
  }

  public async inferHarnessCmdFromWorkspace(workspacePath: string): Promise<string | null> {
    try {
      // Gradle
      if (await this.fileExists(path.join(workspacePath, "build.gradle.kts")) || await this.fileExists(path.join(workspacePath, "build.gradle"))) {
        if (await this.fileExists(path.join(workspacePath, "gradlew"))) {
          return "./gradlew test";
        }
        return "gradle test";
      }

      // Maven
      if (await this.fileExists(path.join(workspacePath, "pom.xml"))) {
        if (await this.fileExists(path.join(workspacePath, "mvnw"))) {
          return "./mvnw test";
        }
        return "mvn test";
      }

      // Node.js / NPM / Bun / PNPM / Yarn
      if (await this.fileExists(path.join(workspacePath, "package.json"))) {
        if (await this.fileExists(path.join(workspacePath, "bun.lockb")) || await this.fileExists(path.join(workspacePath, "bun.lock"))) {
          return "bun test";
        }
        if (await this.fileExists(path.join(workspacePath, "pnpm-lock.yaml"))) {
          return "pnpm test";
        }
        if (await this.fileExists(path.join(workspacePath, "yarn.lock"))) {
          return "yarn test";
        }
        return "npm test";
      }

      // Python
      if (
        await this.fileExists(path.join(workspacePath, "requirements.txt")) ||
        await this.fileExists(path.join(workspacePath, "pytest.ini")) ||
        await this.fileExists(path.join(workspacePath, "pyproject.toml"))
      ) {
        return "pytest";
      }

      // Rust
      if (await this.fileExists(path.join(workspacePath, "Cargo.toml"))) {
        return "cargo test";
      }

      // Go
      if (await this.fileExists(path.join(workspacePath, "go.mod"))) {
        return "go test ./...";
      }

      // Makefile
      if (await this.fileExists(path.join(workspacePath, "Makefile")) || await this.fileExists(path.join(workspacePath, "makefile"))) {
        return "make test";
      }

      // Ruby
      if (
        await this.fileExists(path.join(workspacePath, "Gemfile")) ||
        await this.fileExists(path.join(workspacePath, ".rspec")) ||
        await this.fileExists(path.join(workspacePath, "Rakefile"))
      ) {
        return "bundle exec rspec";
      }

      return null;
    } catch {
      return null;
    }
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

