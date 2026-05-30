package com.jusur.call;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

public class IncomingCallMessagingService extends FirebaseMessagingService {
    private static final String CHANNEL_ID = "incoming_calls";
    private static final String EXTRA_CALL_ID = "call_id";
    private static final String EXTRA_JUSUR_ACTION = "jusur_action";
    private static final String ACTION_OPEN = "open";
    private static final String ACTION_ANSWER = "answer";
    private static final String ACTION_DECLINE = "decline";

    @Override
    public void onMessageReceived(RemoteMessage message) {
        String type = message.getData().get("type");
        if (!"incoming_call".equals(type)) {
            return;
        }

        String callerName = message.getData().get("callerName");
        if (callerName == null || callerName.isEmpty()) {
            callerName = "Jusur caller";
        }

        String callId = message.getData().get("callId");
        showIncomingCall(callerName, callId);
    }

    private void showIncomingCall(String callerName, String callId) {
        createChannel();
        wakeScreenBriefly();

        PendingIntent pendingIntent = buildCallPendingIntent(ACTION_OPEN, callId, 1001);
        PendingIntent answerIntent = buildCallPendingIntent(ACTION_ANSWER, callId, 1002);
        PendingIntent declineIntent = buildCallPendingIntent(ACTION_DECLINE, callId, 1003);

        Uri ringtone = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(getApplicationInfo().icon)
            .setContentTitle("Incoming Jusur call")
            .setContentText(callerName + " is calling you")
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setSound(ringtone)
            .setVibrate(new long[]{0, 700, 350, 700, 350, 700})
            .setOngoing(true)
            .setAutoCancel(false)
            .setContentIntent(pendingIntent)
            .setFullScreenIntent(pendingIntent, true)
            .addAction(android.R.drawable.sym_call_incoming, "Answer", answerIntent)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Decline", declineIntent);

        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        manager.notify(1001, builder.build());
    }

    private PendingIntent buildCallPendingIntent(String action, String callId, int requestCode) {
        Intent intent = new Intent(this, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        intent.putExtra(EXTRA_JUSUR_ACTION, action);
        if (callId != null) {
            intent.putExtra(EXTRA_CALL_ID, callId);
        }

        return PendingIntent.getActivity(
            this,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private void wakeScreenBriefly() {
        PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (powerManager == null) {
            return;
        }

        PowerManager.WakeLock wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP,
            "Jusur:IncomingCallWakeLock"
        );
        wakeLock.acquire(10000);
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }

        Uri ringtone = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        AudioAttributes audioAttributes = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();

        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Incoming calls",
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Full-screen alerts for incoming Jusur calls");
        channel.enableVibration(true);
        channel.setSound(ringtone, audioAttributes);
        channel.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);

        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        manager.createNotificationChannel(channel);
    }
}
