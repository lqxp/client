<div align="center">
  <img src="https://getqxchat.com/app-icon-with-name.svg" alt="QxChat logo" width="320" />

  # QxChat — Web Client

  **End-to-end encrypted messaging in the browser. No install, no account trail — open and talk.**

  [![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](./LICENSE)
  [![Vue 3](https://img.shields.io/badge/Vue-3-42b883?style=flat-square&logo=vue.js)](./src)
  [![Vite + Bun](https://img.shields.io/badge/build-Vite_%2B_Bun-f9f1e1?style=flat-square&logo=vite)](./vite.config.ts)
  [![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript)](./tsconfig.json)
  [![Web Crypto](https://img.shields.io/badge/E2EE-Web_Crypto-purple?style=flat-square)](./src/crypto)
  [![Post-Quantum](https://img.shields.io/badge/PQ-ML--KEM_%2B_SLH--DSA-9e7bea?style=flat-square)](./src/crypto)

  <a href="https://qxch.at/app"><strong>Open the app</strong></a>
  ·
  <a href="https://getqxchat.com/download">Download</a>
  ·
  <a href="https://getqxchat.com/wiki">Wiki</a>
  ·
  <a href="https://discord.wf/qxchat">Discord</a>
  ·
  <a href="https://github.com/lqxp">GitHub</a>
</div>

---

## What is this?

`lqxp/client` is the official QxChat frontend: a Vue 3 single-page app where **all encryption happens in-browser** via Web Crypto and audited PQ libraries (`@noble`). It runs hosted at [qxch.at/app](https://qxch.at/app), and it is also the UI embedded in the [desktop & mobile apps](https://github.com/lqxp/app) (Tauri) built from this exact code.

> Same code, every screen: browser tab today, native window tomorrow, keys intact.

---

## Features

- ★ **Encrypted rooms & DMs** — AES-GCM client-side, token invites, roles, threads, reactions.
- ★ **Voice calls** — WebRTC P2P audio, TURN fallback, per-user volume, noise gate.
- ★ **Device sync** — QxCloudSync pairs phone, desktop and web with a 12-word secret.
- ★ **Tor view** — live circuit map, relay directory, per-hop geo (desktop).
- ★ **Privacy modes** — client lock, RAM-only OPSEC, decoy vault, streamer mode.
- ★ **Expression** — polls, whiteboard, spoiler particles, custom themes, EN/FR/RU/ES.

---

## Hack on it

Prerequisites: Bun 1.3+.

```sh
git clone https://github.com/lqxp/client
cd client
bun install
bun run dev          # Vite dev server
bun run build        # production build + runtime config injection
bun run typecheck    # vue-tsc
```

Point it at your own server with `QXP_SERVER_ORIGIN`, `QXP_API_BASE_URL`, `QXP_WS_URL` (see [`lqxp/lqxp`](https://github.com/lqxp/lqxp) for self-hosting). Packaged builds (Tauri, Nix, stores) live in [`lqxp/app`](https://github.com/lqxp/app) — this repo stays pure web.

---

<div align="center">
  <sub>Built on Internet · Open source · No tracking</sub>
  <br />
  <a href="https://qxch.at/app">qxch.at/app</a>
  |
  <a href="https://getqxchat.com/download">download</a>
  |
  <a href="https://getqxchat.com/wiki">wiki</a>
  |
  <a href="https://discord.wf/qxchat">discord.wf/qxchat</a>
  |
  <a href="https://github.com/lqxp">github.com/lqxp</a>
</div>
