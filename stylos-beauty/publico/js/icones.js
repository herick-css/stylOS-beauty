/**
 * icones.js — ícones em SVG desenhados em código (sem baixar nada de fora).
 * Uso: IconesStylOS.criar('agenda', 20)  → elemento <svg>
 * Todos usam traço (stroke) com a cor atual do texto (currentColor).
 */
(function (raiz) {
  'use strict';

  // Cada ícone é uma lista de "d" de <path> num quadro 24x24.
  const CAMINHOS = {
    menu: ['M4 7h16', 'M4 12h16', 'M4 17h16'],
    fechar: ['M6 6l12 12', 'M18 6L6 18'],
    seta: ['M5 12h14', 'M13 6l6 6-6 6'],
    setaEsquerda: ['M19 12H5', 'M11 6l-6 6 6 6'],
    setaCima: ['M12 19V5', 'M6 11l6-6 6 6'],
    setaBaixo: ['M12 5v14', 'M6 13l6 6 6-6'],
    mais: ['M12 5v14', 'M5 12h14'],
    lixeira: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13', 'M10 11v6', 'M14 11v6'],
    copiar: ['M9 9h11v11H9z', 'M5 15H4V4h11v1'],
    olho: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', 'M12 15a3 3 0 100-6 3 3 0 000 6z'],
    editar: ['M4 20h4L19 9l-4-4L4 16v4z', 'M14 6l4 4'],
    check: ['M5 12.5l4.5 4.5L19 7.5'],
    alerta: ['M12 3l10 18H2L12 3z', 'M12 10v5', 'M12 18v.01'],
    info: ['M12 22a10 10 0 100-20 10 10 0 000 20z', 'M12 11v6', 'M12 7.5v.01'],
    pagina: ['M6 3h9l4 4v14H6z', 'M14 3v5h5', 'M9 13h7', 'M9 17h5'],
    agenda: ['M4 6h16v14H4z', 'M4 10h16', 'M8 3v5', 'M16 3v5', 'M8 14h3', 'M13 14h3', 'M8 17h3'],
    lista: ['M9 6h11', 'M9 12h11', 'M9 18h11', 'M4.5 6h.01', 'M4.5 12h.01', 'M4.5 18h.01'],
    pessoas: ['M9 11a4 4 0 100-8 4 4 0 000 8z', 'M2 21v-1a6 6 0 0112 0v1', 'M16 3.5a4 4 0 010 7', 'M22 21v-1a6 6 0 00-4-5.6'],
    pessoa: ['M12 12a4.5 4.5 0 100-9 4.5 4.5 0 000 9z', 'M4 21v-1a7 7 0 0114 0v1'],
    escudo: ['M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z', 'M8.5 12l2.5 2.5 4.5-5'],
    engrenagem: ['M12 15a3 3 0 100-6 3 3 0 000 6z', 'M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 110-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z'],
    sair: ['M15 4h4v16h-4', 'M10 8l-4 4 4 4', 'M6 12h11'],
    casa: ['M3 11l9-7 9 7', 'M5 10v10h14V10', 'M10 20v-6h4v6'],
    whatsapp: ['M3.5 20.5l1.3-4.2A8.5 8.5 0 1120.5 12 8.5 8.5 0 018 19.4l-4.5 1.1z', 'M9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.6-2-1-1 .9c-1.2-.5-2.3-1.6-2.8-2.8l.9-1-1-2L9 8.5z'],
    instagram: ['M7 3h10a4 4 0 014 4v10a4 4 0 01-4 4H7a4 4 0 01-4-4V7a4 4 0 014-4z', 'M12 16a4 4 0 100-8 4 4 0 000 8z', 'M17.5 6.5v.01'],
    facebook: ['M14 8h3V4h-3a4 4 0 00-4 4v2H7v4h3v7h4v-7h3l1-4h-4V8z'],
    tiktok: ['M14 3v11.5a3.5 3.5 0 11-3.5-3.5', 'M14 3c.5 2.8 2.3 4.5 5 4.8'],
    estrela: ['M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z'],
    play: ['M8 5v14l11-7L8 5z'],
    local: ['M12 21s-7-6.2-7-11.5a7 7 0 0114 0C19 14.8 12 21 12 21z', 'M12 12a2.5 2.5 0 100-5 2.5 2.5 0 000 5z'],
    relogio: ['M12 21a9 9 0 100-18 9 9 0 000 18z', 'M12 7v5l3 2'],
    telefone: ['M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z'],
    imagem: ['M4 5h16v14H4z', 'M4 16l5-5 4 4 3-3 4 4', 'M15.5 9.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z'],
    enviar: ['M12 16V4', 'M7 9l5-5 5 5', 'M4 16v4h16v-4'],
    link: ['M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1', 'M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1'],
    computador: ['M3 4h18v12H3z', 'M8 20h8', 'M12 16v4'],
    tablet: ['M6 3h12v18H6z', 'M11 18h2'],
    celular: ['M8 3h8v18H8z', 'M11 18h2'],
    arrastar: ['M9 6h.01', 'M15 6h.01', 'M9 12h.01', 'M15 12h.01', 'M9 18h.01', 'M15 18h.01'],
    cadeado: ['M6 11h12v10H6z', 'M8 11V7a4 4 0 018 0v4'],
    pincel: ['M14 4l6 6-8.5 8.5a3 3 0 01-2 .9H6v-3.5a3 3 0 01.9-2L14 4z', 'M4 21h4'],
    ajuda: ['M12 22a10 10 0 100-20 10 10 0 000 20z', 'M9.5 9a2.5 2.5 0 015 .5c0 1.7-2.5 2-2.5 3.5', 'M12 17v.01'],
    foguete: ['M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2', 'M9 15l-3-3c1-4 4.5-8 12-9-1 7.5-5 11-9 12z', 'M15 9.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z'],
    calendarioCheck: ['M4 6h16v14H4z', 'M4 10h16', 'M8 3v5', 'M16 3v5', 'M9 15l2 2 4-4'],
    google: ['M20.5 12.2c0-.6-.1-1.2-.2-1.7H12v3.3h4.8a4.1 4.1 0 01-1.8 2.7v2.2h2.9c1.7-1.6 2.6-3.9 2.6-6.5z', 'M12 21c2.4 0 4.5-.8 6-2.2l-2.9-2.2c-.8.5-1.8.9-3.1.9a5.4 5.4 0 01-5-3.7H4v2.3A9 9 0 0012 21z', 'M7 13.8a5.4 5.4 0 010-3.5V8H4a9 9 0 000 8.1l3-2.3z', 'M12 6.6c1.3 0 2.5.5 3.4 1.3l2.6-2.6A9 9 0 004 8l3 2.3a5.4 5.4 0 015-3.7z'],
    // Ícones dos modelos de seção
    cabecalho: ['M3 4h18v16H3z', 'M3 8h18', 'M6 6h3', 'M7 12h7', 'M7 15h4'],
    sobre: ['M3 4h18v16H3z', 'M7 9h10', 'M8 13h2', 'M14 13h2', 'M8 16h2', 'M14 16h2'],
    destaque: ['M3 4h12v16H3z', 'M11 8h10v8H11z'],
    servicos: ['M3 5h5v6H3z', 'M10 5h5v6h-5z', 'M17 5h4v6h-4z', 'M3 14h5', 'M10 14h5', 'M17 14h4', 'M3 17h4', 'M10 17h4'],
    video: ['M3 5h18v14H3z', 'M10 9v6l5-3-5-3z'],
    depoimentos: ['M4 5h16v11H9l-5 4V5z', 'M8 9h8', 'M8 12h5'],
    galeria: ['M3 3h8v8H3z', 'M13 3h8v8h-8z', 'M3 13h8v8H3z', 'M13 13h8v8h-8z'],
    agendamento: ['M4 6h16v14H4z', 'M4 10h16', 'M8 3v5', 'M16 3v5', 'M9 15l2 2 4-4'],
    rodape: ['M3 4h18v16H3z', 'M3 16h18', 'M6 18h4', 'M14 18h4'],
  };

  // Ícones que ficam melhores preenchidos
  const PREENCHIDOS = new Set(['estrela', 'play']);

  function criar(nome, tamanho, classeExtra) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(tamanho || 20));
    svg.setAttribute('height', String(tamanho || 20));
    svg.setAttribute('fill', PREENCHIDOS.has(nome) ? 'currentColor' : 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', PREENCHIDOS.has(nome) ? '0' : '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('class', 'icone' + (classeExtra ? ' ' + classeExtra : ''));
    for (const d of CAMINHOS[nome] || CAMINHOS.info) {
      const caminho = document.createElementNS(ns, 'path');
      caminho.setAttribute('d', d);
      svg.appendChild(caminho);
    }
    return svg;
  }

  raiz.IconesStylOS = { criar, existe: (nome) => Boolean(CAMINHOS[nome]) };
})(typeof self !== 'undefined' ? self : this);
