package de.elnino0916.android.girovo;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Gemini Nano runs in Google's AICore, through ML Kit, and is not in the
 * F-Droid build. Every phone reads as one without Nano: Einstellungen says
 * so, the keyword rules sort the categories on their own, and "Frag deine
 * Umsätze" stays away — as on a phone AICore does not serve.
 */
@CapacitorPlugin(name = "GirovoNano")
public class NanoPlugin extends Plugin {

    private static JSObject unsupported() {
        JSObject out = new JSObject();
        out.put("state", "unsupported");
        out.put("reason", "unavailable");
        return out;
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(unsupported());
    }

    @PluginMethod
    public void download(PluginCall call) {
        call.resolve(unsupported());
    }

    @PluginMethod
    public void classify(PluginCall call) {
        JSObject out = new JSObject();
        out.put("answers", new JSObject());
        call.resolve(out);
    }

    @PluginMethod
    public void prompt(PluginCall call) {
        JSObject out = new JSObject();
        out.put("text", JSObject.NULL);
        call.resolve(out);
    }

    @PluginMethod
    public void progress(PluginCall call) {
        JSObject out = new JSObject();
        out.put("active", false);
        out.put("done", 0);
        out.put("total", 0);
        out.put("waiting", JSObject.NULL);
        call.resolve(out);
    }
}
