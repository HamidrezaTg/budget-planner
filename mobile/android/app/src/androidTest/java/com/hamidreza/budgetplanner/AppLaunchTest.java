package com.hamidreza.budgetplanner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class AppLaunchTest {

    @Test
    public void launcherResolvesToBudgetPlannerActivity() throws Exception {
        Context appContext = InstrumentationRegistry.getInstrumentation().getTargetContext();

        assertEquals("com.hamidreza.budgetplanner", appContext.getPackageName());
        android.content.Intent launchIntent = appContext.getPackageManager()
                .getLaunchIntentForPackage(appContext.getPackageName());
        assertNotNull("the app must declare a launcher activity", launchIntent);
        assertNotNull("the launcher intent must name an activity", launchIntent.getComponent());
        assertTrue("launcher must open MainActivity",
                launchIntent.getComponent().getClassName().endsWith("MainActivity"));
    }
}
