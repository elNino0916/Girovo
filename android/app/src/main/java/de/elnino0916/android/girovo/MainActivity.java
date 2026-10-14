package de.elnino0916.android.girovo;

import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

/**
 * The app: one WebView showing Girovo's page (exported for the phone) with the
 * phone runtime in it (mobile/runtime.ts), and the native pieces that runtime
 * calls on.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HttpPlugin.class);
        registerPlugin(DevicePlugin.class);
        registerPlugin(BiometricPlugin.class);
        registerPlugin(ModelPlugin.class);
        // One per distribution: src/github (APKs from GitHub) or src/play (Google Play).
        registerPlugin(UpdaterPlugin.class);
        super.onCreate(savedInstanceState);
        // The recent-apps overview shows a blank card instead of balances and
        // Umsätze. Screenshots stay possible — sharing a GiroCode is one — and
        // "Beträge ausblenden" is there for showing the screen to someone.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) setRecentsScreenshotEnabled(false);
    }
}
