/**
 * anti-robo-worker.js — roda em segundo plano (Web Worker) para a tela não travar.
 * Procura um número tal que SHA-256(salt + número) comece com N bits zero.
 *
 * SHA-256 escrito à mão e otimizado para o nosso caso: a mensagem sempre
 * cabe em UM bloco de 64 bytes, e só precisamos da 1ª palavra (32 bits) do
 * resultado para contar os zeros iniciais. O servidor confere com o SHA-256 completo.
 */
'use strict';

const K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const W = new Int32Array(64);
const bloco = new Uint8Array(64);

/** 1ª palavra (32 bits) do SHA-256 de bloco[0..tamanho). Exige tamanho <= 55. */
function primeiraPalavraSha256(tamanho) {
  bloco[tamanho] = 0x80;
  for (let i = tamanho + 1; i < 62; i++) bloco[i] = 0;
  const bits = tamanho * 8;
  bloco[62] = (bits >>> 8) & 0xff;
  bloco[63] = bits & 0xff;
  for (let i = 0; i < 16; i++) W[i] = (bloco[4 * i] << 24) | (bloco[4 * i + 1] << 16) | (bloco[4 * i + 2] << 8) | bloco[4 * i + 3];
  for (let i = 16; i < 64; i++) {
    const x = W[i - 15];
    const y = W[i - 2];
    const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
    const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
    W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
  }
  let a = 0x6a09e667 | 0, b = 0xbb67ae85 | 0, c = 0x3c6ef372 | 0, d = 0xa54ff53a | 0;
  let e = 0x510e527f | 0, f = 0x9b05688c | 0, g = 0x1f83d9ab | 0, h = 0x5be0cd19 | 0;
  for (let i = 0; i < 64; i++) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
    h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
  }
  return (0x6a09e667 + a) >>> 0;
}

/** Procura o número. Devolve -1 se o salt for grande demais (não acontece com o nosso servidor). */
function resolver(salt, dificuldade) {
  const tamanhoSalt = salt.length;
  if (tamanhoSalt > 44) return -1;
  for (let i = 0; i < tamanhoSalt; i++) bloco[i] = salt.charCodeAt(i) & 0xff;
  for (let numero = 0; numero < 4294967295; numero++) {
    const digitos = String(numero);
    for (let i = 0; i < digitos.length; i++) bloco[tamanhoSalt + i] = digitos.charCodeAt(i);
    if (Math.clz32(primeiraPalavraSha256(tamanhoSalt + digitos.length)) >= dificuldade) return numero;
  }
  return -1;
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof module === 'undefined') {
  self.onmessage = (evento) => {
    const { salt, dificuldade } = evento.data || {};
    self.postMessage({ numero: resolver(String(salt), Number(dificuldade)) });
  };
}
if (typeof module !== 'undefined') module.exports = { resolver, primeiraPalavraSha256 };
