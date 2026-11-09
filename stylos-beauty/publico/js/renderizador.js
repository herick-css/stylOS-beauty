/**
 * renderizador.js
 * ------------------------------------------------------------------
 * Desenha uma página do StylOS a partir do conteúdo (JSON) salvo.
 * É usado em DOIS lugares, para a prévia ser idêntica ao resultado:
 *   - na página pública  (/p/<slug>)       → modo 'publico'
 *   - na prévia do editor (/pre-visualizacao) → modo 'previa'
 *
 * SEGURANÇA: todo texto digitado pelo ADM entra na página como TEXTO
 * (textContent), nunca como HTML. Mesmo que alguém digite <script>,
 * aparece escrito na tela e não executa.
 *
 * Cada seção ocupa no mínimo uma tela inteira (100% da altura visível)
 * e toda a largura. Se o conteúdo não couber (ex.: celular), ela cresce.
 */
(function (raiz) {
  'use strict';

  const Esquemas = raiz.EsquemasStylOS;
  const Icones = raiz.IconesStylOS;

  // Fontes de cada tema (carregadas do Google Fonts só quando o tema é usado)
  const FONTES_POR_TEMA = {
    'noir-barbearia': 'family=Inter:wght@400;500;700;800;900',
    'figaro-classico': 'family=Playfair+Display:ital,wght@0,400;0,600;1,400&family=Inter:wght@400;500',
    'lavanda-suave': 'family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Jost:wght@300;400;500',
    'rose-noir': 'family=Poppins:wght@200;300;400;500',
    'areia-neutro': 'family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Inter:wght@400;500',
  };

  // ================================================================
  // Funções de apoio para criar elementos com segurança
  // ================================================================

  /**
   * Cria um elemento HTML.
   * atributos especiais: classe, texto, dados (data-*), aoClick/aoKeydown... (eventos)
   */
  function el(tag, atributos, filhos) {
    const elemento = document.createElement(tag);
    for (const [chave, valor] of Object.entries(atributos || {})) {
      if (valor === null || valor === undefined || valor === false) continue;
      if (chave === 'classe') elemento.className = valor;
      else if (chave === 'texto') elemento.textContent = valor;
      else if (chave === 'dados') Object.assign(elemento.dataset, valor);
      else if (chave.startsWith('ao') && typeof valor === 'function') elemento.addEventListener(chave.slice(2).toLowerCase(), valor);
      else elemento.setAttribute(chave, valor === true ? '' : String(valor));
    }
    for (const filho of [].concat(filhos || [])) {
      if (filho === null || filho === undefined || filho === false || filho === '') continue;
      elemento.append(filho instanceof Node ? filho : document.createTextNode(String(filho)));
    }
    return elemento;
  }

  /** Texto com *palavras entre asteriscos* → a palavra vira destaque (<em>). */
  function textoComDestaque(texto) {
    const fragmento = document.createDocumentFragment();
    String(texto || '').split(/(\*[^*]+\*)/g).forEach((pedaco) => {
      if (/^\*[^*]+\*$/.test(pedaco)) fragmento.append(el('em', { texto: pedaco.slice(1, -1) }));
      else if (pedaco) fragmento.append(document.createTextNode(pedaco));
    });
    return fragmento;
  }

  /** Texto longo: linha em branco = novo parágrafo; quebra simples = <br>. */
  function paragrafos(texto, classe) {
    const blocos = String(texto || '').split(/\n{2,}/).map((bloco) => bloco.trim()).filter(Boolean);
    return blocos.map((bloco) => {
      const p = el('p', { classe });
      bloco.split('\n').forEach((linha, indice) => {
        if (indice > 0) p.append(el('br'));
        p.append(document.createTextNode(linha));
      });
      return p;
    });
  }

  /** Foto ou, se não houver, um fundo decorativo (na prévia avisa para adicionar). */
  function midia(url, textoAlternativo, classe, contexto) {
    if (url) {
      return el('img', { classe: `midia ${classe || ''}`, src: url, alt: textoAlternativo || '', loading: 'lazy', decoding: 'async' });
    }
    const vazio = el('div', { classe: `midia midia--vazia ${classe || ''}`, 'aria-hidden': 'true' }, [Icones.criar('imagem', 28)]);
    if (contexto.modo === 'previa') vazio.append(el('span', { texto: 'Adicione uma foto' }));
    return vazio;
  }

  function icone(nome, tamanho) {
    return Icones.criar(nome, tamanho);
  }

  function reduzirMovimento() {
    return raiz.matchMedia && raiz.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /** Rola suavemente até uma seção (usado pelos links do menu). */
  function rolarAte(idSecao) {
    const alvo = document.getElementById(`secao-${idSecao}`);
    if (alvo) alvo.scrollIntoView({ behavior: reduzirMovimento() ? 'auto' : 'smooth', block: 'start' });
  }

  /** Link interno que rola até a seção sem recarregar a página. */
  function linkParaSecao(idSecao, conteudoDoLink, classe, aoClicarExtra) {
    return el('a', {
      href: `#secao-${idSecao}`,
      classe,
      aoClick: (evento) => {
        evento.preventDefault();
        if (aoClicarExtra) aoClicarExtra();
        rolarAte(idSecao);
      },
    }, conteudoDoLink);
  }

  /** Link para fora (redes sociais). Na prévia não sai do editor. */
  function linkExterno(url, rotulo, conteudoDoLink, classe, contexto) {
    return el('a', {
      href: url,
      classe,
      target: '_blank',
      rel: 'noopener noreferrer',
      'aria-label': rotulo,
      aoClick: (evento) => { if (contexto.modo === 'previa') evento.preventDefault(); },
    }, conteudoDoLink);
  }

  function cabecalhoDeSecao({ sobretitulo, titulo, texto, centralizado = true }) {
    return el('header', { classe: `cabecalho-secao ${centralizado ? 'cabecalho-secao--centro' : ''}` }, [
      sobretitulo ? el('p', { classe: 'sobretitulo', texto: sobretitulo }) : null,
      el('h2', { classe: 'titulo-secao' }, textoComDestaque(titulo)),
      el('span', { classe: 'divisor', 'aria-hidden': 'true' }),
      ...paragrafos(texto, 'texto-apoio'),
    ]);
  }

  // ================================================================
  // DESENHO DE CADA TIPO DE SEÇÃO
  // ================================================================
  const desenhar = {};

  desenhar.cabecalho = (secao, contexto) => {
    const dados = secao.dados;
    const idMenu = `menu-${secao.id}`;
    let menuAberto = false;
    const listaLinks = el('ul', { classe: 'nav__links', id: idMenu });
    const botaoMenu = el('button', {
      classe: 'nav__alternar', type: 'button', 'aria-expanded': 'false', 'aria-controls': idMenu, 'aria-label': 'Abrir menu',
      aoClick: () => alternarMenu(!menuAberto),
    }, [icone('menu', 24)]);
    const nav = el('nav', { classe: 'nav', 'aria-label': 'Menu principal' }, [
      linkParaSecao(secao.id, dados.nomeMarca, 'nav__marca'),
      botaoMenu,
      listaLinks,
    ]);

    function alternarMenu(abrir) {
      menuAberto = abrir;
      nav.classList.toggle('nav--aberta', abrir);
      botaoMenu.setAttribute('aria-expanded', String(abrir));
      botaoMenu.setAttribute('aria-label', abrir ? 'Fechar menu' : 'Abrir menu');
      botaoMenu.replaceChildren(icone(abrir ? 'fechar' : 'menu', 24));
    }

    for (const item of contexto.linksMenu) {
      listaLinks.append(el('li', {}, [linkParaSecao(item.id, item.rotulo, 'nav__link', () => alternarMenu(false))]));
    }
    if (dados.textoBotao) {
      listaLinks.append(el('li', { classe: 'nav__item-botao' }, [
        linkParaSecao(contexto.idAlvoBotao, dados.textoBotao, 'botao botao--pequeno', () => alternarMenu(false)),
      ]));
    }

    // Sem foto, a página publicada usa o layout centralizado; na prévia mostramos o espaço da foto.
    const layout = !dados.imagem && contexto.modo === 'publico' ? 'centralizado' : dados.layout;
    const hero = el('div', { classe: 'hero' }, [
      el('div', { classe: 'hero__texto' }, [
        el('h1', { classe: 'hero__titulo' }, textoComDestaque(dados.titulo)),
        dados.subtitulo ? el('p', { classe: 'hero__subtitulo', texto: dados.subtitulo }) : null,
        ...paragrafos(dados.paragrafo, 'hero__paragrafo'),
        dados.textoBotao
          ? linkParaSecao(contexto.idAlvoBotao, [dados.textoBotao, el('span', { classe: 'botao__icone' }, [icone('seta', 18)])], 'botao botao--primario')
          : null,
      ]),
      layout !== 'centralizado' ? el('div', { classe: 'hero__midia' }, [midia(dados.imagem, '', '', contexto)]) : null,
    ]);
    return el('section', { classe: `secao secao--cabecalho layout--${layout}` }, [nav, hero]);
  };

  desenhar.sobre = (secao, contexto) => {
    const dados = secao.dados;
    const texto = el('div', { classe: 'sobre__texto' }, [
      cabecalhoDeSecao({ sobretitulo: dados.sobretitulo, titulo: dados.titulo, texto: dados.paragrafo, centralizado: !dados.imagem }),
      dados.numeros.length
        ? el('ul', { classe: 'numeros' }, dados.numeros.map((numero) => el('li', { classe: 'numero' }, [
            el('strong', { classe: 'numero__valor', texto: numero.valor }),
            el('span', { classe: 'numero__rotulo', texto: numero.rotulo }),
          ])))
        : null,
    ]);
    return el('section', { classe: `secao secao--sobre ${dados.imagem ? 'sobre--com-imagem' : ''}` }, [
      el('div', { classe: 'conteudo' }, [texto, dados.imagem ? el('div', { classe: 'sobre__midia' }, [midia(dados.imagem, '', '', contexto)]) : null]),
    ]);
  };

  desenhar.destaque = (secao, contexto) => {
    const dados = secao.dados;
    return el('section', { classe: `secao secao--destaque lado--${dados.lado}` }, [
      el('div', { classe: 'destaque__midia' }, [midia(dados.imagem, '', '', contexto)]),
      el('div', { classe: 'destaque__cartao' }, [
        el('h2', { classe: 'titulo-secao' }, textoComDestaque(dados.titulo)),
        ...paragrafos(dados.texto, 'texto-apoio'),
        dados.textoBotao ? linkParaSecao(contexto.idAlvoBotao, dados.textoBotao, 'botao botao--secundario') : null,
      ]),
    ]);
  };

  desenhar.servicos = (secao, contexto) => {
    const dados = secao.dados;
    return el('section', { classe: 'secao secao--servicos' }, [
      el('div', { classe: 'conteudo' }, [
        cabecalhoDeSecao({ titulo: dados.titulo, texto: dados.subtitulo }),
        el('div', { classe: `grade-servicos grade--${Math.min(dados.itens.length, 3)}` }, dados.itens.map((item) => el('article', { classe: 'cartao-servico' }, [
          el('div', { classe: 'cartao-servico__midia' }, [midia(item.imagem, item.nome, '', contexto)]),
          el('div', { classe: 'cartao-servico__corpo' }, [
            el('h3', { classe: 'cartao-servico__nome', texto: item.nome }),
            ...paragrafos(item.descricao, 'cartao-servico__descricao'),
            el('div', { classe: 'cartao-servico__rodape' }, [
              item.preco ? el('span', { classe: 'cartao-servico__preco', texto: item.preco }) : el('span'),
              contexto.idAgendamento ? linkParaSecao(contexto.idAgendamento, ['Agendar', icone('seta', 16)], 'link-seta') : null,
            ]),
          ]),
        ]))),
      ]),
    ]);
  };

  desenhar.video = (secao, contexto) => {
    const dados = secao.dados;
    const video = Esquemas.extrairVideo(dados.video);
    const moldura = el('div', { classe: 'video__moldura' });
    if (video) {
      // "Fachada": o player só carrega quando a pessoa clica (mais rápido e mais privado)
      const botao = el('button', {
        classe: 'video__fachada', type: 'button', 'aria-label': `Assistir ao vídeo: ${dados.titulo}`,
        aoClick: () => {
          if (contexto.modo === 'previa') return;
          const endereco = video.provedor === 'youtube'
            ? `https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&rel=0`
            : `https://player.vimeo.com/video/${video.id}?autoplay=1`;
          moldura.replaceChildren(el('iframe', {
            src: endereco, title: dados.titulo, allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
            allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin', loading: 'lazy',
          }));
        },
      }, [el('span', { classe: 'video__play' }, [icone('play', 34)]), el('span', { classe: 'video__dica', texto: contexto.modo === 'previa' ? 'O vídeo toca na página publicada' : 'Assistir' })]);
      moldura.append(botao);
    } else {
      moldura.append(el('div', { classe: 'video__fachada video__fachada--vazia' }, [icone('video', 34), el('span', { texto: 'Cole o link do YouTube ou Vimeo' })]));
    }
    return el('section', { classe: 'secao secao--video' }, [
      el('div', { classe: 'conteudo' }, [cabecalhoDeSecao({ titulo: dados.titulo, texto: dados.texto }), moldura]),
    ]);
  };

  desenhar.depoimentos = (secao) => {
    const dados = secao.dados;
    return el('section', { classe: 'secao secao--depoimentos' }, [
      el('div', { classe: 'conteudo' }, [
        cabecalhoDeSecao({ titulo: dados.titulo }),
        el('div', { classe: 'grade-depoimentos' }, dados.itens.map((item) => el('figure', { classe: 'depoimento' }, [
          el('div', { classe: 'depoimento__estrelas', role: 'img', 'aria-label': `${item.estrelas} de 5 estrelas` },
            Array.from({ length: 5 }, (_, indice) => el('span', { classe: indice < item.estrelas ? 'cheia' : 'vazia' }, [icone('estrela', 16)]))),
          el('blockquote', { classe: 'depoimento__texto' }, paragrafos(item.texto)),
          el('figcaption', { classe: 'depoimento__autor' }, [
            el('span', { classe: 'depoimento__inicial', 'aria-hidden': 'true', texto: (item.nome || '?').trim().charAt(0).toUpperCase() }),
            el('span', {}, [el('strong', { texto: item.nome }), item.servico ? el('small', { texto: item.servico }) : null]),
          ]),
        ]))),
      ]),
    ]);
  };

  desenhar.galeria = (secao, contexto) => {
    const dados = secao.dados;
    const fotos = dados.imagens;
    const grade = el('div', { classe: `grade-galeria quantidade--${Math.min(fotos.length, 6)}` });
    fotos.forEach((foto, indice) => {
      grade.append(el('button', {
        classe: 'galeria__item', type: 'button', 'aria-label': `Ampliar foto ${indice + 1}${foto.legenda ? ': ' + foto.legenda : ''}`,
        aoClick: () => { if (contexto.modo !== 'previa' && foto.imagem) abrirLuz(fotos, indice); },
      }, [midia(foto.imagem, foto.legenda, '', contexto), foto.legenda ? el('span', { classe: 'galeria__legenda', texto: foto.legenda }) : null]));
    });
    return el('section', { classe: 'secao secao--galeria' }, [
      el('div', { classe: 'conteudo' }, [cabecalhoDeSecao({ titulo: dados.titulo, texto: dados.texto }), grade]),
    ]);
  };

  /** Caixa de luz (foto ampliada) da galeria, com setas e tecla Esc. */
  function abrirLuz(fotos, indiceInicial) {
    let indice = indiceInicial;
    const imagem = el('img', { classe: 'luz__imagem', alt: '' });
    const legenda = el('p', { classe: 'luz__legenda' });
    const caixa = el('dialog', { classe: 'luz', 'aria-label': 'Foto ampliada' });
    const mostrar = () => {
      const foto = fotos[indice];
      imagem.src = foto.imagem;
      imagem.alt = foto.legenda || `Foto ${indice + 1}`;
      legenda.textContent = `${foto.legenda || ''}  ${indice + 1}/${fotos.length}`.trim();
    };
    const mover = (passo) => {
      indice = (indice + passo + fotos.length) % fotos.length;
      mostrar();
    };
    caixa.append(
      el('button', { classe: 'luz__fechar', type: 'button', 'aria-label': 'Fechar', aoClick: () => caixa.close() }, [icone('fechar', 26)]),
      fotos.length > 1 ? el('button', { classe: 'luz__seta luz__seta--esq', type: 'button', 'aria-label': 'Foto anterior', aoClick: () => mover(-1) }, [icone('setaEsquerda', 26)]) : null,
      el('figure', { classe: 'luz__figura' }, [imagem, legenda]),
      fotos.length > 1 ? el('button', { classe: 'luz__seta luz__seta--dir', type: 'button', 'aria-label': 'Próxima foto', aoClick: () => mover(1) }, [icone('seta', 26)]) : null,
    );
    caixa.addEventListener('keydown', (evento) => {
      if (evento.key === 'ArrowLeft') mover(-1);
      if (evento.key === 'ArrowRight') mover(1);
    });
    caixa.addEventListener('click', (evento) => { if (evento.target === caixa) caixa.close(); });
    caixa.addEventListener('close', () => caixa.remove());
    document.body.append(caixa);
    mostrar();
    caixa.showModal();
  }

  desenhar.agendamento = (secao, contexto) => {
    const dados = secao.dados;
    const areaWidget = el('div', { classe: 'agendar__widget' });
    raiz.AgendamentoStylOS.montar(areaWidget, contexto);
    return el('section', { classe: 'secao secao--agendamento' }, [
      el('div', { classe: 'conteudo agendar' }, [
        el('div', { classe: 'agendar__intro' }, [
          el('h2', { classe: 'titulo-secao' }, textoComDestaque(dados.titulo)),
          el('span', { classe: 'divisor', 'aria-hidden': 'true' }),
          ...paragrafos(dados.texto, 'texto-apoio'),
          dados.aviso ? el('p', { classe: 'agendar__aviso' }, [icone('info', 18), el('span', { texto: dados.aviso })]) : null,
          el('ol', { classe: 'agendar__passos' }, [
            el('li', { texto: 'Escolha o serviço' }),
            el('li', { texto: 'Escolha o dia e o horário livre' }),
            el('li', { texto: 'Preencha seus dados e envie pelo WhatsApp' }),
          ]),
        ]),
        areaWidget,
      ]),
    ]);
  };

  desenhar.rodape = (secao, contexto) => {
    const dados = secao.dados;
    const informacoes = [
      dados.endereco ? ['local', 'Endereço', dados.endereco] : null,
      dados.horarioTexto ? ['relogio', 'Horário', dados.horarioTexto] : null,
      dados.telefoneTexto ? ['telefone', 'Telefone', dados.telefoneTexto] : null,
    ].filter(Boolean);
    const redes = [['instagram', 'Instagram'], ['facebook', 'Facebook'], ['tiktok', 'TikTok']].filter(([chave]) => dados[chave]);
    return el('section', { classe: 'secao secao--rodape' }, [
      el('footer', { classe: 'conteudo rodape' }, [
        el('div', { classe: 'rodape__topo' }, [
          el('p', { classe: 'rodape__marca', texto: dados.nomeMarca }),
          dados.frase ? el('p', { classe: 'rodape__frase', texto: dados.frase }) : null,
        ]),
        informacoes.length
          ? el('ul', { classe: 'rodape__infos' }, informacoes.map(([nomeIcone, rotulo, texto]) => el('li', {}, [
              el('span', { classe: 'rodape__icone' }, [icone(nomeIcone, 20)]),
              el('div', {}, [el('strong', { texto: rotulo }), ...paragrafos(texto)]),
            ])))
          : null,
        redes.length
          ? el('div', { classe: 'rodape__redes' }, redes.map(([chave, nome]) => linkExterno(dados[chave], nome, [icone(chave, 22)], 'rodape__rede', contexto)))
          : null,
        dados.mostrarMenu && contexto.linksMenu.length
          ? el('nav', { classe: 'rodape__menu', 'aria-label': 'Menu do rodapé' }, contexto.linksMenu.map((item) => linkParaSecao(item.id, item.rotulo, 'rodape__link')))
          : null,
        el('div', { classe: 'rodape__base' }, [
          el('span', { texto: `© ${new Date().getFullYear()} ${dados.nomeMarca}. Todos os direitos reservados.` }),
          el('span', { classe: 'rodape__credito', texto: 'Feito com StylOS Beauty' }),
        ]),
      ]),
    ]);
  };

  // ================================================================
  // DESENHO DA PÁGINA INTEIRA
  // ================================================================

  /** Carrega as fontes do tema (uma vez por tema). */
  function carregarFontes(tema) {
    const id = `fontes-${tema}`;
    if (document.getElementById(id) || !FONTES_POR_TEMA[tema]) return;
    document.head.append(el('link', { id, rel: 'stylesheet', href: `https://fonts.googleapis.com/css2?${FONTES_POR_TEMA[tema]}&display=swap` }));
  }

  /** Animação suave ao aparecer na tela (desligada na prévia e para quem prefere menos movimento). */
  function ativarRevelacao(alvo) {
    if (reduzirMovimento() || !('IntersectionObserver' in raiz)) return;
    const observador = new IntersectionObserver((entradas) => {
      for (const entrada of entradas) {
        if (entrada.isIntersecting) {
          entrada.target.classList.add('visivel');
          observador.unobserve(entrada.target);
        }
      }
    }, { threshold: 0.12 });
    alvo.querySelectorAll('.secao:not(.secao--cabecalho) > *').forEach((filho) => {
      filho.classList.add('revelar');
      observador.observe(filho);
    });
  }

  /** Barra de navegação ganha fundo quando a pessoa rola a página. */
  function ativarNavegacaoRolada(alvo) {
    const nav = alvo.querySelector('.nav');
    if (!nav) return;
    const atualizar = () => nav.classList.toggle('nav--rolada', raiz.scrollY > 40);
    raiz.removeEventListener('scroll', raiz.__stylosNavRolada || (() => {}));
    raiz.__stylosNavRolada = atualizar;
    raiz.addEventListener('scroll', atualizar, { passive: true });
    atualizar();
  }

  /**
   * Desenha a página inteira dentro de "alvo".
   * @param {HTMLElement} alvo
   * @param {object} conteudoBruto  { tema, secoes }
   * @param {object} opcoes { modo: 'publico'|'previa', slug, agenda, usuario, secaoSelecionada, aoSelecionarSecao }
   */
  function renderizarPagina(alvo, conteudoBruto, opcoes) {
    const conteudo = Esquemas.normalizarConteudo(conteudoBruto);
    const modo = opcoes.modo || 'publico';
    document.documentElement.dataset.tema = conteudo.tema;
    document.documentElement.classList.toggle('modo-previa', modo === 'previa');
    carregarFontes(conteudo.tema);

    const secaoAgendamento = conteudo.secoes.find((secao) => secao.tipo === 'agendamento');
    const indiceCabecalho = conteudo.secoes.findIndex((secao) => secao.tipo === 'cabecalho');
    const contexto = {
      modo,
      slug: opcoes.slug,
      agenda: opcoes.agenda || { ativa: false, servicos: [] },
      usuario: opcoes.usuario || null,
      idAgendamento: secaoAgendamento ? secaoAgendamento.id : null,
      // O botão do cabeçalho leva ao agendamento; se não houver, à próxima seção.
      idAlvoBotao: secaoAgendamento ? secaoAgendamento.id : (conteudo.secoes[indiceCabecalho + 1] || conteudo.secoes[0] || {}).id,
      linksMenu: conteudo.secoes
        .filter((secao) => secao.tipo !== 'cabecalho' && secao.tipo !== 'rodape' && secao.dados.mostrarNoMenu && secao.dados.rotuloMenu)
        .map((secao) => ({ id: secao.id, rotulo: secao.dados.rotuloMenu })),
    };

    const principal = el('main', { classe: 'pagina-stylos', id: 'conteudo-principal' });
    for (const secao of conteudo.secoes) {
      let elemento;
      try {
        elemento = desenhar[secao.tipo](secao, contexto);
      } catch (erro) {
        console.error('Falha ao desenhar seção', secao.tipo, erro);
        elemento = el('section', { classe: 'secao' }, [el('p', { texto: 'Não foi possível mostrar esta seção.' })]);
      }
      elemento.id = `secao-${secao.id}`;
      elemento.dataset.secaoId = secao.id;
      elemento.dataset.tipo = secao.tipo;
      elemento.classList.add(`fundo--${secao.dados.fundo || 'padrao'}`);
      if (modo === 'previa') {
        elemento.dataset.rotuloPrevia = Esquemas.TIPOS_SECAO[secao.tipo].nome;
        if (opcoes.secaoSelecionada === secao.id) elemento.classList.add('secao--selecionada');
        elemento.addEventListener('click', () => opcoes.aoSelecionarSecao && opcoes.aoSelecionarSecao(secao.id));
      }
      principal.append(elemento);
    }
    alvo.replaceChildren(
      modo === 'publico' ? el('a', { classe: 'pular-para-conteudo', href: '#conteudo-principal', texto: 'Pular para o conteúdo' }) : '',
      principal,
    );
    ativarNavegacaoRolada(alvo);
    if (modo === 'publico') ativarRevelacao(alvo);
    return contexto;
  }

  raiz.RenderizadorStylOS = { renderizarPagina, rolarAte, el, paragrafos, textoComDestaque, FONTES_POR_TEMA };
})(typeof self !== 'undefined' ? self : this);
