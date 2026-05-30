package com.jusur.call;

import android.Manifest;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.ContactsContract;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.HashSet;
import java.util.Set;

@CapacitorPlugin(
    name = "JusurNative",
    permissions = {
        @Permission(strings = { Manifest.permission.READ_CONTACTS }, alias = "contacts")
    }
)
public class JusurNativePlugin extends Plugin {
    private static final String EXTRA_CALL_ID = "call_id";
    private static final String EXTRA_JUSUR_ACTION = "jusur_action";

    @PluginMethod
    public void getContacts(PluginCall call) {
        if (getPermissionState("contacts") != com.getcapacitor.PermissionState.GRANTED) {
            requestPermissionForAlias("contacts", call, "contactsPermissionCallback");
            return;
        }

        resolveContacts(call);
    }

    @PermissionCallback
    private void contactsPermissionCallback(PluginCall call) {
        if (getPermissionState("contacts") != com.getcapacitor.PermissionState.GRANTED) {
            call.reject("Contacts permission was not granted.");
            return;
        }

        resolveContacts(call);
    }

    private void resolveContacts(PluginCall call) {
        JSArray contacts = new JSArray();
        Set<String> seenEmails = new HashSet<>();
        String[] projection = new String[] {
            ContactsContract.CommonDataKinds.Email.CONTACT_ID,
            ContactsContract.CommonDataKinds.Email.DISPLAY_NAME,
            ContactsContract.CommonDataKinds.Email.ADDRESS,
            ContactsContract.CommonDataKinds.Email.PHOTO_URI
        };

        try (Cursor cursor = getContext().getContentResolver().query(
            ContactsContract.CommonDataKinds.Email.CONTENT_URI,
            projection,
            null,
            null,
            ContactsContract.CommonDataKinds.Email.DISPLAY_NAME + " ASC"
        )) {
            if (cursor != null) {
                int idIndex = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Email.CONTACT_ID);
                int nameIndex = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Email.DISPLAY_NAME);
                int emailIndex = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Email.ADDRESS);
                int photoIndex = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Email.PHOTO_URI);

                while (cursor.moveToNext()) {
                    String email = cursor.getString(emailIndex);
                    if (email == null || email.trim().isEmpty()) {
                        continue;
                    }

                    String normalizedEmail = email.trim().toLowerCase();
                    if (seenEmails.contains(normalizedEmail)) {
                        continue;
                    }
                    seenEmails.add(normalizedEmail);

                    String name = cursor.getString(nameIndex);
                    String photoUri = photoIndex >= 0 ? cursor.getString(photoIndex) : "";

                    JSObject item = new JSObject();
                    item.put("resourceName", "android-contact-" + cursor.getString(idIndex) + "-" + normalizedEmail);
                    item.put("name", name == null || name.trim().isEmpty() ? email : name);
                    item.put("email", email.trim());
                    item.put("photoUrl", photoUri == null ? "" : photoUri);
                    contacts.put(item);
                }
            }

            JSObject result = new JSObject();
            result.put("contacts", contacts);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Could not read device contacts.", error);
        }
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.parse("package:" + getContext().getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void openFullScreenIntentSettings(PluginCall call) {
        Intent intent;
        if (Build.VERSION.SDK_INT >= 34) {
            intent = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
        } else {
            intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void getPendingCallAction(PluginCall call) {
        Intent intent = getActivity() == null ? null : getActivity().getIntent();
        JSObject result = new JSObject();
        if (intent == null) {
            result.put("action", "");
            result.put("callId", "");
            call.resolve(result);
            return;
        }

        String action = intent.getStringExtra(EXTRA_JUSUR_ACTION);
        String callId = intent.getStringExtra(EXTRA_CALL_ID);
        result.put("action", action == null ? "" : action);
        result.put("callId", callId == null ? "" : callId);

        intent.removeExtra(EXTRA_JUSUR_ACTION);
        intent.removeExtra(EXTRA_CALL_ID);
        call.resolve(result);
    }
}
