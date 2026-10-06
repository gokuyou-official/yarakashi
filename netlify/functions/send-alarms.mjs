import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const VAPID_SUBJECT = "mailto:sk19880328@gmail.com";

// JST現在時刻を「深夜0〜4時は24〜28時扱い」の分数で返す
function getJSTMinutes() {
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  const h = jst.getUTCHours();
  const m = jst.getUTCMinutes();
  return (h < 5 ? h + 24 : h) * 60 + m;
}

export default async function handler() {
  // 環境変数チェック（値はログに出さない）
  if (!VAPID_PUBLIC || !VAPID_PRIVATE || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("[send-alarms] Required environment variables are missing");
    return new Response("Configuration error", { status: 500 });
  }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const nowMin = getJSTMinutes();
  const twentyHoursAgo = new Date(Date.now() - 20 * 3600 * 1000).toISOString();
  const FIVE = 5;

  // 終電セット済みのユーザーを取得
  const { data: states, error: fetchErr } = await sb
    .from("tonight_state")
    .select("user_id, train_min, alarm_minutes, push_alarm_sent_at, push_alarm_sent_for, push_5min_sent_at, push_5min_sent_for")
    .eq("train_set", true);

  if (fetchErr) {
    console.error("[send-alarms] DB fetch error:", fetchErr.message);
    return new Response("DB error", { status: 500 });
  }

  let sent = 0;

  for (const state of states ?? []) {
    const {
      user_id,
      train_min,
      alarm_minutes = 15,
      push_alarm_sent_at,
      push_alarm_sent_for,
      push_5min_sent_at,
      push_5min_sent_for,
    } = state;

    const remaining = train_min - nowMin;

    // 終電まで0分以下（過ぎた）か、alarm_minutes+30分より先ならスキップ
    if (remaining <= 0 || remaining > alarm_minutes + 30) continue;

    // 送信済み判定: train_minが一致 かつ 20時間以内に送信済み → スキップ
    const alarmAlreadySent =
      push_alarm_sent_for === train_min &&
      push_alarm_sent_at &&
      push_alarm_sent_at > twentyHoursAgo;

    const fiveMinAlreadySent =
      push_5min_sent_for === train_min &&
      push_5min_sent_at &&
      push_5min_sent_at > twentyHoursAgo;

    // alarm_minutes > 5 の場合: アラーム段階は remaining > 5 のときのみ
    // alarm_minutes <= 5 の場合: 1段階のみ（remainingがalarm_minutes以下になったら送信）
    const shouldSendAlarm =
      !alarmAlreadySent &&
      remaining <= alarm_minutes &&
      remaining > (alarm_minutes > FIVE ? FIVE : 0);

    const shouldSend5min =
      !fiveMinAlreadySent &&
      alarm_minutes > FIVE &&
      remaining <= FIVE &&
      remaining > 0;

    if (!shouldSendAlarm && !shouldSend5min) continue;

    // このユーザーのPush購読を取得
    const { data: subs, error: subErr } = await sb
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("user_id", user_id);

    if (subErr || !subs?.length) continue;

    const title = shouldSend5min
      ? `🚃 終電まであと${remaining}分！`
      : `🚃 終電まで${remaining}分！`;
    const body = shouldSend5min
      ? "今すぐ出て！！乗り遅れたらタクシー 🚕"
      : "そろそろ動いて！飲みすぎ注意 🍺";
    const payload = JSON.stringify({ title, body });

    for (const sub of subs) {
      const pushSub = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      };
      try {
        await webpush.sendNotification(pushSub, payload);
        sent++;
      } catch (err) {
        // 410 / 404 は購読期限切れ → DBから削除
        if (err.statusCode === 410 || err.statusCode === 404) {
          await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        }
        // エラーの詳細はログに残さない（鍵情報が含まれる可能性があるため）
      }
    }

    // 送信済みフラグを更新
    const now = new Date().toISOString();
    const updates = {};
    if (shouldSendAlarm) {
      updates.push_alarm_sent_at = now;
      updates.push_alarm_sent_for = train_min;
    }
    if (shouldSend5min) {
      updates.push_5min_sent_at = now;
      updates.push_5min_sent_for = train_min;
    }
    await sb.from("tonight_state").update(updates).eq("user_id", user_id);
  }

  console.log(`[send-alarms] done. sent=${sent} users=${states?.length ?? 0} nowMin=${nowMin}`);
  return new Response("OK", { status: 200 });
}

export const config = {
  schedule: "* * * * *",
};
