// ======================================================================
// Cafe Push Worker - Cloudflare Workers ネイティブ実装
// web-push NPM パッケージは Node.js 固有 API に依存するため使用せず、
// Web Crypto API + fetch() のみで Web Push (RFC 8291/8292) を実装する。
// ======================================================================

// --- CORS ヘッダー ---
// ⚠️ セキュリティ向上のため、本番環境では "*" をフロントエンドのドメインに変更してください
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// --- グローバルキャッシュ ---
let cachedVapidKey = null;
let lastUsedPrivateKey = null;

// --- ユーティリティ関数群 ---
/** 購読を一意に識別するための ID を生成 (endpoint のハッシュ等) */
async function getSubscriptionId(subscription) {
  const encoder = new TextEncoder();
  const data = encoder.encode(subscription.endpoint);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return bufferToBase64url(hashBuffer);
}

/** フロントエンドのロジックを移植：次の通知時刻を計算 */
function getNextTargetDate(now, fixedTimes, cooldownMinutes) {
  const today = new Date(now);
  today.setSeconds(0, 0);
  const candidates = [];

  // 固定時刻のリセット時間を候補に追加
  for (const timeStr of fixedTimes) {
    const [h, m] = timeStr.split(':').map(Number);
    const d = new Date(today);
    d.setHours(h, m, 0, 0);
    // 既に過ぎている場合は翌日に
    if (d <= now) d.setDate(d.getDate() + 1);
    candidates.push(d);
  }

  // クールタイム経過後を候補に追加
  const cooldownDate = new Date(now.getTime() + cooldownMinutes * 60 * 1000);
  candidates.push(cooldownDate);

  // 最も早い時刻を返す
  candidates.sort((a, b) => a - b);
  return candidates[0];
}

/** Base64URL をデコードして ArrayBuffer に変換 */
function base64urlToBuffer(base64url) {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - base64.length % 4) % 4);
  const binary = atob(base64 + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/** ArrayBuffer を Base64URL エンコード */
function bufferToBase64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** VAPID JWT トークンを生成 (ES256) */
async function createVapidJwt(audience, subject, privateKeyBase64url, publicKeyBase64url) {
  const header = { alg: 'ES256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: audience,
    exp: now + 12 * 3600, // 12時間有効
    sub: subject,
  };

  const headerB64 = bufferToBase64url(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = bufferToBase64url(new TextEncoder().encode(JSON.stringify(payload)));
  const unsignedToken = `${headerB64}.${payloadB64}`;

  // 鍵をキャッシュしてパフォーマンス向上
  if (!cachedVapidKey || lastUsedPrivateKey !== privateKeyBase64url) {
    const pubKeyBytes = new Uint8Array(base64urlToBuffer(publicKeyBase64url));
    const x = bufferToBase64url(pubKeyBytes.slice(1, 33));
    const y = bufferToBase64url(pubKeyBytes.slice(33, 65));

    const jwk = {
      kty: 'EC',
      crv: 'P-256',
      x: x,
      y: y,
      d: privateKeyBase64url,
    };

    cachedVapidKey = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign']
    );
    lastUsedPrivateKey = privateKeyBase64url;
  }

  // 署名
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    cachedVapidKey,
    new TextEncoder().encode(unsignedToken)
  );

  const signatureB64 = bufferToBase64url(signature);
  return `${unsignedToken}.${signatureB64}`;
}

/** Web Push ペイロードを暗号化 (RFC 8291: aes128gcm) */
async function encryptPayload(subscription, payloadText) {
  const payload = new TextEncoder().encode(payloadText);

  // クライアントの公開鍵と認証シークレットを取得
  const clientPublicKeyBuffer = base64urlToBuffer(subscription.keys.p256dh);
  const authSecretBuffer = base64urlToBuffer(subscription.keys.auth);

  // サーバー側の一時鍵ペアを生成
  const serverKeys = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );

  // サーバー公開鍵をエクスポート
  const serverPublicKeyBuffer = await crypto.subtle.exportKey('raw', serverKeys.publicKey);

  // クライアント公開鍵をインポート
  const clientPublicKey = await crypto.subtle.importKey(
    'raw',
    clientPublicKeyBuffer,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  // ECDH 共有シークレットを導出
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: clientPublicKey },
    serverKeys.privateKey,
    256
  );

  // --- RFC 8291 に基づく鍵導出 ---

  // PRK (Pseudo-Random Key) を導出: HKDF-Extract(auth_secret, shared_secret)
  const authKey = await crypto.subtle.importKey(
    'raw', authSecretBuffer, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const prkBuffer = await crypto.subtle.sign('HMAC', authKey, sharedSecret);

  // info for key derivation
  // "WebPush: info\0" + client_public_key + server_public_key
  const keyInfoHeader = new TextEncoder().encode('WebPush: info\0');
  const keyInfo = new Uint8Array(keyInfoHeader.length + clientPublicKeyBuffer.byteLength + serverPublicKeyBuffer.byteLength);
  keyInfo.set(new Uint8Array(keyInfoHeader), 0);
  keyInfo.set(new Uint8Array(clientPublicKeyBuffer), keyInfoHeader.length);
  keyInfo.set(new Uint8Array(serverPublicKeyBuffer), keyInfoHeader.length + clientPublicKeyBuffer.byteLength);

  // IKM (Input Keying Material) を導出: HKDF-Expand(PRK, info, 32)
  const ikm = await hkdfExpand(prkBuffer, keyInfo, 32);

  // salt (16バイトのランダム値)
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // PRK for content encryption: HKDF-Extract(salt, IKM)
  const saltKey = await crypto.subtle.importKey(
    'raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const contentPrk = await crypto.subtle.sign('HMAC', saltKey, ikm);

  // Content Encryption Key (CEK): HKDF-Expand(content_prk, "Content-Encoding: aes128gcm\0", 16)
  const cekInfo = new TextEncoder().encode('Content-Encoding: aes128gcm\0');
  const cek = await hkdfExpand(contentPrk, cekInfo, 16);

  // Nonce: HKDF-Expand(content_prk, "Content-Encoding: nonce\0", 12)
  const nonceInfo = new TextEncoder().encode('Content-Encoding: nonce\0');
  const nonce = await hkdfExpand(contentPrk, nonceInfo, 12);

  // --- AES-128-GCM 暗号化 ---
  const aesKey = await crypto.subtle.importKey(
    'raw', cek, { name: 'AES-GCM' }, false, ['encrypt']
  );

  // パディング: レコードの最初に delimiter \x02 を付加
  const paddedPayload = new Uint8Array(payload.length + 1);
  paddedPayload.set(payload);
  paddedPayload[payload.length] = 2; // delimiter

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, tagLength: 128 },
    aesKey,
    paddedPayload
  );

  // --- aes128gcm ヘッダー構築 ---
  // salt (16) + rs (4, big-endian uint32) + idlen (1) + keyid (65 = uncompressed P-256 point)
  const rs = payload.length + 1 + 16; // record size = payload + padding + tag
  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  const rsView = new DataView(header.buffer, 16, 4);
  rsView.setUint32(0, 4096); // standard record size
  header[20] = 65; // keyid length
  header.set(new Uint8Array(serverPublicKeyBuffer), 21);

  // 最終的なボディ: header + encrypted data
  const body = new Uint8Array(header.length + encrypted.byteLength);
  body.set(header);
  body.set(new Uint8Array(encrypted), header.length);

  return body;
}

/** HKDF-Expand (RFC 5869)  */
async function hkdfExpand(prk, info, length) {
  const key = await crypto.subtle.importKey(
    'raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );

  // T(1) = HMAC-Hash(PRK, info || 0x01)
  const input = new Uint8Array(info.length + 1);
  input.set(new Uint8Array(info instanceof ArrayBuffer ? new Uint8Array(info) : info));
  input[info.length] = 1;

  const result = await crypto.subtle.sign('HMAC', key, input);
  return new Uint8Array(result).slice(0, length);
}

/** Web Push 通知を送信する */
async function sendPushNotification(subscription, payloadText, vapidPublicKey, vapidPrivateKey, vapidSubject) {
  const endpoint = subscription.endpoint;
  const url = new URL(endpoint);
  const audience = `${url.protocol}//${url.host}`;

  // VAPID JWT を生成
  const jwt = await createVapidJwt(audience, vapidSubject, vapidPrivateKey, vapidPublicKey);

  // ペイロードを暗号化
  const encryptedBody = await encryptPayload(subscription, payloadText);

  // Push サービスへ送信
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `vapid t=${jwt}, k=${vapidPublicKey}`,
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL': '86400', // 24時間
      'Urgency': 'high', // 最優先通知（スリープ中も届きやすくする）
    },
    body: encryptedBody,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Push service returned ${response.status}: ${errorText}`);
  }

  return response;
}

// ======================================================================
// Worker エントリーポイント
// ======================================================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // GET /: ヘルスチェック
    if (request.method === "GET" && url.pathname === "/") {
      return new Response("Cafe Push Worker is running.", { headers: corsHeaders });
    }

    // GET /debug/status?subId=XXX&token=YYY: テスト用KV状態確認エンドポイント
    if (request.method === "GET" && url.pathname === "/debug/status") {
      const token = url.searchParams.get("token");
      if (!env.PLAYWRIGHT_DEBUG_TOKEN || token !== env.PLAYWRIGHT_DEBUG_TOKEN) {
        return new Response("Forbidden", { status: 403, headers: corsHeaders });
      }
      const subId = url.searchParams.get("subId");
      if (!subId) {
        return new Response("Missing subId", { status: 400, headers: corsHeaders });
      }
      const activeSchedule = await env.PUSH_STATUS.get(`active_schedule_${subId}`);
      const stopped = await env.PUSH_STATUS.get(`stop_${subId}`);
      return new Response(JSON.stringify({
        subId,
        activeScheduleId: activeSchedule,
        isStopped: stopped === "true",
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST /stop: 通知の停止
    if (request.method === "POST" && url.pathname === "/stop") {
      try {
        const body = await request.json();
        const { subscription } = body;
        const subId = await getSubscriptionId(subscription);
        // KV に停止フラグをセット (24時間で自動消去されるように設定)
        await env.PUSH_STATUS.put(`stop_${subId}`, "true", { expirationTtl: 86400 });
        // 有効なスケジュールも破棄してゴーストQueueを無効化
        await env.PUSH_STATUS.delete(`active_schedule_${subId}`);
        return new Response("Stopped", { status: 200, headers: corsHeaders });
      } catch (e) {
        return new Response(e.message, { status: 500, headers: corsHeaders });
      }
    }

    // POST /schedule: 通知スケジュールの登録 (Queue 遅延送信)
    if (request.method === "POST" && url.pathname === "/schedule") {
      try {
        const body = await request.json();
        const { subscription, payload, delaySeconds, autoUpdate, cooldownMinutes, actionTimeSeconds, fixedTimes } = body;

        if (!subscription || !payload || typeof delaySeconds !== 'number') {
          return new Response("Invalid request body", { status: 400, headers: corsHeaders });
        }

        const subId = await getSubscriptionId(subscription);
        // 新しいスケジュールが来たので停止フラグを消去
        await env.PUSH_STATUS.delete(`stop_${subId}`);

        // 重複実行防止のため、スケジュールの「バージョン（タイムスタンプ）」を発行・記録
        const scheduleId = Date.now().toString();
        await env.PUSH_STATUS.put(`active_schedule_${subId}`, scheduleId, { expirationTtl: 86400 * 7 }); // 7日間維持

        await env.PUSH_QUEUE.send(
          { subscription, payload, autoUpdate, cooldownMinutes, actionTimeSeconds, fixedTimes, scheduleId },
          { delaySeconds: Math.max(0, delaySeconds) }
        );

        return new Response(JSON.stringify({ success: true, message: "Scheduled successfully" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        console.error("/schedule Error:", err.stack || err.message);
        return new Response(err.stack || err.message, { status: 500, headers: corsHeaders });
      }
    }

    // POST /test: 即時テスト送信
    if (request.method === "POST" && url.pathname === "/test") {
      try {
        const body = await request.json();
        const { subscription, payload } = body;

        // 振動設定の抽出（フロントから payload.enableVibration で送られてくる）
        const enableVibration = payload && payload.enableVibration !== undefined ? payload.enableVibration : true;
        const pushPayload = { ...payload, enableVibration };

        await sendPushNotification(
          subscription,
          JSON.stringify(pushPayload),
          env.VAPID_PUBLIC_KEY,
          env.VAPID_PRIVATE_KEY,
          env.VAPID_SUBJECT
        );

        return new Response("Success", { status: 200, headers: corsHeaders });
      } catch (e) {
        console.error("/test Error:", e.stack || e.message);
        return new Response(e.stack || e.message, { status: 500, headers: corsHeaders });
      }
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  },

  // Queue コンシューマー (指定時間後に発火)
  async queue(batch, env) {
    for (const message of batch.messages) {
      try {
        const { subscription, payload, autoUpdate, cooldownMinutes, actionTimeSeconds, fixedTimes, scheduleId } = message.body;

        const subId = await getSubscriptionId(subscription);
        const isStopped = await env.PUSH_STATUS.get(`stop_${subId}`);

        if (isStopped === "true") {
          console.log(`[Queue] Push cancelled for ${subId} (Stopped by user)`);
          message.ack();
          continue;
        }

        // 新しくスケジュールされたQueueが存在し、このQueueが古い（ゴースト）場合は破棄する
        if (scheduleId) {
          const activeScheduleId = await env.PUSH_STATUS.get(`active_schedule_${subId}`);
          if (scheduleId !== activeScheduleId) {
            console.log(`[Queue] Discarding outdated schedule queue (Got: ${scheduleId}, Active: ${activeScheduleId})`);
            message.ack();
            continue;
          }
        }

        await sendPushNotification(
          subscription,
          JSON.stringify(payload),
          env.VAPID_PUBLIC_KEY,
          env.VAPID_PRIVATE_KEY,
          env.VAPID_SUBJECT
        );

        // 自動次回登録: 通知送信後、次のスケジュールを Queue に投入
        if (autoUpdate && cooldownMinutes && typeof actionTimeSeconds === 'number' && fixedTimes) {
          // 現在時刻（通知が送られた直後）
          const now = new Date();
          // リセット時刻を考慮した次のターゲット時刻を計算
          const nextDate = getNextTargetDate(now, fixedTimes, cooldownMinutes);
          // 操作時間を加味した遅延秒数
          const nextDelaySeconds = Math.floor((nextDate.getTime() - now.getTime()) / 1000) + actionTimeSeconds;

          // 新しいスケジュールIDを生成して更新（これ以降、既存の別スレッドのQueueはすべて破棄される）
          const nextScheduleId = Date.now().toString();
          await env.PUSH_STATUS.put(`active_schedule_${subId}`, nextScheduleId, { expirationTtl: 86400 * 7 });

          await env.PUSH_QUEUE.send(
            {
              subscription,
              payload,
              autoUpdate: true,
              cooldownMinutes,
              actionTimeSeconds,
              fixedTimes,
              scheduleId: nextScheduleId
            },
            { delaySeconds: Math.max(0, nextDelaySeconds) }
          );
          console.log(`Auto-update: next notification scheduled at ${nextDate.toISOString()} (Delay: ${nextDelaySeconds}s)`);
        }

        message.ack();
      } catch (error) {
        console.error("Queue push failed:", error.stack || error.message);
        if (message.attempts < 3) {
          message.retry();
        } else {
          message.ack();
        }
      }
    }
  },
};
