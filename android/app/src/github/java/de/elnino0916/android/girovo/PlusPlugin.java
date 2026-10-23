package de.elnino0916.android.girovo;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Girovo Plus does not apply to the GitHub build: it is open source and
 * complete, so everything Plus unlocks in the Google Play build is open here
 * (lib/plus.ts, state 'free'). The Play build has the real PlusPlugin
 * (src/play), with Google Play Billing.
 */
@CapacitorPlugin(name = "GirovoPlus")
public class PlusPlugin extends Plugin {

    @PluginMethod
    public void status(PluginCall call) {
        JSObject out = new JSObject();
        out.put("state", "free");
        out.put("icon", "standard");
        out.put("offers", new JSArray());
        call.resolve(out);
    }

    @PluginMethod
    public void buy(PluginCall call) {
        call.reject("free here", "UNAVAILABLE");
    }

    @PluginMethod
    public void manage(PluginCall call) {
        call.reject("free here", "UNAVAILABLE");
    }

    @PluginMethod
    public void setIcon(PluginCall call) {
        call.reject("free here", "UNAVAILABLE");
    }

    /** No owner key either: nothing here needs unlocking. */
    @PluginMethod
    public void owner(PluginCall call) {
        call.reject("free here", "UNAVAILABLE");
    }

    @PluginMethod
    public void setOwnerKey(PluginCall call) {
        call.reject("free here", "UNAVAILABLE");
    }

    @PluginMethod
    public void clearOwnerKey(PluginCall call) {
        call.reject("free here", "UNAVAILABLE");
    }
}
