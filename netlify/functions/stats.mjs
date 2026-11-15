import { createClient } from "@supabase/supabase-js";

// 利用状況の集計（件数だけを返す。個人を特定する情報は返さない）
export default async () => {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const now = Date.now();
  const day = 24 * 3600 * 1000;
  const since = new Date(now - 28 * day).toISOString();

  const { data: views = [] } = await sb
    .from("page_views")
    .select("visited_at, user_agent, referrer")
    .gte("visited_at", since)
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
  for (const v of views || []) {
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

  return new Response(JSON.stringify(out), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
  });
};
