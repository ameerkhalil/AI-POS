# AI POS

A point-of-sale terminal that configures itself from a short interview, then keeps
everything on a server under a real account.

Same stack you already run: Node + Express + better-sqlite3, one persistent disk,
deployed by `git push`.

## Running it locally

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...
npm start
# http://localhost:3000
```

Create an account, answer the five setup questions, and the terminal builds itself.
The default cashier codes are 1234 (manager), 2222 (shift lead), 1111 (cashier) —
change them under Config → People before anyone else touches it.

## Deploying to Render

1. Push this to a new GitHub repo.
2. New → Web Service, point it at the repo.
   - Build command: `npm install`
   - Start command: `npm start`
3. Add a **persistent disk**, mounted at `/data`. Without one, every deploy wipes
   the database — Render's normal filesystem is ephemeral.
4. Environment:
   - `ANTHROPIC_API_KEY` — required for the AI features
   - `DATA_DIR` — `/data`
   - `NODE_ENV` — `production` (this is what makes the session cookie Secure)

`GET /healthz` returns `{ok:true, ai:true}` once the key is set.

## Why the API key lives here

The browser never sees it. Every AI call goes to `POST /api/ai`, which attaches the
key, pins the model, caps `max_tokens`, allows only the web-search tool through, rate
limits to 40 calls a minute per account, and logs token usage to the `ai_calls` table.

A key in front-end JavaScript is a key anyone can read and spend. This is the only
reason the server exists at minimum — everything else it does is a bonus.

## Layout

```
server.js          auth, config, shifts, sales, AI proxy, static hosting
lib/db.js          schema and connection
lib/persist.js     browser side: loads and saves config, posts sales
public/login.html  account sign in and sign up
public/app.html    the terminal itself (built — see below)
shell.html         HTML frame used by the build
build.py           assembles public/app.html from ../pos/*
```

`public/app.html` is generated. The sources live in `../pos/` (`style.css`, `app.js`,
`pricing.js`, `theme.js`, `config.js`). Edit those, then:

```bash
python3 build.py
```

Keeping it a build step is what lets the same terminal code run both standalone and
against this server — the build swaps the direct API call for `/api/ai` and patches in
the persistence hooks.

## Data model

`accounts` → `stores` → `configs`, `shifts`, `sales`

One account per business, many stores under it. The whole POS configuration is a JSON
blob per store: pricebook, departments, menus, tax rates, tenders, modifiers, staff,
permissions, reason codes, appearance. It is read and written whole, it is small, and
its shape is still moving. Normalise it once it stops.

Sales are stored twice over — as a row with the columns you actually query
(`store_id`, `at`, `total`, `is_return`) and as the full JSON. That way reports stay
fast without locking the receipt format down.

## Offline

The terminal takes sales with no network at all.

- `public/sw.js` caches the shell, so the page loads cold with the ISP down. API
  requests are never cached — a stale pricebook is worse than no answer.
- `lib/offline.js` holds an IndexedDB queue. Every completed sale is written to the
  device *before* it is sent anywhere.
- Every sale carries a client-generated id. `POST /api/sync` inserts on that id, so a
  queued batch replayed after a reconnection lands exactly once. This is the difference
  between a flaky connection and a double charge.
- The queue only clears records the server confirms. A flush that dies halfway leaves
  the rest queued.
- Connection state comes from an actual request to `/api/ping`, not `navigator.onLine`,
  which reports true on café Wi-Fi that has associated but isn't routing.
- The pricebook is cached locally on every save, so a terminal that has been set up once
  will open and sell even after a cold boot with no network.

Closing a shift flushes the queue first, so a Z read never omits held sales.

## Card payments

Stripe Terminal, server-driven. The server creates a PaymentIntent and tells the reader
to collect it; the terminal polls for the result. The browser never handles card data and
never loads the Stripe SDK, and a register that reloads mid-transaction doesn't lose it —
the reader and the intent both still exist.

Set it up in **Config → Hardware & payments**. Paste a Stripe secret key (use a `sk_test_`
one first), then either pair a real reader with its pairing code or create a simulated one
and run the whole flow with no hardware in the room.

Two deliberate choices:

- **Capture happens after the sale is written down.** A crash between authorisation and
  recording leaves an authorisation that expires on its own, rather than a charge with no
  receipt behind it.
- **Card tenders disable themselves when offline.** No terminal can authorise a card
  without reaching a processor. The buttons grey out and say why; cash still works.

The Stripe key lives in `store_settings` on the server and is never sent to a browser.

## Printer and cash drawer

See `agent/README.md`. Short version: run `node agent.js` on the terminal, pair a printer
from Config → Hardware, and receipts print to till roll while the drawer opens on cash
sales and on a logged no-sale. With no agent running, receipts fall back to the browser's
print dialogue.

## What to build next

**Subscription billing.** Stripe Checkout plus a trial, the same shape as any SaaS.

**Fleet visibility.** When a register dies at 2am you need that store's logs without
asking someone to read an error message down the phone.

**Multi-terminal.** Two registers on one pricebook, sharing a shift and a journal.
