package com.yourssu.pikiland;

import org.springframework.boot.WebApplicationType;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.builder.SpringApplicationBuilder;

@SpringBootApplication
public class PikilandEngineApplication {

    public static void main(String[] args) {
        new SpringApplicationBuilder(PikilandEngineApplication.class)
                .web(WebApplicationType.NONE)
                .run(args);
    }
}
