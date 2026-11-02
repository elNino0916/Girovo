package de.elnino0916.android.girovo;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Google's document scanner is Play services' and not in the F-Droid build.
 * The call fails with "unavailable", as on a phone without Play services, and
 * the page opens the system's picker instead ("Beleg hinzufügen", "Rechnung
 * scannen"), where the camera app is one of the choices.
 */
@CapacitorPlugin(name = "GirovoDocScanner")
public class DocScannerPlugin extends Plugin {

    @PluginMethod
    public void scan(PluginCall call) {
        call.reject("No document scanner in the F-Droid build", "unavailable");
    }
}
