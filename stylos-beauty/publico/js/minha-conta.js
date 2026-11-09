/**
 * minha-conta.js — área da CLIENTE (papel "usuario"):
 * ver os próprios agendamentos, cancelar com antecedência e trocar dados/senha.
 */
(function () {
  'use strict';
  const { el, trocar, icone, marca, api, avisar, confirmar, alerta, campo, medidorSenha, formatarDataHora } = window.StylOS;
  const principal = document.getElementById('principal');
  let usuario = null;
  let loginGoogle = false;

  const NOMES_STATUS = { pendente: ['Aguardando confirmação', 'etiqueta--aviso'], confirmado: ['Confirmado', 'etiqueta--sucesso'], cancelado: ['Cancelado', 'etiqueta--perigo'], concluido: ['Concluído', ''] };

  async function desenhar() {
    // Com senha temporária o servidor bloqueia os dados até a troca
    const { agendamentos } = usuario.deveTrocarSenha ? { agendamentos: [] } : await api('/api/cliente/agendamentos');
    const futuros = agendamentos.filter((item) => new Date(item.inicio) > new Date() && ['pendente', 'confirmado'].includes(item.status)).reverse();
    const historico = agendamentos.filter((item) => !futuros.includes(item));
    const cartaoAgendamento = (item) => {
      const [rotulo, classe] = NOMES_STATUS[item.status];
      return el('article', { classe: `agendamento agendamento--${item.status}` }, [
        el('div', { classe: 'agendamento__quando' }, [
          el('span', { classe: 'agendamento__dia', texto: formatarDataHora(item.inicio, item.fuso, 'semana') }),
          el('span', { classe: 'agendamento__hora', texto: formatarDataHora(item.inicio, item.fuso, 'hora') }),
          el('span', { classe: 'agendamento__data', texto: formatarDataHora(item.inicio, item.fuso, 'dia') }),
        ]),
        el('div', { classe: 'agendamento__info' }, [
          el('strong', { texto: item.servico }), ' ', el('span', { classe: `etiqueta ${classe}`, texto: rotulo }),
          el('p', { texto: `${item.pagina} · ${item.duracaoMin} min · código ${item.codigo}` }),
        ]),
        el('div', { classe: 'agendamento__acoes' }, [
          item.slug ? el('a', { classe: 'botao botao--secundario botao--pequeno', href: `/p/${item.slug}`, texto: 'Ver salão' }) : null,
          item.podeCancelar ? el('button', {
            classe: 'botao botao--fantasma botao--pequeno', type: 'button', texto: 'Cancelar',
            aoClick: async () => {
              if (!(await confirmar('Cancelar este horário? Avise o salão pelo WhatsApp também, por educação.', { perigo: true, botao: 'Cancelar horário' }))) return;
              try {
                await api(`/api/cliente/agendamentos/${item.id}/cancelar`, { corpo: {} });
                avisar('Horário cancelado.');
                desenhar();
              } catch (erro) { avisar(erro.message, 'erro', 6000); }
            },
          }) : null,
        ]),
      ]);
    };

    const nome = campo({ id: 'nome', rotulo: 'Nome', valor: usuario.nome, maximo: 80 });
    const telefone = campo({ id: 'telefone', rotulo: 'WhatsApp', valor: usuario.telefone, tipo: 'tel' });
    const areaDados = el('div');
    const senhaAtual = campo({ id: 'senha-atual', rotulo: 'Senha atual', tipo: 'password', atributos: { autocomplete: 'current-password' } });
    if (!usuario.temSenha) senhaAtual.elemento.hidden = true; // conta criada pelo Google: ainda não tem senha
    const senhaNova = campo({ id: 'senha-nova', rotulo: 'Nova senha', tipo: 'password', dica: 'Mínimo 8 caracteres com letras e números.', atributos: { autocomplete: 'new-password' } });
    senhaNova.elemento.insertBefore(medidorSenha(senhaNova.entrada), senhaNova.elemento.lastChild);
    const areaSenha = el('div');

    trocar(principal, 
      el('div', { classe: 'cabecalho-tela' }, [el('div', {}, [el('h1', { texto: `Olá, ${usuario.nome.split(' ')[0]}!` }), el('p', { texto: 'Seus horários nos salões do StylOS.' })])]),
      usuario.deveTrocarSenha ? alerta('Você entrou com uma senha temporária. Crie uma nova senha abaixo.', 'aviso') : null,
      el('h2', { texto: 'Próximos horários' }),
      futuros.length ? el('div', { classe: 'lista-agendamentos' }, futuros.map(cartaoAgendamento)) : el('div', { classe: 'cartao vazio' }, [icone('agenda', 40), el('p', { texto: 'Nenhum horário marcado. Agende pela página do seu salão favorito!' })]),
      historico.length ? el('details', { classe: 'cartao' }, [el('summary', { texto: `Histórico (${historico.length})` }), el('p'), el('div', { classe: 'lista-agendamentos' }, historico.map(cartaoAgendamento))]) : null,
      el('p'),
      el('div', { classe: 'grade-2' }, [
        el('section', { classe: 'cartao' }, [el('h2', { texto: 'Meus dados' }), nome.elemento, telefone.elemento, areaDados, el('button', {
          classe: 'botao botao--primario', type: 'button', texto: 'Salvar',
          aoClick: async () => {
            areaDados.replaceChildren();
            try {
              await api('/api/conta', { metodo: 'PUT', corpo: { nome: nome.entrada.value, telefone: telefone.entrada.value } });
              usuario.nome = nome.entrada.value.trim();
              avisar('Dados salvos.');
            } catch (erro) { areaDados.append(alerta(erro.message)); }
          },
        })]),
        el('section', { classe: 'cartao' }, [el('h2', { texto: usuario.temSenha ? 'Trocar senha' : 'Criar uma senha (opcional)' }), senhaAtual.elemento, senhaNova.elemento, areaSenha, el('button', {
          classe: 'botao botao--primario', type: 'button', texto: 'Trocar senha',
          aoClick: async () => {
            areaSenha.replaceChildren();
            try {
              await api('/api/trocar-senha', { corpo: { senhaAtual: senhaAtual.entrada.value, novaSenha: senhaNova.entrada.value } });
              const eraTemporaria = usuario.deveTrocarSenha || !usuario.temSenha;
              usuario.temSenha = true;
              usuario.deveTrocarSenha = false;
              senhaAtual.entrada.value = '';
              senhaNova.entrada.value = '';
              avisar('Senha alterada.');
              if (eraTemporaria) desenhar();
            } catch (erro) { areaSenha.append(alerta(erro.message)); }
          },
        })]),
      ]),
      loginGoogle || usuario.googleVinculado ? el('p') : null,
      loginGoogle || usuario.googleVinculado ? el('section', { classe: 'cartao' }, [
        el('h2', { texto: 'Entrar com Google' }),
        usuario.googleVinculado
          ? el('p', { texto: 'Sua conta Google está vinculada: você entra com um clique.' })
          : el('p', { classe: 'texto-suave', texto: 'Vincule para entrar com um clique, sem senha.' }),
        usuario.googleVinculado
          ? (usuario.temSenha ? el('button', {
              classe: 'botao botao--secundario botao--pequeno', type: 'button', texto: 'Desvincular',
              aoClick: async () => {
                try {
                  await api('/api/conta/google/desvincular', { corpo: {} });
                  usuario.googleVinculado = false;
                  avisar('Google desvinculado.');
                  desenhar();
                } catch (erro) { avisar(erro.message, 'erro', 6000); }
              },
            }) : null)
          : el('a', { classe: 'botao botao--secundario', href: `/auth/google?modo=vincular&voltar=${encodeURIComponent('/minha-conta')}` }, [icone('google', 18), 'Vincular conta Google']),
      ]) : null,
      el('p', { classe: 'texto-suave texto-pequeno', texto: 'Quer apagar sua conta e seus dados? Peça ao salão (LGPD).' }),
    );
  }

  async function iniciar() {
    const sessao = await api('/api/sessao');
    usuario = sessao.usuario;
    loginGoogle = Boolean(sessao.loginGoogle);
    const retornoGoogle = new URLSearchParams(location.search).get('google');
    if (retornoGoogle) {
      if (retornoGoogle === 'vinculado') { avisar('Conta Google vinculada!'); usuario.googleVinculado = true; }
      if (retornoGoogle === 'em-uso') avisar('Essa conta Google já está ligada a outro usuário.', 'erro', 7000);
      history.replaceState(null, '', location.pathname);
    }
    if (usuario.papel !== 'usuario') {
      // ADM/dono também podem abrir esta tela, mas o lugar deles é o painel
      location.href = '/painel';
      return;
    }
    document.getElementById('topo-cliente').append(marca(), el('button', {
      classe: 'botao botao--fantasma botao--pequeno', type: 'button',
      aoClick: async () => { await api('/api/sair', { corpo: {} }).catch(() => {}); location.href = '/'; },
    }, [icone('sair', 18), 'Sair']));
    await desenhar();
  }
  iniciar().catch((erro) => trocar(principal, alerta(erro.message)));
})();
