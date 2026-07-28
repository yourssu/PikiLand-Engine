package com.yourssu.pikiland.domain.model;

public class PatchInstruction {
    private final String filePath;
    private final String oldCode;
    private final String newCode;

    public PatchInstruction(String filePath, String oldCode, String newCode) {
        this.filePath = filePath;
        this.oldCode = oldCode;
        this.newCode = newCode;
    }

    public String getFilePath() {
        return filePath;
    }

    public String getOldCode() {
        return oldCode;
    }

    public String getNewCode() {
        return newCode;
    }
}
