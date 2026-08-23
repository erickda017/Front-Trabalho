// Extrator de PIX "pessoal" do Supervisor -- ao contrário do /pix normal
// (que salva PDF + Pix no Supabase, associado a um cliente), este NUNCA toca
// o backend: extração 100% local (mesmo scanner de QR do pixExtractor.ts) e
// o resultado fica só no localStorage do navegador, com expiração automática
// em 8h. Serve pra tirar o Pix de faturas avulsas (fora da carteira de
// qualquer operador) sem sujar o banco.
const CHAVE = "supervisor:extratorPessoal:v1";
const TTL_MS = 8 * 60 * 60 * 1000; // 8 horas

export type ItemExtraidoPessoal = {
  id: string;
  nomeArquivo: string;
  pixCopiaCola: string;
  extraidoEm: number; // epoch ms
};

type Armazenado = { itens: ItemExtraidoPessoal[]; expiraEm: number };

function ler(): Armazenado {
  try {
    const bruto = window.localStorage.getItem(CHAVE);
    if (!bruto) return { itens: [], expiraEm: 0 };
    const dado = JSON.parse(bruto) as Armazenado;
    // Expirou -- descarta tudo (não é só "não mostra", apaga mesmo, é o que
    // "sem armazenamento no banco, apenas local por 8 horas" pede).
    if (!dado.expiraEm || Date.now() > dado.expiraEm) {
      window.localStorage.removeItem(CHAVE);
      return { itens: [], expiraEm: 0 };
    }
    return dado;
  } catch {
    return { itens: [], expiraEm: 0 };
  }
}

function salvar(itens: ItemExtraidoPessoal[]) {
  // Cada novo item RENOVA o TTL pro lote inteiro -- é uma sessão de trabalho
  // de até 8h, não 8h fixas desde o primeiro arquivo.
  const dado: Armazenado = { itens, expiraEm: Date.now() + TTL_MS };
  window.localStorage.setItem(CHAVE, JSON.stringify(dado));
}

export function listarExtracoesPessoais(): ItemExtraidoPessoal[] {
  return ler().itens;
}

export function adicionarExtracaoPessoal(item: Omit<ItemExtraidoPessoal, "id" | "extraidoEm">): ItemExtraidoPessoal {
  const atual = ler().itens;
  const novo: ItemExtraidoPessoal = { ...item, id: crypto.randomUUID(), extraidoEm: Date.now() };
  salvar([novo, ...atual]);
  return novo;
}

export function removerExtracaoPessoal(id: string) {
  salvar(ler().itens.filter((i) => i.id !== id));
}

export function limparExtracoesPessoais() {
  window.localStorage.removeItem(CHAVE);
}

export function expiraEmMs(): number {
  return ler().expiraEm;
}
