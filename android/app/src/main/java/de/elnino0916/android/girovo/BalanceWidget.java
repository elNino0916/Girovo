package de.elnino0916.android.girovo;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.view.View;
import android.widget.RemoteViews;

/**
 * The home screen widget (6.0): the Gesamtsaldo, hidden until a tap on the
 * eye shows it for a few seconds; a tap anywhere else opens Girovo.
 *
 * It shows only what the app last handed it (WidgetPlugin, from the page's
 * overview) — the figure formatted, and since when it stands — and keeps that
 * only while a widget is on the home screen: the last one removed, it is gone.
 * The app never wakes for it and asks no bank.
 */
public class BalanceWidget extends AppWidgetProvider {
    static final String PREFS = "girovo_widget";
    static final String KEY_AMOUNT = "amount";
    static final String KEY_STAMP = "stamp";
    private static final String KEY_REVEAL_UNTIL = "revealUntil";
    private static final String ACTION_REVEAL = "de.elnino0916.android.girovo.widget.REVEAL";
    private static final String ACTION_HIDE = "de.elnino0916.android.girovo.widget.HIDE";
    /** How long a tap on the eye shows the figure. */
    private static final long REVEAL_MS = 15_000L;
    /** The figure while it is hidden: no length, no digits to read off. */
    private static final String HIDDEN = "••••••";

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        render(context, manager, ids);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        String action = intent.getAction();
        if (ACTION_REVEAL.equals(action)) {
            SharedPreferences prefs = prefs(context);
            long now = System.currentTimeMillis();
            // A second tap while it shows hides it again.
            long until = prefs.getLong(KEY_REVEAL_UNTIL, 0L) > now ? 0L : now + REVEAL_MS;
            prefs.edit().putLong(KEY_REVEAL_UNTIL, until).apply();
            if (until > 0) scheduleHide(context, until);
            renderAll(context);
        } else if (ACTION_HIDE.equals(action)) {
            prefs(context).edit().putLong(KEY_REVEAL_UNTIL, 0L).apply();
            renderAll(context);
        }
    }

    /** The last widget left the home screen: nothing of the figure is kept. */
    @Override
    public void onDisabled(Context context) {
        prefs(context).edit().clear().apply();
    }

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static int[] placed(Context context) {
        return AppWidgetManager.getInstance(context).getAppWidgetIds(new ComponentName(context, BalanceWidget.class));
    }

    /** Draws every widget again, after the figure changed or was cleared. */
    static void renderAll(Context context) {
        int[] ids = placed(context);
        if (ids.length > 0) render(context, AppWidgetManager.getInstance(context), ids);
    }

    private static void render(Context context, AppWidgetManager manager, int[] ids) {
        SharedPreferences prefs = prefs(context);
        String amount = prefs.getString(KEY_AMOUNT, null);
        String stamp = prefs.getString(KEY_STAMP, null);
        boolean revealed = prefs.getLong(KEY_REVEAL_UNTIL, 0L) > System.currentTimeMillis();
        for (int id : ids) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_balance);
            views.setOnClickPendingIntent(R.id.widget_root, openApp(context));
            if (amount == null) {
                views.setViewVisibility(R.id.widget_figure, View.GONE);
                views.setViewVisibility(R.id.widget_eye, View.GONE);
                views.setViewVisibility(R.id.widget_empty, View.VISIBLE);
            } else {
                views.setViewVisibility(R.id.widget_figure, View.VISIBLE);
                views.setViewVisibility(R.id.widget_eye, View.VISIBLE);
                views.setViewVisibility(R.id.widget_empty, View.GONE);
                views.setTextViewText(R.id.widget_amount, revealed ? amount : HIDDEN);
                views.setContentDescription(R.id.widget_amount,
                        revealed ? amount : context.getString(R.string.widget_hidden));
                views.setTextViewText(R.id.widget_stamp, stamp != null ? stamp : "");
                views.setImageViewResource(R.id.widget_eye, revealed ? R.drawable.ic_widget_eye_off : R.drawable.ic_widget_eye);
                views.setContentDescription(R.id.widget_eye,
                        context.getString(revealed ? R.string.widget_hide : R.string.widget_show));
                views.setOnClickPendingIntent(R.id.widget_eye, broadcast(context, ACTION_REVEAL));
            }
            manager.updateAppWidget(id, views);
        }
    }

    private static PendingIntent openApp(Context context) {
        Intent intent = new Intent(context, MainActivity.class)
                .setAction(Intent.ACTION_MAIN)
                .addCategory(Intent.CATEGORY_LAUNCHER)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(context, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent broadcast(Context context, String action) {
        Intent intent = new Intent(context, BalanceWidget.class).setAction(action);
        return PendingIntent.getBroadcast(context, action.hashCode(), intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /**
     * Hidden again after REVEAL_MS. An inexact alarm needs no permission; it
     * comes a little late at worst, and a tap on the eye hides it at once.
     */
    private static void scheduleHide(Context context, long at) {
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        if (alarms != null) alarms.set(AlarmManager.RTC, at, broadcast(context, ACTION_HIDE));
    }
}
