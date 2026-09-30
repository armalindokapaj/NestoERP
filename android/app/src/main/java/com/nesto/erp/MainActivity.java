package com.nesto.erp;

import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // MOB-11 §46, §100: the recents (app switcher) thumbnail would show whatever was on screen — Finance, HR,
        // a contract. From Android 13 an app can opt out of that preview without blocking screenshots or recording
        // anywhere else. Older versions have no equivalent that does not also block screenshots, so there the
        // preview is hidden only on sensitive surfaces (FLAG_SECURE via the privacy plugin); see
        // docs/security/biometric-security.md.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            setRecentsScreenshotEnabled(false);
        }
    }
}
