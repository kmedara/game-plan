package com.gameplan.app;

import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Bundle;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Exposes the Android-restricted Google Maps API key from the app manifest.
 *
 * The key stays out of the Angular environment bundle; only the native app reads it.
 */
@CapacitorPlugin(name = "MapsKey")
public class MapsKeyPlugin extends Plugin {

    /**
     * Returns the Maps SDK API key from {@code com.google.android.geo.API_KEY}.
     *
     * @param call - Capacitor call to resolve with {@code apiKey}.
     */
    @PluginMethod
    public void getAndroidMapsApiKey(PluginCall call) {
        try {
            ApplicationInfo info = getContext()
                .getPackageManager()
                .getApplicationInfo(getContext().getPackageName(), PackageManager.GET_META_DATA);
            Bundle meta = info.metaData;
            String apiKey = meta != null ? meta.getString("com.google.android.geo.API_KEY") : null;
            if (apiKey == null || apiKey.isEmpty() || apiKey.startsWith("${")) {
                call.reject("missing_google_maps_android_api_key");
                return;
            }
            JSObject result = new JSObject();
            result.put("apiKey", apiKey);
            call.resolve(result);
        } catch (Exception error) {
            call.reject(error.getMessage() != null ? error.getMessage() : "maps_key_read_failed");
        }
    }
}
