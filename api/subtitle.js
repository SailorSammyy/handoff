import { getHeadersForUrl } from './config.js';

const isNode = typeof process !== 'undefined' && process.versions != null && process.versions.node != null;

const KEYS = {
    txt:     { key: Buffer.from("8056483646328763"), iv: Buffer.from("6852612370185273") },
    txt1:    { key: Buffer.from("AmSmZVcH93UQUezi"), iv: Buffer.from("ReBKWW8cqdjPEnF6") },
    default: { key: Buffer.from("sWODXX04QRTkHdlZ"), iv: Buffer.from("8pwhapJeC4hrS9hO") },
};

function removePadding(buffer) {
    const padLength = buffer[buffer.length - 1];
    if (padLength < 1 || padLength > 16) return buffer;
    if (!buffer.slice(-padLength).every(b => b === padLength)) return buffer;
    return buffer.slice(0, -padLength);
}

function decryptLine(encryptedBase64, key, iv) {
    try {
        if (isNode) {
            const crypto = require('crypto');
            const decipher = crypto.createDecipheriv("aes-128-cbc", key, iv);
            const encrypted = Buffer.from(encryptedBase64, "base64");
            const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
            return removePadding(decrypted).toString("utf8");
        } else {
            return decryptLineWeb(encryptedBase64, key, iv);
        }
    } catch (e) {
        return "[DECRYPT ERROR]";
    }
}

async function decryptLineWeb(encryptedBase64, key, iv) {
    try {
        const encryptedData = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
        const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'AES-CBC' }, false, ['decrypt']);
        const decrypted = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: iv }, cryptoKey, encryptedData);
        const decryptedArray = new Uint8Array(decrypted);
        const padLength = decryptedArray[decryptedArray.length - 1];
        if (padLength < 1 || padLength > 16) return new TextDecoder().decode(decryptedArray);
        return new TextDecoder().decode(decryptedArray.slice(0, -padLength));
    } catch (e) {
        return "[DECRYPT ERROR]";
    }
}

function getEncryptionType(url) {
    try {
        const pathname = new URL(url).pathname;
        const ext = pathname.split(".").pop().split("?")[0];
        if (ext === "txt") return "txt";
        if (ext === "txt1") return "txt1";
        return "default";
    } catch (e) {
        return "default";
    }
}

function convertSRTtoVTT(srtContent) {
    let vttContent = 'WEBVTT\n\n';
    const blocks = srtContent.trim().split(/\r?\n\r?\n/);
    for (const block of blocks) {
        const lines = block.trim().split(/\r?\n/);
        if (lines.length >= 3) {
            const [index, timestamp, ...textLines] = lines;
            const text = textLines.join('\n');
            const vttTimestamp = timestamp.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
            vttContent += `${vttTimestamp}\n${text}\n\n`;
        }
    }
    return vttContent;
}

function parseHeadersParam(headersParam) {
    if (!headersParam) return {};
    try {
        const decoded = decodeURIComponent(headersParam);
        const parsed = JSON.parse(decoded);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed;
    } catch (e) {}
    try {
        const parsed = JSON.parse(headersParam);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed;
    } catch (e) {}
    return {};
}

async function handler(req) {
    const compatibleReq = createCompatibleRequest(req);
    const url = new URL(compatibleReq.url);
    const subtitleUrl = url.searchParams.get('url');

    if (!subtitleUrl) {
        return createCompatibleResponse('Missing url parameter', { status: 400 });
    }

    const cleanPath = subtitleUrl.split('?')[0].toLowerCase();
    if (/\.(jpg|jpeg|png|gif|webp|svg|avif|bmp|mp4|ts|m4s|key|mp3|aac|ogg|flac)$/i.test(cleanPath)) {
        return createCompatibleResponse(
            'This endpoint only handles subtitle files. Use /api/proxy for media files.',
            { status: 400, headers: { 'Content-Type': 'text/plain' } }
        );
    }

    if (/thumbnails\.vtt$/i.test(cleanPath)) {
        return createCompatibleResponse(
            'Thumbnail VTT files should be proxied via /api/proxy, not /api/subtitle.',
            { status: 400, headers: { 'Content-Type': 'text/plain' } }
        );
    }

    try {
        console.log(`[SUB] Processing: ${subtitleUrl.split('/').pop()}`);

        const type = getEncryptionType(subtitleUrl);
        const { key, iv } = KEYS[type] || KEYS.default;

        const siteHeaders = getHeadersForUrl(subtitleUrl);

        const originParam  = url.searchParams.get('origin');
        const headersParam = url.searchParams.get('headers');
        const customHeaders = parseHeadersParam(headersParam);

        if (originParam) {
            customHeaders['Origin'] = originParam;
            if (!customHeaders['Referer']) customHeaders['Referer'] = originParam;
        }

        const fetchHeaders = { ...siteHeaders, ...customHeaders };

        const response = await fetch(subtitleUrl, {
            headers: fetchHeaders,
            redirect: 'follow',
            cache: 'no-store',
        });

        if (!response.ok) {
            console.error(`[SUB] Upstream error ${response.status} for: ${subtitleUrl}`);
            console.error(`[SUB] Headers used:`, fetchHeaders);

            let hint = 'Check if the URL is correct.';
            if (response.status === 403) {
                hint = 'Access denied. Try adding &origin=https://example.com or &headers={"Referer":"https://example.com"} to the request.';
            } else if (response.status === 404) {
                hint = 'The subtitle file was not found at this URL.';
            }
            throw new Error(`Upstream ${response.status} — ${hint}`);
        }

        const rawData = await response.text();

        const blocks = rawData.trim().split(/\r?\n\r?\n/);
        const result = [];
        let hasEncryptedBlocks = false;

        for (let i = 0; i < blocks.length; i++) {
            const block = blocks[i];
            const lines = block.split(/\r?\n/);

            if (lines.length >= 3) {
                const [index, timestamp, ...encryptedLines] = lines;
                const payload = encryptedLines.join("");

                if (payload && !payload.includes(" ") && /^[A-Za-z0-9+/=]+$/.test(payload)) {
                    hasEncryptedBlocks = true;
                    const decrypted = decryptLine(payload, key, iv);
                    result.push(`${index}\n${timestamp}\n${decrypted}`);
                } else {
                    result.push(block);
                }
            } else {
                result.push(block);
            }
        }

        let finalContent;
        if (hasEncryptedBlocks) {
            console.log(`[SUB] Decrypted ${type} content`);
            const decryptedSRT = result.join("\n\n");
            finalContent = convertSRTtoVTT(decryptedSRT);
        } else {
            console.log(`[SUB] Plain content (no encryption detected)`);
            if (rawData.trimStart().startsWith('WEBVTT')) {
                finalContent = rawData;
            } else {
                finalContent = convertSRTtoVTT(rawData);
            }

            if (finalContent.includes('[DECRYPT ERROR]')) {
                console.log('[SUB] Decryption produced errors — returning original content as VTT');
                if (rawData.trimStart().startsWith('WEBVTT')) {
                    finalContent = rawData;
                } else {
                    finalContent = convertSRTtoVTT(rawData);
                }
            }
        }

        return createCompatibleResponse(finalContent, {
            status: 200,
            headers: {
                'Content-Type': 'text/vtt; charset=utf-8',
                'Cache-Control': 'public, max-age=3600',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Range',
            }
        });

    } catch (error) {
        console.error('[SUB] Error:', error.message);
        return createCompatibleResponse(JSON.stringify({
            status: 'error',
            message: error.message,
            url: subtitleUrl,
        }, null, 2), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

function createCompatibleRequest(req) {
    if (isNode) {
        let fullUrl = req.url ?? '';
        if (!fullUrl.startsWith('http')) {
            const protocol = req.headers['x-forwarded-proto'] || (req.socket?.encrypted ? 'https' : 'http');
            const host = req.headers.host || 'localhost:3000';
            fullUrl = `${protocol}://${host}${fullUrl}`;
        }
        return {
            url: fullUrl,
            headers: {
                get: (name) => req.headers[name.toLowerCase()] ?? null,
                has: (name) => !!req.headers[name.toLowerCase()]
            }
        };
    }
    return req;
}

function createCompatibleResponse(body, options = {}) {
    if (isNode) {
        return {
            body,
            status: options.status || 200,
            headers: options.headers || {},
            send: function(res) {
                res.writeHead(this.status, this.headers);
                res.end(this.body);
            }
        };
    }
    return new Response(body, options);
}

function expressMiddleware(req, res) {
    handler(req).then(result => {
        if (result && result.send) {
            result.send(res);
        } else if (result && result.body) {
            res.writeHead(result.status || 200, result.headers || {});
            res.end(result.body);
        }
    }).catch(err => {
        console.error('Subtitle handler error:', err);
        if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'error', message: 'Internal Server Error' }));
        }
    });
}

export const config = { runtime: 'edge' };
export default handler;
export { expressMiddleware };