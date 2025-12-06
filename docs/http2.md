# Enabling HTTP/2 for SSE Streams

## The Problem

Browsers limit HTTP/1.1 to **~6 concurrent connections per origin**. Each SSE (Server-Sent Events) stream holds an open connection, so apps with multiple streams can exhaust the connection pool. When this happens, additional streams stall waiting for a free connection.

Symptoms:
- Some streams work, others hang indefinitely
- Opening multiple browser tabs causes streams to fail
- Console shows "SSE connection stalled" warning

## The Solution

Enable HTTP/2, which multiplexes all streams over a single TCP connection with no practical limit.

### For Vite Projects

1. Install the SSL plugin:
   ```bash
   npm install -D @vitejs/plugin-basic-ssl
   ```

2. Update `vite.config.js`:
   ```js
   import { defineConfig } from "vite";
   import basicSsl from "@vitejs/plugin-basic-ssl";
   // ... your other imports

   export default defineConfig({
     plugins: [
       basicSsl(),
       // ... your other plugins
     ],
   });
   ```

3. Restart your dev server

4. Accept the self-signed certificate warning in your browser (one-time)

Your dev server will now run on `https://localhost:5173` with HTTP/2.

## Why This Works

| Protocol | Connections per Origin | SSE Streams |
|----------|----------------------|-------------|
| HTTP/1.1 | ~6 (browser limit)   | Limited     |
| HTTP/2   | 1 (multiplexed)      | Unlimited   |

HTTP/2 multiplexes all requests over a single TCP connection, eliminating the connection limit entirely.

## Verifying HTTP/2

Check your protocol in the browser's Network tab:
- Look for the "Protocol" column (may need to enable it)
- Should show `h2` instead of `http/1.1`

Or use curl:
```bash
curl -I https://localhost:5173/
# Look for: HTTP/2 200
```
