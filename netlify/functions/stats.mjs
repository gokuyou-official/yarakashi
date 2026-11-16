import { createClient } from "@supabase/supabase-js";
import ws from "ws";

// 利用状況の集計（件数だけを返す。個人を特定する情報は返さない）
export default async () => {
  try {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { realtime: { transport: ws } });
  const now = Date.now();
  const day = 24 * 3600 * 1000;
  const since = new Date(now - 28 * day).toISOString();

  const { data: views = [] } = await sb
    .from("page_views")
    .select("visited_at, user_agent, referrer")
    .gte("visited_at", since)
    .order("visited_at", { ascending: false })
    .limit(100000);

  const weeks = () => [0, 0, 0, 0];
  const out = {
    yarakashi_views: weeks(),
    gokuyou_views: weeks(),
    gokuyou_pages_7d: {},
    yarakashi_today: 0,
    gokuyou_today: 0,
  };
  const todayStart = new Date(new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10) + "T00:00:00+09:00").getTime();
  out.yarakashi_recent = [];
  const kind = (ua = "") =>
    /HeadlessChrome|bot|crawl|spider|preview|facebookexternalhit|slurp/i.test(ua) ? "bot"
    : /iPhone|iPad/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : "PC";
  out.excluded_bots = 0;
  for (const v of views || []) {
    if (kind(v.user_agent || "") === "bot") { out.excluded_bots++; continue; }
    if (!(v.referrer || "").startsWith("gokuyou:") && out.yarakashi_recent.length < 40) {
      const ua = v.user_agent || "";
      const ios = (ua.match(/OS (\d+)_/) || [])[1] || "";
      out.yarakashi_recent.push({
        at: new Date(new Date(v.visited_at).getTime() + 9 * 3600 * 1000).toISOString().slice(5, 16).replace("T", " "),
        device: kind(ua) + (ios ? " iOS" + ios : ""),
        from: v.referrer ? new URL(v.referrer).hostname : "直接",
      });
    }
    const t = new Date(v.visited_at).getTime();
    const w = Math.min(3, Math.floor((now - t) / (7 * day)));
    const isG = (v.referrer || "").startsWith("gokuyou:");
    (isG ? out.gokuyou_views : out.yarakashi_views)[3 - w]++;
    if (t >= todayStart) isG ? out.gokuyou_today++ : out.yarakashi_today++;
    if (isG && now - t < 7 * day) {
      const p = v.referrer.slice(8);
      out.gokuyou_pages_7d[p] = (out.gokuyou_pages_7d[p] || 0) + 1;
    }
  }

  const count = async (table, col, sinceIso) => {
    let q = sb.from(table).select("*", { count: "exact", head: true });
    if (col) q = q.gte(col, sinceIso);
    const { count: c } = await q;
    return c ?? null;
  };
  out.yarakashi_records_7d = await count("records", "date", new Date(now - 7 * day).toISOString().slice(0, 10));
  out.yarakashi_tonight_active_7d = await count("tonight_state", "updated_at", new Date(now - 7 * day).toISOString());
  out.yarakashi_push_subscribers = await count("push_subscriptions");
  out.note = "週ごとの配列は 3週前→今週 の順";

  return json(out);
  } catch (e) {
    return json({ error: String(e && e.message || e) }, 500);
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
  });
}
