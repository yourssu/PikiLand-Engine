package com.yourssu.pikiland.application.service;

import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

import java.util.Arrays;

@Component
public class PikilandCliRunner implements CommandLineRunner {

    private final SelfHealingCliService selfHealingCliService;

    public PikilandCliRunner(SelfHealingCliService selfHealingCliService) {
        this.selfHealingCliService = selfHealingCliService;
    }

    @Override
    public void run(String... args) throws Exception {
        boolean isCli = Arrays.asList(args).contains("--cli") || System.getenv("PIKILAND_CLI") != null;
        if (!isCli) {
            return;
        }

        System.out.println("PikiLand starting in CLI mode...");
        try {
            selfHealingCliService.run();
            System.out.println("PikiLand CLI execution completed successfully.");
            System.exit(0);
        } catch (Exception e) {
            System.err.println("PikiLand CLI execution failed: " + e.getMessage());
            e.printStackTrace();
            System.exit(1);
        }
    }
}
