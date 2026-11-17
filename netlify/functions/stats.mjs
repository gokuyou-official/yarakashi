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
    : /iPhone|iPad/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android"
    : /CrOS/.test(ua) ? "Chromebook" : /Windows/.test(ua) ? "Windows" : /Macintosh/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "不明";
  out.excluded_bots = 0;
  // 閲覧時に付けた判別情報（「||」以降。tz=タイムゾーン;lang=言語;scr=画面;vis=表示状態;hc=CPU数）を読み取る
  const parseInfo = (raw = "") => {
    const i = raw.indexOf("||");
    if (i < 0) return { ua: raw, info: null };
    const info = {};
    for (const kv of raw.slice(i + 2).split(";")) {
      const j = kv.indexOf("=");
      if (j > 0) info[kv.slice(0, j).trim()] = kv.slice(j + 1).trim();
    }
    return { ua: raw.slice(0, i).trim(), info };
  };
  // やらかしの閲覧のうち「日本時間の端末」と「日本以外／判別情報なし（旧データ）」を別枠で数える
  out.yarakashi_views_tokyo = weeks();
  out.yarakashi_views_other_tz = weeks();
  out.yarakashi_views_no_info = weeks();
  out.yarakashi_today_tokyo = 0;
  out.yarakashi_today_other_tz = 0;
  out.yarakashi_today_no_info = 0;
  for (const v of views || []) {
    const { ua: baseUa, info } = parseInfo(v.user_agent || "");
    if (kind(baseUa) === "bot") { out.excluded_bots++; continue; }
    if (!(v.referrer || "").startsWith("gokuyou:") && out.yarakashi_recent.length < 40) {
      const ua = baseUa;
      const ios = (ua.match(/OS (\d+)_/) || [])[1] || "";
      out.yarakashi_recent.push({
        at: new Date(new Date(v.visited_at).getTime() + 9 * 3600 * 1000).toISOString().slice(5, 16).replace("T", " "),
        device: kind(ua) + (ios ? " iOS" + ios : "") + ((ua.match(/(Edg|Chrome|Firefox|Version)\/(\d+)/) || [])[0] ? " " + (ua.match(/(Edg|Chrome|Firefox|Version)\/(\d+)/) || [])[0] : ""),
        from: v.referrer ? new URL(v.referrer).hostname : "直接",
        at_sec: new Date(new Date(v.visited_at).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " "),
        tz: info ? info.tz || "" : "情報なし",
        lang: info ? info.lang || "" : "",
        scr: info ? info.scr || "" : "",
        vis: info ? info.vis || "" : "",
        hc: info ? info.hc || "" : "",
      });
    }
    const t = new Date(v.visited_at).getTime();
    const w = Math.min(3, Math.floor((now - t) / (7 * day)));
    const isG = (v.referrer || "").startsWith("gokuyou:");
    (isG ? out.gokuyou_views : out.yarakashi_views)[3 - w]++;
    if (t >= todayStart) isG ? out.gokuyou_today++ : out.yarakashi_today++;
    if (!isG) {
      const g = !info ? "no_info" : info.tz === "Asia/Tokyo" ? "tokyo" : "other_tz";
      out["yarakashi_views_" + g][3 - w]++;
      if (t >= todayStart) out["yarakashi_today_" + g]++;
    }
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
