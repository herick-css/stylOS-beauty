/**
 * comum.js — funções usadas por todas as telas do sistema (painel, editor, login).
 *
 *  StylOS.api(caminho, opcoes)   → conversa com o servidor (já manda o cabeçalho anti-CSRF)
 *  StylOS.el(tag, atributos, filhos) → cria elementos com segurança (texto nunca vira HTML)
 *  StylOS.avisar(texto, tipo)     → mensagem rápida no rodapé da tela
 *  StylOS.janela({...})          → janela (modal) acessível
 *  StylOS.confirmar(texto)        → "Tem certeza?" (Promise<boolean>)
 */
(function (raiz) {
  'use strict';

  const Icones = raiz.IconesStylOS;

  // ----------------------------------------------------------------
  // Criação de elementos
  // ----------------------------------------------------------------
  function el(tag, atributos, filhos) {
    const elemento = document.createElement(tag);
    for (const [chave, valor] of Object.entries(atributos || {})) {
      if (valor === null || valor === undefined || valor === false) continue;
      if (chave === 'classe') elemento.className = valor;
      else if (chave === 'texto') elemento.textContent = valor;
      else if (chave === 'dados') Object.assign(elemento.dataset, valor);
      else if (chave === 'valor') elemento.value = valor;
      else if (chave.startsWith('ao') && typeof valor === 'function') elemento.addEventListener(chave.slice(2).toLowerCase(), valor);
      else elemento.setAttribute(chave, valor === true ? '' : String(valor));
    }
    for (const filho of [].concat(filhos ?? [])) {
      if (filho === null || filho === undefined || filho === false || filho === '') continue;
      elemento.append(filho instanceof Node ? filho : document.createTextNode(String(filho)));
    }
    return elemento;
  }

  /**
   * Troca o conteúdo de um elemento ignorando itens vazios (null/false).
   * (O replaceChildren do navegador escreveria "null" na tela.)
   */
  function trocar(alvo, ...filhos) {
    alvo.replaceChildren(...filhos.flat().filter((filho) => filho !== null && filho !== undefined && filho !== false));
  }

  function icone(nome, tamanho) {
    return Icones.criar(nome, tamanho || 18);
  }

  /** Logo do StylOS Beauty. */
  function marca(comBeauty = true) {
    const simbolo = el('span', { classe: 'marca__simbolo', 'aria-hidden': 'true' });
    const imagem = el('img', { src: '/img/favicon.svg', alt: '', width: '34', height: '34' });
    simbolo.append(imagem);
    return el('a', { classe: 'marca', href: '/', 'aria-label': 'StylOS Beauty — início' }, [
      simbolo,
      el('span', {}, ['Styl', el('span', { classe: 'marca__os', texto: 'OS' }), comBeauty ? el('span', { classe: 'marca__beauty', texto: ' Beauty' }) : null]),
    ]);
  }

  // ----------------------------------------------------------------
  // API
  // ----------------------------------------------------------------
  class ErroApi extends Error {
    constructor(mensagem, status, dados) {
      super(mensagem);
      this.status = status;
      this.dados = dados || {};
    }
  }

  /**
   * Chama a API. Lança ErroApi com a mensagem amigável do servidor.
   * opcoes: { metodo, corpo, corpoBinario, tipoConteudo }
   */
  async function api(caminho, opcoes = {}) {
    const cabecalhos = { 'X-StylOS': '1' };
    let corpo;
    if (opcoes.corpoBinario) {
      corpo = opcoes.corpoBinario;
      cabecalhos['Content-Type'] = opcoes.tipoConteudo || 'application/octet-stream';
    } else if (opcoes.corpo !== undefined) {
      corpo = JSON.stringify(opcoes.corpo);
      cabecalhos['Content-Type'] = 'application/json';
    }
    let resposta;
    try {
      resposta = await fetch(caminho, { method: opcoes.metodo || (corpo ? 'POST' : 'GET'), headers: cabecalhos, body: corpo, credentials: 'same-origin' });
    } catch (erro) {
      throw new ErroApi('Sem conexão com o servidor. O computador do StylOS está ligado?', 0);
    }
    const dados = await resposta.json().catch(() => ({}));
    if (resposta.status === 401 && !opcoes.semRedirecionar) {
      location.href = `/entrar?voltar=${encodeURIComponent(location.pathname + location.search)}`;
      throw new ErroApi('Sessão encerrada.', 401);
    }
    if (!resposta.ok) throw new ErroApi(dados.erro || 'Algo deu errado.', resposta.status, dados);
    return dados;
  }

  // ----------------------------------------------------------------
  // Avisos rápidos (toast)
  // ----------------------------------------------------------------
  let caixaAvisos = null;
  function avisar(texto, tipo = 'sucesso', duracaoMs = 3800) {
    if (!caixaAvisos) {
      caixaAvisos = el('div', { classe: 'avisos', role: 'status', 'aria-live': 'polite' });
      document.body.append(caixaAvisos);
    }
    const aviso = el('div', { classe: `aviso aviso--${tipo}` }, [icone(tipo === 'erro' ? 'alerta' : tipo === 'info' ? 'info' : 'check', 18), el('span', { texto })]);
    caixaAvisos.append(aviso);
    setTimeout(() => aviso.remove(), duracaoMs);
  }

  // ----------------------------------------------------------------
  // Janelas (modais)
  // ----------------------------------------------------------------
  /**
   * Abre uma janela. Devolve { elemento, fechar, corpo }.
   * opcoes: { titulo, icone, conteudo (Node|Node[]), botoes: [{ texto, classe, aoClicar, tipo }], larga, aoFechar, fechavel }
   */
  function janela(opcoes) {
    const corpo = el('div', { classe: 'janela__corpo' }, opcoes.conteudo);
    const rodape = el('div', { classe: 'janela__rodape' });
    const dialogo = el('dialog', { classe: `janela ${opcoes.larga ? 'janela--larga' : ''}`, 'aria-labelledby': 'titulo-janela-' + Date.now() });
    const tituloId = dialogo.getAttribute('aria-labelledby');
    const fechar = () => { if (dialogo.open) dialogo.close(); };
    dialogo.append(
      el('div', { classe: 'janela__cabecalho' }, [
        opcoes.icone ? el('span', { classe: 'item-secao__icone' }, [icone(opcoes.icone, 18)]) : null,
        el('h2', { id: tituloId, texto: opcoes.titulo }),
        opcoes.fechavel === false ? null : el('button', { classe: 'botao botao--fantasma botao--icone', type: 'button', 'aria-label': 'Fechar', aoClick: fechar }, [icone('fechar', 20)]),
      ]),
      corpo,
    );
    for (const botao of opcoes.botoes || []) {
      rodape.append(el('button', {
        classe: `botao ${botao.classe || 'botao--secundario'}`,
        type: 'button',
        aoClick: async (evento) => {
          if (botao.aoClicar) {
            const alvo = evento.currentTarget;
            alvo.classList.add('carregando');
            try {
              const manterAberta = await botao.aoClicar(fechar, alvo);
              if (manterAberta !== true) fechar();
            } finally {
              alvo.classList.remove('carregando');
            }
          } else {
            fechar();
          }
        },
      }, [botao.icone ? icone(botao.icone, 18) : null, botao.texto]));
    }
    if (rodape.childElementCount) dialogo.append(rodape);
    if (opcoes.fechavel === false) dialogo.addEventListener('cancel', (evento) => evento.preventDefault());
    dialogo.addEventListener('close', () => {
      dialogo.remove();
      if (opcoes.aoFechar) opcoes.aoFechar();
    });
    document.body.append(dialogo);
    dialogo.showModal();
    const primeiroCampo = corpo.querySelector('input, textarea, select');
    if (primeiroCampo) primeiroCampo.focus();
    return { elemento: dialogo, fechar, corpo };
  }

  /** Pergunta "tem certeza?". Resolve true/false. */
  function confirmar(texto, { titulo = 'Tem certeza?', botao = 'Confirmar', perigo = false } = {}) {
    return new Promise((resolver) => {
      let resposta = false;
      janela({
        titulo,
        conteudo: [el('p', { texto })],
        botoes: [
          { texto: 'Cancelar' },
          { texto: botao, classe: perigo ? 'botao--perigo' : 'botao--primario', aoClicar: () => { resposta = true; } },
        ],
        aoFechar: () => resolver(resposta),
      });
    });
  }

  /** Copia texto para a área de transferência. */
  async function copiar(texto) {
    try {
      await navigator.clipboard.writeText(texto);
      avisar('Copiado!');
    } catch {
      const campo = el('textarea', { valor: texto });
      document.body.append(campo);
      campo.select();
      document.execCommand('copy');
      campo.remove();
      avisar('Copiado!');
    }
  }

  /** Bloco "texto + botão copiar". */
  function blocoCopiavel(texto) {
    return el('div', { classe: 'copiavel' }, [
      el('code', { texto }),
      el('button', { classe: 'botao botao--secundario botao--pequeno', type: 'button', aoClick: () => copiar(texto) }, [icone('copiar', 16), 'Copiar']),
    ]);
  }

  // ----------------------------------------------------------------
  // Campos de formulário
  // ----------------------------------------------------------------
  /** Campo com rótulo. tipo: text, email, password, textarea, select... */
  function campo({ id, rotulo, tipo = 'text', valor = '', dica, obrigatorio, maximo, opcoes, atributos = {} }) {
    let entrada;
    if (tipo === 'textarea') entrada = el('textarea', { id, maxlength: maximo, required: obrigatorio, ...atributos });
    else if (tipo === 'select') entrada = el('select', { id, ...atributos }, (opcoes || []).map(([v, t]) => el('option', { value: v, texto: t, selected: v === valor ? true : null })));
    else entrada = el('input', { id, type: tipo, maxlength: maximo, required: obrigatorio, ...atributos });
    if (tipo !== 'select') entrada.value = valor ?? '';
    const filhos = [el('label', { for: id, texto: rotulo })];
    if (tipo === 'password') {
      const botaoVer = el('button', {
        classe: 'campo-senha__ver', type: 'button', 'aria-label': 'Mostrar senha',
        aoClick: () => {
          const mostrando = entrada.type === 'text';
          entrada.type = mostrando ? 'password' : 'text';
          botaoVer.setAttribute('aria-label', mostrando ? 'Mostrar senha' : 'Esconder senha');
          botaoVer.replaceChildren(icone(mostrando ? 'olho' : 'fechar', 18));
        },
      }, [icone('olho', 18)]);
      filhos.push(el('div', { classe: 'campo-senha' }, [entrada, botaoVer]));
    } else {
      filhos.push(entrada);
    }
    if (dica) filhos.push(el('span', { classe: 'campo__dica', texto: dica }));
    return { elemento: el('div', { classe: 'campo' }, filhos), entrada };
  }

  /** Mostra uma mensagem de erro/sucesso dentro de um formulário. */
  function alerta(texto, tipo = 'erro') {
    return el('div', { classe: `alerta alerta--${tipo}`, role: tipo === 'erro' ? 'alert' : 'status' }, [
      icone(tipo === 'erro' ? 'alerta' : tipo === 'sucesso' ? 'check' : 'info', 18),
      el('div', { texto }),
    ]);
  }

  /** Força de senha de 0 a 4 (só visual; a regra real fica no servidor). */
  function forcaDaSenha(senha) {
    let pontos = 0;
    if (senha.length >= 8) pontos++;
    if (senha.length >= 12) pontos++;
    if (/[a-zà-ÿ]/.test(senha) && /[A-ZÀ-Ý]/.test(senha)) pontos++;
    if (/\d/.test(senha) && /[^A-Za-z0-9]/.test(senha)) pontos++;
    return pontos;
  }

  function medidorSenha(entrada) {
    const barra = el('span');
    const medidor = el('div', { classe: 'medidor-senha', 'aria-hidden': 'true' }, [barra]);
    const cores = ['#d9534f', '#e38b3c', '#d6b23a', '#6cae5a', '#2f8f5b'];
    entrada.addEventListener('input', () => {
      const forca = entrada.value ? forcaDaSenha(entrada.value) : 0;
      barra.style.width = `${entrada.value ? 20 + forca * 20 : 0}%`;
      barra.style.backgroundColor = cores[forca];
    });
    return medidor;
  }

  // ----------------------------------------------------------------
  // Datas
  // ----------------------------------------------------------------
  function formatarDataHora(iso, fuso, estilo = 'completo') {
    const data = new Date(iso);
    const opcoesPorEstilo = {
      completo: { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' },
      hora: { hour: '2-digit', minute: '2-digit' },
      dia: { day: '2-digit', month: '2-digit' },
      semana: { weekday: 'short' },
      dataHora: { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' },
    };
    return new Intl.DateTimeFormat('pt-BR', { timeZone: fuso || 'America/Manaus', hourCycle: 'h23', ...opcoesPorEstilo[estilo] }).format(data).replace('.', '');
  }

  /** Lê ?voltar=/caminho com segurança (só caminhos do próprio site). */
  function destinoSeguro(padrao) {
    const voltar = new URLSearchParams(location.search).get('voltar');
    if (voltar && /^\/(?!\/)[A-Za-z0-9/_\-?=&#%.]*$/.test(voltar)) return voltar;
    return padrao;
  }

  function iniciais(nome) {
    return String(nome || '?').trim().split(/\s+/).slice(0, 2).map((parte) => parte[0]).join('').toUpperCase();
  }

  raiz.StylOS = {
    el, trocar, icone, marca, api, ErroApi, avisar, janela, confirmar, copiar, blocoCopiavel,
    campo, alerta, medidorSenha, formatarDataHora, destinoSeguro, iniciais,
  };
})(window);
