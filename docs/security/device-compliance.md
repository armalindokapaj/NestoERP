# Device compliance

`evaluateDeviceCompliance` returns state, action and reasons. Actions rank ALLOW < WARN < REQUIRE_REAUTH < REQUIRE_UPDATE < BLOCK; the highest wins.

| Condition | Action |
| --- | --- |
| Revoked / blocked device | BLOCK |
| Blocked build (`1.4.2` or `1.4.2+142`) | REQUIRE_UPDATE |
| Below minimum app version | REQUIRE_UPDATE |
| Below minimum secure version | REQUIRE_UPDATE |
| Below OS floor | BLOCK |
| Reported risk (rooted, jailbroken) | ALLOW / WARN / BLOCK by `deviceRiskPolicy` |
| Below recommended version | ALLOW with UPDATE_RECOMMENDED |

The resolver enforces it on every request (`DEVICE_REVOKED`, `DEVICE_BLOCKED`, `UPDATE_REQUIRED` with `/device-unavailable`). Client-reported risk is a hint; no root detector is shipped.
