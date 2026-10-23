import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

function rnd(n: number) {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % n;
}
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function getConfig() {
  const { data } = await sb.from("quiz_config").select("*").eq("id", 1).single();
  return data!;
}

function pointsFor(elapsedMs: number, cfg: any) {
  const p = Math.round(cfg.max_points - (elapsedMs / 1000) * Number(cfg.penalty_per_sec));
  return Math.max(cfg.min_points, p);
}

function publicQ(row: any, total: number) {
  return { position: row.position, total, text: row.question_text, options: row.options };
}

async function serve(p: any, position: number) {
  const qid = p.question_ids[position];
  const { data: q } = await sb.from("quiz_questions").select("*").eq("id", qid).maybeSingle();
  if (!q) throw new Error("question_missing");
  const options = shuffle([q.correct, ...(q.wrongs as string[])]);
  const { data, error } = await sb.from("quiz_answers").insert({
    participant_id: p.id, position, question_id: q.id,
    question_text: q.text, correct_text: q.correct, options,
    served_at: new Date().toISOString(),
  }).select().single();
  if (error) {
    const { data: ex } = await sb.from("quiz_answers").select("*")
      .eq("participant_id", p.id).eq("position", position).single();
    return ex;
  }
  return data;
}

async function finish(p: any) {
  const now = new Date();
  const { data: ans } = await sb.from("quiz_answers").select("points,is_correct").eq("participant_id", p.id);
  const score = (ans ?? []).reduce((s, a) => s + (a.points ?? 0), 0);
  const correct = (ans ?? []).filter((a) => a.is_correct).length;
  const total = now.getTime() - new Date(p.started_at).getTime();
  await sb.from("quiz_participants").update({
    finished_at: now.toISOString(), score, correct_count: correct, total_time_ms: total,
  }).eq("id", p.id).is("finished_at", null);
  const { data: fresh } = await sb.from("quiz_participants").select("*").eq("id", p.id).single();
  return result(fresh);
}

function result(p: any) {
  return {
    done: true, correct: p.correct_count,
    total: p.question_ids.length, total_time_ms: p.total_time_ms,
  };
}

async function currentState(p: any) {
  if (p.finished_at) return result(p);
  const total = p.question_ids.length;
  const { data: rows } = await sb.from("quiz_answers").select("*")
    .eq("participant_id", p.id).order("position");
  const open = (rows ?? []).find((r) => !r.answered_at);
  if (open) return { done: false, question: publicQ(open, total) };
  const next = (rows ?? []).length;
  if (next >= total) return await finish(p);
  const row = await serve(p, next);
  return { done: false, question: publicQ(row, total) };
}

function base(p: any) {
  return { started_at: p.started_at, server_now: new Date().toISOString() };
}

async function auth(matricula: string, token: string) {
  if (!matricula || !token) return null;
  const { data } = await sb.from("quiz_participants").select("*").eq("matricula", matricula).maybeSingle();
  if (!data || data.token !== token) return null;
  return data;
}

// ignora zeros à esquerda: 0123456 == 123456 (mantém "0" se for só zeros)
const normMat = (s: unknown) => norm(s).toUpperCase().replace(/^0+(?=.)/, "");
const LOCAIS = ["Sede administrativa", "Lote 1", "Lote 2", "Lote 3"];
const norm = (s: unknown) => String(s ?? "").trim().replace(/\s+/g, " ");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json();
    const action = body.action;

    if (action === "start") {
      const nome = norm(body.nome).slice(0, 80);
      const matricula = normMat(body.matricula).slice(0, 40);
      const local = norm(body.local);
      if (nome.length < 2 || !matricula) return json({ error: "Informe nome e matrícula." }, 400);
      if (!LOCAIS.includes(local)) return json({ error: "Selecione o local." }, 400);
      const cfg = await getConfig();
      if (!cfg.active) return json({ error: "O quiz está encerrado no momento." }, 403);

      const { data: ex } = await sb.from("quiz_participants").select("id").eq("matricula_norm", matricula).limit(1).maybeSingle();
      if (ex) return json({ error: "Esta matrícula já respondeu o quiz." }, 409);

      const { data: qs } = await sb.from("quiz_questions").select("id");
      if (!qs || qs.length < 1) return json({ error: "Quiz ainda sem perguntas." }, 503);
      const picked = shuffle(qs.map((q) => q.id)).slice(0, Math.min(cfg.per_quiz, qs.length));
      const token = crypto.randomUUID() + crypto.randomUUID();

      const { data: p, error } = await sb.from("quiz_participants").insert({
        matricula, nome, local, token, question_ids: picked, started_at: new Date().toISOString(),
      }).select().single();
      if (error) return json({ error: "Esta matrícula já respondeu o quiz." }, 409);

      const row = await serve(p, 0);
      return json({ token, matricula, nome, ...base(p), done: false, question: publicQ(row, picked.length) });
    }

    const p = await auth(norm(body.matricula).toUpperCase(), String(body.token ?? ""));
    if (!p) return json({ error: "Sessão inválida." }, 401);

    if (action === "state") {
      return json({ nome: p.nome, ...base(p), ...(await currentState(p)) });
    }

    if (action === "answer") {
      if (p.finished_at) return json({ ...base(p), ...result(p) });
      const position = Number(body.position);
      const idx = Number(body.index);
      const { data: row } = await sb.from("quiz_answers").select("*")
        .eq("participant_id", p.id).eq("position", position).maybeSingle();
      if (!row) return json({ error: "Pergunta inválida." }, 400);
      if (row.answered_at) return json({ ...base(p), ...(await currentState(p)) });
      if (!Number.isInteger(idx) || idx < 0 || idx >= row.options.length) {
        return json({ error: "Opção inválida." }, 400);
      }
      const cfg = await getConfig();
      const now = new Date();
      const elapsed = now.getTime() - new Date(row.served_at).getTime();
      const chosen = row.options[idx];
      const ok = chosen === row.correct_text;
      await sb.from("quiz_answers").update({
        answered_at: now.toISOString(), chosen, is_correct: ok,
        points: ok ? pointsFor(elapsed, cfg) : 0, elapsed_ms: elapsed,
      }).eq("id", row.id).is("answered_at", null);
      return json({ ...base(p), ...(await currentState(p)) });
    }

    return json({ error: "Ação inválida." }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "Erro interno." }, 500);
  }
});
