/**
 * editor.js — EDITOR DE PÁGINAS por seções (blocos).
 * ------------------------------------------------------------------
 * Painel da esquerda:  lista de seções  ⇄  campos da seção escolhida  ⇄  tema
 * Área da direita:     prévia ao vivo (iframe /pre-visualizacao), em
 *                      computador, tablet ou celular.
 *
 * Boas práticas OBRIGATÓRIAS (o editor e o servidor conferem):
 *  - a página começa com o Cabeçalho e termina com o Rodapé (ficam travados);
 *  - campos obrigatórios preenchidos; seções únicas não se repetem.
 *
 * O rascunho é salvo sozinho a cada alteração. O público só vê a página
 * depois de "Publicar".
 */
(function () {
  'use strict';
  const { el, trocar, icone, api, avisar, janela, confirmar, copiar, blocoCopiavel, alerta } = window.StylOS;
  const Esquemas = window.EsquemasStylOS;
  const TIPOS = Esquemas.TIPOS_SECAO;

  const idPagina = Number(new URLSearchParams(location.search).get('id'));
  const topo = document.getElementById('editor-topo');
  const painel = document.getElementById('painel-edicao');
  const corpoEditor = document.getElementById('editor-corpo');
  const iframe = document.getElementById('previa');
  const moldura = document.getElementById('moldura-previa');
  const areaPrevia = document.getElementById('area-previa');

  const estado = {
    pagina: null,
    conteudo: null,
    titulo: '',
    vista: 'lista',           // 'lista' | 'secao' | 'tema'
    secaoSelecionada: null,
    dispositivo: 'computador',
    agendaPrevia: { ativa: true, servicos: [] },
    videos: new Map(),          // id → situação do vídeo (na fila, otimizando, pronto...)
    ferramentasVideo: { disponivel: false, mensagem: '' },
    enviosEmAndamento: 0,
    previaPronta: false,
    alteracoesPendentes: false,
    salvando: false,
    erroAoSalvar: false,
    usuario: null,
    urlPublica: '',
  };

  const DISPOSITIVOS = {
    computador: { largura: 1280, altura: 800, icone: 'computador', nome: 'Computador' },
    tablet: { largura: 820, altura: 1180, icone: 'tablet', nome: 'Tablet' },
    celular: { largura: 390, altura: 844, icone: 'celular', nome: 'Celular' },
  };

  // ================================================================
  // SALVAR AUTOMATICAMENTE
  // ================================================================
  let temporizadorSalvar = null;
  let temporizadorPrevia = null;
  const indicadorEstado = el('span', { classe: 'editor__estado', 'aria-live': 'polite' });

  function atualizarIndicador() {
    indicadorEstado.classList.toggle('editor__estado--erro', estado.erroAoSalvar);
    const [nomeIcone, texto] = estado.erroAoSalvar ? ['alerta', 'Erro ao salvar — tentando de novo']
      : estado.salvando || estado.alteracoesPendentes ? ['relogio', 'Salvando…'] : ['check', 'Rascunho salvo'];
    trocar(indicadorEstado, icone(nomeIcone, 15), el('span', { texto }));
  }

  /** Chamado a cada alteração: atualiza a prévia e agenda o salvamento. */
  function aoMudar({ redesenharLista = false } = {}) {
    estado.alteracoesPendentes = true;
    atualizarIndicador();
    clearTimeout(temporizadorPrevia);
    temporizadorPrevia = setTimeout(enviarParaPrevia, 120);
    clearTimeout(temporizadorSalvar);
    temporizadorSalvar = setTimeout(salvar, 1200);
    if (redesenharLista && estado.vista === 'lista') desenharPainel();
  }

  async function salvar() {
    if (estado.salvando) {
      clearTimeout(temporizadorSalvar);
      temporizadorSalvar = setTimeout(salvar, 500);
      return;
    }
    if (!estado.alteracoesPendentes) return;
    estado.salvando = true;
    estado.alteracoesPendentes = false;
    atualizarIndicador();
    try {
      await api(`/api/adm/paginas/${idPagina}`, { metodo: 'PUT', corpo: { titulo: estado.titulo, conteudo: estado.conteudo } });
      estado.erroAoSalvar = false;
    } catch (erro) {
      estado.erroAoSalvar = true;
      estado.alteracoesPendentes = true;
      if (erro.status === 400) avisar(erro.message, 'erro');
      clearTimeout(temporizadorSalvar);
      temporizadorSalvar = setTimeout(salvar, 5000);
    }
    estado.salvando = false;
    atualizarIndicador();
  }

  /** Garante que tudo foi salvo (antes de publicar ou sair). */
  async function salvarAgora() {
    clearTimeout(temporizadorSalvar);
    while (estado.salvando) await new Promise((resolver) => setTimeout(resolver, 100));
    if (estado.alteracoesPendentes) await salvar();
    if (estado.erroAoSalvar) throw new Error('Não foi possível salvar. Verifique a conexão.');
  }

  window.addEventListener('beforeunload', (evento) => {
    if (estado.alteracoesPendentes || estado.salvando || estado.enviosEmAndamento > 0) {
      evento.preventDefault();
      evento.returnValue = '';
    }
  });

  // ================================================================
  // PRÉVIA (iframe)
  // ================================================================
  function enviarParaPrevia() {
    if (!estado.previaPronta || !estado.conteudo) return;
    iframe.contentWindow.postMessage({
      tipo: 'renderizar',
      conteudo: estado.conteudo,
      agenda: estado.agendaPrevia,
      secaoSelecionada: estado.secaoSelecionada,
      videosPendentes: [...estado.videos.values()].filter((video) => video.status !== 'pronto').map((video) => video.id),
    }, location.origin);
  }

  function selecionarNaPrevia(secaoId, rolar) {
    if (estado.previaPronta) iframe.contentWindow.postMessage({ tipo: 'selecionar', secaoId, rolar }, location.origin);
  }

  window.addEventListener('message', (evento) => {
    if (evento.origin !== location.origin || evento.source !== iframe.contentWindow) return;
    const mensagem = evento.data || {};
    if (mensagem.tipo === 'pronto') {
      estado.previaPronta = true;
      enviarParaPrevia();
    } else if (mensagem.tipo === 'selecionar') {
      abrirSecao(mensagem.secaoId, false);
    }
  });

  /** Ajusta o tamanho/escala da prévia conforme o dispositivo escolhido. */
  function ajustarPrevia() {
    const dispositivo = DISPOSITIVOS[estado.dispositivo];
    const espacoLargura = areaPrevia.clientWidth - 48;
    const espacoAltura = areaPrevia.clientHeight - 48;
    if (espacoLargura <= 0 || espacoAltura <= 0) return;
    let largura = dispositivo.largura;
    let altura = dispositivo.altura;
    if (estado.dispositivo === 'computador') altura = Math.max(600, Math.round(espacoAltura * (largura / espacoLargura)));
    const escala = Math.min(1, espacoLargura / largura, espacoAltura / altura);
    moldura.style.width = `${largura}px`;
    moldura.style.height = `${altura}px`;
    moldura.style.transform = `translate(-50%, -50%) scale(${escala})`;
    moldura.classList.toggle('moldura-previa--celular', estado.dispositivo === 'celular');
    document.getElementById('escala-previa').textContent = `${dispositivo.nome} · ${Math.round(escala * 100)}%`;
  }
  new ResizeObserver(ajustarPrevia).observe(areaPrevia);

  // ================================================================
  // BARRA DO TOPO
  // ================================================================
  function desenharTopo() {
    const campoTitulo = el('input', {
      classe: 'editor__titulo', valor: estado.titulo, maxlength: '80', 'aria-label': 'Nome da página',
      aoInput: (evento) => { estado.titulo = evento.target.value; aoMudar(); },
    });
    const dispositivos = el('div', { classe: 'dispositivos', role: 'group', 'aria-label': 'Tamanho da prévia', id: 'botoes-dispositivo' },
      Object.entries(DISPOSITIVOS).map(([id, dispositivo]) => el('button', {
        type: 'button', 'aria-pressed': String(id === estado.dispositivo), 'aria-label': `Prévia no ${dispositivo.nome.toLowerCase()}`, title: dispositivo.nome,
        aoClick: (evento) => {
          estado.dispositivo = id;
          dispositivos.querySelectorAll('button').forEach((botao) => botao.setAttribute('aria-pressed', 'false'));
          evento.currentTarget.setAttribute('aria-pressed', 'true');
          ajustarPrevia();
        },
      }, [icone(dispositivo.icone, 18)])));
    atualizarIndicador();
    trocar(topo, 
      el('a', { classe: 'botao botao--fantasma botao--pequeno', href: '/painel#paginas', 'aria-label': 'Voltar ao painel' }, [icone('setaEsquerda', 18), el('span', { classe: 'rotulo-longo', texto: 'Painel' })]),
      campoTitulo,
      indicadorEstado,
      el('span', { classe: 'editor__espaco' }),
      dispositivos,
      el('button', { classe: 'botao botao--fantasma botao--pequeno', type: 'button', id: 'botao-ajuda-editor', 'aria-label': 'Ver tutorial do editor', aoClick: iniciarTutorialEditor }, [icone('ajuda', 18)]),
      estado.pagina.publicada ? el('a', { classe: 'botao botao--fantasma botao--pequeno', href: `/p/${estado.pagina.slug}`, target: '_blank', rel: 'noopener', title: 'Ver página publicada' }, [icone('olho', 18), el('span', { classe: 'rotulo-longo', texto: 'Ver no ar' })]) : null,
      el('button', { classe: 'botao botao--primario botao--pequeno', type: 'button', id: 'botao-publicar', aoClick: publicar }, [icone('foguete', 16), estado.pagina.publicada ? 'Atualizar' : 'Publicar']),
    );
  }

  // ================================================================
  // PAINEL DA ESQUERDA
  // ================================================================
  function desenharPainel() {
    if (estado.vista === 'secao') return desenharFormularioSecao();
    if (estado.vista === 'tema') return desenharTema();
    return desenharLista();
  }

  /** Texto curto que identifica a seção na lista (ex.: o título dela). */
  function resumoDaSecao(secao) {
    const dados = secao.dados;
    return (dados.titulo || dados.nomeMarca || '').replace(/\*/g, '') || TIPOS[secao.tipo].descricao;
  }

  function errosPorSecao() {
    const { erros } = Esquemas.verificarParaPublicar(estado.conteudo);
    const mapa = new Map();
    for (const erro of erros) if (erro.secaoId) mapa.set(erro.secaoId, (mapa.get(erro.secaoId) || 0) + 1);
    return mapa;
  }

  // ---------- Lista de seções ----------
  let indiceArrastado = null;

  function desenharLista() {
    const secoes = estado.conteudo.secoes;
    const comErro = errosPorSecao();
    const lista = el('ol', { classe: 'lista-secoes', id: 'lista-secoes', 'aria-label': 'Seções da página, na ordem em que aparecem' });

    secoes.forEach((secao, indice) => {
      const modelo = TIPOS[secao.tipo];
      const fixa = Boolean(modelo.fixa);
      const podeSubir = !fixa && indice > 1;
      const podeDescer = !fixa && indice < secoes.length - 2;
      const item = el('li', {
        classe: `item-secao ${fixa ? 'item-secao--fixa' : ''} ${secao.id === estado.secaoSelecionada ? 'item-secao--selecionada' : ''} ${comErro.has(secao.id) ? 'item-secao--com-erro' : ''}`,
        draggable: fixa ? null : 'true',
        dados: { indice: String(indice) },
      }, [
        el('button', { classe: 'item-secao__alca', type: 'button', disabled: fixa ? true : null, tabindex: '-1', 'aria-hidden': 'true', title: fixa ? 'Posição fixa' : 'Arraste para mudar a ordem' }, [icone(fixa ? 'cadeado' : 'arrastar', 16)]),
        el('span', { classe: 'item-secao__icone' }, [icone(modelo.icone, 18)]),
        el('button', { classe: 'item-secao__abrir', type: 'button', aoClick: () => abrirSecao(secao.id, true) }, [
          el('strong', {}, [modelo.nome, comErro.has(secao.id) ? el('span', { classe: 'etiqueta etiqueta--perigo', texto: ` ${comErro.get(secao.id)} pendente(s)` }) : null]),
          el('span', { texto: resumoDaSecao(secao) }),
        ]),
        fixa
          ? el('span', { classe: 'item-secao__cadeado', title: modelo.posicao === 'primeira' ? 'Sempre a primeira seção' : 'Sempre a última seção' }, [icone('cadeado', 15)])
          : el('span', { classe: 'item-secao__acoes' }, [
              el('button', { type: 'button', 'aria-label': `Subir ${modelo.nome}`, title: 'Subir', disabled: podeSubir ? null : true, aoClick: () => moverSecao(indice, indice - 1) }, [icone('setaCima', 16)]),
              el('button', { type: 'button', 'aria-label': `Descer ${modelo.nome}`, title: 'Descer', disabled: podeDescer ? null : true, aoClick: () => moverSecao(indice, indice + 1) }, [icone('setaBaixo', 16)]),
              el('button', { type: 'button', 'aria-label': `Excluir ${modelo.nome}`, title: 'Excluir', aoClick: () => excluirSecao(secao.id) }, [icone('lixeira', 16)]),
            ]),
      ]);

      if (!fixa) {
        item.addEventListener('dragstart', (evento) => {
          indiceArrastado = indice;
          item.classList.add('item-secao--arrastando');
          evento.dataTransfer.effectAllowed = 'move';
          evento.dataTransfer.setData('text/plain', String(indice));
        });
        item.addEventListener('dragend', () => { indiceArrastado = null; desenharLista(); });
      }
      item.addEventListener('dragover', (evento) => {
        if (indiceArrastado === null) return;
        const acima = evento.offsetY < item.offsetHeight / 2;
        const destino = acima ? indice : indice + 1;
        if (destino < 1 || destino > secoes.length - 1) return; // não passa do cabeçalho/rodapé
        evento.preventDefault();
        item.classList.toggle('item-secao--alvo-acima', acima);
        item.classList.toggle('item-secao--alvo-abaixo', !acima);
      });
      item.addEventListener('dragleave', () => item.classList.remove('item-secao--alvo-acima', 'item-secao--alvo-abaixo'));
      item.addEventListener('drop', (evento) => {
        evento.preventDefault();
        if (indiceArrastado === null) return;
        const acima = evento.offsetY < item.offsetHeight / 2;
        let destino = acima ? indice : indice + 1;
        if (destino > indiceArrastado) destino -= 1;
        destino = Math.max(1, Math.min(secoes.length - 2, destino));
        moverSecao(indiceArrastado, destino);
      });
      lista.append(item);

      // Botão "adicionar" logo antes do rodapé
      if (indice === secoes.length - 2) {
        lista.append(el('li', {}, [el('button', { classe: 'botao-adicionar-secao', type: 'button', id: 'botao-adicionar-secao', aoClick: () => abrirGaleriaDeSecoes() }, [icone('mais', 18), 'Adicionar seção'])]));
      }
    });

    const tema = Esquemas.TEMAS[estado.conteudo.tema];
    trocar(painel, 
      el('div', { classe: 'painel-edicao__cabecalho' }, [el('h2', {}, [icone('lista', 18), 'Seções da página'])]),
      el('div', { classe: 'painel-edicao__rolagem' }, [
        el('button', { classe: 'item-secao', type: 'button', id: 'botao-tema', aoClick: () => { estado.vista = 'tema'; desenharPainel(); } }, [
          el('span', { classe: 'item-secao__icone' }, [icone('pincel', 18)]),
          el('span', { classe: 'item-secao__abrir' }, [el('strong', { texto: 'Aparência (tema)' }), el('span', { texto: tema.nome })]),
          icone('seta', 16),
        ]),
        el('p'),
        lista,
        el('p', { classe: 'dica-regras' }, [icone('info', 16), el('span', { texto: 'O Cabeçalho é sempre a primeira tela e o Rodapé a última. Cada seção ocupa uma tela inteira. Arraste ou use as setas para mudar a ordem.' })]),
      ]),
    );
  }

  function moverSecao(de, para) {
    const secoes = estado.conteudo.secoes;
    if (para < 1 || para > secoes.length - 2 || de === para) return desenharLista();
    const [secao] = secoes.splice(de, 1);
    secoes.splice(para, 0, secao);
    aoMudar();
    desenharLista();
    selecionarNaPrevia(secao.id, true);
  }

  async function excluirSecao(secaoId) {
    const secao = estado.conteudo.secoes.find((item) => item.id === secaoId);
    if (!secao || TIPOS[secao.tipo].fixa) return;
    if (!(await confirmar(`Excluir a seção "${TIPOS[secao.tipo].nome}"? (Dá para adicionar de novo, mas o texto se perde.)`, { botao: 'Excluir', perigo: true }))) return;
    estado.conteudo.secoes = estado.conteudo.secoes.filter((item) => item.id !== secaoId);
    if (estado.secaoSelecionada === secaoId) estado.secaoSelecionada = null;
    estado.vista = 'lista';
    aoMudar();
    desenharPainel();
  }

  function abrirGaleriaDeSecoes() {
    const existentes = new Set(estado.conteudo.secoes.map((secao) => secao.tipo));
    const caixa = janela({
      titulo: 'Adicionar seção',
      icone: 'mais',
      larga: true,
      conteudo: [
        el('p', { classe: 'texto-suave', texto: 'Escolha um modelo. Ele entra antes do Rodapé e você pode mudar a ordem depois.' }),
        el('div', { classe: 'galeria-modelos' }, Esquemas.ORDEM_GALERIA.map((tipo) => {
          const modelo = TIPOS[tipo];
          const bloqueado = modelo.unica && existentes.has(tipo);
          return el('button', {
            classe: 'modelo-secao', type: 'button', disabled: bloqueado ? true : null,
            aoClick: () => {
              const nova = Esquemas.criarSecao(tipo);
              const secoes = estado.conteudo.secoes;
              secoes.splice(secoes.length - 1, 0, nova);
              caixa.fechar();
              aoMudar();
              abrirSecao(nova.id, true);
            },
          }, [
            el('span', { classe: 'modelo-secao__desenho' }, [icone(modelo.icone, 38)]),
            el('strong', { texto: modelo.nome }),
            el('span', { texto: bloqueado ? 'Já existe na página (só pode ter uma).' : modelo.descricao }),
          ]);
        })),
      ],
    });
  }

  // ---------- Tema ----------
  function desenharTema() {
    const grupos = { masculino: 'Estilo masculino', feminino: 'Estilo feminino', neutro: 'Neutro' };
    const conteudoTemas = [];
    for (const [publico, rotulo] of Object.entries(grupos)) {
      conteudoTemas.push(el('p', { classe: 'campo__rotulo', texto: rotulo }));
      conteudoTemas.push(el('div', { classe: 'temas' }, Object.entries(Esquemas.TEMAS).filter(([, tema]) => tema.publico === publico).map(([id, tema]) => el('button', {
        classe: 'tema-opcao', type: 'button', 'aria-pressed': String(estado.conteudo.tema === id),
        aoClick: () => { estado.conteudo.tema = id; aoMudar(); desenharTema(); },
      }, [
        el('span', { classe: 'tema-opcao__amostra' }, tema.cores.map((cor) => { const faixa = el('span'); faixa.style.background = cor; return faixa; })),
        el('strong', { texto: tema.nome }),
        el('small', { texto: tema.descricao }),
      ]))));
      conteudoTemas.push(el('div', { classe: 'campo' }));
    }
    trocar(painel, 
      el('div', { classe: 'painel-edicao__cabecalho' }, [
        el('button', { classe: 'botao botao--fantasma botao--pequeno', type: 'button', aoClick: voltarParaLista }, [icone('setaEsquerda', 16), 'Seções']),
        el('h2', {}, [icone('pincel', 18), 'Aparência']),
      ]),
      el('div', { classe: 'painel-edicao__rolagem' }, [
        el('p', { classe: 'texto-suave texto-pequeno', texto: 'O tema muda cores, letras e formas de TODA a página. Seus textos e fotos continuam iguais.' }),
        ...conteudoTemas,
      ]),
    );
  }

  function voltarParaLista() {
    estado.vista = 'lista';
    desenharPainel();
  }

  // ---------- Formulário de uma seção ----------
  function abrirSecao(secaoId, rolarPrevia) {
    if (!estado.conteudo.secoes.some((secao) => secao.id === secaoId)) return;
    estado.secaoSelecionada = secaoId;
    estado.vista = 'secao';
    desenharPainel();
    selecionarNaPrevia(secaoId, rolarPrevia);
    if (window.matchMedia('(max-width: 760px)').matches) trocarAbaCelular('editar');
  }

  function desenharFormularioSecao(campoEmFoco) {
    const secao = estado.conteudo.secoes.find((item) => item.id === estado.secaoSelecionada);
    if (!secao) return voltarParaLista();
    const modelo = TIPOS[secao.tipo];
    const rolagemAnterior = painel.querySelector('.painel-edicao__rolagem')?.scrollTop || 0;

    const principais = el('fieldset', { classe: 'grupo-campos' }, [el('legend', { texto: 'Conteúdo' })]);
    const menu = el('fieldset', { classe: 'grupo-campos' }, [el('legend', { texto: 'Menu do cabeçalho' })]);
    const aparencia = el('fieldset', { classe: 'grupo-campos' }, [el('legend', { texto: 'Aparência' })]);
    for (const campo of modelo.campos) {
      const destino = campo.grupo === 'menu' ? menu : campo.grupo === 'aparencia' ? aparencia : principais;
      destino.append(criarCampo(campo, secao.dados, `${secao.id}-${campo.chave}`, () => aoMudar()));
    }
    if (secao.tipo === 'cabecalho') {
      principais.append(alerta('Os links do menu são as seções marcadas com "Mostrar link no menu". O botão leva até a seção de Agendamento.', 'info'));
    }
    if (secao.tipo === 'agendamento') {
      principais.append(alerta('Serviços, dias e horários vêm de "Agenda e WhatsApp" no painel. Na prévia aparecem horários de exemplo.', 'info'));
    }

    trocar(painel, 
      el('div', { classe: 'painel-edicao__cabecalho' }, [
        el('button', { classe: 'botao botao--fantasma botao--pequeno', type: 'button', id: 'voltar-secoes', aoClick: voltarParaLista }, [icone('setaEsquerda', 16), 'Seções']),
        el('h2', {}, [icone(modelo.icone, 18), modelo.nome]),
      ]),
      el('div', { classe: 'painel-edicao__rolagem' }, [
        el('p', { classe: 'texto-suave texto-pequeno', texto: modelo.descricao }),
        principais,
        menu.childElementCount > 1 ? menu : null,
        aparencia.childElementCount > 1 ? aparencia : null,
      ]),
      modelo.fixa ? null : el('div', { classe: 'painel-edicao__rodape' }, [
        el('button', { classe: 'botao botao--perigo botao--pequeno', type: 'button', aoClick: () => excluirSecao(secao.id) }, [icone('lixeira', 16), 'Excluir esta seção']),
      ]),
    );
    painel.querySelector('.painel-edicao__rolagem').scrollTop = rolagemAnterior;
    if (campoEmFoco) {
      const alvo = document.getElementById(campoEmFoco);
      if (alvo) { alvo.focus(); alvo.scrollIntoView({ block: 'center' }); }
    }
  }

  /**
   * Cria o controle de UM campo conforme o tipo do esquema.
   * "dados" é o objeto onde o valor é gravado (seção ou item de lista).
   */
  function criarCampo(campo, dados, idCampo, aoAlterar) {
    const rotulo = el('label', { for: idCampo }, [campo.rotulo, campo.obrigatorio ? el('span', { classe: 'texto-suave', texto: ' *' }) : null]);
    const caixa = el('div', { classe: 'campo' });
    const dica = (texto) => (texto ? el('span', { classe: 'campo__dica', texto }) : null);

    switch (campo.tipo) {
      case 'texto':
      case 'textoLongo': {
        const ehLongo = campo.tipo === 'textoLongo';
        const contador = el('span', { classe: 'campo__contador' });
        const atualizarContador = (valor) => { contador.textContent = `${valor.length}/${campo.max}`; };
        const entrada = el(ehLongo ? 'textarea' : 'input', {
          id: idCampo, maxlength: String(campo.max), rows: ehLongo ? '3' : null, valor: dados[campo.chave] || '',
          aoInput: (evento) => { dados[campo.chave] = evento.target.value; atualizarContador(evento.target.value); aoAlterar(); },
        });
        atualizarContador(dados[campo.chave] || '');
        const dicaTitulo = campo.chave === 'titulo' ? 'Dica: coloque uma palavra entre *asteriscos* para destacá-la.' : '';
        caixa.append(rotulo, entrada, el('div', { classe: 'copiavel' }, [dica(campo.dica || dicaTitulo) || el('span'), contador]));
        break;
      }
      case 'url':
      case 'video': {
        const retorno = el('span', { classe: 'campo__dica' });
        const validar = (valor) => {
          if (campo.tipo === 'video') {
            retorno.textContent = !valor ? (campo.dica || '') : Esquemas.extrairVideo(valor) ? '✓ Vídeo reconhecido' : 'Link não reconhecido. Use um link do YouTube ou Vimeo.';
          } else {
            retorno.textContent = !valor || /^https?:\/\/\S+\.\S+/.test(valor) ? '' : 'Comece com https://';
          }
        };
        const entrada = el('input', {
          id: idCampo, type: 'url', inputmode: 'url', placeholder: 'https://', valor: dados[campo.chave] || '',
          aoInput: (evento) => { dados[campo.chave] = evento.target.value.trim(); validar(dados[campo.chave]); aoAlterar(); },
        });
        validar(dados[campo.chave]);
        caixa.append(rotulo, entrada, retorno);
        break;
      }
      case 'booleano': {
        const entrada = el('input', {
          id: idCampo, type: 'checkbox', checked: dados[campo.chave] ? true : null,
          aoChange: (evento) => { dados[campo.chave] = evento.target.checked; aoAlterar(); },
        });
        caixa.append(el('label', { classe: 'caixa-marcar', for: idCampo }, [entrada, el('span', { texto: campo.rotulo })]));
        break;
      }
      case 'escolha': {
        const grupo = el('div', { classe: 'escolhas', role: 'group', id: idCampo, 'aria-label': campo.rotulo });
        for (const [valor, texto] of campo.opcoes) {
          grupo.append(el('button', {
            classe: 'escolha', type: 'button', 'aria-pressed': String(dados[campo.chave] === valor), texto,
            aoClick: (evento) => {
              dados[campo.chave] = valor;
              grupo.querySelectorAll('.escolha').forEach((botao) => botao.setAttribute('aria-pressed', 'false'));
              evento.currentTarget.setAttribute('aria-pressed', 'true');
              aoAlterar();
            },
          }));
        }
        caixa.append(el('span', { classe: 'campo__rotulo', texto: campo.rotulo }), grupo);
        break;
      }
      case 'numero': {
        // usado para estrelas (1 a 5)
        const grupo = el('div', { classe: 'estrelas-entrada', role: 'radiogroup', id: idCampo, 'aria-label': campo.rotulo });
        const desenharEstrelas = () => trocar(grupo, ...Array.from({ length: campo.maximo }, (_, indice) => el('button', {
          type: 'button', role: 'radio', 'aria-checked': String(dados[campo.chave] === indice + 1), 'aria-label': `${indice + 1} estrela(s)`,
          classe: indice < dados[campo.chave] ? 'acesa' : '',
          aoClick: () => { dados[campo.chave] = indice + 1; desenharEstrelas(); aoAlterar(); },
        }, [icone('estrela', 22)])));
        desenharEstrelas();
        caixa.append(el('span', { classe: 'campo__rotulo', texto: campo.rotulo }), grupo);
        break;
      }
      case 'imagem':
      case 'midia':
        caixa.append(
          el('span', { classe: 'campo__rotulo' }, [campo.rotulo, campo.obrigatorio ? el('span', { classe: 'texto-suave', texto: ' *' }) : null]),
          controleMidia(campo, dados, idCampo, aoAlterar),
        );
        // (append(null) escreveria "null" na tela, por isso o "if")
        if (campo.dica) caixa.append(el('span', { classe: 'campo__dica', texto: campo.dica }));
        break;
      case 'lista':
        caixa.append(el('span', { classe: 'campo__rotulo', texto: `${campo.rotulo} (${(dados[campo.chave] || []).length}/${campo.max})` }), controleLista(campo, dados, idCampo, aoAlterar));
        break;
      default:
        break;
    }
    return caixa;
  }

  // ---------- Lista de itens (serviços, depoimentos, fotos...) ----------
  const itensAbertos = new Set();

  function controleLista(campo, dados, idCampo, aoAlterar) {
    dados[campo.chave] = dados[campo.chave] || [];
    const itens = dados[campo.chave];
    const area = el('div', { classe: 'lista-itens', id: idCampo });
    const redesenhar = () => {
      aoAlterar();
      desenharFormularioSecao();
    };
    itens.forEach((item, indice) => {
      const chaveAberta = `${idCampo}-${indice}`;
      const primeiroTexto = campo.campos.map((subcampo) => item[subcampo.chave]).find((valor) => typeof valor === 'string' && valor && !valor.startsWith('/'));
      const detalhes = el('details', { classe: 'item-lista', open: itensAbertos.has(chaveAberta) ? true : null }, [
        el('summary', {}, [
          icone('seta', 14),
          el('span', { classe: 'resumo-texto', texto: `${campo.rotuloItem || 'Item'} ${indice + 1}${primeiroTexto ? ` · ${primeiroTexto}` : ''}` }),
          el('span', { classe: 'item-lista__acoes' }, [
            el('button', { type: 'button', 'aria-label': 'Subir', disabled: indice === 0 ? true : null, aoClick: (evento) => { evento.preventDefault(); [itens[indice - 1], itens[indice]] = [itens[indice], itens[indice - 1]]; redesenhar(); } }, [icone('setaCima', 14)]),
            el('button', { type: 'button', 'aria-label': 'Descer', disabled: indice === itens.length - 1 ? true : null, aoClick: (evento) => { evento.preventDefault(); [itens[indice + 1], itens[indice]] = [itens[indice], itens[indice + 1]]; redesenhar(); } }, [icone('setaBaixo', 14)]),
            el('button', {
              type: 'button', 'aria-label': 'Remover', disabled: campo.min && itens.length <= campo.min ? true : null,
              aoClick: (evento) => { evento.preventDefault(); itens.splice(indice, 1); itensAbertos.delete(chaveAberta); redesenhar(); },
            }, [icone('lixeira', 14)]),
          ]),
        ]),
        el('div', { classe: 'item-lista__corpo' }, campo.campos.map((subcampo) => criarCampo(subcampo, item, `${chaveAberta}-${subcampo.chave}`, aoAlterar))),
      ]);
      detalhes.addEventListener('toggle', () => { if (detalhes.open) itensAbertos.add(chaveAberta); else itensAbertos.delete(chaveAberta); });
      area.append(detalhes);
    });
    if (itens.length < (campo.max || 20)) {
      area.append(el('button', {
        classe: 'botao botao--secundario botao--pequeno', type: 'button',
        aoClick: () => {
          const novo = {};
          for (const subcampo of campo.campos) novo[subcampo.chave] = subcampo.tipo === 'numero' ? (subcampo.maximo || 5) : subcampo.tipo === 'booleano' ? false : '';
          itens.push(novo);
          itensAbertos.add(`${idCampo}-${itens.length - 1}`);
          redesenhar();
        },
      }, [icone('mais', 16), `Adicionar ${String(campo.rotuloItem || 'item').toLowerCase()}`]));
    }
    return area;
  }

  // ---------- Fotos ----------
  /**
   * Reduz a foto no navegador antes de enviar (máx. 1920 px, formato WEBP).
   * Uma foto de celular de 6 MB costuma virar ~300 KB, sem perda visível.
   */
  async function reduzirImagem(arquivo) {
    if (!/^image\/(jpeg|png|webp)$/.test(arquivo.type)) {
      throw new Error('Formato não aceito. Use JPG, PNG ou WEBP (fotos do iPhone em HEIC: exporte como JPG).');
    }
    const bitmap = await createImageBitmap(arquivo);
    const ladoMaximo = 1920;
    const escala = Math.min(1, ladoMaximo / Math.max(bitmap.width, bitmap.height));
    const tela = document.createElement('canvas');
    tela.width = Math.round(bitmap.width * escala);
    tela.height = Math.round(bitmap.height * escala);
    tela.getContext('2d').drawImage(bitmap, 0, 0, tela.width, tela.height);
    bitmap.close && bitmap.close();
    const gerar = (tipo) => new Promise((resolver) => tela.toBlob(resolver, tipo, 0.85));
    let resultado = await gerar('image/webp');
    if (!resultado || resultado.type !== 'image/webp') resultado = await gerar('image/jpeg');
    return resultado;
  }

  async function enviarFoto(arquivo) {
    const reduzida = await reduzirImagem(arquivo);
    const resposta = await api('/api/adm/arquivos', { metodo: 'POST', corpoBinario: reduzida, tipoConteudo: reduzida.type });
    return resposta.url;
  }

  // ---------- Vídeos ----------
  const formatarMb = (bytes) => `${(bytes / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: bytes < 10485760 ? 1 : 0 })} MB`;
  const formatarDuracao = (segundos) => `${Math.floor(segundos / 60)}:${String(Math.round(segundos % 60)).padStart(2, '0')}`;

  /** Lista os vídeos do ADM (e se o FFmpeg está disponível). */
  async function carregarVideos() {
    try {
      const dados = await api('/api/adm/videos');
      estado.ferramentasVideo = { disponivel: dados.disponivel, mensagem: dados.mensagem, tamanhoMaximoMb: dados.tamanhoMaximoMb };
      estado.videos = new Map(dados.videos.map((video) => [video.id, video]));
      acompanharVideos();
    } catch {
      estado.ferramentasVideo = { disponivel: false, mensagem: 'Não foi possível verificar os vídeos.' };
    }
  }

  /** Texto + barra que mostram a situação de um vídeo. */
  function conteudoEstadoVideo(video) {
    if (!video) return [el('span', { texto: 'Vídeo não encontrado. Escolha outro.' })];
    const barra = (porcento) => {
      const preenchida = el('span');
      preenchida.style.width = `${porcento}%`;
      return el('div', { classe: 'barra-envio', role: 'progressbar', 'aria-valuenow': String(porcento), 'aria-valuemin': '0', 'aria-valuemax': '100' }, [preenchida]);
    };
    if (video.status === 'na_fila') return [el('strong', { texto: `Na fila para otimizar${video.posicaoNaFila > 1 ? ` (posição ${video.posicaoNaFila})` : ''}…` }), barra(0)];
    if (video.status === 'processando') {
      return [el('strong', { texto: `Otimizando o vídeo… ${video.progresso}%` }), barra(video.progresso),
        el('span', { texto: 'Pode continuar editando. Publique quando terminar.' })];
    }
    if (video.status === 'erro') return [el('strong', { texto: 'Não foi possível usar este vídeo.' }), el('span', { texto: video.mensagem })];
    const economia = video.tamanhoOriginal ? Math.max(0, Math.round((1 - video.tamanhoFinal / video.tamanhoOriginal) * 100)) : 0;
    return [
      el('strong', { texto: `✓ Pronto${economia ? `: ${economia}% mais leve` : ''}` }),
      el('span', { texto: `${formatarMb(video.tamanhoOriginal)} → ${formatarMb(video.tamanhoFinal)} no computador · ${formatarMb(video.tamanhoMovel)} no celular · ${formatarDuracao(video.duracao)}` }),
    ];
  }

  function classeEstadoVideo(video) {
    return `estado-video ${video && video.status === 'erro' ? 'estado-video--erro' : video && video.status === 'pronto' ? 'estado-video--pronto' : ''}`;
  }

  /** Atualiza na tela (sem redesenhar o formulário, para não tirar o foco de quem digita). */
  function atualizarEstadosNaTela(video) {
    document.querySelectorAll(`[data-estado-video="${video.id}"]`).forEach((caixa) => {
      caixa.className = classeEstadoVideo(video);
      trocar(caixa, ...conteudoEstadoVideo(video));
    });
    if (video.status === 'pronto') {
      document.querySelectorAll(`[data-previa-video="${video.id}"]`).forEach((previa) => {
        trocar(previa, el('img', { src: `${video.url}/poster.jpg`, alt: '' }), el('span', { classe: 'selo-video-mini' }, [icone('play', 12), 'vídeo']));
      });
    }
  }

  /** Enquanto houver vídeo na fila/otimizando, pergunta ao servidor a cada 1,5 s. */
  let temporizadorVideos = null;
  function acompanharVideos() {
    if (temporizadorVideos) return;
    const verificar = async () => {
      const pendentes = [...estado.videos.values()].filter((video) => ['na_fila', 'processando'].includes(video.status));
      if (!pendentes.length) { temporizadorVideos = null; return; }
      let terminouAlgum = false;
      for (const video of pendentes) {
        try {
          const atual = await api(`/api/adm/videos/${video.id}`);
          estado.videos.set(atual.id, atual);
          atualizarEstadosNaTela(atual);
          if (atual.status === 'pronto' || atual.status === 'erro') {
            terminouAlgum = true;
            avisar(atual.status === 'pronto' ? 'Vídeo otimizado e pronto!' : 'Um vídeo deu erro ao otimizar.', atual.status === 'pronto' ? 'sucesso' : 'erro');
          }
        } catch { /* tenta de novo na próxima volta */ }
      }
      if (terminouAlgum) enviarParaPrevia();
      temporizadorVideos = setTimeout(verificar, 1500);
    };
    temporizadorVideos = setTimeout(verificar, 1500);
  }

  /**
   * Envia um vídeo em pedaços de 4 MB (com nova tentativa se a internet falhar)
   * e pede ao servidor para otimizar. aoProgredir(porcentagem do envio).
   */
  async function enviarVideo(arquivo, aoProgredir) {
    const limite = (estado.ferramentasVideo.tamanhoMaximoMb || 500) * 1048576;
    if (!/^video\//.test(arquivo.type) && !/\.(mp4|mov|m4v|webm|mkv|avi|3gp)$/i.test(arquivo.name)) throw new Error('Escolha um arquivo de vídeo (MP4, MOV, WEBM...).');
    if (arquivo.size > limite) throw new Error(`Vídeo grande demais (${formatarMb(arquivo.size)}). O limite é ${formatarMb(limite)}.`);
    estado.enviosEmAndamento += 1;
    try {
      const { id, tamanhoPedaco } = await api('/api/adm/videos', { corpo: { nome: arquivo.name, tamanho: arquivo.size } });
      let enviado = 0;
      while (enviado < arquivo.size) {
        const pedaco = arquivo.slice(enviado, enviado + tamanhoPedaco);
        let tentativas = 0;
        for (;;) {
          try {
            const resposta = await api(`/api/adm/videos/${id}/pedaco?inicio=${enviado}`, { metodo: 'PUT', corpoBinario: pedaco, tipoConteudo: 'application/octet-stream' });
            enviado = resposta.recebido;
            break;
          } catch (erro) {
            if (erro.status === 409 && erro.dados && Number.isInteger(erro.dados.recebido)) { enviado = erro.dados.recebido; break; }
            tentativas += 1;
            if (tentativas >= 4 || (erro.status && erro.status < 500 && erro.status !== 429)) throw erro;
            await new Promise((resolver) => setTimeout(resolver, 1500 * tentativas));
          }
        }
        aoProgredir(Math.round((enviado / arquivo.size) * 100));
      }
      const situacao = await api(`/api/adm/videos/${id}/concluir`, { corpo: {} });
      estado.videos.set(situacao.id, situacao);
      acompanharVideos();
      return situacao;
    } finally {
      estado.enviosEmAndamento -= 1;
    }
  }

  /** Miniatura do campo: foto, capa do vídeo ou ícone. */
  function previaDaMidia(valor) {
    const enderecos = Esquemas.enderecosDoVideo(valor);
    if (enderecos) {
      const video = estado.videos.get(enderecos.id);
      return el('span', { classe: 'campo-imagem__previa campo-imagem__previa--video', dados: { previaVideo: enderecos.id } }, video && video.status === 'pronto'
        ? [el('img', { src: enderecos.capa, alt: '' }), el('span', { classe: 'selo-video-mini' }, [icone('play', 12), 'vídeo'])]
        : [icone('filme', 26)]);
    }
    return valor ? el('img', { classe: 'campo-imagem__previa', src: valor, alt: 'Foto escolhida' }) : el('span', { classe: 'campo-imagem__previa' }, [icone('imagem', 26)]);
  }

  /** Campo "Foto ou vídeo" (ou só foto / só vídeo, conforme campo.aceita). */
  function controleMidia(campo, dados, idCampo, aoAlterar) {
    const valor = dados[campo.chave];
    const aceitaFoto = campo.tipo === 'imagem' || campo.aceita !== 'video';
    const aceitaVideo = campo.tipo === 'midia';
    const enderecos = Esquemas.enderecosDoVideo(valor);
    const areaEstado = el('div', { classe: 'campo-imagem__estado' });
    const definir = (url) => { dados[campo.chave] = url; aoAlterar(); desenharFormularioSecao(); };

    // Foto: reduzida no navegador (máx. 1920 px, WEBP)
    const seletorFoto = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', id: `${idCampo}-foto`, classe: 'so-leitor' });
    const botaoFoto = el('label', { classe: 'botao botao--secundario botao--pequeno', for: `${idCampo}-foto` }, [icone('imagem', 16), 'Foto']);
    seletorFoto.addEventListener('change', async () => {
      const arquivo = seletorFoto.files[0];
      if (!arquivo) return;
      botaoFoto.classList.add('carregando');
      try {
        definir(await enviarFoto(arquivo));
        avisar('Foto enviada!');
      } catch (erro) {
        avisar(erro.message, 'erro', 6000);
        botaoFoto.classList.remove('carregando');
      }
    });

    // Vídeo: enviado em pedaços e otimizado no servidor
    const seletorVideo = el('input', { type: 'file', accept: 'video/*,.mp4,.mov,.m4v,.webm,.mkv,.avi,.3gp', id: `${idCampo}-video`, classe: 'so-leitor', disabled: estado.ferramentasVideo.disponivel ? null : true });
    const botaoVideo = estado.ferramentasVideo.disponivel
      ? el('label', { classe: 'botao botao--secundario botao--pequeno', for: `${idCampo}-video` }, [icone('filme', 16), 'Vídeo'])
      : el('button', { classe: 'botao botao--secundario botao--pequeno', type: 'button', title: estado.ferramentasVideo.mensagem, aoClick: () => avisar(estado.ferramentasVideo.mensagem || 'Vídeos indisponíveis.', 'erro', 8000) }, [icone('filme', 16), 'Vídeo']);
    seletorVideo.addEventListener('change', async () => {
      const arquivo = seletorVideo.files[0];
      if (!arquivo) return;
      const preenchida = el('span');
      const textoEnvio = el('strong', { texto: 'Enviando o vídeo… 0%' });
      trocar(areaEstado, el('div', { classe: 'estado-video' }, [textoEnvio, el('div', { classe: 'barra-envio' }, [preenchida]), el('span', { texto: 'Não feche esta página até o envio terminar.' })]));
      botaoVideo.classList.add('carregando');
      try {
        const situacao = await enviarVideo(arquivo, (porcento) => {
          textoEnvio.textContent = `Enviando o vídeo… ${porcento}%`;
          preenchida.style.width = `${porcento}%`;
        });
        definir(situacao.url);
        enviarParaPrevia();
        avisar('Vídeo enviado! Agora ele está sendo otimizado.');
      } catch (erro) {
        botaoVideo.classList.remove('carregando');
        trocar(areaEstado, el('div', { classe: 'estado-video estado-video--erro' }, [el('strong', { texto: 'O envio não deu certo.' }), el('span', { texto: erro.message })]));
      }
    });

    if (enderecos) {
      const video = estado.videos.get(enderecos.id);
      areaEstado.append(el('div', { classe: classeEstadoVideo(video), dados: { estadoVideo: enderecos.id }, 'aria-live': 'polite' }, conteudoEstadoVideo(video)));
    }

    return el('div', { classe: 'campo-imagem' }, [
      previaDaMidia(valor),
      el('div', { classe: 'campo-imagem__acoes' }, [
        aceitaFoto ? seletorFoto : null,
        aceitaFoto ? botaoFoto : null,
        aceitaVideo ? seletorVideo : null,
        aceitaVideo ? botaoVideo : null,
        el('button', {
          classe: 'botao botao--fantasma botao--pequeno', type: 'button',
          aoClick: () => escolherDaGaleria(definir, { fotos: aceitaFoto, videos: aceitaVideo }),
        }, [icone('galeria', 16), 'Minhas mídias']),
        valor ? el('button', { classe: 'botao botao--fantasma botao--pequeno', type: 'button', 'aria-label': 'Remover', title: 'Remover', aoClick: () => definir('') }, [icone('fechar', 16)]) : null,
      ]),
      areaEstado,
    ]);
  }

  const ILUSTRACOES = ['capa', 'salao', 'corte', 'coloracao', 'tratamento', 'penteado', 'unhas', 'barba'].map((nome) => `/img/exemplo/${nome}.svg`);

  /** Janela "Minhas mídias": fotos enviadas, vídeos e ilustrações de exemplo. */
  async function escolherDaGaleria(aoEscolher, { fotos = true, videos = false } = {}) {
    let arquivos = [];
    try {
      if (fotos) arquivos = (await api('/api/adm/arquivos')).arquivos;
      if (videos) await carregarVideos();
    } catch (erro) {
      avisar(erro.message, 'erro');
    }
    const apagar = async (caminhoApi, texto) => {
      if (!(await confirmar(texto, { perigo: true, botao: 'Apagar' }))) return;
      try {
        await api(caminhoApi, { metodo: 'DELETE' });
        caixa.fechar();
        avisar('Apagado.');
      } catch (erro) {
        avisar(erro.message, 'erro', 6000);
      }
    };
    const item = ({ url, miniatura, selo, rodape, desativado, aoApagar }) => el('div', { classe: 'item-midia' }, [
      el('button', {
        classe: 'galeria__item', type: 'button', disabled: desativado ? true : null, 'aria-label': 'Usar este item',
        aoClick: () => { aoEscolher(url); caixa.fechar(); },
      }, [miniatura ? el('img', { src: miniatura, alt: '', loading: 'lazy' }) : el('span', { classe: 'campo-imagem__previa' }, [icone('filme', 26)])]),
      selo ? el('span', { classe: 'item-midia__selo' }, [icone('play', 11), selo]) : null,
      el('div', { classe: 'item-midia__rodape' }, [el('span', { texto: rodape || '' }), aoApagar ? el('button', { classe: 'botao botao--fantasma botao--icone botao--pequeno', type: 'button', 'aria-label': 'Apagar', aoClick: aoApagar }, [icone('lixeira', 14)]) : null]),
    ]);
    const listaVideos = [...estado.videos.values()];
    const nomesStatus = { na_fila: 'na fila', processando: 'otimizando', erro: 'erro' };
    const caixa = janela({
      titulo: 'Minhas mídias',
      icone: 'galeria',
      larga: true,
      conteudo: [
        videos ? el('h3', { texto: 'Vídeos' }) : null,
        videos ? (listaVideos.length
          ? el('div', { classe: 'galeria-midias' }, listaVideos.map((video) => item({
              url: video.url,
              miniatura: video.status === 'pronto' ? `${video.url}/poster.jpg` : null,
              selo: video.status === 'pronto' ? formatarDuracao(video.duracao) : nomesStatus[video.status],
              rodape: video.status === 'pronto' ? formatarMb(video.tamanhoFinal) : video.status === 'processando' ? `${video.progresso}%` : '',
              desativado: video.status === 'erro',
              aoApagar: () => apagar(`/api/adm/videos/${video.id}`, 'Apagar este vídeo do sistema?'),
            })))
          : el('p', { classe: 'texto-suave', texto: estado.ferramentasVideo.disponivel ? 'Nenhum vídeo enviado ainda. Use o botão "Vídeo".' : estado.ferramentasVideo.mensagem })) : null,
        videos && fotos ? el('p') : null,
        fotos ? el('h3', { texto: 'Fotos que você enviou' }) : null,
        fotos ? (arquivos.length
          ? el('div', { classe: 'galeria-midias' }, arquivos.map((arquivo) => item({ url: arquivo.url, miniatura: arquivo.url, rodape: formatarMb(arquivo.tamanho), aoApagar: () => apagar(`/api/adm/arquivos/${arquivo.url.split('/').pop()}`, 'Apagar esta foto do sistema?') })))
          : el('p', { classe: 'texto-suave', texto: 'Nenhuma foto enviada ainda. Use o botão "Foto".' })) : null,
        fotos ? el('p') : null,
        fotos ? el('h3', { texto: 'Ilustrações de exemplo' }) : null,
        fotos ? el('p', { classe: 'texto-suave texto-pequeno', texto: 'Use só enquanto não tiver fotos reais do salão.' }) : null,
        fotos ? el('div', { classe: 'galeria-midias' }, ILUSTRACOES.map((url) => item({ url, miniatura: url }))) : null,
      ],
    });
  }

  // ================================================================
  // PUBLICAR
  // ================================================================
  async function publicar(evento) {
    const botao = evento.currentTarget;
    botao.classList.add('carregando');
    try {
      await salvarAgora();
      const resposta = await api(`/api/adm/paginas/${idPagina}/publicar`, { corpo: {} });
      estado.pagina.publicada = true;
      estado.pagina.slug = resposta.slug;
      desenharTopo();
      mostrarPublicada(resposta);
    } catch (erro) {
      if (erro.status === 422) mostrarPendencias(erro.dados.erros || [], erro.dados.avisos || []);
      else avisar(erro.message, 'erro', 6000);
    }
    botao.classList.remove('carregando');
  }

  function mostrarPendencias(erros, avisos) {
    const caixa = janela({
      titulo: 'Quase lá! Ajuste antes de publicar',
      icone: 'alerta',
      conteudo: [
        el('p', { classe: 'texto-suave', texto: 'Seguimos boas práticas para a página ficar profissional:' }),
        el('ul', { classe: 'lista-erros' }, [
          ...erros.map((erro) => el('li', {}, [
            icone('alerta', 18),
            el('span', { texto: erro.mensagem }),
            erro.secaoId ? el('button', { classe: 'botao botao--secundario botao--pequeno', type: 'button', texto: 'Corrigir', aoClick: () => { caixa.fechar(); abrirSecao(erro.secaoId, true); setTimeout(() => focarCampo(erro.secaoId, erro.campo), 50); } })
              : erro.acao === 'agenda' ? el('a', { classe: 'botao botao--secundario botao--pequeno', href: '/painel#agenda', texto: 'Abrir' }) : null,
          ])),
          ...avisos.map((aviso) => el('li', { classe: 'aviso-item' }, [icone('info', 18), el('span', { texto: aviso.mensagem })])),
        ]),
      ],
      botoes: [{ texto: 'Entendi', classe: 'botao--primario' }],
    });
  }

  function focarCampo(secaoId, chave) {
    const alvo = document.getElementById(`${secaoId}-${chave}`);
    if (alvo) {
      alvo.scrollIntoView({ block: 'center' });
      if (alvo.focus) alvo.focus();
    }
  }

  function mostrarPublicada(resposta) {
    const link = `${estado.urlPublica || location.origin}${resposta.caminho}`;
    janela({
      titulo: 'Página no ar!',
      conteudo: [
        el('div', { classe: 'link-publicado' }, [
          el('span', { classe: 'link-publicado__icone' }, [icone('check', 34)]),
          el('p', { texto: 'Este é o link da sua página. Coloque na bio do Instagram, mande no WhatsApp ou use no botão do site do Canva.' }),
          blocoCopiavel(link),
          /^http:\/\/(localhost|127\.)/.test(link)
            ? alerta('Este link só abre NESTE computador. Para funcionar no celular das clientes, ligue o Tailscale Funnel (o dono vê o passo a passo em "Sistema e segurança").', 'aviso')
            : null,
          el('div', { classe: 'cabecalho-tela__acoes' }, [
            el('a', { classe: 'botao botao--secundario', href: link, target: '_blank', rel: 'noopener' }, [icone('olho', 16), 'Abrir']),
            el('a', { classe: 'botao botao--whatsapp', href: `https://wa.me/?text=${encodeURIComponent(`Agende seu horário: ${link}`)}`, target: '_blank', rel: 'noopener noreferrer' }, [icone('whatsapp', 16), 'Compartilhar']),
          ]),
          resposta.avisos && resposta.avisos.length ? el('ul', { classe: 'lista-erros' }, resposta.avisos.map((aviso) => el('li', { classe: 'aviso-item' }, [icone('info', 18), el('span', { texto: aviso.mensagem })]))) : null,
          el('p', { classe: 'texto-suave texto-pequeno', texto: 'Mudanças futuras só aparecem para o público quando você clicar em "Atualizar".' }),
        ]),
      ],
      botoes: [{ texto: 'Continuar editando', classe: 'botao--primario' }],
    });
  }

  // ================================================================
  // CELULAR: abas Editar / Prévia
  // ================================================================
  function trocarAbaCelular(aba) {
    corpoEditor.dataset.aba = aba;
    document.querySelectorAll('#abas-celular button').forEach((botao) => botao.setAttribute('aria-selected', String(botao.dataset.aba === aba)));
    if (aba === 'previa') {
      estado.dispositivo = 'celular';
      requestAnimationFrame(ajustarPrevia);
    }
  }

  function desenharAbasCelular() {
    document.getElementById('abas-celular').replaceChildren(
      el('button', { type: 'button', role: 'tab', dados: { aba: 'editar' }, 'aria-selected': 'true', aoClick: () => trocarAbaCelular('editar') }, [icone('editar', 18), 'Editar']),
      el('button', { type: 'button', role: 'tab', dados: { aba: 'previa' }, 'aria-selected': 'false', aoClick: () => trocarAbaCelular('previa') }, [icone('olho', 18), 'Prévia']),
    );
  }

  // ================================================================
  // TUTORIAL DO EDITOR
  // ================================================================
  function iniciarTutorialEditor() {
    const celular = window.matchMedia('(max-width: 760px)').matches;
    const irParaLista = async () => { if (celular) trocarAbaCelular('editar'); if (estado.vista !== 'lista') voltarParaLista(); };
    const passos = [
      { alvo: '#lista-secoes', titulo: 'Sua página é feita de seções', texto: 'Cada item é uma tela inteira da página, na ordem em que aparece. O Cabeçalho (primeira) e o Rodapé (última) ficam travados: é uma boa prática obrigatória.', antes: irParaLista },
      { alvo: '#botao-adicionar-secao', titulo: 'Adicionar seções', texto: 'Escolha entre Sobre, Serviços, Destaque, Galeria, Depoimentos, Vídeo e Agendamento. Arraste ou use as setas para mudar a ordem.', antes: irParaLista },
      { alvo: '#botao-tema', titulo: 'Aparência', texto: 'Troque o tema (masculino, feminino ou neutro) quando quiser. Os textos e fotos continuam.', antes: irParaLista },
      { alvo: celular ? '#abas-celular' : '#area-previa', titulo: 'Prévia ao vivo', texto: celular ? 'Toque em "Prévia" para ver como está ficando.' : 'Tudo que você muda aparece aqui na hora. Clique numa seção da prévia para editá-la.' },
      celular ? null : { alvo: '#botoes-dispositivo', titulo: 'Computador, tablet e celular', texto: 'Confira como a página fica em cada tela. A maioria das clientes vai abrir pelo celular!' },
      { alvo: '.editor__estado', titulo: 'Salvamento automático', texto: 'Seu rascunho é salvo sozinho. O público só vê depois que você publicar.' },
      { alvo: '#botao-publicar', titulo: 'Publicar', texto: 'Quando estiver pronta, clique aqui. O sistema confere as boas práticas e gera o link da página para você divulgar.' },
    ].filter(Boolean);
    window.TourStylOS.iniciar(passos, {
      aoTerminar: async () => {
        estado.usuario.tutorialEditor = true;
        await api('/api/tutorial', { corpo: { qual: 'editor' } }).catch(() => {});
      },
    });
  }

  // ================================================================
  // INÍCIO
  // ================================================================
  async function iniciar() {
    if (!Number.isInteger(idPagina) || idPagina <= 0) {
      location.href = '/painel#paginas';
      return;
    }
    const [sessao, pagina, agenda] = await Promise.all([
      api('/api/sessao'),
      api(`/api/adm/paginas/${idPagina}`),
      api('/api/adm/agenda').catch(() => null),
    ]);
    if (sessao.usuario.deveTrocarSenha) { location.href = '/painel'; return; }
    estado.usuario = sessao.usuario;
    estado.urlPublica = sessao.urlPublica;
    estado.pagina = pagina;
    estado.titulo = pagina.titulo;
    estado.conteudo = Esquemas.normalizarConteudo(pagina.conteudo);
    if (agenda) estado.agendaPrevia = { ativa: true, servicos: agenda.config.servicos };
    await carregarVideos();
    document.title = `${pagina.titulo} — Editor StylOS`;

    desenharTopo();
    desenharPainel();
    desenharAbasCelular();
    ajustarPrevia();
    // A prévia pode ter carregado antes de nós: perguntamos se está pronta
    // (ela responde "pronto" e então enviamos o conteúdo).
    const cumprimentarPrevia = () => iframe.contentWindow && iframe.contentWindow.postMessage({ tipo: 'ola' }, location.origin);
    iframe.addEventListener('load', cumprimentarPrevia);
    cumprimentarPrevia();
    if (!estado.usuario.tutorialEditor) setTimeout(iniciarTutorialEditor, 600);
  }

  iniciar().catch((erro) => {
    trocar(painel, el('div', { classe: 'painel-edicao__rolagem' }, [alerta(erro.message), el('p'), el('a', { classe: 'botao botao--secundario', href: '/painel#paginas', texto: 'Voltar ao painel' })]));
  });
})();
