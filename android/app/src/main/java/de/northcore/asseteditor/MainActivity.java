package de.northcore.asseteditor;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeFileDialogPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
