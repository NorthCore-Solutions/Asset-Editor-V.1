package de.northcore.asseteditor;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.IOException;
import java.io.OutputStream;

@CapacitorPlugin(name = "NativeFileDialog")
public class NativeFileDialogPlugin extends Plugin {

    @PluginMethod
    public void saveFile(PluginCall call) {
        String fileName = call.getString("fileName");
        String mimeType = call.getString("mimeType", "application/octet-stream");
        String base64 = call.getString("base64");

        if (fileName == null || fileName.isBlank()) {
            call.reject("Dateiname fehlt.");
            return;
        }
        if (base64 == null) {
            call.reject("Dateidaten fehlen.");
            return;
        }

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType);
        intent.putExtra(Intent.EXTRA_TITLE, fileName);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
        );

        startActivityForResult(call, intent, "saveFileResult");
    }

    @ActivityCallback
    private void saveFileResult(PluginCall call, ActivityResult result) {
        if (call == null) return;

        Intent data = result.getData();
        Uri uri = data == null ? null : data.getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            JSObject cancelled = new JSObject();
            cancelled.put("cancelled", true);
            call.resolve(cancelled);
            return;
        }

        persistUriPermission(uri, data);

        try {
            writeBase64(uri, call.getString("base64"));
            JSObject response = new JSObject();
            response.put("cancelled", false);
            response.put("uri", uri.toString());
            response.put("name", resolveDisplayName(uri, call.getString("fileName", "Datei")));
            call.resolve(response);
        } catch (Exception error) {
            call.reject("Datei konnte nicht gespeichert werden: " + safeMessage(error));
        }
    }

    @PluginMethod
    public void writeFile(PluginCall call) {
        String uriValue = call.getString("uri");
        String base64 = call.getString("base64");

        if (uriValue == null || uriValue.isBlank()) {
            call.reject("Dateipfad fehlt.");
            return;
        }
        if (base64 == null) {
            call.reject("Dateidaten fehlen.");
            return;
        }

        try {
            writeBase64(Uri.parse(uriValue), base64);
            call.resolve();
        } catch (Exception error) {
            call.reject("Datei konnte nicht überschrieben werden: " + safeMessage(error));
        }
    }

    private void persistUriPermission(Uri uri, Intent data) {
        int flags = data.getFlags()
            & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        if (flags == 0) return;

        try {
            getContext().getContentResolver().takePersistableUriPermission(uri, flags);
        } catch (SecurityException ignored) {
            // Manche Dateianbieter gewähren nur eine temporäre Berechtigung.
        }
    }

    private void writeBase64(Uri uri, String base64) throws IOException {
        if (base64 == null) throw new IOException("Dateidaten fehlen.");

        byte[] bytes;
        try {
            bytes = Base64.decode(base64, Base64.DEFAULT);
        } catch (IllegalArgumentException error) {
            throw new IOException("Dateidaten sind ungültig.", error);
        }

        ContentResolver resolver = getContext().getContentResolver();
        OutputStream stream = resolver.openOutputStream(uri, "wt");
        if (stream == null) throw new IOException("Datei konnte nicht geöffnet werden.");

        try (OutputStream output = stream) {
            output.write(bytes);
            output.flush();
        }
    }

    private String resolveDisplayName(Uri uri, String fallback) {
        ContentResolver resolver = getContext().getContentResolver();
        try (Cursor cursor = resolver.query(
            uri,
            new String[] { OpenableColumns.DISPLAY_NAME },
            null,
            null,
            null
        )) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) {
                    String name = cursor.getString(index);
                    if (name != null && !name.isBlank()) return name;
                }
            }
        } catch (Exception ignored) {
            // Der gewählte Dateianbieter muss keinen Anzeigenamen liefern.
        }
        return fallback;
    }

    private String safeMessage(Exception error) {
        String message = error.getMessage();
        return message == null || message.isBlank() ? error.getClass().getSimpleName() : message;
    }
}
