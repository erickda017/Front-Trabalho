import { createFileRoute } from "@tanstack/react-router";
import {
  BarChart3,
  Check,
  Copy,
  Download,
  FileSpreadsheet,
  FileText,
  KeyRound,
  Loader2,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";

import { AppShell } from "@/components/AppShell";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { Aviso, Botao, Busca, Seletor, TabelaWrap } from "@/components/shared/Controls";
import { StatusPill } from "@/components/shared/StatusPill";
import { api } from "@/api";
import { extrairPixLocal } from "@/lib/pixExtractor";
import { casarClientePorNome } from "@/lib/clienteMatch";
import {
  adicionarExtracaoPessoal,
  expiraEmMs,
  limparExtracoesPessoais,
  listarExtracoesPessoais,
  removerExtracaoPessoal,
  type ItemExtraidoPessoal,
} from "@/lib/extratorPessoal";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/supervisor")({
  head: () => ({
    meta: [
      { title: "Supervisor — Veloce Faturas" },
      { name: "description", content: "Visão geral de todos os operadores: clientes, faturas, disparos e ferramentas de PIX." },
    ],
  }),
  component: Supervisor,
});

type Operador = { id: string; email: string | null; nome: string | null };
type ClienteSup = {
  id: string;
  nome: string;
  telefone: string;
  valor: string | null;
  vencimento: string | null;
  pix_code: string | null;
  pdf_path: string | null;
  operador: Operador | null;
};
type FaturaSup = {
  cliente_id: string;
  cliente_nome: string;
  telefone: string;
  valor: string | null;
  vencimento: string | null;
  pdf_path: string | null;
  pdf_url: string | null;
  pix_code: string | null;
  operador: Operador | null;
};
type DisparoSup = {
  id: string;
  criado_em: string;
  lote: string | null;
  status: string;
  total: number;
  enviados: number;
  entregues: number;
  lidos: number;
  falhas: number;
  pendentes: number;
  operador: Operador | null;
};
type ResumoOperador = {
  operador: Operador;
  total_clientes: number;
  com_pdf: number;
  com_pix: number;
  disparos_em_andamento: number;
  disparos_concluidos: number;
  enviados: number;
  entregues: number;
  lidos: number;
  falhas: number;
};
type IndicePixItem = { id: string; nome: string; telefone: string; pix_code: string; usuario_id: string; operador: Operador | null };

const ABAS = [
  { id: "dashboard", label: "Dashboard", icon: BarChart3 },
  { id: "clientes", label: "Clientes", icon: Users },
  { id: "faturas", label: "Faturas", icon: FileText },
  { id: "disparos", label: "Disparos", icon: KeyRound },
  { id: "planilha", label: "Planilha de PIX", icon: FileSpreadsheet },
  { id: "extrator", label: "Extrator pessoal", icon: ShieldCheck },
] as const;
type AbaId = (typeof ABAS)[number]["id"];

function nomeOperador(op: Operador | null) {
  return op?.nome || op?.email || "—";
}

function formatarData(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function formatarValor(v: string | null) {
  if (!v) return "—";
  const n = Number(v);
  return Number.isNaN(n) ? v : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function Supervisor() {
  const [aba, setAba] = useState<AbaId>("dashboard");
  const [operadores, setOperadores] = useState<Operador[]>([]);

  useEffect(() => {
    api.supervisor
      .operadores()
      .then((data) => setOperadores(Array.isArray(data) ? data.map((o: any) => ({ id: o.id, email: o.email, nome: o.nome })) : []))
      .catch(() => {});
  }, []);

  return (
    <AppShell title="Supervisor" subtitle="Visão de todos os operadores: clientes, faturas, disparos e ferramentas de PIX">
      <div className="border-border mb-6 flex gap-1 overflow-x-auto border-b">
        {ABAS.map((a) => (
          <button
            key={a.id}
            onClick={() => setAba(a.id)}
            className={cn(
              "focus-ring flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
              aba === a.id
                ? "border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            <a.icon className="size-4" />
            {a.label}
          </button>
        ))}
      </div>

      {aba === "dashboard" && <AbaDashboard />}
      {aba === "clientes" && <AbaClientes operadores={operadores} />}
      {aba === "faturas" && <AbaFaturas operadores={operadores} />}
      {aba === "disparos" && <AbaDisparos operadores={operadores} />}
      {aba === "planilha" && <AbaPlanilha />}
      {aba === "extrator" && <AbaExtratorPessoal />}
    </AppShell>
  );
}

function CarregandoBloco({ linhas = 5 }: { linhas?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: linhas }).map((_, i) => (
        <div key={i} className="bg-surface-sunken h-8 animate-pulse rounded-md" />
      ))}
    </div>
  );
}

function CardMetrica({ label, valor }: { label: string; valor: string | number }) {
  return (
    <div className="border-border bg-surface rounded-lg border p-4">
      <p className="text-subtle text-xs tracking-wide uppercase">{label}</p>
      <p className="font-display mt-1 text-2xl font-semibold">{valor}</p>
    </div>
  );
}

function AbaDashboard() {
  const [dados, setDados] = useState<{ totais: Record<string, number>; por_operador: ResumoOperador[] } | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    api.supervisor
      .dashboard()
      .then(setDados)
      .catch((e) => setErro((e as Error).message))
      .finally(() => setCarregando(false));
  }, []);

  if (carregando) return <CarregandoBloco linhas={4} />;
  if (erro) return <Aviso tone="danger">{erro}</Aviso>;
  if (!dados) return null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <CardMetrica label="Operadores" valor={dados.totais.operadores} />
        <CardMetrica label="Clientes" valor={dados.totais.clientes} />
        <CardMetrica label="Com PIX" valor={dados.totais.com_pix} />
        <CardMetrica label="Disparos em andamento" valor={dados.totais.disparos_em_andamento} />
        <CardMetrica label="Disparos concluídos" valor={dados.totais.disparos_concluidos} />
      </div>

      <SectionCard titulo="Por operador" descricao="Carteira e disparos de cada operador." flush bodyClassName="p-0">
        <TabelaWrap>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border text-subtle border-b text-left text-xs uppercase">
                <th className="px-4 py-2.5">Operador</th>
                <th className="px-4 py-2.5">Clientes</th>
                <th className="px-4 py-2.5">Com PDF</th>
                <th className="px-4 py-2.5">Com PIX</th>
                <th className="px-4 py-2.5">Em andamento</th>
                <th className="px-4 py-2.5">Concluídos</th>
                <th className="px-4 py-2.5">Entregues / lidos</th>
                <th className="px-4 py-2.5">Falhas</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {dados.por_operador.map((op) => (
                <tr key={op.operador.id}>
                  <td className="px-4 py-2.5 font-medium">{nomeOperador(op.operador)}</td>
                  <td className="px-4 py-2.5">{op.total_clientes}</td>
                  <td className="px-4 py-2.5">{op.com_pdf}</td>
                  <td className="px-4 py-2.5">{op.com_pix}</td>
                  <td className="px-4 py-2.5">{op.disparos_em_andamento}</td>
                  <td className="px-4 py-2.5">{op.disparos_concluidos}</td>
                  <td className="px-4 py-2.5">
                    {op.entregues} / {op.lidos}
                  </td>
                  <td className="px-4 py-2.5">
                    {op.falhas > 0 ? <span className="text-destructive">{op.falhas}</span> : "0"}
                  </td>
                </tr>
              ))}
              {dados.por_operador.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-subtle px-4 py-6 text-center text-sm">
                    Nenhum operador logou ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </TabelaWrap>
      </SectionCard>
    </div>
  );
}

function SeletorOperador({
  operadores,
  valor,
  onChange,
}: {
  operadores: Operador[];
  valor: string;
  onChange: (v: string) => void;
}) {
  return (
    <Seletor value={valor} onChange={(e) => onChange(e.target.value)} className="max-w-[220px]">
      <option value="">Todos os operadores</option>
      {operadores.map((o) => (
        <option key={o.id} value={o.id}>
          {nomeOperador(o)}
        </option>
      ))}
    </Seletor>
  );
}

function AbaClientes({ operadores }: { operadores: Operador[] }) {
  const [clientes, setClientes] = useState<ClienteSup[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [operadorId, setOperadorId] = useState("");

  const carregar = useCallback(() => {
    setCarregando(true);
    api.supervisor
      .clientes({ busca: busca || undefined, operador_id: operadorId || undefined })
      .then((data) => setClientes(Array.isArray(data) ? data : []))
      .catch((e) => setErro((e as Error).message))
      .finally(() => setCarregando(false));
  }, [busca, operadorId]);

  useEffect(() => {
    const t = setTimeout(carregar, 300);
    return () => clearTimeout(t);
  }, [carregar]);

  return (
    <SectionCard
      titulo="Clientes (todos os operadores)"
      descricao="A quem cada cliente está atribuído."
      acoes={
        <div className="flex gap-2">
          <Busca placeholder="Buscar por nome ou telefone…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <SeletorOperador operadores={operadores} valor={operadorId} onChange={setOperadorId} />
        </div>
      }
      flush
      bodyClassName="p-0"
    >
      {erro ? (
        <div className="p-5">
          <Aviso tone="danger">{erro}</Aviso>
        </div>
      ) : carregando ? (
        <CarregandoBloco linhas={6} />
      ) : (
        <TabelaWrap>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border text-subtle border-b text-left text-xs uppercase">
                <th className="px-4 py-2.5">Cliente</th>
                <th className="px-4 py-2.5">Telefone</th>
                <th className="px-4 py-2.5">Valor</th>
                <th className="px-4 py-2.5">PIX</th>
                <th className="px-4 py-2.5">Atribuído a</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {clientes.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2.5 font-medium">{c.nome}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{c.telefone}</td>
                  <td className="px-4 py-2.5">{formatarValor(c.valor)}</td>
                  <td className="px-4 py-2.5">
                    {c.pix_code ? <StatusPill tone="success">Com PIX</StatusPill> : <StatusPill tone="muted">Sem PIX</StatusPill>}
                  </td>
                  <td className="px-4 py-2.5">{nomeOperador(c.operador)}</td>
                </tr>
              ))}
              {clientes.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-subtle px-4 py-6 text-center text-sm">
                    Nenhum cliente encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </TabelaWrap>
      )}
    </SectionCard>
  );
}

function AbaFaturas({ operadores }: { operadores: Operador[] }) {
  const [faturas, setFaturas] = useState<FaturaSup[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [operadorId, setOperadorId] = useState("");

  const carregar = useCallback(() => {
    setCarregando(true);
    api.supervisor
      .faturas({ busca: busca || undefined, operador_id: operadorId || undefined })
      .then((data) => setFaturas(Array.isArray(data) ? data : []))
      .catch((e) => setErro((e as Error).message))
      .finally(() => setCarregando(false));
  }, [busca, operadorId]);

  useEffect(() => {
    const t = setTimeout(carregar, 300);
    return () => clearTimeout(t);
  }, [carregar]);

  return (
    <SectionCard
      titulo="Faturas (todos os operadores)"
      descricao="PDF, valor, vencimento e a quem está atribuída cada fatura."
      acoes={
        <div className="flex gap-2">
          <Busca placeholder="Buscar por nome ou telefone…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <SeletorOperador operadores={operadores} valor={operadorId} onChange={setOperadorId} />
        </div>
      }
      flush
      bodyClassName="p-0"
    >
      {erro ? (
        <div className="p-5">
          <Aviso tone="danger">{erro}</Aviso>
        </div>
      ) : carregando ? (
        <CarregandoBloco linhas={6} />
      ) : (
        <TabelaWrap>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border text-subtle border-b text-left text-xs uppercase">
                <th className="px-4 py-2.5">Cliente</th>
                <th className="px-4 py-2.5">Valor</th>
                <th className="px-4 py-2.5">Vencimento</th>
                <th className="px-4 py-2.5">PDF</th>
                <th className="px-4 py-2.5">Atribuído a</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {faturas.map((f) => (
                <tr key={f.cliente_id}>
                  <td className="px-4 py-2.5 font-medium">{f.cliente_nome}</td>
                  <td className="px-4 py-2.5">{formatarValor(f.valor)}</td>
                  <td className="px-4 py-2.5">{f.vencimento || "—"}</td>
                  <td className="px-4 py-2.5">
                    {f.pdf_url ? (
                      <a href={f.pdf_url} target="_blank" rel="noreferrer" className="text-primary-strong inline-flex items-center gap-1 hover:underline">
                        <FileText className="size-3.5" /> Ver
                      </a>
                    ) : (
                      <span className="text-subtle">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">{nomeOperador(f.operador)}</td>
                </tr>
              ))}
              {faturas.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-subtle px-4 py-6 text-center text-sm">
                    Nenhuma fatura encontrada.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </TabelaWrap>
      )}
    </SectionCard>
  );
}

const STATUS_DISPARO: Record<string, { label: string; tone: "muted" | "brand" | "success" | "warning" | "danger" }> = {
  pendente: { label: "Pendente", tone: "muted" },
  agendado: { label: "Agendado", tone: "muted" },
  em_andamento: { label: "Em andamento", tone: "brand" },
  pausado: { label: "Pausado", tone: "warning" },
  concluido: { label: "Concluído", tone: "success" },
  cancelado: { label: "Cancelado", tone: "danger" },
};

function AbaDisparos({ operadores }: { operadores: Operador[] }) {
  const [disparos, setDisparos] = useState<DisparoSup[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [status, setStatus] = useState("todos");
  const [operadorId, setOperadorId] = useState("");

  const carregar = useCallback(() => {
    setCarregando(true);
    api.supervisor
      .disparos({ status, operador_id: operadorId || undefined })
      .then((data) => setDisparos(Array.isArray(data) ? data : []))
      .catch((e) => setErro((e as Error).message))
      .finally(() => setCarregando(false));
  }, [status, operadorId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  return (
    <SectionCard
      titulo="Disparos (todos os operadores)"
      descricao="Lotes de disparo em andamento e finalizados, de qualquer operador."
      acoes={
        <div className="flex gap-2">
          <Seletor value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-[180px]">
            <option value="todos">Todos os status</option>
            <option value="em_andamento">Em andamento</option>
            <option value="pendente">Pendente</option>
            <option value="pausado">Pausado</option>
            <option value="agendado">Agendado</option>
            <option value="concluido">Concluído</option>
            <option value="cancelado">Cancelado</option>
          </Seletor>
          <SeletorOperador operadores={operadores} valor={operadorId} onChange={setOperadorId} />
        </div>
      }
      flush
      bodyClassName="p-0"
    >
      {erro ? (
        <div className="p-5">
          <Aviso tone="danger">{erro}</Aviso>
        </div>
      ) : carregando ? (
        <CarregandoBloco linhas={6} />
      ) : (
        <TabelaWrap>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border text-subtle border-b text-left text-xs uppercase">
                <th className="px-4 py-2.5">Lote</th>
                <th className="px-4 py-2.5">Operador</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Progresso</th>
                <th className="px-4 py-2.5">Entregues / lidos</th>
                <th className="px-4 py-2.5">Criado em</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {disparos.map((d) => {
                const st = STATUS_DISPARO[d.status] || { label: d.status, tone: "muted" as const };
                return (
                  <tr key={d.id}>
                    <td className="px-4 py-2.5 font-medium">{d.lote || d.id.slice(0, 8)}</td>
                    <td className="px-4 py-2.5">{nomeOperador(d.operador)}</td>
                    <td className="px-4 py-2.5">
                      <StatusPill tone={st.tone}>{st.label}</StatusPill>
                    </td>
                    <td className="px-4 py-2.5">
                      {d.enviados}/{d.total} enviados
                      {d.falhas > 0 && <span className="text-destructive"> · {d.falhas} falha(s)</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      {d.entregues} / {d.lidos}
                    </td>
                    <td className="px-4 py-2.5">{formatarData(d.criado_em)}</td>
                  </tr>
                );
              })}
              {disparos.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-subtle px-4 py-6 text-center text-sm">
                    Nenhum disparo encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </TabelaWrap>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Planilha de PIX -- lida em modo "matriz" (header: 1) em vez de objetos,
// pra preservar EXATAMENTE a estrutura original da planilha (colunas extras,
// ordem, linhas em branco) e só mexer na célula da coluna PIX. Detecta as
// colunas "CLIENTE" e "PIX" pelo texto do cabeçalho (sem acento/maiúscula),
// aceitando variações comuns (Nome do cliente, Chave Pix, etc.).
// ---------------------------------------------------------------------------

function normalizarCabecalho(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function acharColuna(linhaCabecalho: unknown[], candidatos: RegExp[]): number {
  for (const regex of candidatos) {
    const idx = linhaCabecalho.findIndex((cel) => regex.test(normalizarCabecalho(cel)));
    if (idx !== -1) return idx;
  }
  return -1;
}

type ResultadoPlanilha = {
  linhasProcessadas: number;
  preenchidas: number;
  jaTinhamPix: number;
  semCorrespondencia: number;
};

// Processa uma matriz (array de arrays, primeira linha = cabeçalho): acha
// coluna CLIENTE e PIX, casa cada nome com `indice` (nome->pix) e preenche a
// célula PIX só quando estava vazia. Muta `matriz` in-place e devolve um
// resumo pra UI. `indice` pode vir de mais de uma fonte (sistema + extração
// pessoal) -- quem chama decide a ordem de prioridade ao montar o Map.
function preencherPixNaMatriz(
  matriz: unknown[][],
  indice: Map<string, string>,
  clientesParaCasar: { nome: string; pix: string }[],
): ResultadoPlanilha {
  const resultado: ResultadoPlanilha = { linhasProcessadas: 0, preenchidas: 0, jaTinhamPix: 0, semCorrespondencia: 0 };
  if (!matriz.length) return resultado;

  const cabecalho = matriz[0] || [];
  const colCliente = acharColuna(cabecalho, [/^cliente$/, /nome.*cliente/, /^nome$/, /razao social/]);
  const colPix = acharColuna(cabecalho, [/^pix$/, /chave.*pix/, /pix.*copia/, /codigo.*pix/]);

  if (colCliente === -1 || colPix === -1) {
    throw new Error('Não encontrei as colunas "CLIENTE" e "PIX" no cabeçalho da planilha.');
  }

  for (let i = 1; i < matriz.length; i++) {
    const linha = matriz[i];
    if (!linha || linha.every((c) => c === "" || c == null)) continue;
    const nomeCelula = String(linha[colCliente] ?? "").trim();
    if (!nomeCelula) continue;

    resultado.linhasProcessadas++;

    const pixAtual = String(linha[colPix] ?? "").trim();
    if (pixAtual) {
      resultado.jaTinhamPix++;
      continue;
    }

    const casado = casarClientePorNome(nomeCelula, clientesParaCasar.map((c) => ({ nome: c.nome, pix: c.pix })));
    const pixEncontrado = casado?.pix || indice.get(normalizarCabecalho(nomeCelula));

    if (pixEncontrado) {
      linha[colPix] = pixEncontrado;
      resultado.preenchidas++;
    } else {
      resultado.semCorrespondencia++;
    }
  }

  return resultado;
}

function baixarMatrizComoXlsx(matriz: unknown[][], nomeArquivo: string) {
  const aba = XLSX.utils.aoa_to_sheet(matriz);
  const livro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(livro, aba, "Planilha");
  XLSX.writeFile(livro, nomeArquivo);
}

function AbaPlanilha() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [processando, setProcessando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoPlanilha | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function processar() {
    if (!arquivo) return;
    setProcessando(true);
    setErro(null);
    setResultado(null);
    try {
      const indicePix = await api.supervisor.indicePix();
      const clientesParaCasar = (Array.isArray(indicePix) ? indicePix : []).map((c: IndicePixItem) => ({
        nome: c.nome,
        pix: c.pix_code,
      }));
      const indice = new Map(clientesParaCasar.map((c) => [normalizarCabecalho(c.nome), c.pix]));

      const buffer = await arquivo.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const nomeAba = workbook.SheetNames[0];
      const matriz = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[nomeAba], { header: 1, defval: "" });

      const res = preencherPixNaMatriz(matriz, indice, clientesParaCasar);
      setResultado(res);

      const nomeSaida = arquivo.name.replace(/\.(xlsx|xls|csv)$/i, "") + "-com-pix.xlsx";
      baixarMatrizComoXlsx(matriz, nomeSaida);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setProcessando(false);
    }
  }

  return (
    <SectionCard
      titulo="Planilha de PIX"
      descricao='Suba uma planilha com as colunas "CLIENTE" e "PIX" (a coluna PIX pode vir vazia) -- o sistema acha cada cliente pelo nome, cruza com o PIX já cadastrado no banco (de qualquer operador) e devolve a mesma planilha com a coluna PIX preenchida.'
    >
      <div className="space-y-4">
        <label className="border-border-strong hover:border-primary flex h-10 max-w-md cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 text-xs">
          <Upload className="size-3.5 shrink-0" />
          <span className="truncate">{arquivo ? arquivo.name : "Selecionar planilha (.xlsx, .xls, .csv)"}</span>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              setArquivo(e.target.files?.[0] ?? null);
              setResultado(null);
              setErro(null);
            }}
          />
        </label>

        <Botao variante="primary" onClick={processar} disabled={!arquivo || processando}>
          {processando ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-3.5" />}
          {processando ? "Processando…" : "Processar e baixar"}
        </Botao>

        {resultado && (
          <Aviso tone={resultado.semCorrespondencia > 0 ? "warning" : "info"}>
            {resultado.linhasProcessadas} linha(s) processada(s) — {resultado.preenchidas} preenchida(s) agora,{" "}
            {resultado.jaTinhamPix} já tinham PIX, {resultado.semCorrespondencia} sem correspondência.
          </Aviso>
        )}
        {erro && <Aviso tone="danger">{erro}</Aviso>}
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Extrator de PIX pessoal -- extração 100% local (mesmo scanner de QR do
// /pix normal), NUNCA sobe PDF nem grava nada no Supabase. Resultado fica só
// no localStorage (ver lib/extratorPessoal.ts), expira sozinho em 8h. Serve
// pra tirar o Pix de faturas avulsas, fora da carteira de qualquer operador.
// A planilha aqui cruza primeiro com o que acabou de ser extraído localmente
// e, se não achar, cai pro índice do sistema (mesmo indicePix da aba
// "Planilha de PIX") -- é o "relaciona o Pix que existe no sistema com o Pix
// da planilha" pedido.
// ---------------------------------------------------------------------------

function formatarContagemRegressiva(ms: number) {
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h${String(m).padStart(2, "0")}min`;
}

function CopiarPix({ valor }: { valor: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(valor);
        setCopiado(true);
        setTimeout(() => setCopiado(false), 1500);
      }}
      className="focus-ring text-subtle hover:text-foreground shrink-0"
      aria-label="Copiar chave PIX"
    >
      {copiado ? <Check className="text-success size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

function AbaExtratorPessoal() {
  const [itens, setItens] = useState<ItemExtraidoPessoal[]>([]);
  const [expiraEm, setExpiraEmState] = useState(0);
  const [extraindo, setExtraindo] = useState(false);
  const [erroExtracao, setErroExtracao] = useState<string | null>(null);

  const inputPdfRef = useRef<HTMLInputElement>(null);
  const inputPlanilhaRef = useRef<HTMLInputElement>(null);
  const [arquivoPlanilha, setArquivoPlanilha] = useState<File | null>(null);
  const [processandoPlanilha, setProcessandoPlanilha] = useState(false);
  const [resultadoPlanilha, setResultadoPlanilha] = useState<ResultadoPlanilha | null>(null);
  const [erroPlanilha, setErroPlanilha] = useState<string | null>(null);

  const recarregar = useCallback(() => {
    setItens(listarExtracoesPessoais());
    setExpiraEmState(expiraEmMs());
  }, []);

  useEffect(() => {
    recarregar();
    // Atualiza a contagem regressiva a cada minuto -- e faz sumir a lista
    // sozinha quando os dados expiram, sem precisar recarregar a página.
    const t = setInterval(recarregar, 60_000);
    return () => clearInterval(t);
  }, [recarregar]);

  async function extrairArquivos(arquivos: File[]) {
    setExtraindo(true);
    setErroExtracao(null);
    try {
      for (const arquivo of arquivos) {
        try {
          const resultado = await extrairPixLocal(arquivo);
          if (resultado?.pixCopiaCola) {
            adicionarExtracaoPessoal({ nomeArquivo: arquivo.name, pixCopiaCola: resultado.pixCopiaCola });
          }
        } catch {
          // um PDF ruim não derruba o resto do lote
        }
      }
      recarregar();
    } catch (e) {
      setErroExtracao((e as Error).message);
    } finally {
      setExtraindo(false);
    }
  }

  async function processarPlanilha() {
    if (!arquivoPlanilha) return;
    setProcessandoPlanilha(true);
    setErroPlanilha(null);
    setResultadoPlanilha(null);
    try {
      // Prioridade: 1) o que acabou de ser extraído localmente (mais
      // recente = vence, por isso o reduce simples sobrescrevendo), 2) o
      // índice do sistema (todos os operadores) só pra quem não achou local.
      const indiceLocal = new Map(itens.map((i) => [normalizarCabecalho(i.nomeArquivo.replace(/\.pdf$/i, "")), i.pixCopiaCola]));
      const indiceSistema = await api.supervisor.indicePix();
      const clientesSistema = (Array.isArray(indiceSistema) ? indiceSistema : []).map((c: IndicePixItem) => ({
        nome: c.nome,
        pix: c.pix_code,
      }));

      const buffer = await arquivoPlanilha.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const nomeAba = workbook.SheetNames[0];
      const matriz = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[nomeAba], { header: 1, defval: "" });

      // Casa primeiro contra os nomes de arquivo extraídos localmente (nome
      // do arquivo funciona como "nome do cliente" aqui, mesma convenção do
      // Extrator de PIX normal); o que sobrar cai pro índice do sistema.
      const clientesParaCasarLocal = [...indiceLocal.entries()].map(([nome, pix]) => ({ nome, pix }));
      const res = preencherPixNaMatriz(matriz, indiceLocal, clientesParaCasarLocal);
      const resSistema = preencherPixNaMatriz(matriz, new Map(), clientesSistema);
      const resultadoFinal: ResultadoPlanilha = {
        linhasProcessadas: res.linhasProcessadas,
        preenchidas: res.preenchidas + resSistema.preenchidas,
        jaTinhamPix: res.jaTinhamPix,
        semCorrespondencia: resSistema.semCorrespondencia,
      };
      setResultadoPlanilha(resultadoFinal);

      const nomeSaida = arquivoPlanilha.name.replace(/\.(xlsx|xls|csv)$/i, "") + "-com-pix.xlsx";
      baixarMatrizComoXlsx(matriz, nomeSaida);
    } catch (e) {
      setErroPlanilha((e as Error).message);
    } finally {
      setProcessandoPlanilha(false);
    }
  }

  const contagem = formatarContagemRegressiva(expiraEm - Date.now());

  return (
    <div className="space-y-6">
      <SectionCard
        titulo="Extrair PIX (só neste navegador)"
        descricao="Extração 100% local -- nada é enviado ou salvo no banco. O resultado fica só neste navegador e some sozinho em 8 horas."
        acoes={
          <Botao variante="primary" onClick={() => inputPdfRef.current?.click()} disabled={extraindo}>
            {extraindo ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-3.5" />}
            {extraindo ? "Extraindo…" : "Selecionar PDFs"}
          </Botao>
        }
      >
        <input
          ref={inputPdfRef}
          type="file"
          accept="application/pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            const arquivos = Array.from(e.target.files || []);
            if (arquivos.length) extrairArquivos(arquivos);
            e.target.value = "";
          }}
        />

        {contagem && (
          <p className="text-subtle mb-3 text-xs">
            {itens.length} extração(ões) guardada(s) neste navegador — some(m) em {contagem}.
          </p>
        )}
        {erroExtracao && <Aviso tone="danger">{erroExtracao}</Aviso>}

        {itens.length > 0 ? (
          <div className="divide-border border-border divide-y rounded-md border">
            {itens.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <FileText className="text-subtle size-4 shrink-0" />
                  <span className="truncate text-sm">{item.nomeArquivo}</span>
                  <span className="text-subtle max-w-[220px] truncate font-mono text-xs">{item.pixCopiaCola}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <CopiarPix valor={item.pixCopiaCola} />
                  <button
                    type="button"
                    onClick={() => {
                      removerExtracaoPessoal(item.id);
                      recarregar();
                    }}
                    className="focus-ring text-subtle hover:text-destructive"
                    aria-label="Remover"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState titulo="Nenhuma extração ainda" descricao="Selecione um ou mais PDFs pra extrair a chave PIX localmente." />
        )}

        {itens.length > 0 && (
          <Botao
            variante="outline"
            tamanho="sm"
            className="mt-3"
            onClick={() => {
              limparExtracoesPessoais();
              recarregar();
            }}
          >
            <Trash2 className="size-3.5" />
            Limpar tudo
          </Botao>
        )}
      </SectionCard>

      <SectionCard
        titulo="Preencher planilha com esses PIX + o sistema"
        descricao="Suba a planilha (colunas CLIENTE e PIX) -- primeiro tenta casar pelo que você acabou de extrair acima, depois pelo PIX já existente no sistema (de qualquer operador)."
      >
        <div className="space-y-4">
          <label className="border-border-strong hover:border-primary flex h-10 max-w-md cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 text-xs">
            <Upload className="size-3.5 shrink-0" />
            <span className="truncate">{arquivoPlanilha ? arquivoPlanilha.name : "Selecionar planilha (.xlsx, .xls, .csv)"}</span>
            <input
              ref={inputPlanilhaRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                setArquivoPlanilha(e.target.files?.[0] ?? null);
                setResultadoPlanilha(null);
                setErroPlanilha(null);
              }}
            />
          </label>

          <Botao variante="primary" onClick={processarPlanilha} disabled={!arquivoPlanilha || processandoPlanilha}>
            {processandoPlanilha ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-3.5" />}
            {processandoPlanilha ? "Processando…" : "Processar e baixar"}
          </Botao>

          {resultadoPlanilha && (
            <Aviso tone={resultadoPlanilha.semCorrespondencia > 0 ? "warning" : "info"}>
              {resultadoPlanilha.linhasProcessadas} linha(s) processada(s) — {resultadoPlanilha.preenchidas} preenchida(s) agora,{" "}
              {resultadoPlanilha.jaTinhamPix} já tinham PIX, {resultadoPlanilha.semCorrespondencia} sem correspondência.
            </Aviso>
          )}
          {erroPlanilha && <Aviso tone="danger">{erroPlanilha}</Aviso>}
        </div>
      </SectionCard>
    </div>
  );
}
