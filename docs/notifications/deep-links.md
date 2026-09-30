# Deep links from notifications

Every in-app, push and email notification opens `/notifications/{id}/open`. That route:

1. requires a session (cold start: the app restores it first, then follows the path);
2. loads the notification among the person's own rows only;
3. for a Group-workspace user resolves the notification's company and enters it when safe (`openNotificationForWorkspace`);
4. re-reads the record through the record registry in the reader's current context;
5. marks it read and redirects to the canonical path — or answers "not available" (deleted, or access revoked), without any cached record data.

There are no native-only record URLs. Universal Links / App Links and the `safePushPath` allow-list are the MOB-08 contract (`docs/mobile/native-deep-links.md`); an unknown or newer event type still opens the same route, so older app versions cannot crash on it. Approval notifications land on the approval as it is now: a resolved approval shows its resolved state, never a stale Approve action.
