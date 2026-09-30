# Deep links (MOB-08 §27-§31, §52, §53)

The URL model is the ordinary NESTO URL model: `https://<prod origin>/projects/:id`, `/tasks/:id`, `/units/:id`, `/approvals/:id`. No custom scheme.

## Verification files (served by the app itself)

| Platform | Route | Config |
| --- | --- | --- |
| iOS Universal Links | `/.well-known/apple-app-site-association` | `NESTO_IOS_TEAM_ID` (10 chars), optional `NESTO_IOS_BUNDLE_ID` |
| Android App Links | `/.well-known/assetlinks.json` | `NESTO_ANDROID_SHA256_CERTS` (comma-separated SHA-256 of the **Play App Signing** and upload/release certificates), optional `NESTO_ANDROID_PACKAGE` |

Both answer **404 until configured** — a half-configured file would claim links that cannot verify. Both are public routes (`PUBLIC_OPERATIONAL_ROUTES`). iOS entitlement `applinks:<host>` and the Android `autoVerify` intent filter are written by `scripts/native/configure.ts` from the same origin the shell loads.

## Resolution

```
tap link → OS opens app → appUrlOpen → resolveDeepLink(url)
        → router.push(path)  → middleware (session) → route's requireModule()/record checks
```

- Only URLs on the NESTO origin resolve, and only to `path?query#hash`. `/api/*` and `/_next/*` never do.
- A link never grants access: an unauthenticated user lands on `/login?callbackUrl=…` and continues to the link after sign-in; an unauthorised one gets the route's normal not-found/forbidden page. The shell caches no protected content.
- Without the app installed the same URL opens in the browser and resolves the same way.

## In-app navigation policy

`server.allowNavigation` lists the NESTO host only. `ExternalLinkService.open()` routes everything else: NESTO → in-app, `https` elsewhere → system browser (`@capacitor/browser`), `tel:`/`mailto:` → the OS handler, anything else (including `javascript:`, `file:`, plain `http`) is refused. `classifyLink` is unit-tested.
