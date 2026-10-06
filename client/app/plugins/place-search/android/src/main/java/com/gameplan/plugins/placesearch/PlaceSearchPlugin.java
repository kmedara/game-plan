package com.gameplan.plugins.placesearch;

import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Bundle;
import androidx.annotation.NonNull;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.maps.model.LatLng;
import com.google.android.libraries.places.api.Places;
import com.google.android.libraries.places.api.model.AutocompletePrediction;
import com.google.android.libraries.places.api.model.AutocompleteSessionToken;
import com.google.android.libraries.places.api.model.Place;
import com.google.android.libraries.places.api.net.FetchPlaceRequest;
import com.google.android.libraries.places.api.net.FindAutocompletePredictionsRequest;
import com.google.android.libraries.places.api.net.PlacesClient;
import java.util.Arrays;
import java.util.List;

/**
 * Google Places SDK autocomplete for Android.
 *
 * Reads the API key from the app manifest meta-data
 * `com.google.android.geo.API_KEY`.
 */
@CapacitorPlugin(name = "PlaceSearch")
public class PlaceSearchPlugin extends Plugin {

    private PlacesClient placesClient;
    private AutocompleteSessionToken sessionToken;
    private boolean placesReady = false;
    private String initError;

    @Override
    public void load() {
        try {
            String apiKey = readApiKey();
            if (apiKey == null || apiKey.isEmpty() || "REPLACE_ME".equals(apiKey)) {
                initError = "missing_google_maps_api_key";
                return;
            }
            if (!Places.isInitialized()) {
                Places.initializeWithNewPlacesApiEnabled(getContext(), apiKey);
            }
            placesClient = Places.createClient(getContext());
            sessionToken = AutocompleteSessionToken.newInstance();
            placesReady = true;
        } catch (Exception error) {
            initError = error.getMessage() != null ? error.getMessage() : "places_init_failed";
        }
    }

    @PluginMethod
    public void autocomplete(PluginCall call) {
        if (!ensureReady(call)) {
            return;
        }

        String query = call.getString("query", "").trim();
        if (query.isEmpty()) {
            JSObject result = new JSObject();
            result.put("suggestions", new JSArray());
            call.resolve(result);
            return;
        }

        FindAutocompletePredictionsRequest request = FindAutocompletePredictionsRequest
            .builder()
            .setSessionToken(sessionToken)
            .setQuery(query)
            .build();

        placesClient
            .findAutocompletePredictions(request)
            .addOnSuccessListener(response -> {
                JSArray suggestions = new JSArray();
                List<AutocompletePrediction> predictions = response.getAutocompletePredictions();
                for (AutocompletePrediction prediction : predictions) {
                    String id = prediction.getPlaceId();
                    JSObject row = new JSObject();
                    row.put("id", id);
                    row.put("primaryText", prediction.getPrimaryText(null).toString());
                    CharSequence secondary = prediction.getSecondaryText(null);
                    if (secondary != null && secondary.length() > 0) {
                        row.put("secondaryText", secondary.toString());
                    }
                    suggestions.put(row);
                }
                JSObject result = new JSObject();
                result.put("suggestions", suggestions);
                call.resolve(result);
            })
            .addOnFailureListener(error -> rejectPlacesError(call, error));
    }

    @PluginMethod
    public void resolve(PluginCall call) {
        if (!ensureReady(call)) {
            return;
        }

        String id = call.getString("id");
        if (id == null || id.isEmpty()) {
            call.reject("unknown_suggestion");
            return;
        }

        List<Place.Field> fields = Arrays.asList(
            Place.Field.ID,
            Place.Field.DISPLAY_NAME,
            Place.Field.FORMATTED_ADDRESS,
            Place.Field.LOCATION
        );
        FetchPlaceRequest request = FetchPlaceRequest
            .builder(id, fields)
            .setSessionToken(sessionToken)
            .build();

        placesClient
            .fetchPlace(request)
            .addOnSuccessListener(response -> {
                Place place = response.getPlace();
                LatLng location = place.getLocation();
                if (location == null) {
                    call.reject("place_not_found");
                    return;
                }

                String name = place.getDisplayName() != null ? place.getDisplayName() : "";
                String address = place.getFormattedAddress() != null ? place.getFormattedAddress() : "";
                String label = buildLabel(name, address);

                JSObject result = new JSObject();
                result.put("label", label);
                result.put("latitude", location.latitude);
                result.put("longitude", location.longitude);
                call.resolve(result);

                // Start a new billing session after a successful selection.
                sessionToken = AutocompleteSessionToken.newInstance();
            })
            .addOnFailureListener(error -> rejectPlacesError(call, error));
    }

    /**
     * Ensures the Places client finished initializing.
     *
     * @param call - The Capacitor call to reject when Places is not ready.
     * @return True when the client can run queries.
     */
    private boolean ensureReady(PluginCall call) {
        if (placesReady && placesClient != null) {
            return true;
        }
        call.reject(initError != null ? initError : "places_not_ready");
        return false;
    }

    /**
     * Reads the Maps/Places API key from the host app manifest.
     *
     * @return The key string, or null when missing.
     */
    private String readApiKey() throws PackageManager.NameNotFoundException {
        ApplicationInfo info = getContext()
            .getPackageManager()
            .getApplicationInfo(getContext().getPackageName(), PackageManager.GET_META_DATA);
        Bundle meta = info.metaData;
        if (meta == null) {
            return null;
        }
        return meta.getString("com.google.android.geo.API_KEY");
    }

    /**
     * Builds a display label from place name and formatted address.
     *
     * @param name - The place display name.
     * @param address - The formatted address.
     * @return A single label string.
     */
    private static String buildLabel(@NonNull String name, @NonNull String address) {
        String trimmedName = name.trim();
        String trimmedAddress = address.trim();
        if (!trimmedName.isEmpty() && !trimmedAddress.isEmpty() && !trimmedAddress.contains(trimmedName)) {
            return trimmedName + ", " + trimmedAddress;
        }
        if (!trimmedName.isEmpty()) {
            return trimmedName;
        }
        if (!trimmedAddress.isEmpty()) {
            return trimmedAddress;
        }
        return "Selected place";
    }

    /**
     * Maps Places SDK failures to Capacitor rejections.
     *
     * @param call - The active plugin call.
     * @param error - The failure from the Places client.
     */
    private static void rejectPlacesError(PluginCall call, Exception error) {
        if (error instanceof ApiException) {
            call.reject(((ApiException) error).getStatusMessage());
            return;
        }
        call.reject(error.getMessage() != null ? error.getMessage() : "places_request_failed");
    }
}
