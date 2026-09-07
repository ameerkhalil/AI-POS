# Station agent

A browser can't talk to a USB receipt printer or a cash drawer. This can.

Run it on the machine the register is on. It listens on `127.0.0.1:9110` and nothing else.

```bash
cd agent
node agent.js
```

No `npm install` — it uses only Node's built-ins, so it starts on a counter PC with
no toolchain.

## Pairing a printer

Easiest path is a network printer (Epson TM-m30III Ethernet, Star TSP143 LAN). Print the
printer's self-test to get its IP, then in the terminal go to **Config → Hardware &
payments → Scan for printers**. It sweeps your subnet for anything answering on port 9100.

Or set it by hand in `station.json` next to `agent.js`:

```json
{ "mode": "network", "printer": "192.168.1.50", "port": 9100, "width": 42, "drawer": true }
```

`width` is the column count for your paper — 42 for 80mm, 32 for 58mm.

### USB printer on Windows

Share the printer (Printer properties → Sharing → share as `RECEIPT`), then:

```json
{ "mode": "share", "share": "\\\\localhost\\RECEIPT", "width": 42 }
```

## The cash drawer

The drawer plugs into the **printer**, not the computer. It opens when the printer
receives a kick code, so opening it is a print job with no paper. If receipts print but
the drawer won't open, the cable between printer and drawer is the thing to check.

## Endpoints

| Route | What it does |
| --- | --- |
| `GET /status` | Whether an agent is running and a printer is set |
| `GET /discover` | Sweeps the subnet for printers on port 9100 |
| `POST /config` | Sets printer address, width, mode |
| `POST /print` | Prints a receipt document |
| `POST /drawer` | Kicks the drawer |
| `POST /test` | Prints a test receipt |

## Running it at boot

**Windows** — `shell:startup`, then a shortcut to:
`node "C:\AI POS\aipos\agent\agent.js"`

**Linux** — a systemd unit with `Restart=always`.
