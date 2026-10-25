package de.elnino0916.android.girovo;

import android.app.Activity;
import android.util.Log;

import androidx.appcompat.app.AppCompatActivity;
import androidx.lifecycle.Lifecycle;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.play.core.review.ReviewManager;
import com.google.android.play.core.review.ReviewManagerFactory;

/**
 * Google Play's rating card (In-App Review) in the Google Play build:
 * mobile/bridges/review.ts asks for it after a good moment, at most once per
 * version (lib/play-review.ts). Play decides whether the card shows — it keeps
 * a quota of its own — and never says whether it did, nor what was rated, so
 * the answer is "done" either way. "failed" means Play was not asked: the app
 * was not in front, or Play could not be reached (no Play account, no network,
 * not installed from Play).
 *
 * The GitHub build has its own ReviewPlugin (src/github), without Play.
 */
@CapacitorPlugin(name = "GirovoReview")
public class ReviewPlugin extends Plugin {

    private static final String TAG = "GirovoReview";

    private ReviewManager manager;

    private ReviewManager manager() {
        if (manager == null) manager = ReviewManagerFactory.create(getContext());
        return manager;
    }

    /** Whether the app is in front: Play's card over a backgrounded app would never be seen. */
    private boolean inFront() {
        AppCompatActivity activity = getActivity();
        return activity != null && !activity.isFinishing()
            && activity.getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.RESUMED);
    }

    @PluginMethod
    public void request(PluginCall call) {
        getBridge().executeOnMainThread(() -> {
            if (!inFront()) {
                answer(call, "failed");
                return;
            }
            manager().requestReviewFlow().addOnCompleteListener(flow -> {
                Activity activity = getActivity();
                if (!flow.isSuccessful() || !inFront()) {
                    Log.i(TAG, "not asked: " + (flow.isSuccessful() ? "not in front" : flow.getException()));
                    answer(call, "failed");
                    return;
                }
                manager().launchReviewFlow(activity, flow.getResult())
                    .addOnCompleteListener(done -> answer(call, "done"));
            });
        });
    }

    private static void answer(PluginCall call, String result) {
        JSObject out = new JSObject();
        out.put("result", result);
        call.resolve(out);
    }
}
