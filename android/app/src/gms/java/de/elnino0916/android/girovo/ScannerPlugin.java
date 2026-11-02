package de.elnino0916.android.girovo;

import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.common.MlKitException;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanner;
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning;

/**
 * "GiroCode scannen": Google's code scanner, from Play services. It is its own
 * camera screen, run by Play services — the app asks for no camera permission
 * and never sees the camera's picture, only the text of the one QR code the
 * user aimed at. The page reads that text as a GiroCode (lib/girocode.ts).
 *
 * Without Play services (some phones the GitHub APK runs on) there is no
 * scanner: the call fails with "unavailable", and the page offers picking an
 * image or a PDF instead. Any other failure is "failed": try again.
 */
@CapacitorPlugin(name = "GirovoScanner")
public class ScannerPlugin extends Plugin {

    /**
     * What is a fault worth saying (MlKitException's scanner codes): no camera
     * permission for the scanner (202), its pipeline failing to start or to
     * read (205, 206), Play services too old for it (207). (Not Set.of: that
     * is Android 11's, and the app runs from Android 8.)
     */
    private static boolean isFault(int code) {
        return code == 202 || code == 205 || code == 206 || code == 207;
    }

    @PluginMethod
    public void scan(PluginCall call) {
        GmsBarcodeScannerOptions options = new GmsBarcodeScannerOptions.Builder()
            .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
            // A GiroCode on paper is small; the scanner zooms in on it by itself.
            .enableAutoZoom()
            .build();
        GmsBarcodeScanner scanner = GmsBarcodeScanning.getClient(getActivity(), options);
        scanner.startScan()
            .addOnSuccessListener(barcode -> {
                JSObject result = new JSObject();
                result.put("value", barcode.getRawValue());
                call.resolve(result);
            })
            .addOnCanceledListener(() -> canceled(call))
            .addOnFailureListener(e -> {
                int code = e instanceof MlKitException ? ((MlKitException) e).getErrorCode() : -1;
                Log.w("GirovoScanner", "scan ended without a code: " + code + " " + e.getMessage());
                if (code == MlKitException.CODE_SCANNER_UNAVAILABLE) {
                    // No scanner on this phone (no Play services, or its module
                    // could not be had): the page offers an image or a PDF.
                    call.reject(e.getMessage(), "unavailable", e);
                } else if (isFault(code)) {
                    call.reject(e.getMessage(), "failed", e);
                } else {
                    // Back in the scanner: documented as a cancelled task, it
                    // arrives as a failure on Play services — CANCELLED (201),
                    // or plainly "Failed to scan code." (13, seen on a Galaxy
                    // with Play services 26.39). The user's no, not a fault.
                    canceled(call);
                }
            });
    }

    private static void canceled(PluginCall call) {
        JSObject result = new JSObject();
        result.put("canceled", true);
        call.resolve(result);
    }
}
