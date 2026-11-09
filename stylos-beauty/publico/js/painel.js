/**
 * painel.js — PAINEL do ADM e do DONO.
 * ------------------------------------------------------------------
 * Telas (trocadas pelo endereço #):
 *   #inicio        → boas-vindas + lista "primeiros passos"
 *   #paginas       → minhas páginas (criar, editar, publicar, link)
 *   #agenda        → WhatsApp, Google Agenda, expediente, serviços, regras
 *   #agendamentos  → pedidos recebidos (confirmar, cancelar, avisar cliente)
 *   #conta         → meus dados e senha
 *   Só para o DONO:
 *   #adms          → cadastrar e gerenciar ADMs
 *   #google        → chave da conta de serviço do Google
 *   #sistema       → endereço público, todas as páginas, registro de atividades
 */
(function () {
  'use strict';
  const { el, trocar, icone, marca, api, avisar, janela, confirmar, copiar, blocoCopiavel, campo, alerta, medidorSenha, formatarDataHora, iniciais } = window.StylOS;
  const Esquemas = window.EsquemasStylOS;

  const principal = document.getElementById('principal');
  const lateral = document.getElementById('lateral');

  const estado = {
    usuario: null,
    urlPublica: '',
    totalPendentes: 0,
  };

  const TELAS = [
    { id: 'inicio', nome: 'Início', icone: 'casa', desenhar: telaInicio },
    { id: 'paginas', nome: 'Minhas páginas', icone: 'pagina', desenhar: telaPaginas },
    { id: 'agenda', nome: 'Agenda e WhatsApp', icone: 'agenda', desenhar: telaAgenda },
    { id: 'agendamentos', nome: 'Agendamentos', icone: 'calendarioCheck', desenhar: telaAgendamentos },
    { id: 'conta', nome: 'Minha conta', icone: 'pessoa', desenhar: telaConta },
    { id: 'adms', nome: 'Administradores', icone: 'pessoas', desenhar: telaAdms, soDono: true },
    { id: 'google', nome: 'Integração Google', icone: 'google', desenhar: telaGoogle, soDono: true },
    { id: 'sistema', nome: 'Sistema e segurança', icone: 'escudo', desenhar: telaSistema, soDono: true },
  ];

  const ehDono = () => estado.usuario && estado.usuario.papel === 'dono';
  const linkDaPagina = (slug) => `${estado.urlPublica || location.origin}/p/${slug}`;

  // ================================================================
  // ESTRUTURA: menu lateral e navegação
  // ================================================================
  function desenharLateral() {
    const telaAtual = (location.hash || '#inicio').slice(1);
    const item = (tela) => el('a', {
      classe: `lateral__item ${tela.id === telaAtual ? 'lateral__item--ativo' : ''}`,
      href: `#${tela.id}`,
      id: `menu-${tela.id}`,
      'aria-current': tela.id === telaAtual ? 'page' : null,
      aoClick: fecharLateralCelular,
    }, [
      icone(tela.icone, 19),
      tela.nome,
      tela.id === 'agendamentos' && estado.totalPendentes ? el('span', { classe: 'lateral__contador', 'aria-label': `${estado.totalPendentes} pendentes`, texto: String(estado.totalPendentes) }) : null,
    ]);
    trocar(lateral, 
      marca(),
      ...TELAS.filter((tela) => !tela.soDono).map(item),
      ehDono() ? el('div', { classe: 'lateral__grupo', texto: 'Dono do sistema' }) : null,
      ...(ehDono() ? TELAS.filter((tela) => tela.soDono).map(item) : []),
      el('div', { classe: 'lateral__rodape' }, [
        el('button', { classe: 'lateral__item', type: 'button', id: 'rever-tutorial', aoClick: () => { fecharLateralCelular(); iniciarTutorial(); } }, [icone('ajuda', 19), 'Ver tutorial de novo']),
        el('div', { classe: 'lateral__usuario' }, [
          el('span', { classe: 'avatar', 'aria-hidden': 'true', texto: iniciais(estado.usuario.nome) }),
          el('div', {}, [
            el('strong', { texto: estado.usuario.nome }),
            el('small', {}, [el('span', { classe: 'papel-selo', texto: ehDono() ? 'Dono' : 'ADM' })]),
          ]),
        ]),
        el('button', { classe: 'lateral__item', type: 'button', aoClick: sair }, [icone('sair', 19), 'Sair']),
      ]),
    );
  }

  let fundoLateral = null;
  function abrirLateralCelular() {
    lateral.classList.add('lateral--aberta');
    document.getElementById('abrir-lateral').setAttribute('aria-expanded', 'true');
    if (fundoLateral) return; // já está aberto: não cria outra camada escura
    fundoLateral = el('div', { classe: 'fundo-lateral', aoClick: fecharLateralCelular });
    document.body.append(fundoLateral);
  }
  function fecharLateralCelular() {
    lateral.classList.remove('lateral--aberta');
    document.getElementById('abrir-lateral').setAttribute('aria-expanded', 'false');
    if (fundoLateral) fundoLateral.remove();
    fundoLateral = null;
  }

  async function sair() {
    await api('/api/sair', { corpo: {} }).catch(() => {});
    location.href = '/entrar';
  }

  async function navegar() {
    const id = (location.hash || '#inicio').slice(1);
    const tela = TELAS.find((item) => item.id === id && (!item.soDono || ehDono())) || TELAS[0];
    desenharLateral();
    trocar(principal, el('p', { classe: 'texto-suave', texto: 'Carregando…' }));
    try {
      await tela.desenhar();
    } catch (erro) {
      if (erro.dados && erro.dados.codigo === 'trocar-senha') return exigirTrocaDeSenha();
      trocar(principal, alerta(erro.message));
    }
    principal.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  function cabecalhoTela(titulo, descricao, acoes) {
    return el('div', { classe: 'cabecalho-tela' }, [
      el('div', {}, [el('h1', { texto: titulo }), descricao ? el('p', { texto: descricao }) : null]),
      acoes && acoes.length ? el('div', { classe: 'cabecalho-tela__acoes' }, acoes) : null,
    ]);
  }

  function cartao(tituloTexto, nomeIcone, filhos, extra) {
    return el('section', { classe: 'cartao', ...(extra || {}) }, [
      el('div', { classe: 'cartao__titulo' }, [icone(nomeIcone, 20), el('h2', { texto: tituloTexto })]),
      ...[].concat(filhos),
    ]);
  }

  async function atualizarPendentes() {
    try {
      const dados = await api('/api/adm/agendamentos?filtro=pendentes');
      estado.totalPendentes = dados.totalPendentes;
    } catch { /* sem problema */ }
  }

  // ================================================================
  // TELA: INÍCIO
  // ================================================================
  async function telaInicio() {
    const [agenda, paginas, proximos] = await Promise.all([
      api('/api/adm/agenda'),
      api('/api/adm/paginas'),
      api('/api/adm/agendamentos?filtro=proximos'),
    ]);
    const passos = [
      { feito: Boolean(agenda.whatsapp), texto: 'Cadastrar seu WhatsApp', detalhe: 'Para onde vão os pedidos de horário.', tela: 'agenda' },
      { feito: agenda.config.servicos.length > 0 && Boolean(agenda.whatsapp), texto: 'Conferir expediente e serviços', detalhe: 'Dias e horários em que você atende.', tela: 'agenda' },
      { feito: Boolean(agenda.googleAgendaId), texto: 'Conectar a Google Agenda (recomendado)', detalhe: 'Bloqueia horários ocupados automaticamente.', tela: 'agenda' },
      { feito: paginas.paginas.some((pagina) => pagina.publicada), texto: 'Publicar sua primeira página', detalhe: 'Comece editando a página de exemplo.', tela: 'paginas' },
    ];
    const feitos = passos.filter((passo) => passo.feito).length;
    const barra = el('span');
    barra.style.width = `${(feitos / passos.length) * 100}%`;

    const listaProximos = proximos.agendamentos.slice(0, 4);
    trocar(principal, 
      cabecalhoTela(`Olá, ${estado.usuario.nome.split(' ')[0]}!`, 'Este é o seu StylOS. Daqui você cuida da página e da agenda do salão.'),
      el('div', { classe: 'grade-2' }, [
        el('section', { classe: 'cartao cartao--destaque', id: 'cartao-primeiros-passos' }, [
          el('div', { classe: 'cartao__titulo' }, [icone('foguete', 20), el('h2', { texto: 'Primeiros passos' })]),
          el('p', { classe: 'texto-suave', texto: feitos === passos.length ? 'Tudo pronto! Seu salão já pode receber agendamentos.' : `${feitos} de ${passos.length} concluídos.` }),
          el('div', { classe: 'barra-progresso', 'aria-hidden': 'true' }, [barra]),
          el('ul', { classe: 'checklist' }, passos.map((passo) => el('li', { classe: `checklist__item ${passo.feito ? 'checklist__item--feito' : ''}` }, [
            el('span', { classe: 'checklist__marca' }, passo.feito ? [icone('check', 14)] : []),
            el('span', { classe: 'checklist__texto' }, [passo.texto, el('small', { texto: passo.detalhe })]),
            passo.feito ? null : el('a', { classe: 'botao botao--pequeno botao--secundario', href: `#${passo.tela}`, texto: 'Fazer' }),
          ]))),
        ]),
        cartao('Próximos atendimentos', 'calendarioCheck', listaProximos.length
          ? [el('div', { classe: 'lista-agendamentos' }, listaProximos.map((item) => itemAgendamento(item, proximos.fuso, true))),
            el('p'), el('a', { classe: 'botao botao--secundario botao--pequeno', href: '#agendamentos', texto: 'Ver todos' })]
          : [el('div', { classe: 'vazio' }, [icone('agenda', 40), el('p', { texto: 'Nenhum horário marcado ainda. Quando alguém agendar pela sua página, aparece aqui.' })])]),
      ]),
    );
  }

  // ================================================================
  // TELA: MINHAS PÁGINAS
  // ================================================================
  async function telaPaginas() {
    const { paginas } = await api('/api/adm/paginas');
    const cartoes = paginas.map((pagina) => {
      const tema = Esquemas.TEMAS[pagina.tema] || Esquemas.TEMAS[Esquemas.TEMA_PADRAO];
      const miniatura = el('div', { classe: 'cartao-pagina__miniatura' });
      miniatura.style.background = tema.cores[0];
      const faixa1 = el('span', { classe: 'faixa' });
      const faixa2 = el('span', { classe: 'faixa faixa--curta' });
      faixa1.style.background = tema.cores[1];
      faixa2.style.background = tema.cores[2];
      miniatura.append(
        faixa1, faixa2,
        pagina.exemplo ? el('span', { classe: 'etiqueta etiqueta--marca', texto: 'Exemplo' })
          : pagina.publicada ? el('span', { classe: `etiqueta ${pagina.temAlteracoesNaoPublicadas ? 'etiqueta--aviso' : 'etiqueta--sucesso'}`, texto: pagina.temAlteracoesNaoPublicadas ? 'Publicada · com alterações' : 'Publicada' })
            : el('span', { classe: 'etiqueta', texto: 'Rascunho' }),
      );
      if (pagina.exemplo && pagina.publicada) miniatura.lastChild.textContent = 'Exemplo · publicada';
      return el('article', { classe: 'cartao cartao-pagina' }, [
        miniatura,
        el('div', { classe: 'cartao-pagina__corpo' }, [
          el('h3', { texto: pagina.titulo }),
          el('span', { classe: 'cartao-pagina__link', texto: pagina.publicada ? linkDaPagina(pagina.slug) : `Tema ${tema.nome} · editada ${formatarDataHora(pagina.atualizadaEm, undefined, 'dataHora')}` }),
        ]),
        el('div', { classe: 'cartao-pagina__acoes' }, [
          el('a', { classe: 'botao botao--primario botao--pequeno', href: `/editor?id=${pagina.id}` }, [icone('editar', 16), 'Editar']),
          pagina.publicada ? el('button', { classe: 'botao botao--secundario botao--pequeno', type: 'button', aoClick: () => copiar(linkDaPagina(pagina.slug)) }, [icone('copiar', 16), 'Link']) : null,
          pagina.publicada ? el('a', { classe: 'botao botao--secundario botao--pequeno', href: `/p/${pagina.slug}`, target: '_blank', rel: 'noopener' }, [icone('olho', 16), 'Ver']) : null,
          el('button', { classe: 'botao botao--fantasma botao--pequeno botao--icone', type: 'button', 'aria-label': 'Mais ações', title: 'Mais ações', aoClick: () => maisAcoesPagina(pagina) }, [icone('engrenagem', 16)]),
        ]),
      ]);
    });
    trocar(principal, 
      cabecalhoTela('Minhas páginas', 'Cada página publicada ganha um link próprio para divulgar (Instagram, WhatsApp, site do Canva...).', [
        el('button', { classe: 'botao botao--primario', type: 'button', id: 'botao-nova-pagina', aoClick: novaPagina }, [icone('mais', 18), 'Nova página']),
      ]),
      el('div', { classe: 'grade-cartoes' }, [...cartoes, el('button', { classe: 'cartao-novo', type: 'button', aoClick: novaPagina }, [icone('mais', 34), 'Criar nova página'])]),
    );
  }

  function maisAcoesPagina(pagina) {
    const acao = (texto, nomeIcone, funcao, classe) => el('button', { classe: `botao ${classe || 'botao--secundario'} botao--largo`, type: 'button', aoClick: async () => { caixa.fechar(); await funcao(); } }, [icone(nomeIcone, 18), texto]);
    const caixa = janela({
      titulo: pagina.titulo,
      conteudo: [el('div', { classe: 'lista-itens' }, [
        acao('Duplicar página', 'copiar', async () => {
          await api(`/api/adm/paginas/${pagina.id}/duplicar`, { corpo: {} });
          avisar('Página duplicada.');
          navegar();
        }),
        pagina.publicada ? acao('Tirar do ar (vira rascunho)', 'olho', async () => {
          if (!(await confirmar('O link vai parar de funcionar até você publicar de novo.'))) return;
          await api(`/api/adm/paginas/${pagina.id}/despublicar`, { corpo: {} });
          avisar('Página fora do ar.');
          navegar();
        }) : null,
        acao('Excluir página', 'lixeira', async () => {
          if (!(await confirmar(`Excluir "${pagina.titulo}" para sempre? Os agendamentos já feitos continuam guardados.`, { botao: 'Excluir', perigo: true }))) return;
          await api(`/api/adm/paginas/${pagina.id}`, { metodo: 'DELETE' });
          avisar('Página excluída.');
          navegar();
        }, 'botao--perigo'),
      ])],
    });
  }

  /** Seletor visual de temas (usado ao criar página e no editor). */
  function seletorDeTemas(temaInicial, aoEscolher) {
    let escolhido = temaInicial;
    const grupos = { masculino: 'Estilo masculino', feminino: 'Estilo feminino', neutro: 'Neutro' };
    const area = el('div');
    for (const [publico, rotulo] of Object.entries(grupos)) {
      area.append(el('p', { classe: 'campo__rotulo', texto: rotulo }));
      const grade = el('div', { classe: 'temas' });
      for (const [id, tema] of Object.entries(Esquemas.TEMAS).filter(([, t]) => t.publico === publico)) {
        const amostra = el('span', { classe: 'tema-opcao__amostra' }, tema.cores.map((cor) => {
          const faixa = el('span');
          faixa.style.background = cor;
          return faixa;
        }));
        grade.append(el('button', {
          classe: 'tema-opcao', type: 'button', 'aria-pressed': String(id === escolhido), title: tema.descricao,
          aoClick: (evento) => {
            escolhido = id;
            area.querySelectorAll('.tema-opcao').forEach((botao) => botao.setAttribute('aria-pressed', 'false'));
            evento.currentTarget.setAttribute('aria-pressed', 'true');
            aoEscolher(id);
          },
        }, [amostra, el('strong', { texto: tema.nome }), el('small', { texto: tema.descricao })]));
      }
      area.append(grade, el('div', { classe: 'campo' }));
    }
    return area;
  }

  function novaPagina() {
    let tema = 'lavanda-suave';
    let modelo = 'completo';
    const titulo = campo({ id: 'nova-titulo', rotulo: 'Nome da página (só você vê)', maximo: 80, atributos: { placeholder: 'Ex.: Página do salão — dezembro' } });
    const nomeSalao = campo({ id: 'nova-salao', rotulo: 'Nome do salão (aparece na página)', maximo: 40, atributos: { placeholder: 'Ex.: Studio Bela Flor' } });
    const botoesModelo = el('div', { classe: 'escolhas' }, [
      ['completo', 'Completa, com textos de exemplo'],
      ['basico', 'Básica: cabeçalho, serviços, agendamento e rodapé'],
    ].map(([valor, texto]) => el('button', {
      classe: 'escolha', type: 'button', 'aria-pressed': String(valor === modelo), texto,
      aoClick: (evento) => {
        modelo = valor;
        botoesModelo.querySelectorAll('.escolha').forEach((botao) => botao.setAttribute('aria-pressed', 'false'));
        evento.currentTarget.setAttribute('aria-pressed', 'true');
      },
    })));
    const areaErro = el('div');
    janela({
      titulo: 'Nova página',
      icone: 'pagina',
      larga: true,
      conteudo: [
        el('div', { classe: 'linha-campos' }, [titulo.elemento, nomeSalao.elemento]),
        el('div', { classe: 'campo' }, [el('span', { classe: 'campo__rotulo', texto: 'Começar com' }), botoesModelo]),
        el('p', { classe: 'campo__rotulo', texto: 'Escolha o visual (dá para trocar depois)' }),
        seletorDeTemas(tema, (novo) => { tema = novo; }),
        areaErro,
      ],
      botoes: [
        { texto: 'Cancelar' },
        {
          texto: 'Criar e abrir o editor', classe: 'botao--primario', icone: 'seta',
          aoClicar: async () => {
            areaErro.replaceChildren();
            try {
              const { id } = await api('/api/adm/paginas', { corpo: { titulo: titulo.entrada.value || nomeSalao.entrada.value, nomeSalao: nomeSalao.entrada.value, tema, modelo } });
              location.href = `/editor?id=${id}`;
            } catch (erro) {
              areaErro.append(alerta(erro.message));
              return true;
            }
          },
        },
      ],
    });
  }

  // ================================================================
  // TELA: AGENDA E WHATSAPP
  // ================================================================
  const NOMES_DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const FUSOS_BRASIL = [
    ['America/Manaus', 'Manaus / Amazonas (UTC−4)'],
    ['America/Sao_Paulo', 'Brasília / São Paulo (UTC−3)'],
    ['America/Belem', 'Belém / Pará (UTC−3)'],
    ['America/Fortaleza', 'Fortaleza / Nordeste (UTC−3)'],
    ['America/Cuiaba', 'Cuiabá / Mato Grosso (UTC−4)'],
    ['America/Porto_Velho', 'Porto Velho / Rondônia (UTC−4)'],
    ['America/Boa_Vista', 'Boa Vista / Roraima (UTC−4)'],
    ['America/Rio_Branco', 'Rio Branco / Acre (UTC−5)'],
    ['America/Noronha', 'Fernando de Noronha (UTC−2)'],
  ];

  function mascaraTelefone(texto) {
    let d = String(texto).replace(/\D/g, '');
    if (d.startsWith('55') && d.length > 11) d = d.slice(2);
    d = d.slice(0, 11);
    if (d.length <= 2) return d.length ? `(${d}` : '';
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }

  async function telaAgenda() {
    const dados = await api('/api/adm/agenda');
    const config = JSON.parse(JSON.stringify(dados.config));

    // ---- WhatsApp ----
    const whatsapp = campo({ id: 'whatsapp', rotulo: 'Seu número de WhatsApp', tipo: 'tel', valor: mascaraTelefone(dados.whatsapp), dica: 'Os pedidos de horário chegam neste número. Obrigatório para publicar páginas com agendamento.', atributos: { inputmode: 'tel', placeholder: '(92) 99999-9999', autocomplete: 'tel-national' } });
    whatsapp.entrada.addEventListener('input', () => { whatsapp.entrada.value = mascaraTelefone(whatsapp.entrada.value); });
    const cartaoWhatsapp = cartao('WhatsApp', 'whatsapp', [whatsapp.elemento], { id: 'cartao-whatsapp' });

    // ---- Google Agenda ----
    const agendaId = campo({ id: 'agenda-id', rotulo: 'ID da sua agenda', tipo: 'email', valor: dados.googleAgendaId, dica: 'Normalmente é o seu próprio Gmail.', atributos: { placeholder: 'seunome@gmail.com', autocomplete: 'email' } });
    const resultadoTeste = el('div', { 'aria-live': 'polite' });
    const botaoTestar = el('button', {
      classe: 'botao botao--secundario', type: 'button',
      aoClick: async () => {
        resultadoTeste.replaceChildren();
        botaoTestar.classList.add('carregando');
        try {
          const resposta = await api('/api/adm/agenda/testar', { corpo: { googleAgendaId: agendaId.entrada.value } });
          resultadoTeste.append(alerta(resposta.mensagem, resposta.ok ? 'sucesso' : 'erro'));
        } catch (erro) {
          resultadoTeste.append(alerta(erro.message));
        }
        botaoTestar.classList.remove('carregando');
      },
    }, [icone('link', 16), 'Testar conexão']);
    const conteudoGoogle = dados.emailIntegracao
      ? [
          el('p', { classe: 'texto-suave', texto: 'Assim, quando você marcar um compromisso na sua Google Agenda, o horário some sozinho da página. O sistema só vê "livre" ou "ocupado" — nunca o nome dos seus compromissos.' }),
          el('ol', { classe: 'passos-guia' }, [
            el('li', { texto: 'No computador, abra calendar.google.com.' }),
            el('li', { texto: 'Na lista "Minhas agendas", passe o mouse na sua agenda → três pontinhos → "Configurações e compartilhamento".' }),
            el('li', {}, ['Em "Compartilhar com pessoas e grupos específicos", clique em "Adicionar pessoas e grupos" e cole este e-mail:', blocoCopiavel(dados.emailIntegracao)]),
            el('li', { texto: 'Em permissões, escolha "Ver apenas livre/ocupado (ocultar detalhes)" e clique em Enviar.' }),
            el('li', { texto: 'Na mesma página, em "Integrar agenda", copie o "ID da agenda" e cole abaixo.' }),
          ]),
          el('p'),
          agendaId.elemento,
          el('div', { classe: 'cabecalho-tela__acoes' }, [botaoTestar]),
          resultadoTeste,
          el('p'),
          alerta('Atenção: eventos de "dia inteiro" no Google vêm como "Disponível" por padrão. Para bloquear um dia de folga, marque o evento como "Ocupado" ou use "Dias bloqueados" abaixo.', 'aviso'),
        ]
      : [alerta(ehDono()
          ? 'A integração com o Google ainda não foi configurada. Vá em "Integração Google" no menu (só o dono vê).'
          : 'O dono do sistema ainda não ativou a integração com o Google. Enquanto isso, os horários seguem só o expediente abaixo e os pedidos feitos pelo site.', 'info')];
    const cartaoGoogle = cartao('Google Agenda', 'google', conteudoGoogle, { id: 'cartao-google' });

    // ---- Expediente ----
    const areaExpediente = el('div', { classe: 'expediente' });
    function desenharExpediente() {
      trocar(areaExpediente, ...[1, 2, 3, 4, 5, 6, 0].map((dia) => {
        const faixas = config.expediente[dia] || [];
        const trabalha = faixas.length > 0;
        const caixa = el('input', {
          type: 'checkbox', id: `trabalha-${dia}`, checked: trabalha ? true : null,
          aoChange: (evento) => {
            config.expediente[dia] = evento.target.checked ? [['08:00', '12:00'], ['14:00', '18:00']] : [];
            desenharExpediente();
          },
        });
        const listaFaixas = el('div', { classe: 'expediente__faixas' });
        if (!trabalha) listaFaixas.append(el('span', { classe: 'expediente__folga', texto: 'Folga' }));
        faixas.forEach((faixa, indice) => {
          const inicio = el('input', { type: 'time', valor: faixa[0], step: '300', 'aria-label': `${NOMES_DIAS[dia]}: início da faixa ${indice + 1}`, aoChange: (evento) => { faixa[0] = evento.target.value; } });
          const fim = el('input', { type: 'time', valor: faixa[1], step: '300', 'aria-label': `${NOMES_DIAS[dia]}: fim da faixa ${indice + 1}`, aoChange: (evento) => { faixa[1] = evento.target.value; } });
          listaFaixas.append(el('span', { classe: 'faixa-hora' }, [
            inicio, 'até', fim,
            el('button', {
              classe: 'botao botao--fantasma botao--icone botao--pequeno', type: 'button', 'aria-label': 'Remover faixa',
              aoClick: () => { faixas.splice(indice, 1); desenharExpediente(); },
            }, [icone('fechar', 14)]),
          ]));
        });
        if (trabalha && faixas.length < 4) {
          listaFaixas.append(el('button', {
            classe: 'botao botao--fantasma botao--pequeno', type: 'button',
            aoClick: () => {
              const ultima = faixas[faixas.length - 1];
              faixas.push([ultima ? ultima[1] : '08:00', '20:00']);
              desenharExpediente();
            },
          }, [icone('mais', 14), 'Faixa']));
        }
        return el('div', { classe: 'expediente__dia' }, [
          el('label', { classe: 'expediente__nome', for: `trabalha-${dia}` }, [caixa, NOMES_DIAS[dia]]),
          listaFaixas,
        ]);
      }));
    }
    desenharExpediente();
    const cartaoExpediente = cartao('Expediente', 'relogio', [
      el('p', { classe: 'texto-suave', texto: 'Dias e horários em que você atende. Use duas faixas para o horário de almoço (ex.: 08:00–12:00 e 14:00–18:00). Fora disso aparece como indisponível.' }),
      areaExpediente,
    ], { id: 'cartao-expediente' });

    // ---- Serviços ----
    const areaServicos = el('div', { classe: 'tabela-servicos' });
    const DURACOES = [15, 20, 30, 40, 45, 60, 75, 90, 105, 120, 150, 180, 210, 240, 300, 360];
    function desenharServicos() {
      trocar(areaServicos, ...config.servicos.map((servico, indice) => {
        const duracoes = DURACOES.includes(servico.duracaoMin) ? DURACOES : [...DURACOES, servico.duracaoMin].sort((a, b) => a - b);
        return el('div', { classe: 'linha-servico' }, [
          el('input', { classe: 'entrada', valor: servico.nome, maxlength: '50', 'aria-label': `Nome do serviço ${indice + 1}`, placeholder: 'Nome do serviço', aoInput: (evento) => { servico.nome = evento.target.value; } }),
          el('select', { classe: 'entrada', 'aria-label': 'Duração', aoChange: (evento) => { servico.duracaoMin = Number(evento.target.value); } },
            duracoes.map((minutos) => el('option', { value: String(minutos), selected: minutos === servico.duracaoMin ? true : null, texto: minutos < 60 ? `${minutos} min` : `${Math.floor(minutos / 60)}h${minutos % 60 ? String(minutos % 60).padStart(2, '0') : ''}` }))),
          el('input', { classe: 'entrada campo-preco', valor: servico.preco, maxlength: '24', placeholder: 'Preço (opcional)', 'aria-label': 'Preço', aoInput: (evento) => { servico.preco = evento.target.value; } }),
          el('button', {
            classe: 'botao botao--fantasma botao--icone', type: 'button', 'aria-label': `Remover ${servico.nome}`, disabled: config.servicos.length <= 1 ? true : null,
            aoClick: () => { config.servicos.splice(indice, 1); desenharServicos(); },
          }, [icone('lixeira', 18)]),
        ]);
      }));
    }
    desenharServicos();
    const cartaoServicos = cartao('Serviços para agendar', 'lista', [
      el('p', { classe: 'texto-suave', texto: 'A cliente escolhe um destes antes do horário. A duração define quanto tempo fica reservado.' }),
      areaServicos,
      el('p'),
      el('button', { classe: 'botao botao--secundario botao--pequeno', type: 'button', aoClick: () => { if (config.servicos.length < 20) { config.servicos.push({ id: '', nome: '', duracaoMin: 60, preco: '' }); desenharServicos(); areaServicos.lastChild.querySelector('input').focus(); } } }, [icone('mais', 16), 'Adicionar serviço']),
    ]);

    // ---- Regras ----
    const passo = campo({ id: 'passo', rotulo: 'Começar horários a cada', tipo: 'select', valor: String(config.passoMin), opcoes: [['15', '15 minutos'], ['20', '20 minutos'], ['30', '30 minutos'], ['45', '45 minutos'], ['60', '1 hora']] });
    const antecedencia = campo({ id: 'antecedencia', rotulo: 'Antecedência mínima', tipo: 'select', valor: String(config.antecedenciaMin), opcoes: [['0', 'Sem mínimo'], ['30', '30 minutos'], ['60', '1 hora'], ['120', '2 horas'], ['240', '4 horas'], ['720', '12 horas'], ['1440', '1 dia'], ['2880', '2 dias']] });
    const diasAFrente = campo({ id: 'dias-frente', rotulo: 'Mostrar até quantos dias à frente', tipo: 'number', valor: String(config.diasAFrente), atributos: { min: '1', max: '90' } });
    const fuso = campo({ id: 'fuso', rotulo: 'Fuso horário', tipo: 'select', valor: dados.fuso, opcoes: FUSOS_BRASIL.some(([valor]) => valor === dados.fuso) ? FUSOS_BRASIL : [[dados.fuso, dados.fuso], ...FUSOS_BRASIL] });
    const exigirConta = el('input', { type: 'checkbox', id: 'exigir-conta', checked: config.exigirContaCliente ? true : null });
    const listaBloqueados = el('div', { classe: 'escolhas' });
    function desenharBloqueados() {
      config.diasBloqueados.sort();
      trocar(listaBloqueados, ...(config.diasBloqueados.length ? config.diasBloqueados.map((data, indice) => el('span', { classe: 'etiqueta' }, [
        data.split('-').reverse().join('/'),
        el('button', { classe: 'botao botao--fantasma botao--icone botao--pequeno', type: 'button', 'aria-label': `Remover ${data}`, aoClick: () => { config.diasBloqueados.splice(indice, 1); desenharBloqueados(); } }, [icone('fechar', 12)]),
      ])) : [el('span', { classe: 'texto-suave texto-pequeno', texto: 'Nenhum dia bloqueado.' })]));
    }
    desenharBloqueados();
    const novaData = el('input', { type: 'date', classe: 'entrada', 'aria-label': 'Data para bloquear' });
    const cartaoRegras = cartao('Regras de agendamento', 'engrenagem', [
      el('div', { classe: 'linha-campos' }, [passo.elemento, antecedencia.elemento, diasAFrente.elemento, fuso.elemento]),
      el('div', { classe: 'campo' }, [
        el('span', { classe: 'campo__rotulo', texto: 'Dias bloqueados (folgas, feriados)' }),
        listaBloqueados,
        el('div', { classe: 'copiavel' }, [novaData, el('button', {
          classe: 'botao botao--secundario', type: 'button',
          aoClick: () => {
            if (novaData.value && !config.diasBloqueados.includes(novaData.value)) config.diasBloqueados.push(novaData.value);
            novaData.value = '';
            desenharBloqueados();
          },
        }, [icone('mais', 16), 'Bloquear'])]),
      ]),
      el('label', { classe: 'caixa-marcar', for: 'exigir-conta' }, [exigirConta, el('span', { texto: 'Exigir que a cliente tenha conta no StylOS para agendar (evita pedidos falsos, mas dá mais trabalho para ela).' })]),
    ]);

    // ---- Aviso automático (opcional) ----
    const chaveCallMeBot = campo({ id: 'callmebot', rotulo: 'Chave do CallMeBot (opcional)', valor: '', dica: dados.callmebotConfigurado ? 'Já existe uma chave salva. Digite outra para trocar.' : 'Deixe em branco se não for usar.', atributos: { autocomplete: 'off', placeholder: dados.callmebotConfigurado ? '•••••• (configurada)' : '' } });
    let removerCallMeBot = false;
    const cartaoAvisoAuto = el('details', { classe: 'cartao' }, [
      el('summary', { classe: 'cartao__titulo' }, [icone('whatsapp', 20), el('h2', { texto: 'Aviso automático no seu WhatsApp (opcional)' }), dados.callmebotConfigurado ? el('span', { classe: 'etiqueta etiqueta--sucesso', texto: 'Ativo' }) : null]),
      el('p', { classe: 'texto-suave', texto: 'Por padrão, a CLIENTE toca em "Enviar pelo WhatsApp" e a mensagem chega até você. Se quiser receber um aviso automático mesmo que ela não envie, use o CallMeBot (serviço gratuito de terceiros, sem garantia):' }),
      el('ol', { classe: 'passos-guia' }, [
        el('li', { texto: 'No seu celular, salve o contato do CallMeBot indicado no site callmebot.com (seção WhatsApp).' }),
        el('li', { texto: 'Mande para ele a mensagem de ativação que o site mostra.' }),
        el('li', { texto: 'Ele responde com a sua "apikey". Cole aqui.' }),
      ]),
      el('p'),
      chaveCallMeBot.elemento,
      dados.callmebotConfigurado ? el('button', { classe: 'botao botao--perigo botao--pequeno', type: 'button', aoClick: (evento) => { removerCallMeBot = true; evento.currentTarget.textContent = 'Será removida ao salvar'; } }, [icone('lixeira', 16), 'Remover chave']) : null,
      el('p'),
      alerta('Privacidade: com isso, nome e telefone da cliente passam pelos servidores do CallMeBot.', 'aviso'),
    ]);

    // ---- Salvar ----
    const areaErro = el('div');
    async function salvarAgenda(evento) {
      const botao = evento.currentTarget;
      areaErro.replaceChildren();
      botao.classList.add('carregando');
      config.passoMin = Number(passo.entrada.value);
      config.antecedenciaMin = Number(antecedencia.entrada.value);
      config.diasAFrente = Number(diasAFrente.entrada.value);
      config.exigirContaCliente = exigirConta.checked;
      const corpo = { whatsapp: whatsapp.entrada.value, googleAgendaId: dados.emailIntegracao ? agendaId.entrada.value : dados.googleAgendaId, fuso: fuso.entrada.value, config };
      if (chaveCallMeBot.entrada.value.trim()) corpo.callmebotChave = chaveCallMeBot.entrada.value.trim();
      else if (removerCallMeBot) corpo.callmebotChave = '';
      try {
        await api('/api/adm/agenda', { metodo: 'PUT', corpo });
        avisar('Agenda salva!');
        navegar();
      } catch (erro) {
        botao.classList.remove('carregando');
        areaErro.append(alerta(erro.message));
        areaErro.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
    // Dois botões "Salvar" (topo e fim da tela), mesma ação
    const criarBotaoSalvar = (id) => el('button', { classe: 'botao botao--primario', type: 'button', id, aoClick: salvarAgenda }, [icone('check', 18), 'Salvar alterações']);

    trocar(principal, 
      cabecalhoTela('Agenda e WhatsApp', 'Configure como as clientes marcam horário com você.', [criarBotaoSalvar('salvar-agenda')]),
      cartaoWhatsapp, cartaoGoogle, cartaoExpediente, cartaoServicos, cartaoRegras, cartaoAvisoAuto,
      el('p'), areaErro,
      el('div', { classe: 'cabecalho-tela__acoes' }, [criarBotaoSalvar('salvar-agenda-fim')]),
    );
  }

  // ================================================================
  // TELA: AGENDAMENTOS
  // ================================================================
  let filtroAgendamentos = 'proximos';

  /** Converte ISO para o formato do link do Google Agenda: 20261112T130000Z */
  const paraGoogle = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

  function telefoneComDdi(digitos) {
    return digitos.length <= 11 ? `55${digitos}` : digitos;
  }

  function itemAgendamento(item, fuso, compacto) {
    const nomesStatus = { pendente: ['Pendente', 'etiqueta--aviso'], confirmado: ['Confirmado', 'etiqueta--sucesso'], cancelado: ['Cancelado', 'etiqueta--perigo'], concluido: ['Concluído', ''] };
    const [rotuloStatus, classeStatus] = nomesStatus[item.status];
    const mudarStatus = async (novo, texto) => {
      if (novo === 'cancelado' && !(await confirmar(`Cancelar o horário de ${item.nome}? O horário volta a ficar livre na página.`, { botao: 'Cancelar horário', perigo: true }))) return;
      await api(`/api/adm/agendamentos/${item.id}/status`, { corpo: { status: novo } });
      avisar(texto);
      await atualizarPendentes();
      navegar();
    };
    const dataTexto = formatarDataHora(item.inicio, fuso, 'dia');
    const horaTexto = formatarDataHora(item.inicio, fuso, 'hora');
    const mensagemCliente = item.status === 'cancelado'
      ? `Olá, ${item.nome}! Infelizmente precisamos cancelar seu horário de ${item.servico} em ${dataTexto} às ${horaTexto}. Podemos remarcar?`
      : `Olá, ${item.nome}! Seu horário de ${item.servico} em ${dataTexto} às ${horaTexto} está CONFIRMADO. Te esperamos!`;
    const acoes = compacto ? [] : [
      item.status === 'pendente' ? el('button', { classe: 'botao botao--sucesso botao--pequeno', type: 'button', aoClick: () => mudarStatus('confirmado', 'Confirmado! Avise a cliente pelo WhatsApp.') }, [icone('check', 16), 'Confirmar']) : null,
      item.status === 'confirmado' && new Date(item.fim) < new Date() ? el('button', { classe: 'botao botao--secundario botao--pequeno', type: 'button', aoClick: () => mudarStatus('concluido', 'Marcado como concluído.') }, ['Concluído']) : null,
      item.telefone ? el('a', { classe: 'botao botao--whatsapp botao--pequeno', href: `https://wa.me/${telefoneComDdi(item.telefone)}?text=${encodeURIComponent(mensagemCliente)}`, target: '_blank', rel: 'noopener noreferrer' }, [icone('whatsapp', 16), 'Cliente']) : null,
      item.status !== 'cancelado' ? el('a', {
        classe: 'botao botao--secundario botao--pequeno', target: '_blank', rel: 'noopener noreferrer', title: 'Criar o evento na sua Google Agenda',
        href: `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(`${item.servico} — ${item.nome}`)}&dates=${paraGoogle(item.inicio)}/${paraGoogle(item.fim)}&details=${encodeURIComponent(`Telefone: ${item.telefoneFormatado}\nCódigo: ${item.codigo}\n${item.observacoes}`)}`,
      }, [icone('google', 16), 'Agenda']) : null,
      ['pendente', 'confirmado'].includes(item.status) ? el('button', { classe: 'botao botao--fantasma botao--pequeno', type: 'button', aoClick: () => mudarStatus('cancelado', 'Horário cancelado.') }, ['Cancelar']) : null,
    ];
    return el('article', { classe: `agendamento agendamento--${item.status}` }, [
      el('div', { classe: 'agendamento__quando' }, [
        el('span', { classe: 'agendamento__dia', texto: formatarDataHora(item.inicio, fuso, 'semana') }),
        el('span', { classe: 'agendamento__hora', texto: horaTexto }),
        el('span', { classe: 'agendamento__data', texto: dataTexto }),
      ]),
      el('div', { classe: 'agendamento__info' }, [
        el('strong', { texto: item.nome }), ' ', el('span', { classe: `etiqueta ${classeStatus}`, texto: rotuloStatus }),
        el('p', { texto: `${item.servico} · ${item.duracaoMin} min · ${item.telefoneFormatado}` }),
        compacto ? null : el('p', { texto: `Página: ${item.pagina} · Código ${item.codigo}${item.clienteComConta ? ' · cliente com conta' : ''}` }),
        item.observacoes && !compacto ? el('p', { texto: `Obs.: ${item.observacoes}` }) : null,
      ]),
      compacto ? null : el('div', { classe: 'agendamento__acoes' }, acoes),
    ]);
  }

  async function telaAgendamentos() {
    const dados = await api(`/api/adm/agendamentos?filtro=${filtroAgendamentos}`);
    estado.totalPendentes = dados.totalPendentes;
    desenharLateral();
    const filtros = [['proximos', 'Próximos'], ['pendentes', `Pendentes${dados.totalPendentes ? ` (${dados.totalPendentes})` : ''}`], ['passados', 'Passados'], ['cancelados', 'Cancelados']];
    trocar(principal, 
      cabecalhoTela('Agendamentos', 'Pedidos feitos pelas suas páginas. Um pedido "pendente" já bloqueia o horário até você confirmar ou cancelar.', [
        el('button', { classe: 'botao botao--secundario', type: 'button', aoClick: navegar }, [icone('setaBaixo', 16), 'Atualizar']),
      ]),
      el('div', { classe: 'filtros', role: 'tablist' }, filtros.map(([valor, texto]) => el('button', {
        classe: `filtro ${valor === filtroAgendamentos ? 'filtro--ativo' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(valor === filtroAgendamentos), texto,
        aoClick: () => { filtroAgendamentos = valor; navegar(); },
      }))),
      dados.agendamentos.length
        ? el('div', { classe: 'lista-agendamentos' }, dados.agendamentos.map((item) => itemAgendamento(item, dados.fuso)))
        : el('div', { classe: 'cartao vazio' }, [icone('agenda', 40), el('p', { texto: 'Nada por aqui.' })]),
    );
  }

  // ================================================================
  // TELA: MINHA CONTA
  // ================================================================
  async function telaConta() {
    const nome = campo({ id: 'conta-nome', rotulo: 'Nome', valor: estado.usuario.nome, maximo: 80 });
    const telefone = campo({ id: 'conta-telefone', rotulo: 'Telefone (opcional)', valor: mascaraTelefone(estado.usuario.telefone || ''), tipo: 'tel' });
    telefone.entrada.addEventListener('input', () => { telefone.entrada.value = mascaraTelefone(telefone.entrada.value); });
    const areaDados = el('div');
    trocar(principal, 
      cabecalhoTela('Minha conta', estado.usuario.email),
      el('div', { classe: 'grade-2' }, [
        cartao('Meus dados', 'pessoa', [
          nome.elemento, telefone.elemento, areaDados,
          el('button', {
            classe: 'botao botao--primario', type: 'button',
            aoClick: async () => {
              areaDados.replaceChildren();
              try {
                await api('/api/conta', { metodo: 'PUT', corpo: { nome: nome.entrada.value, telefone: telefone.entrada.value } });
                estado.usuario.nome = nome.entrada.value.trim();
                avisar('Dados salvos.');
                desenharLateral();
              } catch (erro) {
                areaDados.append(alerta(erro.message));
              }
            },
          }, ['Salvar']),
        ]),
        cartao('Trocar senha', 'cadeado', formularioTrocaSenha(() => avisar('Senha alterada. Outras sessões abertas foram encerradas.'))),
      ]),
    );
  }

  function formularioTrocaSenha(aoConcluir) {
    const atual = campo({ id: 'senha-atual', rotulo: 'Senha atual', tipo: 'password', atributos: { autocomplete: 'current-password' } });
    const nova = campo({ id: 'senha-nova', rotulo: 'Nova senha', tipo: 'password', dica: 'Pelo menos 8 caracteres, com letras e números.', atributos: { autocomplete: 'new-password' } });
    nova.elemento.insertBefore(medidorSenha(nova.entrada), nova.elemento.lastChild);
    const repetir = campo({ id: 'senha-repetir', rotulo: 'Repita a nova senha', tipo: 'password', atributos: { autocomplete: 'new-password' } });
    const areaErro = el('div');
    const botao = el('button', { classe: 'botao botao--primario', type: 'submit', texto: 'Trocar senha' });
    return [el('form', {
      novalidate: true,
      aoSubmit: async (evento) => {
        evento.preventDefault();
        areaErro.replaceChildren();
        if (nova.entrada.value !== repetir.entrada.value) {
          areaErro.append(alerta('As duas senhas novas não são iguais.'));
          return;
        }
        botao.classList.add('carregando');
        try {
          await api('/api/trocar-senha', { corpo: { senhaAtual: atual.entrada.value, novaSenha: nova.entrada.value } });
          evento.target.reset();
          aoConcluir();
        } catch (erro) {
          areaErro.append(alerta(erro.message));
        }
        botao.classList.remove('carregando');
      },
    }, [atual.elemento, nova.elemento, repetir.elemento, areaErro, el('div', { classe: 'campo' }, [botao])])];
  }

  /** ADM criado pelo dono entra com senha temporária: é obrigado a trocar. */
  function exigirTrocaDeSenha() {
    return new Promise((resolver) => {
      const caixa = janela({
        titulo: 'Crie sua senha',
        icone: 'cadeado',
        fechavel: false,
        conteudo: [
          el('p', { texto: 'Você entrou com uma senha temporária. Para sua segurança, crie uma senha só sua antes de continuar.' }),
          ...formularioTrocaSenha(() => {
            estado.usuario.deveTrocarSenha = false;
            caixa.fechar();
            avisar('Senha criada! Bem-vinda(o) ao StylOS.');
            resolver();
            navegar().then(() => { if (!estado.usuario.tutorialPainel) iniciarTutorial(); });
          }),
        ],
      });
    });
  }

  // ================================================================
  // TELAS DO DONO
  // ================================================================
  async function telaAdms() {
    const { adms } = await api('/api/dono/adms');
    const linhas = adms.map((adm) => el('tr', {}, [
      el('td', {}, [el('strong', { texto: adm.nome }), el('div', { classe: 'texto-suave texto-pequeno', texto: adm.email })]),
      el('td', {}, [
        !adm.ativo ? el('span', { classe: 'etiqueta etiqueta--perigo', texto: 'Desativado' })
          : adm.deve_trocar_senha ? el('span', { classe: 'etiqueta etiqueta--aviso', texto: 'Aguardando 1º acesso' })
            : el('span', { classe: 'etiqueta etiqueta--sucesso', texto: 'Ativo' }),
      ]),
      el('td', { texto: `${adm.paginas_publicadas} de ${adm.total_paginas}` }),
      el('td', {}, [adm.tem_whatsapp ? el('span', { classe: 'etiqueta etiqueta--sucesso', texto: 'Sim' }) : el('span', { classe: 'etiqueta', texto: 'Não' })]),
      el('td', { classe: 'texto-pequeno', texto: adm.ultimo_login ? formatarDataHora(adm.ultimo_login, undefined, 'dataHora') : '—' }),
      el('td', {}, [el('div', { classe: 'agendamento__acoes' }, [
        el('button', {
          classe: 'botao botao--secundario botao--pequeno', type: 'button',
          aoClick: async () => {
            if (!(await confirmar(`Gerar uma nova senha temporária para ${adm.nome}? A senha atual deixa de funcionar.`))) return;
            const { senhaTemporaria } = await api(`/api/dono/adms/${adm.id}/redefinir-senha`, { corpo: {} });
            mostrarCredenciais(adm.nome, adm.email, senhaTemporaria);
            navegar();
          },
        }, ['Nova senha']),
        el('button', {
          classe: `botao ${adm.ativo ? 'botao--perigo' : 'botao--secundario'} botao--pequeno`, type: 'button',
          aoClick: async () => {
            if (adm.ativo && !(await confirmar(`Desativar ${adm.nome}? Ela/ele não conseguirá entrar e as páginas dela(e) saem do ar.`, { botao: 'Desativar', perigo: true }))) return;
            await api(`/api/dono/adms/${adm.id}/ativo`, { corpo: { ativo: !adm.ativo } });
            avisar(adm.ativo ? 'ADM desativado.' : 'ADM reativado.');
            navegar();
          },
        }, [adm.ativo ? 'Desativar' : 'Reativar']),
      ])]),
    ]));
    trocar(principal, 
      cabecalhoTela('Administradores', 'Só você (dono) cadastra ADMs. Cada ADM monta as próprias páginas e tem a própria agenda.', [
        el('button', { classe: 'botao botao--primario', type: 'button', id: 'botao-novo-adm', aoClick: novoAdm }, [icone('mais', 18), 'Cadastrar ADM']),
      ]),
      adms.length
        ? el('div', { classe: 'cartao rolagem-horizontal' }, [el('table', { classe: 'tabela' }, [
            el('thead', {}, [el('tr', {}, ['Nome', 'Situação', 'Páginas publicadas', 'WhatsApp', 'Último acesso', 'Ações'].map((texto) => el('th', { texto })))]),
            el('tbody', {}, linhas),
          ])])
        : el('div', { classe: 'cartao vazio' }, [icone('pessoas', 40), el('p', { texto: 'Nenhum ADM ainda. Cadastre as profissionais do salão.' })]),
    );
  }

  function mostrarCredenciais(nome, email, senha) {
    const endereco = `${estado.urlPublica || location.origin}/entrar`;
    const texto = `Olá, ${nome}! Seu acesso ao StylOS Beauty:\nEndereço: ${endereco}\nE-mail: ${email}\nSenha temporária: ${senha}\nNo primeiro acesso você vai criar a sua própria senha.`;
    janela({
      titulo: 'Acesso criado',
      icone: 'cadeado',
      conteudo: [
        alerta('Esta senha aparece SÓ AGORA. Copie e envie para a pessoa por um canal privado.', 'aviso'),
        el('p'),
        el('div', { classe: 'campo' }, [el('span', { classe: 'campo__rotulo', texto: 'Senha temporária' }), blocoCopiavel(senha)]),
        el('div', { classe: 'campo' }, [el('span', { classe: 'campo__rotulo', texto: 'Mensagem pronta' }), el('pre', { classe: 'copiavel' }, [el('code', { texto })])]),
      ],
      botoes: [
        { texto: 'Copiar mensagem', classe: 'botao--secundario', icone: 'copiar', aoClicar: () => { copiar(texto); return true; } },
        { texto: 'Pronto', classe: 'botao--primario' },
      ],
    });
  }

  function novoAdm() {
    const nome = campo({ id: 'adm-nome', rotulo: 'Nome', maximo: 80 });
    const email = campo({ id: 'adm-email', rotulo: 'E-mail (será o login)', tipo: 'email' });
    const areaErro = el('div');
    janela({
      titulo: 'Cadastrar ADM',
      icone: 'pessoas',
      conteudo: [nome.elemento, email.elemento, el('p', { classe: 'texto-suave texto-pequeno', texto: 'O sistema cria uma senha temporária. A pessoa troca no primeiro acesso e já encontra uma página de exemplo e um tutorial.' }), areaErro],
      botoes: [
        { texto: 'Cancelar' },
        {
          texto: 'Cadastrar', classe: 'botao--primario',
          aoClicar: async () => {
            areaErro.replaceChildren();
            try {
              const { senhaTemporaria } = await api('/api/dono/adms', { corpo: { nome: nome.entrada.value, email: email.entrada.value } });
              setTimeout(() => mostrarCredenciais(nome.entrada.value.trim(), email.entrada.value.trim().toLowerCase(), senhaTemporaria), 50);
              navegar();
            } catch (erro) {
              areaErro.append(alerta(erro.message));
              return true;
            }
          },
        },
      ],
    });
  }

  async function telaGoogle() {
    const dados = await api('/api/dono/google');
    const caixaJson = campo({ id: 'json-google', rotulo: 'Cole aqui o conteúdo do arquivo JSON da chave', tipo: 'textarea', atributos: { rows: '6', spellcheck: 'false', placeholder: '{ "type": "service_account", ... }' } });
    const areaMensagem = el('div');
    trocar(principal, 
      cabecalhoTela('Integração Google', 'Configure UMA vez. Depois cada ADM só compartilha a própria agenda com o e-mail da integração.'),
      dados.configurado
        ? cartao('Integração ativa', 'check', [
            el('p', { texto: 'Os ADMs devem compartilhar a agenda com este e-mail (permissão "ver apenas livre/ocupado"):' }),
            blocoCopiavel(dados.email),
            el('p'),
            el('button', {
              classe: 'botao botao--perigo botao--pequeno', type: 'button',
              aoClick: async () => {
                if (!(await confirmar('Remover a integração? As páginas deixam de enxergar os horários ocupados do Google.', { perigo: true, botao: 'Remover' }))) return;
                await api('/api/dono/google', { metodo: 'DELETE' });
                navegar();
              },
            }, ['Remover integração']),
          ])
        : el('div', { classe: 'alerta alerta--info' }, [icone('info', 18), el('div', { texto: 'Ainda não configurada. Sem ela, os horários seguem só o expediente e os pedidos do site.' })]),
      el('p'),
      cartao(dados.configurado ? 'Trocar a chave' : 'Como configurar (uns 10 minutos)', 'google', [
        el('ol', { classe: 'passos-guia' }, [
          el('li', { texto: 'Acesse console.cloud.google.com com a conta Google do salão/Senac e crie um projeto (ex.: "StylOS").' }),
          el('li', { texto: 'Em "APIs e serviços" → "Biblioteca", procure "Google Calendar API" e clique em Ativar.' }),
          el('li', { texto: 'Em "IAM e administrador" → "Contas de serviço", clique em "Criar conta de serviço" (nome: stylos-agenda). Não precisa dar papéis.' }),
          el('li', { texto: 'Abra a conta criada → aba "Chaves" → "Adicionar chave" → "Criar nova chave" → JSON. Um arquivo será baixado.' }),
          el('li', { texto: 'Abra esse arquivo no Bloco de Notas, copie TUDO e cole abaixo. Depois apague o arquivo do computador.' }),
        ]),
        el('p'),
        caixaJson.elemento,
        areaMensagem,
        el('button', {
          classe: 'botao botao--primario', type: 'button',
          aoClick: async (evento) => {
            areaMensagem.replaceChildren();
            evento.currentTarget.classList.add('carregando');
            try {
              await api('/api/dono/google', { metodo: 'PUT', corpo: { json: caixaJson.entrada.value } });
              avisar('Integração salva!');
              navegar();
            } catch (erro) {
              areaMensagem.append(alerta(erro.message));
              evento.target.classList.remove('carregando');
            }
          },
        }, ['Salvar chave']),
        el('p'),
        el('p', { classe: 'texto-suave texto-pequeno', texto: 'A chave fica criptografada no banco de dados e nunca é mostrada de novo.' }),
      ]),
    );
  }

  async function telaSistema() {
    const [sistema, todas, auditoria] = await Promise.all([api('/api/dono/sistema'), api('/api/dono/paginas'), api('/api/dono/auditoria')]);
    const url = campo({ id: 'url-publica', rotulo: 'Endereço público do sistema', valor: sistema.urlPublica, tipo: 'url', dica: 'O endereço do túnel (Tailscale/Cloudflare). Usado nos links das páginas. Ex.: https://salao.tail1234.ts.net', atributos: { placeholder: 'https://...' } });
    const areaUrl = el('div');
    const emailCliente = campo({ id: 'email-cliente', rotulo: 'E-mail da cliente', tipo: 'email' });
    const areaCliente = el('div');
    const NOMES_ACOES = {
      login: 'Entrou', 'login-falhou': 'Senha errada', 'adm-criado': 'ADM cadastrado', 'pagina-publicada': 'Página publicada', 'pagina-excluida': 'Página excluída',
      'senha-trocada': 'Senha trocada', 'adm-desativado': 'ADM desativado', 'adm-reativado': 'ADM reativado', 'adm-senha-redefinida': 'Senha de ADM redefinida',
      'google-configurado': 'Google configurado', 'google-removido': 'Google removido', 'url-publica-alterada': 'Endereço alterado', 'cadastro-cliente': 'Cliente se cadastrou',
      'configuracao-inicial': 'Sistema configurado', 'pagina-retirada-pelo-dono': 'Página retirada pelo dono', 'cliente-cancelou': 'Cliente cancelou', 'cliente-senha-redefinida': 'Senha de cliente redefinida',
    };
    trocar(principal, 
      cabecalhoTela('Sistema e segurança', `${sistema.totais.adms} ADM(s) · ${sistema.totais.clientes} cliente(s) · ${sistema.totais.paginasPublicadas} página(s) no ar · ${sistema.totais.agendamentos} agendamento(s)`),
      el('div', { classe: 'grade-2' }, [
        cartao('Endereço público', 'link', [
          url.elemento, areaUrl,
          el('button', {
            classe: 'botao botao--primario', type: 'button',
            aoClick: async () => {
              areaUrl.replaceChildren();
              try {
                const resposta = await api('/api/dono/sistema', { metodo: 'PUT', corpo: { urlPublica: url.entrada.value } });
                estado.urlPublica = resposta.urlPublica;
                avisar('Endereço salvo.');
              } catch (erro) {
                areaUrl.append(alerta(erro.message));
              }
            },
          }, ['Salvar endereço']),
        ]),
        cartao('Cliente esqueceu a senha', 'cadeado', [
          el('p', { classe: 'texto-suave', texto: 'Gera uma senha temporária. Confirme a identidade da cliente antes (ex.: pelo WhatsApp cadastrado).' }),
          emailCliente.elemento, areaCliente,
          el('button', {
            classe: 'botao botao--secundario', type: 'button',
            aoClick: async () => {
              areaCliente.replaceChildren();
              try {
                const { senhaTemporaria } = await api('/api/dono/clientes/redefinir-senha', { corpo: { email: emailCliente.entrada.value } });
                areaCliente.append(el('div', { classe: 'campo' }, [el('span', { classe: 'campo__rotulo', texto: 'Senha temporária' }), blocoCopiavel(senhaTemporaria)]));
              } catch (erro) {
                areaCliente.append(alerta(erro.message));
              }
            },
          }, ['Gerar senha temporária']),
        ]),
      ]),
      el('p'),
      cartao('Todas as páginas', 'pagina', todas.paginas.length ? [el('div', { classe: 'rolagem-horizontal' }, [el('table', { classe: 'tabela' }, [
        el('thead', {}, [el('tr', {}, ['Página', 'Autor(a)', 'Situação', 'Ações'].map((texto) => el('th', { texto })))]),
        el('tbody', {}, todas.paginas.map((pagina) => el('tr', {}, [
          el('td', {}, [el('strong', { texto: pagina.titulo }), pagina.slug ? el('div', { classe: 'texto-pequeno texto-suave', texto: `/p/${pagina.slug}` }) : null]),
          el('td', { texto: pagina.autor }),
          el('td', {}, [el('span', { classe: `etiqueta ${pagina.publicada ? 'etiqueta--sucesso' : ''}`, texto: pagina.publicada ? 'No ar' : 'Rascunho' })]),
          el('td', {}, [el('div', { classe: 'agendamento__acoes' }, [
            pagina.publicada ? el('a', { classe: 'botao botao--secundario botao--pequeno', href: `/p/${pagina.slug}`, target: '_blank', rel: 'noopener', texto: 'Ver' }) : null,
            pagina.publicada ? el('button', {
              classe: 'botao botao--perigo botao--pequeno', type: 'button', texto: 'Tirar do ar',
              aoClick: async () => {
                if (!(await confirmar(`Tirar "${pagina.titulo}" do ar? Use se o conteúdo for impróprio.`, { perigo: true, botao: 'Tirar do ar' }))) return;
                await api(`/api/dono/paginas/${pagina.id}/despublicar`, { corpo: {} });
                navegar();
              },
            }) : null,
          ])]),
        ]))),
      ])])] : [el('p', { classe: 'texto-suave', texto: 'Nenhuma página.' })]),
      el('p'),
      cartao('Registro de atividades (últimas 200)', 'escudo', [el('div', { classe: 'rolagem-horizontal' }, [el('table', { classe: 'tabela' }, [
        el('thead', {}, [el('tr', {}, ['Quando', 'Quem', 'O quê', 'Detalhe', 'IP'].map((texto) => el('th', { texto })))]),
        el('tbody', {}, auditoria.registros.map((registro) => el('tr', {}, [
          el('td', { classe: 'texto-pequeno', texto: formatarDataHora(registro.quando, undefined, 'dataHora') }),
          el('td', { texto: registro.usuario || '—' }),
          el('td', {}, [el('span', { classe: `etiqueta ${registro.acao === 'login-falhou' ? 'etiqueta--perigo' : ''}`, texto: NOMES_ACOES[registro.acao] || registro.acao })]),
          el('td', { classe: 'texto-pequeno', texto: registro.detalhe || '' }),
          el('td', { classe: 'texto-pequeno texto-suave', texto: registro.ip || '' }),
        ]))),
      ])])]),
    );
  }

  // ================================================================
  // TUTORIAL DO PAINEL
  // ================================================================
  function iniciarTutorial() {
    const celular = window.matchMedia('(max-width: 900px)').matches;
    const mostrarMenu = async () => { if (celular) abrirLateralCelular(); };
    const esconderMenu = async () => { if (celular) fecharLateralCelular(); };
    const passos = [
      { alvo: null, titulo: 'Bem-vinda(o) ao StylOS Beauty!', texto: 'Em 1 minuto vamos mostrar onde fica cada coisa. Você pode rever este tutorial quando quiser pelo menu.', antes: async () => { if (location.hash && location.hash !== '#inicio') { location.hash = '#inicio'; await navegar(); } } },
      { alvo: '#cartao-primeiros-passos', titulo: 'Primeiros passos', texto: 'Esta lista mostra o que falta para o seu salão receber agendamentos. Siga de cima para baixo.', antes: esconderMenu },
      { alvo: '#menu-paginas', titulo: 'Minhas páginas', texto: 'Aqui ficam as suas páginas. Já deixamos uma PÁGINA DE EXEMPLO pronta: abra no editor para ver como funciona e depois faça a sua.', antes: mostrarMenu },
      { alvo: '#menu-agenda', titulo: 'Agenda e WhatsApp', texto: 'Cadastre seu WhatsApp (obrigatório), seus dias e horários de trabalho, os serviços e conecte a Google Agenda.', antes: mostrarMenu },
      { alvo: '#menu-agendamentos', titulo: 'Agendamentos', texto: 'Cada pedido feito pela página aparece aqui e chega no seu WhatsApp. Você confirma, cancela ou avisa a cliente com um toque.', antes: mostrarMenu },
    ];
    if (ehDono()) {
      passos.push({ alvo: '#menu-adms', titulo: 'Só para você: Administradores', texto: 'Você é o DONO. Só você cadastra ADMs. Comece configurando a Integração Google e o Endereço público (em Sistema).', antes: mostrarMenu });
    }
    passos.push({ alvo: '#rever-tutorial', titulo: 'Pronto!', texto: 'Se esquecer algo, clique aqui para ver o tutorial de novo. Bom trabalho!', antes: mostrarMenu });
    window.TourStylOS.iniciar(passos, {
      aoTerminar: async () => {
        fecharLateralCelular();
        estado.usuario.tutorialPainel = true;
        await api('/api/tutorial', { corpo: { qual: 'painel' } }).catch(() => {});
      },
    });
  }

  // ================================================================
  // INÍCIO
  // ================================================================
  async function iniciar() {
    document.getElementById('marca-celular').replaceWith(marca());
    const botaoAbrir = document.getElementById('abrir-lateral');
    botaoAbrir.append(icone('menu', 22));
    botaoAbrir.addEventListener('click', abrirLateralCelular);
    document.addEventListener('keydown', (evento) => { if (evento.key === 'Escape') fecharLateralCelular(); });

    const sessao = await api('/api/sessao');
    if (!sessao.usuario) { location.href = '/entrar?voltar=/painel'; return; }
    if (sessao.usuario.papel === 'usuario') { location.href = '/minha-conta'; return; }
    estado.usuario = sessao.usuario;
    estado.urlPublica = sessao.urlPublica;
    window.addEventListener('hashchange', navegar);

    if (estado.usuario.deveTrocarSenha) {
      desenharLateral();
      principal.replaceChildren();
      await exigirTrocaDeSenha();
      return;
    }
    await atualizarPendentes();
    await navegar();
    if (!estado.usuario.tutorialPainel) setTimeout(iniciarTutorial, 400);
  }

  iniciar().catch((erro) => trocar(principal, alerta(erro.message)));
})();
