import { createClient } from "@supabase/supabase-js";
import ws from "ws";

// 御供養の各ページから呼ばれる、閲覧数カウンター（ページのパスだけを記録する）
export default async (req) => {
  const headers = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };
  try {
    const url = new URL(req.url);
    // 点検モード（?check=1）：記録はせず、接続設定があるかどうかだけを返す（値そのものは返さない）
    if (url.searchParams.get("check") === "1") {
      return new Response(JSON.stringify({ env: !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) }), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
      });
    }
    const p = (url.searchParams.get("p") || "/").slice(0, 200);
    const ua = (req.headers.get("user-agent") || "").slice(0, 300);
    // 自動の確認作業（画面を持たないブラウザ）や検索ロボットは数えない
    if (/HeadlessChrome|bot|crawl|spider|preview/i.test(ua) || !p.startsWith("/gokuyou")) {
      return new Response(null, { status: 204, headers });
    }
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { realtime: { transport: ws } });
    await sb.from("page_views").insert({ user_agent: ua, referrer: "gokuyou:" + p });
  } catch (e) {
    // 失敗しても閲覧者には影響させない
  }
  return new Response(null, { status: 204, headers });
};
