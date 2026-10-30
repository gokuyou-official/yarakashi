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

// 通知する段階（分前）。設定値より小さい 10・5・3・1 分前を足す
function alarmStages(alarmMinutes) {
  const list = [alarmMinutes, 10, 5, 3, 1].filter((m) => m > 0 && m <= alarmMinutes);
  return [...new Set(list)].sort((x, y) => y - x);
}

// 段階ごとの文面（アプリ画面の言い回しに合わせる）
function alarmMessage(stage, remaining, alarmMinutes) {
  const title = `${stage <= 5 ? "🚨" : "🚃"} 終電まであと${remaining}分`;
  if (stage === alarmMinutes && stage > 10) return { title, body: "そろそろ動いて！飲みすぎ注意 🍺" };
  if (stage >= 10) return { title, body: "会計もたついたらダッシュ！🏃‍♂️💨" };
  if (stage >= 5) return { title, body: "今すぐ出て！！乗り遅れたらタクシー 🚕" };
  if (stage >= 3) return { title, body: "諦めたらそこで試合終了です。🏀" };
  return { title, body: "…タクシー代いくらかな 🚕" };
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
    const { user_id, train_min, alarm_minutes = 15, push_alarm_sent_at, push_alarm_sent_for, push_5min_sent_for } = state;

    const remaining = train_min - nowMin;
    if (remaining <= 0 || remaining > alarm_minutes + 30) continue;

    // 通知する段階：設定した分前 → 10分前 → 5分前 → 3分前 → 1分前
    const stages = alarmStages(alarm_minutes);
    // いま該当する段階（残り時間がその段階以下になった、いちばん小さい段階）
    const target = [...stages].reverse().find((s) => remaining <= s);
    if (target === undefined) continue;

    // 送信済みの段階は push_5min_sent_for に「最後に送った段階の分数」として記録する
    const sameNight =
      push_alarm_sent_for === train_min && push_alarm_sent_at && push_alarm_sent_at > twentyHoursAgo;
    const lastStage = sameNight ? push_5min_sent_for : null;
    if (lastStage != null && lastStage <= target) continue;

    const { data: subs, error: subErr } = await sb
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("user_id", user_id);
    if (subErr || !subs?.length) continue;

    const { title, body } = alarmMessage(target, remaining, alarm_minutes);
    const payload = JSON.stringify({ title, body });

    for (const sub of subs) {
      const pushSub = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
      try {
        await webpush.sendNotification(pushSub, payload);
        sent++;
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        }
      }
    }

    await sb
      .from("tonight_state")
      .update({ push_alarm_sent_at: new Date().toISOString(), push_alarm_sent_for: train_min, push_5min_sent_for: target })
      .eq("user_id", user_id);
  }

  console.log(`[send-alarms] done. sent=${sent} users=${states?.length ?? 0} nowMin=${nowMin}`);
  return new Response("OK", { status: 200 });
}

export const config = {
  schedule: "* * * * *",
};
