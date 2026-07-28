package com.yourssu.pikiland.domain.model;

import java.util.List;

public class AiAnalysisResult {
    private final boolean confident;
    private final String summary;
    private final String impact;
    private final String causeDescription;
    private final boolean prNeeded;
    private final List<PrCandidate> prCandidates;

    public AiAnalysisResult(boolean confident, String summary, String impact, String causeDescription,
                            boolean prNeeded, List<PrCandidate> prCandidates) {
        this.confident = confident;
        this.summary = summary;
        this.impact = impact;
        this.causeDescription = causeDescription;
        this.prNeeded = prNeeded;
        this.prCandidates = prCandidates;
    }

    public boolean isConfident() {
        return confident;
    }

    public String getSummary() {
        return summary;
    }

    public String getImpact() {
        return impact;
    }

    public String getCauseDescription() {
        return causeDescription;
    }

    public boolean isPrNeeded() {
        return prNeeded;
    }

    public List<PrCandidate> getPrCandidates() {
        return prCandidates;
    }
}
