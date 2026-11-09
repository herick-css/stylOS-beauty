/**
 * horarios.js
 * ------------------------------------------------------------------
 * Calcula os horários livres de um ADM. É a mesma ideia do
 * lib/slots.ts do projeto da Fernanda, só que generalizada:
 *
 *   horários do EXPEDIENTE (configurado no painel)
 *   − OCUPADOS no Google Agenda
 *   − agendamentos já feitos pelo site (pendentes/confirmados)
 *   − horários que já passaram ou estão em cima da hora
 *   = horários LIVRES
 *
 * Funciona com qualquer fuso horário (padrão America/Manaus).
 */
'use strict';

const MINUTO = 60 * 1000;
const DIA = 24 * 60 * MINUTO;

/** Configuração padrão de uma agenda nova. */
function configuracaoPadraoAgenda() {
  return {
    // 0 = domingo ... 6 = sábado. Cada dia tem faixas [início, fim]. Vazio = folga.
    expediente: {
      0: [],
      1: [['08:00', '12:00'], ['14:00', '18:00']],
      2: [['08:00', '12:00'], ['14:00', '18:00']],
      3: [['08:00', '12:00'], ['14:00', '18:00']],
      4: [['08:00', '12:00'], ['14:00', '18:00']],
      5: [['08:00', '12:00'], ['14:00', '18:00']],
      6: [['08:00', '12:00']],
    },
    servicos: [
      { id: 'corte', nome: 'Corte', duracaoMin: 60, preco: '' },
      { id: 'escova', nome: 'Escova', duracaoMin: 45, preco: '' },
      { id: 'coloracao', nome: 'Coloração', duracaoMin: 120, preco: '' },
    ],
    passoMin: 30,          // de quanto em quanto tempo começa um horário (08:00, 08:30...)
    antecedenciaMin: 120,  // não deixa marcar em cima da hora (2 h)
    diasAFrente: 21,       // até quantos dias no futuro aparece
    diasBloqueados: [],    // folgas/feriados: ['2026-12-25']
    exigirContaCliente: false,
  };
}

/** "08:30" → 510 minutos */
function paraMinutos(textoHora) {
  const [horas, minutos] = String(textoHora).split(':').map(Number);
  return horas * 60 + minutos;
}

/** 510 → "08:30" */
function paraTextoHora(totalMinutos) {
  return `${String(Math.floor(totalMinutos / 60)).padStart(2, '0')}:${String(totalMinutos % 60).padStart(2, '0')}`;
}

/** Formata um instante como data local "AAAA-MM-DD" no fuso dado. */
function dataLocal(instanteMs, fuso) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instanteMs));
}

/** Diferença (em ms) entre o horário local do fuso e o UTC num instante. */
function deslocamentoDoFuso(instanteMs, fuso) {
  const partes = {};
  for (const parte of new Intl.DateTimeFormat('en-US', {
    timeZone: fuso, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instanteMs))) {
    partes[parte.type] = parte.value;
  }
  const comoUtc = Date.UTC(+partes.year, +partes.month - 1, +partes.day, +partes.hour, +partes.minute, +partes.second);
  return comoUtc - Math.floor(instanteMs / 1000) * 1000;
}

/**
 * Converte "data + hora de parede" num fuso para instante UTC (ms).
 * Ex.: ('2026-11-10', 510, 'America/Manaus') → instante das 08:30 em Manaus.
 * Faz duas passadas para acertar dias de mudança de horário de verão.
 */
function instanteLocal(dataTexto, minutosDoDia, fuso) {
  const [ano, mes, dia] = dataTexto.split('-').map(Number);
  const palpite = Date.UTC(ano, mes - 1, dia, Math.floor(minutosDoDia / 60), minutosDoDia % 60);
  let instante = palpite - deslocamentoDoFuso(palpite, fuso);
  instante = palpite - deslocamentoDoFuso(instante, fuso);
  return instante;
}

/** Soma n dias a uma data "AAAA-MM-DD" (sem depender de fuso). */
function somarDias(dataTexto, quantidade) {
  const [ano, mes, dia] = dataTexto.split('-').map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia + quantidade));
  return data.toISOString().slice(0, 10);
}

/** Dia da semana (0 = domingo) de uma data "AAAA-MM-DD". */
function diaDaSemana(dataTexto) {
  const [ano, mes, dia] = dataTexto.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
}

/** Intervalo total (início e fim em ms) que precisa ser consultado no Google. */
function janelaDeBusca(configAgenda, fuso, agora = Date.now()) {
  const hoje = dataLocal(agora, fuso);
  return {
    inicio: instanteLocal(hoje, 0, fuso),
    fim: instanteLocal(somarDias(hoje, configAgenda.diasAFrente + 1), 0, fuso),
  };
}

/**
 * Gera a lista de dias com seus horários.
 * @param {object} parametros
 *  - configAgenda: { expediente, passoMin, antecedenciaMin, diasAFrente, diasBloqueados }
 *  - fuso: 'America/Manaus'
 *  - duracaoMin: duração do serviço escolhido
 *  - ocupados: [{ inicio: ms, fim: ms }]
 *  - agora: ms (para testes)
 * @returns [{ data, diaSemana, folga, horarios: [{ inicio: ISO, hora, estado }] }]
 *   estado: 'livre' | 'ocupado' | 'indisponivel' (já passou / em cima da hora)
 */
function gerarDias({ configAgenda, fuso, duracaoMin, ocupados = [], agora = Date.now() }) {
  const hoje = dataLocal(agora, fuso);
  const limiteMinimo = agora + (configAgenda.antecedenciaMin || 0) * MINUTO;
  const passo = Math.max(5, configAgenda.passoMin || 30);
  const bloqueados = new Set(configAgenda.diasBloqueados || []);
  const dias = [];

  for (let indice = 0; indice <= configAgenda.diasAFrente; indice++) {
    const data = somarDias(hoje, indice);
    const semana = diaDaSemana(data);
    const faixas = bloqueados.has(data) ? [] : configAgenda.expediente[semana] || [];
    const horarios = [];

    for (const [inicioFaixa, fimFaixa] of faixas) {
      const fimFaixaMin = paraMinutos(fimFaixa);
      for (let minuto = paraMinutos(inicioFaixa); minuto + duracaoMin <= fimFaixaMin; minuto += passo) {
        const inicio = instanteLocal(data, minuto, fuso);
        const fim = inicio + duracaoMin * MINUTO;
        let estado = 'livre';
        if (inicio < limiteMinimo) estado = 'indisponivel';
        else if (ocupados.some((ocupado) => ocupado.inicio < fim && ocupado.fim > inicio)) estado = 'ocupado';
        horarios.push({ inicio: new Date(inicio).toISOString(), hora: paraTextoHora(minuto), estado });
      }
    }
    dias.push({ data, diaSemana: semana, folga: horarios.length === 0, horarios });
  }
  return dias;
}

/** Confere se um início (ISO) está entre os horários LIVRES para aquele serviço. */
function horarioEstaLivre(inicioIso, parametros) {
  const dias = gerarDias(parametros);
  return dias.some((dia) => dia.horarios.some((horario) => horario.inicio === inicioIso && horario.estado === 'livre'));
}

/** Valida e limpa a configuração enviada pelo painel. Lança Error com mensagem amigável. */
function validarConfiguracaoAgenda(entrada) {
  const padrao = configuracaoPadraoAgenda();
  const config = {};
  const formatoHora = /^([01]\d|2[0-3]):[0-5]\d$/;

  config.expediente = {};
  for (let dia = 0; dia <= 6; dia++) {
    const faixas = Array.isArray(entrada?.expediente?.[dia]) ? entrada.expediente[dia].slice(0, 4) : [];
    const limpas = [];
    for (const faixa of faixas) {
      if (!Array.isArray(faixa) || !formatoHora.test(faixa[0]) || !formatoHora.test(faixa[1])) {
        throw new Error('Horário de expediente inválido. Use o formato 08:00.');
      }
      if (paraMinutos(faixa[1]) <= paraMinutos(faixa[0])) throw new Error('No expediente, o fim precisa ser depois do início.');
      limpas.push([faixa[0], faixa[1]]);
    }
    limpas.sort((a, b) => paraMinutos(a[0]) - paraMinutos(b[0]));
    for (let i = 1; i < limpas.length; i++) {
      if (paraMinutos(limpas[i][0]) < paraMinutos(limpas[i - 1][1])) throw new Error('Há faixas de expediente sobrepostas no mesmo dia.');
    }
    config.expediente[dia] = limpas;
  }

  const servicos = Array.isArray(entrada?.servicos) ? entrada.servicos.slice(0, 20) : [];
  if (!servicos.length) throw new Error('Cadastre pelo menos um serviço para o agendamento.');
  const idsVistos = new Set();
  config.servicos = servicos.map((servico, indice) => {
    const nome = String(servico?.nome || '').trim().slice(0, 50);
    const duracao = Math.round(Number(servico?.duracaoMin));
    if (!nome) throw new Error(`O serviço ${indice + 1} está sem nome.`);
    if (!Number.isFinite(duracao) || duracao < 10 || duracao > 600) throw new Error(`Duração do serviço "${nome}" deve ficar entre 10 e 600 minutos.`);
    let id = String(servico?.id || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30);
    if (!id || idsVistos.has(id)) id = `s${indice}-${Math.random().toString(36).slice(2, 7)}`;
    idsVistos.add(id);
    return { id, nome, duracaoMin: duracao, preco: String(servico?.preco || '').trim().slice(0, 24) };
  });

  const numeroEntre = (valor, minimo, maximo, valorPadrao) => {
    const numero = Math.round(Number(valor));
    return Number.isFinite(numero) ? Math.min(maximo, Math.max(minimo, numero)) : valorPadrao;
  };
  config.passoMin = numeroEntre(entrada?.passoMin, 5, 240, padrao.passoMin);
  config.antecedenciaMin = numeroEntre(entrada?.antecedenciaMin, 0, 7 * 24 * 60, padrao.antecedenciaMin);
  config.diasAFrente = numeroEntre(entrada?.diasAFrente, 1, 90, padrao.diasAFrente);
  config.diasBloqueados = (Array.isArray(entrada?.diasBloqueados) ? entrada.diasBloqueados : [])
    .filter((data) => /^\d{4}-\d{2}-\d{2}$/.test(data))
    .slice(0, 100);
  config.exigirContaCliente = Boolean(entrada?.exigirContaCliente);
  return config;
}

/** Fuso válido? (ex.: America/Manaus) */
function fusoValido(fuso) {
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: fuso });
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  MINUTO,
  DIA,
  configuracaoPadraoAgenda,
  gerarDias,
  horarioEstaLivre,
  janelaDeBusca,
  instanteLocal,
  dataLocal,
  somarDias,
  paraMinutos,
  paraTextoHora,
  validarConfiguracaoAgenda,
  fusoValido,
};
