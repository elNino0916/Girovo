package de.elnino0916.android.girovo;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.security.KeyStore;
import java.security.SecureRandom;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * "Neue Umsätze melden" (lib/background-check.ts): what the page's plugin
 * (BackgroundPlugin) and the job (BackgroundJob) share.
 *
 * <ul>
 *   <li>The secret the PINs' box is sealed with: 32 random bytes, kept in the
 *   app's preferences under an Android Keystore key that needs no fingerprint
 *   — a check runs while nobody is there. That is the difference to the
 *   fingerprint login's key (BiometricPlugin), and why the checks are opt-in.</li>
 *   <li>The sealed box itself (lib/background-store.ts): one preference, for
 *   the page's runtime and the job's alike.</li>
 *   <li>The job's schedule, and the notifications a check leaves.</li>
 * </ul>
 */
final class BackgroundState {
    static final int JOB_ID = 4712;
    static final String CHANNEL = "bookings";
    private static final String PREFS = "girovo_background";
    private static final String KEY_SECRET = "secret";
    private static final String KEY_BOX = "box";
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "girovo.background.v1";
    /** Every six hours, give or take one. */
    private static final long PERIOD_MS = 6L * 60 * 60 * 1000;
    private static final long FLEX_MS = 60L * 60 * 1000;
    private static final int SECRET_BYTES = 32;

    private BackgroundState() {}

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // -----------------------------------------------------------------------
    // The secret

    private static SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance(KEYSTORE);
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) return ((KeyStore.SecretKeyEntry) store.getEntry(KEY_ALIAS, null)).getSecretKey();
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return generator.generateKey();
    }

    /**
     * The secret in base64: made the first time, read back after. One that no
     * longer opens (the Keystore was reset) is replaced — the box sealed with
     * the old one then cannot open, and the page deletes it.
     */
    static synchronized String secret(Context context) throws Exception {
        SecretKey key = key();
        String kept = prefs(context).getString(KEY_SECRET, null);
        if (kept != null) {
            try {
                String[] parts = kept.split(":", 2);
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
                byte[] plain = cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP));
                if (plain.length == SECRET_BYTES) return Base64.encodeToString(plain, Base64.NO_WRAP);
            } catch (javax.crypto.AEADBadTagException | android.security.keystore.KeyPermanentlyInvalidatedException
                     | IllegalArgumentException | ArrayIndexOutOfBoundsException e) {
                // Unreadable for good (another key, a damaged entry): a new one below.
            }
            // Anything else may pass (the Keystore busy, say): no secret this time,
            // rather than a new one that would leave every kept PIN unopenable.
        }
        byte[] fresh = new byte[SECRET_BYTES];
        new SecureRandom().nextBytes(fresh);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key);
        byte[] sealed = cipher.doFinal(fresh);
        String stored = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(sealed, Base64.NO_WRAP);
        prefs(context).edit().putString(KEY_SECRET, stored).commit();
        return Base64.encodeToString(fresh, Base64.NO_WRAP);
    }

    // -----------------------------------------------------------------------
    // The box

    static String readBox(Context context) {
        return prefs(context).getString(KEY_BOX, null);
    }

    /**
     * Written only while the box is still `expected` (null: none) — the page's
     * runtime and the job's each read, change and write it, and neither may
     * undo what the other did meanwhile. Answers whether it was written.
     */
    static synchronized boolean writeBoxIf(Context context, String expected, String text) {
        String now = readBox(context);
        if (expected == null ? now != null : !expected.equals(now)) return false;
        writeBox(context, text);
        return true;
    }

    static synchronized void writeBox(Context context, String text) {
        SharedPreferences.Editor edit = prefs(context).edit();
        if (text == null) edit.remove(KEY_BOX);
        else edit.putString(KEY_BOX, text);
        // commit, not apply: the next read — maybe from the other runtime — must see it.
        edit.commit();
    }

    // -----------------------------------------------------------------------
    // The job

    static void schedule(Context context, boolean on) {
        JobScheduler scheduler = context.getSystemService(JobScheduler.class);
        if (scheduler == null) return;
        if (!on) {
            scheduler.cancel(JOB_ID);
            return;
        }
        // Planned already: said again at every login, the plan stands.
        if (scheduler.getPendingJob(JOB_ID) != null) return;
        scheduler.schedule(new JobInfo.Builder(JOB_ID, new ComponentName(context, BackgroundJob.class))
                .setPeriodic(PERIOD_MS, FLEX_MS)
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                // Through a restart of the phone (RECEIVE_BOOT_COMPLETED).
                .setPersisted(true)
                .build());
    }

    static boolean scheduled(Context context) {
        JobScheduler scheduler = context.getSystemService(JobScheduler.class);
        return scheduler != null && scheduler.getPendingJob(JOB_ID) != null;
    }

    // -----------------------------------------------------------------------
    // Notifications

    static boolean notificationsAllowed(Context context) {
        return NotificationManagerCompat.from(context).areNotificationsEnabled();
    }

    /**
     * What a check found: {"channel": name, "notices": [{key, kind, title, text, lines}]}.
     * The lock screen shows only the channel's name — no bank, no amount.
     */
    static void post(Context context, JSONObject payload) {
        NotificationManagerCompat notifications = NotificationManagerCompat.from(context);
        if (!notifications.areNotificationsEnabled()) return;
        String channelName = payload.optString("channel", "Girovo");
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.createNotificationChannel(new NotificationChannel(CHANNEL, channelName, NotificationManager.IMPORTANCE_DEFAULT));
        }
        JSONArray notices = payload.optJSONArray("notices");
        if (notices == null) return;
        Intent open = new Intent(context, MainActivity.class)
                .setAction(Intent.ACTION_MAIN)
                .addCategory(Intent.CATEGORY_LAUNCHER)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent tap = PendingIntent.getActivity(context, 1, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        int accent = ContextCompat.getColor(context, R.color.girovo_action);
        for (int i = 0; i < notices.length(); i++) {
            JSONObject notice = notices.optJSONObject(i);
            if (notice == null) continue;
            String title = notice.optString("title", "Girovo");
            String text = notice.optString("text", "");
            JSONArray lines = notice.optJSONArray("lines");
            NotificationCompat.Builder hidden = new NotificationCompat.Builder(context, CHANNEL)
                    .setSmallIcon(R.drawable.ic_stat_girovo)
                    .setColor(accent)
                    .setContentTitle(channelName);
            NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL)
                    .setSmallIcon(R.drawable.ic_stat_girovo)
                    .setColor(accent)
                    .setContentTitle(title)
                    .setContentIntent(tap)
                    .setAutoCancel(true)
                    .setCategory(NotificationCompat.CATEGORY_EVENT)
                    .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                    .setPublicVersion(hidden.build());
            if (lines != null && lines.length() > 0) {
                NotificationCompat.InboxStyle inbox = new NotificationCompat.InboxStyle().setBigContentTitle(title);
                for (int l = 0; l < lines.length(); l++) inbox.addLine(lines.optString(l, ""));
                builder.setContentText(lines.optString(0, "")).setStyle(inbox);
            } else {
                builder.setContentText(text).setStyle(new NotificationCompat.BigTextStyle().bigText(text));
            }
            try {
                notifications.notify("girovo.bookings", notice.optString("key", title).hashCode(), builder.build());
            } catch (SecurityException ignored) {
                // Notifications were turned off meanwhile.
            }
        }
    }
}
