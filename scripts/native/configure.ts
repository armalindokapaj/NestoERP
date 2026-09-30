/**
 * Applies everything `cap sync` does not own to the native projects (MOB-08
 * §28, §29, §63, §81): version numbers, the deep-link host, entitlements,
 * permission strings and manifest entries. Idempotent — run it before every
 * `cap sync` (`pnpm native:sync`). The origin and version come from
 * `native/origins.ts` and `native/version.json`, the same inputs as
 * `capacitor.config.ts`, so the two can never disagree.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { resolveNativeOrigin } from "../../native/origins";
import version from "../../native/version.json";

const { environment, origin } = resolveNativeOrigin(process.env);
const host = new URL(origin).host;

function edit(path: string, change: (text: string) => string): void {
  const before = readFileSync(path, "utf8");
  const after = change(before);
  if (after !== before) writeFileSync(path, after);
}

// iOS ---------------------------------------------------------------------
edit("ios/App/App.xcodeproj/project.pbxproj", (text) =>
  text
    .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version.version};`)
    .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${version.iosBuild};`)
    .replace(/(PRODUCT_BUNDLE_IDENTIFIER = com\.nesto\.erp;)(?!\n\t+CODE_SIGN_ENTITLEMENTS)/g, "$1\n\t\t\t\tCODE_SIGN_ENTITLEMENTS = App/App.entitlements;"),
);

writeFileSync(
  "ios/App/App/App.entitlements",
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>aps-environment</key>
	<string>development</string>
	<key>com.apple.developer.associated-domains</key>
	<array>
		<string>applinks:${host}</string>
	</array>
</dict>
</plist>
`,
);

const PLIST_STRINGS: Record<string, string> = {
  NSCameraUsageDescription: "NESTO uses the camera when you take a photo for a task, site report or document.",
  NSPhotoLibraryUsageDescription: "NESTO reads the photos you choose to attach to a task, site report or document.",
  NSFaceIDUsageDescription: "NESTO uses Face ID to unlock the app when you turn on app lock.",
};
edit("ios/App/App/Info.plist", (text) => {
  let next = text;
  for (const [key, value] of Object.entries(PLIST_STRINGS)) {
    if (!next.includes(`<key>${key}</key>`)) next = next.replace("</dict>\n</plist>", `\t<key>${key}</key>\n\t<string>${value}</string>\n</dict>\n</plist>`);
  }
  // A development build may talk to a dev server on the local network over http.
  // The exception is present only then; any other environment removes it (§12).
  const ats = "\t<key>NSAppTransportSecurity</key>\n\t<dict>\n\t\t<key>NSAllowsLocalNetworking</key>\n\t\t<true/>\n\t</dict>\n";
  next = next.replace(ats, "");
  if (environment === "development") next = next.replace("</dict>\n</plist>", `${ats}</dict>\n</plist>`);
  return next;
});

// Android -----------------------------------------------------------------
edit("android/app/build.gradle", (text) =>
  text.replace(/versionCode \d+/, `versionCode ${version.androidBuild}`).replace(/versionName "[^"]*"/, `versionName "${version.version}"`),
);

const LINKS = `<!-- nesto:app-links -->
            <intent-filter android:autoVerify="true">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="https" android:host="${host}" />
            </intent-filter>
            <!-- /nesto:app-links -->`;
const PERMISSIONS = `<!-- nesto:permissions -->
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.USE_BIOMETRIC" />
    <!-- /nesto:permissions -->`;
edit("android/app/src/main/AndroidManifest.xml", (text) => {
  let next = text.replace(/<!-- nesto:app-links -->[\s\S]*?<!-- \/nesto:app-links -->/, LINKS);
  if (!next.includes("nesto:app-links")) next = next.replace("        </activity>", `            ${LINKS}\n\n        </activity>`);
  next = next.replace(/<!-- nesto:permissions -->[\s\S]*?<!-- \/nesto:permissions -->/, PERMISSIONS);
  if (!next.includes("nesto:permissions")) next = next.replace("</manifest>", `    ${PERMISSIONS}\n</manifest>`);
  return next;
});

console.log(`Native projects configured: v${version.version} (iOS ${version.iosBuild}, Android ${version.androidBuild}), links ${host}`);
