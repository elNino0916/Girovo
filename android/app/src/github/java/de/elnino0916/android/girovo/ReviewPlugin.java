package de.elnino0916.android.girovo;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Google Play's rating card does not apply to the GitHub build: it has no
 * Play library at all, so it can go where Google Play's code may not (an
 * F-Droid repository). mobile/bridges/review.ts never asks here; should
 * anything ask, it is unavailable. The Play build has the real ReviewPlugin
 * (src/play), with Play's In-App Review.
 */
@CapacitorPlugin(name = "GirovoReview")
public class ReviewPlugin extends Plugin {

    @PluginMethod
    public void request(PluginCall call) {
        call.unavailable("Google Play's rating card is in the Google Play build only.");
    }
}
