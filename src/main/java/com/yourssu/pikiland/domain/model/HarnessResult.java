package com.yourssu.pikiland.domain.model;

public class HarnessResult {
    private final boolean success;
    private final String output;

    public HarnessResult(boolean success, String output) {
        this.success = success;
        this.output = output;
    }

    public boolean isSuccess() {
        return success;
    }

    public String getOutput() {
        return output;
    }
}
