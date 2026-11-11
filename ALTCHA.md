# Self-hosted ALTCHA

CAPTCHA is optional by default. `CAPTCHA_ENFORCEMENT_ENABLED` must remain `false` in the current deployment. The login API retains the existing `captchaToken` field. Both login forms can submit without waiting for the widget.

For an isolated test, configure two different cryptographically random secrets of at least 32 characters in the server environment: `ALTCHA_HMAC_SECRET` for ips.ipecgroup.net and `ALTCHA_HMAC_SECRET_INTERNAL` for ips.ipec.com. Never commit them. Generate each with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. All backend replicas for a given hostname must share that hostname's secret. Local non-production localhost uses `ALTCHA_HMAC_SECRET`.

The Compose configuration supplies `CAPTCHA_REDIS_URL` pointing to the private `captcha-store` service. Its persistent volume supports shared atomic replay checks. Protect the Redis network and volume, ensure a single shared store for all app replicas, and monitor persistence and availability. The challenge endpoint rate limit uses the trusted proxy's `X-Real-IP`; block direct public access to the app and ensure the proxy overwrites that header. The existing `/api` proxy covers `/api/captcha/challenge`. Each signed challenge expires after five minutes and is returned with `Cache-Control: no-store`.

Build the frontend with `VITE_CAPTCHA_WIDGET_ENABLED=true` to display the optional widget; the Compose compatibility overlay `compose.arcaptcha.yml` passes this build argument. This does not enable backend enforcement. The widget and worker are packaged locally; the backend does not contact a CAPTCHA provider. Ensure the deployment's CSP permits the widget's bundled styles and blob worker.

Only after a separate authorization and isolated end-to-end testing, build with the widget enabled and set `CAPTCHA_ENFORCEMENT_ENABLED=true` on all app instances. In that mode unavailable or replayed CAPTCHA fails closed. Test Redis failover/persistence and browser behavior before activation. Restore false to make CAPTCHA optional again.
