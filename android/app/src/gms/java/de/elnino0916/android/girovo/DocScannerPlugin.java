package de.elnino0916.android.girovo;

import android.app.Activity;
import android.net.Uri;
import android.util.Base64;
import android.util.Log;

import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.common.MlKitException;
import com.google.mlkit.vision.documentscanner.GmsDocumentScanner;
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions;
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning;
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;

/**
 * "Beleg fotografieren" and "Rechnung scannen": Google's document scanner,
 * from Play services. It is its own camera screen — it finds the paper's
 * edges, straightens and crops it — and the app asks for no camera
 * permission: it gets the finished pages back as JPEGs (and, when asked, the
 * pages as one PDF), which the page keeps sealed as a Beleg or reads for an
 * invoice's text (TextPlugin).
 *
 * Without Play services the call fails with "unavailable", and the page
 * offers picking a file instead; backing out of the scanner is "canceled".
 */
@CapacitorPlugin(name = "GirovoDocScanner")
public class DocScannerPlugin extends Plugin {

    private ActivityResultLauncher<IntentSenderRequest> launcher;
    private PluginCall pending;
    private boolean wantPdf;

    @Override
    public void load() {
        // Registered while the activity is created, as the Activity Result API requires.
        launcher = getActivity().registerForActivityResult(
            new ActivityResultContracts.StartIntentSenderForResult(), this::onResult);
    }

    @PluginMethod
    public void scan(PluginCall call) {
        // A scan still open from before (its result lost with an activity
        // that went away) ends as canceled: the new one takes its place.
        if (pending != null) {
            JSObject canceled = new JSObject();
            canceled.put("canceled", true);
            pending.resolve(canceled);
            pending = null;
        }
        int pages = Math.max(1, Math.min(10, call.getInt("pages", 1)));
        wantPdf = Boolean.TRUE.equals(call.getBoolean("pdf", false));
        GmsDocumentScannerOptions.Builder options = new GmsDocumentScannerOptions.Builder()
            .setGalleryImportAllowed(true)
            .setPageLimit(pages)
            .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL);
        if (wantPdf) {
            options.setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG, GmsDocumentScannerOptions.RESULT_FORMAT_PDF);
        } else {
            options.setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG);
        }
        GmsDocumentScanner scanner = GmsDocumentScanning.getClient(options.build());
        pending = call;
        scanner.getStartScanIntent(getActivity())
            .addOnSuccessListener(sender -> launcher.launch(new IntentSenderRequest.Builder(sender).build()))
            .addOnFailureListener(e -> {
                int code = e instanceof MlKitException ? ((MlKitException) e).getErrorCode() : -1;
                Log.w("GirovoDocScanner", "no scanner: " + code + " " + e.getMessage());
                PluginCall c = pending;
                pending = null;
                if (c != null) c.reject(e.getMessage(), code == MlKitException.UNAVAILABLE ? "unavailable" : "failed", e);
            });
    }

    private void onResult(ActivityResult result) {
        PluginCall call = pending;
        pending = null;
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK) {
            JSObject canceled = new JSObject();
            canceled.put("canceled", true);
            call.resolve(canceled);
            return;
        }
        GmsDocumentScanningResult scan = GmsDocumentScanningResult.fromActivityResultIntent(result.getData());
        if (scan == null || scan.getPages() == null || scan.getPages().isEmpty()) {
            call.reject("no pages", "failed");
            return;
        }
        try {
            JSArray pages = new JSArray();
            for (GmsDocumentScanningResult.Page page : scan.getPages()) pages.put(base64(page.getImageUri()));
            JSObject out = new JSObject();
            out.put("pages", pages);
            if (wantPdf && scan.getPdf() != null) out.put("pdf", base64(scan.getPdf().getUri()));
            call.resolve(out);
        } catch (IOException e) {
            call.reject("unreadable", "failed", e);
        }
    }

    private String base64(Uri uri) throws IOException {
        try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
            if (in == null) throw new IOException("no stream");
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[64 * 1024];
            int n;
            while ((n = in.read(buffer)) > 0) bytes.write(buffer, 0, n);
            return Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP);
        }
    }
}
