plugins {
    java
    id("org.springframework.boot") version "3.3.1"
}

group = "com.yourssu"
version = "0.0.1-SNAPSHOT"

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

repositories {
    mavenCentral()
}

val mockitoAgent = configurations.create("mockitoAgent")

dependencies {
    implementation(platform("org.springframework.boot:spring-boot-dependencies:3.3.1"))

    // Core Spring Boot starter without Web Server (Tomcat) or Security
    implementation("org.springframework.boot:spring-boot-starter")
    // Spring Web abstractions (RestTemplate, HttpHeaders) without embedded Tomcat server
    implementation("org.springframework:spring-web")

    // Jackson JSON parser for AI Adapters
    implementation("com.fasterxml.jackson.core:jackson-databind")

    // JWT for GitHub API authentication
    implementation("io.jsonwebtoken:jjwt-api:0.12.5")
    runtimeOnly("io.jsonwebtoken:jjwt-impl:0.12.5")
    runtimeOnly("io.jsonwebtoken:jjwt-jackson:0.12.5")

    // Testing
    testImplementation("com.tngtech.archunit:archunit-junit5:1.3.0")
    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")

    // Mockito Static Agent
    testImplementation("org.mockito:mockito-core:5.14.0")
    mockitoAgent("org.mockito:mockito-core:5.14.0") {
        isTransitive = false
    }
}

tasks.withType<Test> {
    useJUnitPlatform()
    jvmArgs("-javaagent:${mockitoAgent.asPath}")
}
