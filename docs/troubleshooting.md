# VaultLab: "the application is not working"

## 0. Clarify first (ask, don't assume)
- What exactly fails? (page doesn't load / loads but an action fails / an error message: which one?)
- Who? One user, everyone, one device, one network?
- Since when? Did anything change (update, config, password, network)?
- Can you reproduce it, and can I?

## 1. The browser (Day 6)
- Console: red errors? (JavaScript error = front end; failed fetch = go to Network)
- Network: does the request leave? Status code? Response body? Timing?
  - (failed) / no status   -> it never got an HTTP answer: DNS, network, TLS (steps 2-4)
  - certificate warning     -> TLS (step 4)
  - 401 / 403 / 404         -> the app answered: auth, permissions, wrong URL (step 7)
  - 500                     -> the app failed: its log (step 6)
  - 502 / 504               -> nginx is up, the app behind it isn't answering (step 5)
  - 503 (health)            -> the app is up, the database isn't (step 6)

## 2. Name resolution (Day 5)
    getent hosts vaultlab.home        # what this machine resolves, hosts file included

## 3. Network and port (Days 4, 8)
    ping -c 3 vaultlab.home           # does the machine answer at all? (ICMP can be blocked)
    nc -zv vaultlab.home 443          # refused = nothing listening / timeout = firewall or down
    # on the server:
    sudo ss -tlnp                     # who listens where (127.0.0.1 vs 0.0.0.0)
    sudo ufw status numbered          # what the firewall allows

## 4. TLS (Day 13)
    curl -v https://vaultlab.home/api/health
    echo | openssl s_client -connect vaultlab.home:443 -servername vaultlab.home | openssl x509 -noout -subject -issuer -dates
    # authority (trust store) / name (SAN) / dates (expiry, clock) / protocol version

## 5. nginx (Day 13)
    systemctl status nginx
    sudo nginx -t
    sudo tail -20 /var/log/nginx/error.log    # "upstream" lines name the address nginx tried

## 6. The app and the database (Days 9, 14)
    systemctl status vaultlab-api
    sudo journalctl -u vaultlab-api -n 50 --no-pager
    systemctl status mariadb
    curl -s https://vaultlab.home/api/health   # 200 / 503 = database

## 7. Auth and permissions (Days 10, 11)
- 401: no valid session (logged out, expired, cookie not sent: Secure, domain, HTTPS?)
- 403: logged in, not allowed (role)
- 404 on an item: not the owner, or doesn't exist
- journalctl -u vaultlab-api -g 'auth|authz'

## 8. Fix, verify, explain
- Fix the cause, not the symptom. Change one thing at a time.
- Verify the way the user experiences it (the browser), not only with curl.
- Write it down: symptom, cause, fix, how to prevent it.
