package com.hamidreza.budgetplanner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class AppConfigurationTest {

    @Test
    public void releaseIdentityIsTheBudgetPlannerApp() {
        assertEquals("com.hamidreza.budgetplanner", BuildConfig.APPLICATION_ID);
        assertTrue("version code must be positive", BuildConfig.VERSION_CODE > 0);
        assertTrue("version name must be present", BuildConfig.VERSION_NAME.matches("\\d+\\.\\d+\\.\\d+"));
    }
}
