/**
 * esquemas-secoes.js  —  ARQUIVO COMPARTILHADO (navegador + servidor)
 * ------------------------------------------------------------------
 * Aqui ficam, num lugar só:
 *   - os TEMAS visuais disponíveis;
 *   - os MODELOS DE SEÇÃO (cabeçalho, serviços, galeria, agendamento...)
 *     com seus campos, limites e textos padrão;
 *   - as REGRAS DE BOAS PRÁTICAS usadas para liberar a publicação
 *     (começar com cabeçalho, terminar com rodapé, campos obrigatórios...);
 *   - a página de EXEMPLO mostrada no primeiro acesso do ADM.
 *
 * O editor usa este arquivo para montar os formulários e o servidor usa
 * o MESMO arquivo para validar — assim as regras nunca ficam diferentes.
 *
 * Para criar um tipo de seção novo: adicione em TIPOS_SECAO e crie a
 * função de desenho correspondente em renderizador.js.
 */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.EsquemasStylOS = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ================================================================
  // TEMAS
  // ================================================================
  const TEMAS = {
    'noir-barbearia': {
      nome: 'Noir Barbearia',
      publico: 'masculino',
      descricao: 'Preto profundo, letras grossas e vermelho-tijolo. Moderno e marcante.',
      cores: ['#0f0f0f', '#f4f1ec', '#d9482f'],
    },
    'figaro-classico': {
      nome: 'Fígaro Clássico',
      publico: 'masculino',
      descricao: 'Tons escuros e quentes, serifa elegante e cartões translúcidos.',
      cores: ['#15110f', '#ece4d8', '#b4483c'],
    },
    'lavanda-suave': {
      nome: 'Lavanda Suave',
      publico: 'feminino',
      descricao: 'Lilás claro, roxo e dourado, títulos finos em itálico. Calmo e delicado.',
      cores: ['#f6f2fb', '#5b3f8c', '#a8875a'],
    },
    'rose-noir': {
      nome: 'Rosé Noir',
      publico: 'feminino',
      descricao: 'Grafite com rosé-gold e letras espaçadas. Sofisticado.',
      cores: ['#1b181b', '#efe6e3', '#d99a80'],
    },
    'areia-neutro': {
      nome: 'Areia Neutro',
      publico: 'neutro',
      descricao: 'Branco, cinza-quente e bege. Limpo, organizado e fácil de combinar.',
      cores: ['#ffffff', '#5f5d58', '#cfc5b6'],
    },
  };
  const TEMA_PADRAO = 'areia-neutro';

  // ================================================================
  // CAMPOS COMUNS das seções do "meio" da página
  // ================================================================
  const CAMPOS_MENU_E_FUNDO = [
    { chave: 'mostrarNoMenu', rotulo: 'Mostrar link desta seção no menu do cabeçalho', tipo: 'booleano', grupo: 'menu' },
    { chave: 'rotuloMenu', rotulo: 'Nome no menu', tipo: 'texto', max: 20, grupo: 'menu', dica: 'Curto: "Serviços", "Galeria"...' },
    {
      chave: 'fundo', rotulo: 'Cor de fundo da seção', tipo: 'escolha', grupo: 'aparencia',
      opcoes: [['padrao', 'Padrão do tema'], ['alternativo', 'Alternativa'], ['destaque', 'Destaque (cor forte)']],
    },
  ];

  // ================================================================
  // MODELOS DE SEÇÃO
  // ================================================================
  const TIPOS_SECAO = {
    cabecalho: {
      nome: 'Cabeçalho',
      icone: 'cabecalho',
      descricao: 'Primeira tela: nome do salão, título, foto e o menu que rola até as outras seções.',
      unica: true,
      posicao: 'primeira',
      fixa: true, // não pode ser removida nem mudar de lugar
      campos: [
        { chave: 'nomeMarca', rotulo: 'Nome do salão (aparece como logo)', tipo: 'texto', max: 40, obrigatorio: true },
        { chave: 'titulo', rotulo: 'Título principal', tipo: 'texto', max: 90, obrigatorio: true },
        { chave: 'subtitulo', rotulo: 'Subtítulo', tipo: 'textoLongo', max: 220 },
        { chave: 'paragrafo', rotulo: 'Parágrafo', tipo: 'textoLongo', max: 400 },
        { chave: 'imagem', rotulo: 'Foto ou vídeo principal', tipo: 'midia', recomendado: true, dica: 'Vídeo de fundo: envie o vídeo e escolha "Foto/vídeo ocupando o fundo" em Arrumação.' },
        { chave: 'textoBotao', rotulo: 'Texto do botão (leva ao agendamento)', tipo: 'texto', max: 32 },
        {
          chave: 'layout', rotulo: 'Arrumação', tipo: 'escolha',
          opcoes: [['dividido', 'Texto e foto/vídeo lado a lado'], ['fundo', 'Foto/vídeo ocupando o fundo'], ['centralizado', 'Tudo centralizado (sem foto)']],
        },
      ],
      padrao: {
        nomeMarca: 'Meu Salão',
        titulo: 'Realce a sua beleza com quem entende',
        subtitulo: 'Cortes, cor e cuidados feitos com atenção a cada detalhe.',
        paragrafo: '',
        imagem: '',
        textoBotao: 'Agendar horário',
        layout: 'dividido',
      },
    },

    sobre: {
      nome: 'Sobre e números',
      icone: 'sobre',
      descricao: 'Quem vocês são, com números de destaque (anos, clientes, serviços).',
      campos: [
        { chave: 'sobretitulo', rotulo: 'Texto pequeno acima do título', tipo: 'texto', max: 40 },
        { chave: 'titulo', rotulo: 'Título', tipo: 'texto', max: 90, obrigatorio: true },
        { chave: 'paragrafo', rotulo: 'Texto', tipo: 'textoLongo', max: 600 },
        { chave: 'imagem', rotulo: 'Foto ou vídeo (opcional)', tipo: 'midia' },
        {
          chave: 'numeros', rotulo: 'Números de destaque', tipo: 'lista', max: 4, rotuloItem: 'Número',
          campos: [
            { chave: 'valor', rotulo: 'Valor', tipo: 'texto', max: 10, obrigatorio: true, dica: 'Ex.: 10+' },
            { chave: 'rotulo', rotulo: 'Legenda', tipo: 'texto', max: 30, obrigatorio: true, dica: 'Ex.: anos de experiência' },
          ],
        },
        ...CAMPOS_MENU_E_FUNDO,
      ],
      padrao: {
        sobretitulo: 'Sobre nós',
        titulo: 'Transforme o seu visual',
        paragrafo: 'Conte aqui a história do salão, o que vocês valorizam e por que as clientes voltam.',
        imagem: '',
        numeros: [{ valor: '10+', rotulo: 'Anos' }, { valor: '20+', rotulo: 'Serviços' }, { valor: '500+', rotulo: 'Clientes' }],
        mostrarNoMenu: true,
        rotuloMenu: 'Sobre',
        fundo: 'alternativo',
      },
    },

    destaque: {
      nome: 'Destaque com foto',
      icone: 'destaque',
      descricao: 'Uma foto ou vídeo grande com um cartão de texto por cima. Ótimo para promover um serviço.',
      campos: [
        { chave: 'titulo', rotulo: 'Título', tipo: 'texto', max: 80, obrigatorio: true },
        { chave: 'texto', rotulo: 'Texto', tipo: 'textoLongo', max: 400 },
        { chave: 'imagem', rotulo: 'Foto ou vídeo', tipo: 'midia', obrigatorio: true },
        { chave: 'textoBotao', rotulo: 'Texto do botão (opcional, leva ao agendamento)', tipo: 'texto', max: 32 },
        { chave: 'lado', rotulo: 'Lado do cartão', tipo: 'escolha', opcoes: [['direita', 'Direita'], ['esquerda', 'Esquerda']] },
        ...CAMPOS_MENU_E_FUNDO,
      ],
      padrao: {
        titulo: 'Tratamentos que renovam',
        texto: 'Hidratação, nutrição e reconstrução para fios fortes e brilhantes.',
        imagem: '',
        textoBotao: 'Quero agendar',
        lado: 'direita',
        mostrarNoMenu: false,
        rotuloMenu: 'Destaque',
        fundo: 'padrao',
      },
    },

    servicos: {
      nome: 'Serviços',
      icone: 'servicos',
      descricao: 'Cartões com foto, nome, descrição e preço de cada serviço.',
      campos: [
        { chave: 'titulo', rotulo: 'Título', tipo: 'texto', max: 80, obrigatorio: true },
        { chave: 'subtitulo', rotulo: 'Texto de apoio', tipo: 'textoLongo', max: 250 },
        {
          chave: 'itens', rotulo: 'Serviços', tipo: 'lista', min: 1, max: 6, rotuloItem: 'Serviço',
          campos: [
            { chave: 'imagem', rotulo: 'Foto ou vídeo', tipo: 'midia' },
            { chave: 'nome', rotulo: 'Nome do serviço', tipo: 'texto', max: 50, obrigatorio: true },
            { chave: 'descricao', rotulo: 'Descrição', tipo: 'textoLongo', max: 220 },
            { chave: 'preco', rotulo: 'Preço (opcional)', tipo: 'texto', max: 24, dica: 'Ex.: a partir de R$ 40' },
          ],
        },
        ...CAMPOS_MENU_E_FUNDO,
      ],
      padrao: {
        titulo: 'Nossos serviços',
        subtitulo: 'Escolha o cuidado ideal para você.',
        itens: [
          { imagem: '', nome: 'Corte', descricao: 'Corte pensado para o seu rosto e rotina.', preco: '' },
          { imagem: '', nome: 'Coloração', descricao: 'Cor sob medida, do retoque à transformação.', preco: '' },
          { imagem: '', nome: 'Tratamentos', descricao: 'Hidratação e reconstrução para fios saudáveis.', preco: '' },
        ],
        mostrarNoMenu: true,
        rotuloMenu: 'Serviços',
        fundo: 'padrao',
      },
    },

    video: {
      nome: 'Vídeo',
      icone: 'video',
      descricao: 'Um vídeo seu (enviado e otimizado aqui) ou do YouTube/Vimeo — bastidores, antes e depois...',
      campos: [
        { chave: 'titulo', rotulo: 'Título', tipo: 'texto', max: 80, obrigatorio: true },
        { chave: 'texto', rotulo: 'Texto', tipo: 'textoLongo', max: 300 },
        { chave: 'arquivo', rotulo: 'Envie um vídeo seu', tipo: 'midia', aceita: 'video', dica: 'Fica no próprio site, com som e controles. Ou use um link abaixo.' },
        { chave: 'video', rotulo: 'Ou cole um link do YouTube/Vimeo', tipo: 'video', dica: 'Use um OU outro. Se os dois estiverem preenchidos, vale o vídeo enviado.' },
        ...CAMPOS_MENU_E_FUNDO,
      ],
      padrao: {
        titulo: 'Por dentro do salão',
        texto: 'Veja como cuidamos de cada cliente.',
        arquivo: '',
        video: '',
        mostrarNoMenu: false,
        rotuloMenu: 'Vídeo',
        fundo: 'destaque',
      },
    },

    depoimentos: {
      nome: 'Depoimentos',
      icone: 'depoimentos',
      descricao: 'O que as clientes dizem, com estrelas.',
      campos: [
        { chave: 'titulo', rotulo: 'Título', tipo: 'texto', max: 80, obrigatorio: true },
        {
          chave: 'itens', rotulo: 'Depoimentos', tipo: 'lista', min: 1, max: 6, rotuloItem: 'Depoimento',
          campos: [
            { chave: 'nome', rotulo: 'Nome da cliente', tipo: 'texto', max: 40, obrigatorio: true },
            { chave: 'texto', rotulo: 'Depoimento', tipo: 'textoLongo', max: 300, obrigatorio: true },
            { chave: 'servico', rotulo: 'Serviço feito (opcional)', tipo: 'texto', max: 40 },
            { chave: 'estrelas', rotulo: 'Estrelas', tipo: 'numero', minimo: 1, maximo: 5 },
          ],
        },
        ...CAMPOS_MENU_E_FUNDO,
      ],
      padrao: {
        titulo: 'Quem vem, recomenda',
        itens: [
          { nome: 'Cliente', texto: 'Escreva aqui um depoimento real (peça autorização à cliente).', servico: '', estrelas: 5 },
        ],
        mostrarNoMenu: true,
        rotuloMenu: 'Depoimentos',
        fundo: 'alternativo',
      },
    },

    galeria: {
      nome: 'Galeria',
      icone: 'galeria',
      descricao: 'Fotos e vídeos dos trabalhos em grade (ampliam ao tocar).',
      campos: [
        { chave: 'titulo', rotulo: 'Título', tipo: 'texto', max: 80, obrigatorio: true },
        { chave: 'texto', rotulo: 'Texto', tipo: 'textoLongo', max: 200 },
        {
          chave: 'imagens', rotulo: 'Fotos e vídeos', tipo: 'lista', min: 1, max: 12, rotuloItem: 'Item',
          campos: [
            { chave: 'imagem', rotulo: 'Foto ou vídeo', tipo: 'midia', obrigatorio: true },
            { chave: 'legenda', rotulo: 'Legenda (também ajuda quem usa leitor de tela)', tipo: 'texto', max: 80 },
          ],
        },
        ...CAMPOS_MENU_E_FUNDO,
      ],
      padrao: {
        titulo: 'Nossos trabalhos',
        texto: '',
        imagens: [{ imagem: '', legenda: '' }],
        mostrarNoMenu: true,
        rotuloMenu: 'Galeria',
        fundo: 'padrao',
      },
    },

    agendamento: {
      nome: 'Agendamento',
      icone: 'agendamento',
      descricao: 'A cliente escolhe serviço, dia e horário livre; o pedido chega no seu WhatsApp.',
      unica: true,
      campos: [
        { chave: 'titulo', rotulo: 'Título', tipo: 'texto', max: 80, obrigatorio: true },
        { chave: 'texto', rotulo: 'Texto', tipo: 'textoLongo', max: 300 },
        { chave: 'aviso', rotulo: 'Aviso pequeno (ex.: forma de pagamento)', tipo: 'texto', max: 120 },
        ...CAMPOS_MENU_E_FUNDO,
      ],
      padrao: {
        titulo: 'Agende seu horário',
        texto: 'Escolha o serviço, o dia e o horário livre. A confirmação chega pelo WhatsApp.',
        aviso: 'O pagamento é feito no salão, no dia do atendimento.',
        mostrarNoMenu: true,
        rotuloMenu: 'Agendar',
        fundo: 'alternativo',
      },
    },

    rodape: {
      nome: 'Rodapé',
      icone: 'rodape',
      descricao: 'Última tela: endereço, horário, redes sociais e créditos.',
      unica: true,
      posicao: 'ultima',
      fixa: true,
      campos: [
        { chave: 'nomeMarca', rotulo: 'Nome do salão', tipo: 'texto', max: 40, obrigatorio: true },
        { chave: 'frase', rotulo: 'Frase de despedida', tipo: 'texto', max: 120 },
        { chave: 'endereco', rotulo: 'Endereço', tipo: 'textoLongo', max: 160 },
        { chave: 'horarioTexto', rotulo: 'Horário de funcionamento', tipo: 'textoLongo', max: 160 },
        { chave: 'telefoneTexto', rotulo: 'Telefone para mostrar', tipo: 'texto', max: 30 },
        { chave: 'instagram', rotulo: 'Link do Instagram', tipo: 'url' },
        { chave: 'facebook', rotulo: 'Link do Facebook', tipo: 'url' },
        { chave: 'tiktok', rotulo: 'Link do TikTok', tipo: 'url' },
        { chave: 'mostrarMenu', rotulo: 'Repetir os links do menu no rodapé', tipo: 'booleano' },
      ],
      padrao: {
        nomeMarca: 'Meu Salão',
        frase: 'Esperamos por você!',
        endereco: '',
        horarioTexto: '',
        telefoneTexto: '',
        instagram: '',
        facebook: '',
        tiktok: '',
        mostrarMenu: true,
      },
    },
  };

  /** Ordem em que os modelos aparecem na galeria "Adicionar seção". */
  const ORDEM_GALERIA = ['sobre', 'servicos', 'destaque', 'galeria', 'depoimentos', 'video', 'agendamento'];
  const MAXIMO_SECOES = 20;

  // Formatos aceitos para imagens: fotos enviadas (/arquivos/...) ou ilustrações de exemplo.
  const PADRAO_IMAGEM = /^\/(arquivos\/[a-f0-9]{32}\.(webp|jpg|png)|img\/exemplo\/[a-z0-9-]{1,40}\.svg)$/;
  // Vídeo enviado e otimizado pelo sistema: /arquivos/videos/<id> (a página escolhe 1080p ou 720p)
  const PADRAO_VIDEO = /^\/arquivos\/videos\/([a-f0-9]{32})$/;

  /** Se o valor for um vídeo enviado, devolve os endereços das versões; senão null. */
  function enderecosDoVideo(valor) {
    const resultado = PADRAO_VIDEO.exec(String(valor || ''));
    if (!resultado) return null;
    const base = `/arquivos/videos/${resultado[1]}`;
    return { id: resultado[1], computador: `${base}/1080.mp4`, celular: `${base}/720.mp4`, capa: `${base}/poster.jpg` };
  }

  // ================================================================
  // FUNÇÕES AUXILIARES
  // ================================================================

  function copiaProfunda(valor) {
    return JSON.parse(JSON.stringify(valor));
  }

  /** Identificador curto para cada seção (usado na âncora #secao-xxxx do menu). */
  function novoIdSecao() {
    let id = '';
    const letras = 'abcdefghijkmnpqrstuvwxyz23456789';
    for (let i = 0; i < 8; i++) id += letras[Math.floor(Math.random() * letras.length)];
    return id;
  }

  /**
   * Entende links do YouTube/Vimeo e devolve { provedor, id } ou null.
   * Aceita: youtube.com/watch?v=, youtu.be/, youtube.com/shorts/, youtube.com/embed/, vimeo.com/123
   */
  function extrairVideo(url) {
    const texto = String(url || '').trim();
    let resultado = texto.match(/^https?:\/\/(?:www\.|m\.)?youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)([A-Za-z0-9_-]{11})/);
    if (resultado) return { provedor: 'youtube', id: resultado[1] };
    resultado = texto.match(/^https?:\/\/youtu\.be\/([A-Za-z0-9_-]{11})/);
    if (resultado) return { provedor: 'youtube', id: resultado[1] };
    resultado = texto.match(/^https?:\/\/(?:www\.|player\.)?vimeo\.com\/(?:video\/)?(\d{5,12})/);
    if (resultado) return { provedor: 'vimeo', id: resultado[1] };
    return null;
  }

  /** Remove caracteres invisíveis de controle (mantém quebra de linha se pedido). */
  function limparTexto(valor, maximo, manterQuebras) {
    let texto = typeof valor === 'string' ? valor : valor == null ? '' : String(valor);
    texto = manterQuebras
      ? texto.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')
      : texto.replace(/[\u0000-\u001F\u007F]/g, ' ');
    return texto.slice(0, maximo || 200);
  }

  /** Normaliza o valor de UM campo conforme o tipo. Valores inválidos viram vazio. */
  function normalizarCampo(campo, valor, padrao) {
    switch (campo.tipo) {
      case 'texto':
        return limparTexto(valor ?? padrao ?? '', campo.max, false);
      case 'textoLongo':
        return limparTexto(valor ?? padrao ?? '', campo.max, true);
      case 'imagem':
        return typeof valor === 'string' && PADRAO_IMAGEM.test(valor) ? valor : '';
      case 'midia': // foto OU vídeo (campo.aceita: 'video' = só vídeo)
        if (typeof valor !== 'string') return '';
        if (PADRAO_VIDEO.test(valor)) return valor;
        return campo.aceita !== 'video' && PADRAO_IMAGEM.test(valor) ? valor : '';
      case 'url': {
        const texto = typeof valor === 'string' ? valor.trim().slice(0, 300) : '';
        if (!texto) return '';
        try {
          const endereco = new URL(texto);
          return endereco.protocol === 'https:' || endereco.protocol === 'http:' ? endereco.href : '';
        } catch (erro) {
          return '';
        }
      }
      case 'video': {
        const video = extrairVideo(valor);
        if (!video) return '';
        return video.provedor === 'youtube' ? 'https://www.youtube.com/watch?v=' + video.id : 'https://vimeo.com/' + video.id;
      }
      case 'booleano':
        return valor === undefined ? Boolean(padrao) : Boolean(valor);
      case 'numero': {
        let numero = Math.round(Number(valor));
        if (!Number.isFinite(numero)) numero = Number(padrao) || campo.maximo || 0;
        return Math.min(campo.maximo ?? numero, Math.max(campo.minimo ?? numero, numero));
      }
      case 'escolha': {
        const valoresAceitos = campo.opcoes.map((opcao) => opcao[0]);
        if (valoresAceitos.includes(valor)) return valor;
        return valoresAceitos.includes(padrao) ? padrao : valoresAceitos[0];
      }
      case 'lista': {
        const itens = Array.isArray(valor) ? valor.slice(0, campo.max || 20) : copiaProfunda(padrao || []);
        return itens.map((item) => {
          const objeto = item && typeof item === 'object' ? item : {};
          const limpo = {};
          for (const subcampo of campo.campos) limpo[subcampo.chave] = normalizarCampo(subcampo, objeto[subcampo.chave], undefined);
          return limpo;
        });
      }
      default:
        return '';
    }
  }

  /**
   * Limpa um conteúdo de página vindo do editor (ou de qualquer lugar):
   * remove campos desconhecidos, corta textos longos, invalida links perigosos.
   * Sempre devolve uma estrutura segura: { versao, tema, secoes: [...] }.
   */
  function normalizarConteudo(entrada) {
    const conteudo = entrada && typeof entrada === 'object' ? entrada : {};
    const tema = Object.prototype.hasOwnProperty.call(TEMAS, conteudo.tema) ? conteudo.tema : TEMA_PADRAO;
    const secoesEntrada = Array.isArray(conteudo.secoes) ? conteudo.secoes.slice(0, MAXIMO_SECOES) : [];
    const idsUsados = new Set();
    const secoes = [];
    for (const secao of secoesEntrada) {
      if (!secao || typeof secao !== 'object' || !Object.prototype.hasOwnProperty.call(TIPOS_SECAO, secao.tipo)) continue;
      const modelo = TIPOS_SECAO[secao.tipo];
      let id = typeof secao.id === 'string' && /^[a-z0-9]{4,16}$/.test(secao.id) ? secao.id : novoIdSecao();
      while (idsUsados.has(id)) id = novoIdSecao();
      idsUsados.add(id);
      const dadosEntrada = secao.dados && typeof secao.dados === 'object' ? secao.dados : {};
      const dados = {};
      for (const campo of modelo.campos) {
        const valorPadrao = modelo.padrao[campo.chave];
        dados[campo.chave] = normalizarCampo(campo, dadosEntrada[campo.chave], campo.tipo === 'lista' ? [] : valorPadrao);
      }
      secoes.push({ id, tipo: secao.tipo, dados });
    }
    return { versao: 1, tema, secoes };
  }

  function campoVazio(campo, valor) {
    if (campo.tipo === 'lista') return !Array.isArray(valor) || valor.length === 0;
    if (campo.tipo === 'booleano' || campo.tipo === 'numero' || campo.tipo === 'escolha') return false;
    return !String(valor || '').trim();
  }

  /**
   * Regras de boas práticas para PUBLICAR.
   * Devolve { erros: [...], avisos: [...] }. Só publica se erros estiver vazio.
   * Cada item: { secaoId, campo, mensagem }.
   */
  function verificarParaPublicar(conteudoBruto) {
    const conteudo = normalizarConteudo(conteudoBruto);
    const erros = [];
    const avisos = [];
    const secoes = conteudo.secoes;
    const contar = (tipo) => secoes.filter((secao) => secao.tipo === tipo).length;

    if (!secoes.length || secoes[0].tipo !== 'cabecalho') {
      erros.push({ secaoId: null, campo: null, mensagem: 'A página precisa COMEÇAR com um Cabeçalho.' });
    }
    if (!secoes.length || secoes[secoes.length - 1].tipo !== 'rodape') {
      erros.push({ secaoId: null, campo: null, mensagem: 'A página precisa TERMINAR com um Rodapé.' });
    }
    for (const [tipo, modelo] of Object.entries(TIPOS_SECAO)) {
      if (modelo.unica && contar(tipo) > 1) {
        erros.push({ secaoId: null, campo: null, mensagem: `Só pode existir uma seção "${modelo.nome}".` });
      }
    }
    if (secoes.length < 3) {
      erros.push({ secaoId: null, campo: null, mensagem: 'Adicione pelo menos uma seção entre o Cabeçalho e o Rodapé.' });
    }

    for (const secao of secoes) {
      const modelo = TIPOS_SECAO[secao.tipo];
      for (const campo of modelo.campos) {
        const valor = secao.dados[campo.chave];
        if (campo.obrigatorio && campoVazio(campo, valor)) {
          erros.push({ secaoId: secao.id, campo: campo.chave, mensagem: `${modelo.nome}: preencha "${campo.rotulo}".` });
        }
        if (campo.recomendado && campoVazio(campo, valor)) {
          avisos.push({ secaoId: secao.id, campo: campo.chave, mensagem: `${modelo.nome}: uma foto ou vídeo deixa a página bem mais bonita.` });
        }
        if (campo.tipo === 'lista') {
          if (campo.min && valor.length < campo.min) {
            erros.push({ secaoId: secao.id, campo: campo.chave, mensagem: `${modelo.nome}: adicione pelo menos ${campo.min} item(ns) em "${campo.rotulo}".` });
          }
          valor.forEach((item, indice) => {
            for (const subcampo of campo.campos) {
              if (subcampo.obrigatorio && campoVazio(subcampo, item[subcampo.chave])) {
                erros.push({
                  secaoId: secao.id, campo: campo.chave,
                  mensagem: `${modelo.nome}: no ${campo.rotuloItem || 'item'} ${indice + 1}, preencha "${subcampo.rotulo}".`,
                });
              }
            }
          });
        }
      }
      if (secao.tipo === 'video' && !secao.dados.arquivo && !secao.dados.video) {
        erros.push({ secaoId: secao.id, campo: 'arquivo', mensagem: 'Vídeo: envie um vídeo ou cole um link do YouTube/Vimeo.' });
      }
      if (secao.dados.mostrarNoMenu && !String(secao.dados.rotuloMenu || '').trim()) {
        erros.push({ secaoId: secao.id, campo: 'rotuloMenu', mensagem: `${modelo.nome}: dê um nome para o link do menu.` });
      }
    }

    if (contar('agendamento') === 0) {
      avisos.push({ secaoId: null, campo: null, mensagem: 'A página não tem seção de Agendamento: as clientes não vão conseguir marcar horário.' });
    }
    if (!secoes.some((secao) => secao.dados.mostrarNoMenu)) {
      avisos.push({ secaoId: null, campo: null, mensagem: 'Nenhuma seção aparece no menu do cabeçalho.' });
    }
    return { erros, avisos, conteudo };
  }

  /** Cria uma seção nova de um tipo, já com os textos padrão. */
  function criarSecao(tipo) {
    const modelo = TIPOS_SECAO[tipo];
    if (!modelo) throw new Error('Tipo de seção desconhecido: ' + tipo);
    return { id: novoIdSecao(), tipo, dados: copiaProfunda(modelo.padrao) };
  }

  /** Página nova "em branco": já nasce com Cabeçalho + Rodapé (boas práticas). */
  function conteudoInicial(nomeSalao, tema) {
    const cabecalho = criarSecao('cabecalho');
    const rodape = criarSecao('rodape');
    if (nomeSalao) {
      cabecalho.dados.nomeMarca = limparTexto(nomeSalao, 40);
      rodape.dados.nomeMarca = limparTexto(nomeSalao, 40);
    }
    return { versao: 1, tema: TEMAS[tema] ? tema : TEMA_PADRAO, secoes: [cabecalho, criarSecao('servicos'), criarSecao('agendamento'), rodape] };
  }

  /**
   * Página de EXEMPLO completa (mostrada no primeiro acesso do ADM).
   * Usa ilustrações de /img/exemplo — troque pelas fotos reais do salão.
   */
  function paginaExemplo(nomeSalao, tema) {
    const nome = limparTexto(nomeSalao || 'Studio Exemplo', 40);
    const masculino = TEMAS[tema] && TEMAS[tema].publico === 'masculino';
    const secao = (tipo, dados) => {
      const nova = criarSecao(tipo);
      Object.assign(nova.dados, dados);
      return nova;
    };
    return normalizarConteudo({
      versao: 1,
      tema: TEMAS[tema] ? tema : 'lavanda-suave',
      secoes: [
        secao('cabecalho', {
          nomeMarca: nome,
          titulo: masculino ? 'Corte, barba e estilo no detalhe' : 'Eleve a sua experiência de beleza',
          subtitulo: masculino
            ? 'Barbearia moderna com atendimento sem pressa e acabamento impecável.'
            : 'Transforme o seu visual com cuidado profissional e atendimento personalizado.',
          paragrafo: 'Esta é uma página de EXEMPLO. Clique em cada seção à esquerda para ver como editar.',
          imagem: masculino ? '/img/exemplo/barba.svg' : '/img/exemplo/capa.svg',
          textoBotao: 'Agendar horário',
          layout: 'dividido',
        }),
        secao('sobre', {
          sobretitulo: 'Sobre nós',
          titulo: 'Cuidado que se vê',
          paragrafo: 'Somos alunas e alunos do Senac colocando em prática técnicas profissionais, com higiene, segurança e muito carinho em cada atendimento.',
          numeros: [{ valor: '10+', rotulo: 'Anos' }, { valor: '20+', rotulo: 'Serviços' }, { valor: '100+', rotulo: 'Clientes' }],
        }),
        secao('destaque', {
          titulo: masculino ? 'Barba de respeito' : 'Tratamentos luxuosos',
          texto: masculino
            ? 'Toalha quente, navalha e finalização com óleo. Um ritual completo para a sua barba.'
            : 'Mime seus fios com tratamentos que nutrem, reparam e revitalizam.',
          imagem: '/img/exemplo/salao.svg',
          textoBotao: 'Quero agendar',
        }),
        secao('servicos', {
          titulo: 'Nossos serviços',
          subtitulo: 'Cada serviço abaixo também aparece na hora de agendar (configure em "Agenda e WhatsApp").',
          itens: masculino
            ? [
                { imagem: '/img/exemplo/corte.svg', nome: 'Corte masculino', descricao: 'Máquina e tesoura, do clássico ao degradê.', preco: 'R$ 35' },
                { imagem: '/img/exemplo/barba.svg', nome: 'Barba completa', descricao: 'Desenho, toalha quente e navalha.', preco: 'R$ 30' },
                { imagem: '/img/exemplo/tratamento.svg', nome: 'Hidratação', descricao: 'Cabelo e barba macios e alinhados.', preco: 'R$ 25' },
              ]
            : [
                { imagem: '/img/exemplo/tratamento.svg', nome: 'Tratamentos', descricao: 'Hidratação, nutrição e reconstrução.', preco: 'a partir de R$ 50' },
                { imagem: '/img/exemplo/coloracao.svg', nome: 'Coloração', descricao: 'Cor personalizada, com criatividade e técnica.', preco: 'a partir de R$ 90' },
                { imagem: '/img/exemplo/penteado.svg', nome: 'Penteados', descricao: 'Para casamentos, formaturas e eventos.', preco: 'a partir de R$ 70' },
              ],
        }),
        secao('galeria', {
          titulo: 'Nossos trabalhos',
          texto: 'Troque estas ilustrações pelas fotos reais (peça autorização das clientes).',
          imagens: masculino ? [
            { imagem: '/img/exemplo/corte.svg', legenda: 'Corte' },
            { imagem: '/img/exemplo/barba.svg', legenda: 'Barba' },
            { imagem: '/img/exemplo/coloracao.svg', legenda: 'Textura' },
            { imagem: '/img/exemplo/tratamento.svg', legenda: 'Produtos' },
            { imagem: '/img/exemplo/salao.svg', legenda: 'Nosso espaço' },
            { imagem: '/img/exemplo/corte.svg', legenda: 'Acabamento' },
          ] : [
            { imagem: '/img/exemplo/corte.svg', legenda: 'Corte' },
            { imagem: '/img/exemplo/coloracao.svg', legenda: 'Coloração' },
            { imagem: '/img/exemplo/penteado.svg', legenda: 'Penteado' },
            { imagem: '/img/exemplo/unhas.svg', legenda: 'Unhas' },
            { imagem: '/img/exemplo/tratamento.svg', legenda: 'Tratamento' },
            { imagem: '/img/exemplo/salao.svg', legenda: 'Nosso espaço' },
          ],
        }),
        secao('depoimentos', {
          titulo: 'Quem vem, recomenda',
          itens: [
            { nome: 'Ana Paula', texto: 'Atendimento atencioso do começo ao fim. Saí me sentindo outra pessoa!', servico: 'Coloração', estrelas: 5 },
            { nome: 'Marcos', texto: 'Ambiente limpo, pontual e o corte ficou exatamente como pedi.', servico: 'Corte', estrelas: 5 },
            { nome: 'Juliana', texto: 'Amei a hidratação. Meu cabelo nunca esteve tão macio.', servico: 'Tratamento', estrelas: 4 },
          ],
        }),
        secao('agendamento', {}),
        secao('rodape', {
          nomeMarca: nome,
          frase: 'Esperamos por você!',
          endereco: 'Rua Exemplo, 123 — Centro, Manacapuru - AM',
          horarioTexto: 'Segunda a sexta, 8h às 18h · Sábado, 8h às 12h',
          telefoneTexto: '(92) 99999-9999',
          instagram: 'https://instagram.com/',
        }),
      ],
    });
  }

  return {
    TEMAS,
    TEMA_PADRAO,
    TIPOS_SECAO,
    ORDEM_GALERIA,
    MAXIMO_SECOES,
    PADRAO_IMAGEM,
    PADRAO_VIDEO,
    enderecosDoVideo,
    novoIdSecao,
    extrairVideo,
    normalizarConteudo,
    verificarParaPublicar,
    criarSecao,
    conteudoInicial,
    paginaExemplo,
    copiaProfunda,
  };
});
