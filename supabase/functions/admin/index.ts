import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info, x-admin-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { data: kc } = await sb.from("quiz_config").select("admin_key").eq("id", 1).single();
  const given = req.headers.get("x-admin-key");
  if (!kc || !given || given !== kc.admin_key) return json({ error: "Não autorizado." }, 401);
  try {
    const body = await req.json();
    const a = body.action;

    if (a === "dashboard") {
      const [{ data: cfg }, { data: ps }, { data: ans }, { count }] = await Promise.all([
        sb.from("quiz_config").select("id,per_quiz,max_points,penalty_per_sec,min_points,active").eq("id", 1).single(),
        sb.from("quiz_participants").select("id,matricula,nome,local,started_at,finished_at,score,correct_count,total_time_ms,question_ids"),
        sb.from("quiz_answers").select("participant_id,answered_at"),
        sb.from("quiz_questions").select("id", { count: "exact", head: true }),
      ]);
      const answered: Record<string, number> = {};
      for (const x of ans ?? []) if (x.answered_at) answered[x.participant_id] = (answered[x.participant_id] ?? 0) + 1;
      const rows = (ps ?? []).map((p) => ({
        id: p.id, matricula: p.matricula, nome: p.nome, local: p.local, started_at: p.started_at,
        finished: !!p.finished_at, score: p.score, correct: p.correct_count,
        total_time_ms: p.total_time_ms, answered: answered[p.id] ?? 0, total: p.question_ids.length,
      }));
      const fin = rows.filter((r) => r.finished).sort((x, y) => y.score - x.score || x.total_time_ms! - y.total_time_ms!);
      const prog = rows.filter((r) => !r.finished).sort((x, y) => y.answered - x.answered);
      return json({ config: cfg, questions: count ?? 0, ranking: fin, in_progress: prog });
    }

    if (a === "questions") {
      const { data } = await sb.from("quiz_questions").select("*").order("created_at");
      return json({ questions: data ?? [] });
    }

    if (a === "import") {
      const rows = Array.isArray(body.rows) ? body.rows : [];
      const clean = rows.map((r: any) => ({
        text: String(r.text ?? "").trim(),
        correct: String(r.correct ?? "").trim(),
        wrongs: (Array.isArray(r.wrongs) ? r.wrongs : []).map((w: any) => String(w).trim()).filter(Boolean),
      })).filter((r: any) => r.text && r.correct && r.wrongs.length >= 1);
      if (!clean.length) return json({ error: "Nenhuma pergunta válida." }, 400);
      if (body.mode === "replace") {
        await sb.from("quiz_questions").delete().not("id", "is", null);
      }
      const { error } = await sb.from("quiz_questions").insert(clean);
      if (error) return json({ error: error.message }, 500);
      return json({ imported: clean.length });
    }

    if (a === "delete_question") {
      await sb.from("quiz_questions").delete().eq("id", body.id);
      return json({ ok: true });
    }

    if (a === "detail") {
      const { data } = await sb.from("quiz_answers").select("position,question_text,correct_text,chosen,is_correct,points,elapsed_ms")
        .eq("participant_id", body.id).order("position");
      return json({ answers: data ?? [] });
    }

    if (a === "delete_participant") {
      await sb.from("quiz_participants").delete().eq("id", body.id);
      return json({ ok: true });
    }

    if (a === "reset_all") {
      await sb.from("quiz_participants").delete().not("id", "is", null);
      return json({ ok: true });
    }

    if (a === "set_config") {
      const upd: Record<string, unknown> = {};
      if (typeof body.active === "boolean") upd.active = body.active;
      if (Number.isInteger(body.per_quiz) && body.per_quiz >= 1 && body.per_quiz <= 50) upd.per_quiz = body.per_quiz;
      await sb.from("quiz_config").update(upd).eq("id", 1);
      return json({ ok: true });
    }

    return json({ error: "Ação inválida." }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "Erro interno." }, 500);
  }
});
