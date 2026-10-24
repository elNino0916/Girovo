package de.elnino0916.android.girovo;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;

/**
 * Keeps Girovo reachable for its bank while the user approves in the bank's
 * own app (S-pushTAN, SecureGo plus, …).
 *
 * Approving means switching to that app, and from Android 15 on an app in the
 * background has no network: the next "approved yet?" question to the bank
 * fails before it leaves the phone (UnknownHostException), and the login or
 * transfer ends as "bank unreachable" although the user has just said yes.
 * A foreground service is the process lifecycle Android keeps the network
 * for. This one runs exactly as long as an approval is awaited
 * (DevicePlugin.holdForApproval / releaseApproval, driven by the page's wait
 * state), shows a quiet notification while it does, and never longer than
 * Android's short-service limit of about three minutes.
 */
public class ApprovalService extends Service {

    static final String EXTRA_TITLE = "title";
    static final String EXTRA_TEXT = "text";
    private static final String CHANNEL = "approval";
    private static final int NOTIFICATION_ID = 4711;

    static void start(Context context, String title, String text) {
        Intent intent = new Intent(context, ApprovalService.class);
        intent.putExtra(EXTRA_TITLE, title);
        intent.putExtra(EXTRA_TEXT, text);
        androidx.core.content.ContextCompat.startForegroundService(context, intent);
    }

    static void stop(Context context) {
        context.stopService(new Intent(context, ApprovalService.class));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String title = intent == null ? null : intent.getStringExtra(EXTRA_TITLE);
        String text = intent == null ? null : intent.getStringExtra(EXTRA_TEXT);
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, title == null ? "Girovo" : title, NotificationManager.IMPORTANCE_LOW);
            channel.setShowBadge(false);
            manager.createNotificationChannel(channel);
        }
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent back = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification notification = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_girovo)
            .setContentTitle(title == null ? "Girovo" : title)
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(back)
            .setOngoing(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        return START_NOT_STICKY;
    }

    /** Android's limit for a short service: it must end now. Whatever is still awaited carries on without it. */
    @Override
    public void onTimeout(int startId) {
        stopSelf();
    }

    @Override
    public void onTimeout(int startId, int fgsType) {
        stopSelf();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
