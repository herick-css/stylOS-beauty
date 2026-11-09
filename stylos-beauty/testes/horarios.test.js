/**
 * Testes do cálculo de horários (sem servidor).
 * Rode com: npm run testar
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../servidor/servicos/horarios');

const configBase = {
  expediente: { 0: [], 1: [['08:00', '12:00'], ['14:00', '18:00']], 2: [['08:00', '12:00']], 3: [], 4: [], 5: [], 6: [] },
  passoMin: 30, antecedenciaMin: 120, diasAFrente: 7, diasBloqueados: [],
};

test('converte hora de Manaus para UTC corretamente (UTC-4)', () => {
  const instante = h.instanteLocal('2026-11-16', 8 * 60, 'America/Manaus');
  assert.equal(new Date(instante).toISOString(), '2026-11-16T12:00:00.000Z');
});

test('respeita horário de verão em fuso que tem (Nova York)', () => {
  // 9 de março de 2026: NY já em horário de verão (UTC-4); 1º de março: UTC-5
  assert.equal(new Date(h.instanteLocal('2026-03-09', 9 * 60, 'America/New_York')).toISOString(), '2026-03-09T13:00:00.000Z');
  assert.equal(new Date(h.instanteLocal('2026-03-01', 9 * 60, 'America/New_York')).toISOString(), '2026-03-01T14:00:00.000Z');
});

test('gera horários só dentro do expediente e com a duração cabendo', () => {
  const agora = Date.parse('2026-11-15T12:00:00Z'); // domingo
  const dias = h.gerarDias({ configAgenda: configBase, fuso: 'America/Manaus', duracaoMin: 60, ocupados: [], agora });
  const segunda = dias.find((dia) => dia.data === '2026-11-16');
  assert.deepEqual(segunda.horarios.map((x) => x.hora), ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00']);
  assert.equal(dias.find((dia) => dia.data === '2026-11-15').folga, true);
  const terca = dias.find((dia) => dia.data === '2026-11-17');
  assert.equal(terca.horarios.at(-1).hora, '11:00');
});

test('marca ocupado quando há conflito com o Google/agendamentos', () => {
  const agora = Date.parse('2026-11-15T12:00:00Z');
  const ocupados = [{ inicio: Date.parse('2026-11-16T13:00:00Z'), fim: Date.parse('2026-11-16T14:00:00Z') }]; // 09:00-10:00 Manaus
  const dias = h.gerarDias({ configAgenda: configBase, fuso: 'America/Manaus', duracaoMin: 60, ocupados, agora });
  const estados = Object.fromEntries(dias.find((dia) => dia.data === '2026-11-16').horarios.map((x) => [x.hora, x.estado]));
  assert.equal(estados['08:00'], 'livre');
  assert.equal(estados['08:30'], 'ocupado'); // 08:30-09:30 bate em 09:00
  assert.equal(estados['09:00'], 'ocupado');
  assert.equal(estados['09:30'], 'ocupado');
  assert.equal(estados['10:00'], 'livre');
});

test('antecedência mínima deixa horários próximos indisponíveis', () => {
  const agora = Date.parse('2026-11-16T12:10:00Z'); // 08:10 em Manaus, segunda
  const dias = h.gerarDias({ configAgenda: configBase, fuso: 'America/Manaus', duracaoMin: 30, ocupados: [], agora });
  const estados = Object.fromEntries(dias[0].horarios.map((x) => [x.hora, x.estado]));
  assert.equal(estados['10:00'], 'indisponivel');
  assert.equal(estados['10:30'], 'livre');
});

test('dia bloqueado vira folga', () => {
  const agora = Date.parse('2026-11-15T12:00:00Z');
  const dias = h.gerarDias({ configAgenda: { ...configBase, diasBloqueados: ['2026-11-16'] }, fuso: 'America/Manaus', duracaoMin: 60, agora });
  assert.equal(dias.find((dia) => dia.data === '2026-11-16').folga, true);
});

test('valida configuração: rejeita faixa invertida e sobreposta', () => {
  assert.throws(() => h.validarConfiguracaoAgenda({ expediente: { 1: [['12:00', '08:00']] }, servicos: [{ nome: 'A', duracaoMin: 30 }] }), /fim precisa ser depois/);
  assert.throws(() => h.validarConfiguracaoAgenda({ expediente: { 1: [['08:00', '12:00'], ['11:00', '13:00']] }, servicos: [{ nome: 'A', duracaoMin: 30 }] }), /sobrepostas/);
  assert.throws(() => h.validarConfiguracaoAgenda({ expediente: {}, servicos: [] }), /pelo menos um serviço/);
  const ok = h.validarConfiguracaoAgenda({ expediente: { 1: [['08:00', '12:00']] }, servicos: [{ nome: 'Corte', duracaoMin: '45' }], passoMin: 9999 });
  assert.equal(ok.passoMin, 240);
  assert.equal(ok.servicos[0].duracaoMin, 45);
});
