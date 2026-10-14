package de.elnino0916.android.girovo;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.play.core.appupdate.AppUpdateInfo;
import com.google.android.play.core.appupdate.AppUpdateManager;
import com.google.android.play.core.appupdate.AppUpdateManagerFactory;
import com.google.android.play.core.appupdate.AppUpdateOptions;
import com.google.android.play.core.install.model.AppUpdateType;
import com.google.android.play.core.install.model.UpdateAvailability;

/**
 * Updates for the Google Play build: Play installs them. Google Play does not
 * allow an app it distributes to download and install APKs itself, so this
 * build cannot — the most it does is offer Play's own in-app update, which
 * downloads and installs through Play.
 *
 * The GitHub build has its own UpdaterPlugin (src/github).
 */
@CapacitorPlugin(name = "GirovoUpdater")
public class UpdaterPlugin extends Plugin {

    private AppUpdateManager manager;
    private AppUpdateInfo latest;

    private AppUpdateManager manager() {
        if (manager == null) manager = AppUpdateManagerFactory.create(getContext());
        return manager;
    }

    @PluginMethod
    public void playCheck(PluginCall call) {
        manager().getAppUpdateInfo()
            .addOnSuccessListener(info -> {
                latest = info;
                JSObject result = new JSObject();
                boolean available = info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE
                    && info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE);
                result.put("available", available);
                if (available) result.put("versionCode", info.availableVersionCode());
                call.resolve(result);
            })
            .addOnFailureListener(e -> {
                // Installed from elsewhere, no Play account, no network: no update to offer.
                JSObject result = new JSObject();
                result.put("available", false);
                call.resolve(result);
            });
    }

    @PluginMethod
    public void playUpdate(PluginCall call) {
        if (latest == null || latest.updateAvailability() != UpdateAvailability.UPDATE_AVAILABLE) {
            JSObject result = new JSObject();
            result.put("result", "failed");
            call.resolve(result);
            return;
        }
        getBridge().executeOnMainThread(() -> manager()
            .startUpdateFlow(latest, getActivity(), AppUpdateOptions.defaultOptions(AppUpdateType.IMMEDIATE))
            .addOnSuccessListener(code -> {
                JSObject result = new JSObject();
                result.put("result", code == android.app.Activity.RESULT_OK ? "started" : "canceled");
                call.resolve(result);
            })
            .addOnFailureListener(e -> {
                JSObject result = new JSObject();
                result.put("result", "failed");
                call.resolve(result);
            }));
    }

    @PluginMethod
    public void download(PluginCall call) {
        call.unavailable("Google Play installs the updates of this build.");
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        call.resolve();
    }

    @PluginMethod
    public void install(PluginCall call) {
        call.unavailable("Google Play installs the updates of this build.");
    }
}
