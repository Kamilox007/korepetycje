"""One slowapi limiter for the whole app.

Lives in its own module so routers can decorate endpoints without importing
main.py (which imports the routers - a cycle). main.py attaches it to
app.state and registers the 429 handler.

Note: behind Caddy every request carries Caddy's own address as the client
IP (uvicorn only trusts X-Forwarded-For from forwarded_allow_ips, which is
127.0.0.1 by default), so these limits are in practice global, not per IP.
Documented as a TODO in README; keep the limits loose enough for a few
parallel lessons.
"""
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
