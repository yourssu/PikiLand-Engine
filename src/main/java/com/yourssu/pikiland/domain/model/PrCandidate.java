package com.yourssu.pikiland.domain.model;

import java.util.List;

public class PrCandidate {
    private final String patchSummary;
    private final List<PatchInstruction> patchInstructions;
    private final String prTitle;
    private final String prBody;

    public PrCandidate(String patchSummary, List<PatchInstruction> patchInstructions, String prTitle, String prBody) {
        this.patchSummary = patchSummary;
        this.patchInstructions = patchInstructions;
        this.prTitle = prTitle;
        this.prBody = prBody;
    }

    public String getPatchSummary() {
        return patchSummary;
    }

    public List<PatchInstruction> getPatchInstructions() {
        return patchInstructions;
    }

    public String getPrTitle() {
        return prTitle;
    }

    public String getPrBody() {
        return prBody;
    }
}
