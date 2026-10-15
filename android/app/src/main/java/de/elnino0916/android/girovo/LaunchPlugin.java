package de.elnino0916.android.girovo;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import android.util.Base64;

import androidx.core.content.IntentCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;

/**
 * How the app was opened, beyond its icon: a shortcut from the launcher
 * (res/xml/shortcuts.xml — Überweisen, GiroCode scannen, Geld anfordern), or a
 * file another app shared with Girovo — an invoice, as an image or a PDF, for
 * the GiroCode on it. Each launch reaches the page as a "launch" event, kept
 * until the page listens (components/android/useLaunches.ts): the dashboard
 * acts on it once someone is logged in.
 *
 * A PDF is drawn here, page by page (PdfRenderer): the page reads a GiroCode
 * off pixels (lib/qr-read.ts), and the WebView cannot draw a PDF itself.
 */
@CapacitorPlugin(name = "GirovoLaunch")
public class LaunchPlugin extends Plugin {
    static final String ACTION_TRANSFER = "de.elnino0916.android.girovo.TRANSFER";
    static final String ACTION_SCAN = "de.elnino0916.android.girovo.SCAN";
    static final String ACTION_REQUEST = "de.elnino0916.android.girovo.REQUEST";

    /** A GiroCode sits on an invoice's first page or two. */
    private static final int MAX_PAGES = 3;
    /** A shared file larger than this is no invoice. */
    private static final int MAX_BYTES = 25 * 1024 * 1024;
    /** About 200 dpi, and no side longer than this: enough for a printed code, not a poster. */
    private static final float DPI = 200f;
    private static final int MAX_SIDE = 2400;

    @Override
    public void load() {
        handle(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        handle(intent);
    }

    private void handle(Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        JSObject launch = new JSObject();
        switch (intent.getAction()) {
            case ACTION_TRANSFER:
                launch.put("kind", "transfer");
                break;
            case ACTION_SCAN:
                launch.put("kind", "scan");
                break;
            case ACTION_REQUEST:
                launch.put("kind", "request");
                break;
            case Intent.ACTION_SEND: {
                Uri uri = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri.class);
                if (uri == null) return;
                launch.put("kind", "file");
                launch.put("uri", uri.toString());
                launch.put("mime", intent.getType());
                break;
            }
            default:
                return;
        }
        // Acted on once: the activity keeps its intent, and a later reload of
        // the page must not open the transfer a second time.
        intent.setAction(Intent.ACTION_MAIN);
        notifyListeners("launch", launch, true);
    }

    /** A shared file's bytes, with its name and type, as base64. */
    @PluginMethod
    public void readShared(PluginCall call) {
        String uriString = call.getString("uri");
        if (uriString == null) {
            call.reject("no uri");
            return;
        }
        Uri uri = Uri.parse(uriString);
        getBridge().execute(() -> {
            ContentResolver resolver = getContext().getContentResolver();
            try (InputStream in = resolver.openInputStream(uri)) {
                if (in == null) throw new IOException("unreadable");
                byte[] bytes = readAll(in);
                JSObject result = new JSObject();
                result.put("name", displayName(resolver, uri));
                String mime = call.getString("mime");
                result.put("mime", mime != null ? mime : resolver.getType(uri));
                result.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
                call.resolve(result);
            } catch (Exception e) {
                call.reject("unreadable", "unreadable", e);
            }
        });
    }

    /** The first pages of a PDF, each drawn on white as a PNG (base64). */
    @PluginMethod
    public void renderPdf(PluginCall call) {
        String data = call.getString("data");
        if (data == null) {
            call.reject("no data");
            return;
        }
        getBridge().execute(() -> {
            File tmp = null;
            try {
                tmp = File.createTempFile("girovo-", ".pdf", getContext().getCacheDir());
                try (FileOutputStream out = new FileOutputStream(tmp)) {
                    out.write(Base64.decode(data, Base64.DEFAULT));
                }
                JSArray pages = new JSArray();
                try (ParcelFileDescriptor fd = ParcelFileDescriptor.open(tmp, ParcelFileDescriptor.MODE_READ_ONLY);
                     PdfRenderer renderer = new PdfRenderer(fd)) {
                    int count = Math.min(renderer.getPageCount(), MAX_PAGES);
                    for (int i = 0; i < count; i++) {
                        try (PdfRenderer.Page page = renderer.openPage(i)) {
                            float scale = Math.min(DPI / 72f, (float) MAX_SIDE / Math.max(page.getWidth(), page.getHeight()));
                            int width = Math.max(1, Math.round(page.getWidth() * scale));
                            int height = Math.max(1, Math.round(page.getHeight() * scale));
                            Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
                            bitmap.eraseColor(Color.WHITE);
                            page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                            ByteArrayOutputStream png = new ByteArrayOutputStream();
                            bitmap.compress(Bitmap.CompressFormat.PNG, 100, png);
                            bitmap.recycle();
                            pages.put(Base64.encodeToString(png.toByteArray(), Base64.NO_WRAP));
                        }
                    }
                }
                JSObject result = new JSObject();
                result.put("pages", pages);
                call.resolve(result);
            } catch (Exception e) {
                call.reject("unreadable", "unreadable", e);
            } finally {
                if (tmp != null) //noinspection ResultOfMethodCallIgnored
                    tmp.delete();
            }
        });
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[64 * 1024];
        int n;
        while ((n = in.read(buffer)) != -1) {
            out.write(buffer, 0, n);
            if (out.size() > MAX_BYTES) throw new IOException("too large");
        }
        return out.toByteArray();
    }

    private static String displayName(ContentResolver resolver, Uri uri) {
        try (Cursor cursor = resolver.query(uri, new String[] {OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                String name = cursor.getString(0);
                if (name != null) return name;
            }
        } catch (Exception ignored) {
            // A provider without a name column: the page names it itself.
        }
        return "shared";
    }
}
