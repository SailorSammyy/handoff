# Proxy

A lightweight proxy server for streaming media. Handles HLS (`.m3u8`), MP4, subtitles, and thumbnails with CORS support and a built-in player UI for testing.

## Stack

- **Runtime**: Node.js (or Bun)

## Install

```bash
npm install
# or
bun install
```

## Setup

Copy `.env.template` to `.env` and configure:

```env
PORT=3001
ENABLE_CORS=true
ALLOWED_ORIGINS=*   # comma-separated origins, or * for all
```

## Run

```bash
npm start
# or
bun run server.js
```

Server starts at `http://localhost:<PORT>`.

## Endpoints

### `GET /api/proxy`

Proxies any media URL with automatic header injection.

```
/api/proxy?url=<encoded_url>
/api/proxy?url=<encoded_url>&origin=https://example.com
/api/proxy?url=<encoded_url>&headers={"Referer":"https://example.com"}
```

- Rewrites `.m3u8` playlists so all segment/key URLs route back through the proxy
- Rewrites thumbnail `.vtt` sprite files similarly
- Supports `Range` requests for video seeking
- Streams responses for video/audio

### `GET /api/subtitle`

Fetches and converts subtitles to VTT. Handles encrypted `.txt` / `.txt1` subtitle formats (AES-128-CBC) and plain SRT/VTT.

```
/api/subtitle?url=<encoded_subtitle_url>
```

### `GET /health`

Returns server status and CORS config.

## Site Configs

Automatic `Referer` / `Origin` / `User-Agent` headers are injected based on the target domain. Configured in `api/config.js` under `SITE_CONFIGS`:
To add a new site, copy the template block in `api/config.js` and fill in the domains and headers.

## Player UI

Visit `http://localhost:<PORT>` for the built-in tester. Supports:

- HLS and MP4 playback
- Subtitle loading (URL, file upload, or drag & drop) — VTT, SRT, ASS
- Thumbnail sprite preview
- Custom origin / headers per request
