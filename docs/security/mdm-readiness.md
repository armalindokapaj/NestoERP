# MDM readiness

No MDM server is built. The device model has managed/trust fields, and policy is server-side, so managed app configuration can later seed `managed` state and the install id without changing the contract. SSO is likewise prepared: `recentAuthAt` does not assume a password.
