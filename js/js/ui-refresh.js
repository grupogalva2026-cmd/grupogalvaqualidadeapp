(function () {
  'use strict';

  var GROUP_KEY = 'gv_nav_groups';
  var THEME_KEY = 'gv_theme';
  var CLOSED_STATUS = ['finalizado', 'fechado', 'resolvido', 'concluido', 'cancelado', 'encerrado'];
  var ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';
  var ICON_ALERT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>';
  var ICON_CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
  var ICON_BOX = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></svg>';

  function byId(id) {
    return document.getElementById(id);
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function norm(value) {
    var text = String(value == null ? '' : value);
    if (text.normalize) text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return text.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function pad2(number) {
    return number < 10 ? '0' + number : String(number);
  }

  function truncate(text, limit) {
    var value = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    return value.length > limit ? value.slice(0, limit - 1).trim() + '…' : value;
  }

  function parseDate(value) {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    if (typeof value === 'number') {
      var numericValue = value < 100000000000 ? value * 1000 : value;
      var numericDate = new Date(numericValue);
      return isNaN(numericDate.getTime()) ? null : numericDate;
    }
    var text = String(value).trim();
    if (!text) return null;
    if (/^\d{10,13}$/.test(text)) {
      var timestamp = parseInt(text, 10);
      if (text.length === 10) timestamp *= 1000;
      var timestampDate = new Date(timestamp);
      return isNaN(timestampDate.getTime()) ? null : timestampDate;
    }
    var match = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (match) {
      var brazilian = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]), Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0));
      return isNaN(brazilian.getTime()) ? null : brazilian;
    }
    match = text.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:[T,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (match) {
      var iso = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0));
      return isNaN(iso.getTime()) ? null : iso;
    }
    var fallback = new Date(text);
    return isNaN(fallback.getTime()) ? null : fallback;
  }

  function startOfWeek(date) {
    var start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    var weekday = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - weekday);
    start.setHours(0, 0, 0, 0);
    return start;
  }

  function getWeeks() {
    var current = startOfWeek(new Date());
    var weeks = [];
    for (var index = 7; index >= 0; index--) {
      var start = new Date(current.getTime());
      start.setDate(start.getDate() - index * 7);
      var end = new Date(start.getTime());
      end.setDate(end.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      weeks.push({ start: start, end: end, current: index === 0 });
    }
    return weeks;
  }

  function shortDate(date) {
    return date ? pad2(date.getDate()) + '/' + pad2(date.getMonth() + 1) : '';
  }

  function timeLabel(date) {
    if (!date) return 'Sem data';
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    var diff = Math.round((today.getTime() - day.getTime()) / 86400000);
    var clock = pad2(date.getHours()) + ':' + pad2(date.getMinutes());
    if (diff === 0) return 'Hoje, ' + clock;
    if (diff === 1) return 'Ontem, ' + clock;
    return shortDate(date) + ', ' + clock;
  }

  function relativeTime(date) {
    if (!date) return '';
    var diff = Date.now() - date.getTime();
    if (diff < 0) diff = 0;
    var minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'agora';
    if (minutes < 60) return 'há ' + minutes + ' min';
    var hours = Math.floor(minutes / 60);
    if (hours < 24) return 'há ' + hours + ' h';
    var days = Math.floor(hours / 24);
    if (days < 7) return 'há ' + days + ' d';
    return date.toLocaleDateString('pt-BR');
  }

  function timePhrase(prefix, date) {
    var relative = relativeTime(date);
    if (!relative) return '';
    if (relative === 'agora') return prefix + ' agora';
    if (relative.indexOf('há ') === 0) return prefix + ' ' + relative;
    return prefix + ' em ' + relative;
  }

  function readDB() {
    if (typeof window.getDB === 'function') {
      try { return window.getDB() || {}; } catch (error) {}
    }
    try { return JSON.parse(localStorage.getItem('galvabras_db') || '{}') || {}; } catch (error) { return {}; }
  }

  function readTickets(db) {
    if (typeof window.visibleTickets === 'function') {
      try {
        var visible = window.visibleTickets(db);
        if (Array.isArray(visible)) return visible.filter(Boolean);
      } catch (error) {}
    }
    return ((db && db.tickets) || []).filter(Boolean);
  }

  function ticketClosed(ticket) {
    if (typeof window.tktIsClosed === 'function') {
      try { return !!window.tktIsClosed(ticket); } catch (error) {}
    }
    return CLOSED_STATUS.indexOf(norm(ticket && ticket.status)) !== -1;
  }

  function openTicketsCount(db) {
    if (typeof window.openTicketCount === 'function') {
      try { return Number(window.openTicketCount(db)) || 0; } catch (error) {}
    }
    return readTickets(db).filter(function (ticket) { return !ticketClosed(ticket); }).length;
  }

  function ticketStatus(ticket) {
    var raw = '';
    if (typeof window.tktStatus === 'function') {
      try { raw = window.tktStatus(ticket); } catch (error) {}
    }
    if (!raw) raw = (ticket && ticket.status) || 'Aberto';
    var key = norm(raw);
    if (ticketClosed(ticket)) return { label: 'Finalizado', tone: 'green' };
    if (key.indexOf('atend') !== -1) return { label: 'Atendido', tone: 'green' };
    if (key.indexOf('analise') !== -1) return { label: 'Em análise', tone: 'blue' };
    if (key.indexOf('aberto') !== -1) return { label: 'Aberto', tone: 'red' };
    return { label: raw, tone: 'gray' };
  }

  function ticketPriority(ticket) {
    var raw = ticket && ticket.prioridade;
    var key = norm(raw);
    if (!key) return null;
    if (key.indexOf('urgent') !== -1) return { label: 'Urgente', tone: 'red' };
    if (key.indexOf('alta') !== -1) return { label: 'Alta', tone: 'red' };
    if (key.indexOf('media') !== -1) return { label: 'Média', tone: 'blue' };
    if (key.indexOf('baixa') !== -1) return { label: 'Baixa', tone: 'gray' };
    return { label: String(raw), tone: 'gray' };
  }

  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  function tag(label, tone) {
    return '<span class="tag ' + tone + '">' + esc(label) + '</span>';
  }

  function inventoryDate(item) {
    return parseDate(item && (item.date || item.data || item.createdAt || item.criadoEm || item.dataEntrada));
  }

  function inventoryStatus(item) {
    return norm(item && item.status);
  }

  function rateInfo(db) {
    var list = ((db && db.tickets) || []).map(function (ticket) {
      var value = Number(ticket && ticket.rating);
      if (!value || !isFinite(value)) return null;
      value = Math.max(1, Math.min(10, value));
      return {
        value: value,
        date: parseDate(ticket.ratingTime || ticket.finalizadoEm || ticket.criadoEm)
      };
    }).filter(Boolean);
    var total = list.reduce(function (sum, item) { return sum + item.value; }, 0);
    return { list: list, count: list.length, average: list.length ? total / list.length : 0 };
  }

  function ticketSortDate(ticket) {
    var dates = [
      parseDate(ticket && ticket.finalizadoEm),
      parseDate(ticket && ticket.atendidoEm),
      parseDate(ticket && ticket.criadoEm)
    ].filter(Boolean);
    return dates.length ? Math.max.apply(null, dates.map(function (date) { return date.getTime(); })) : 0;
  }

  function setText(id, value) {
    var node = byId(id);
    if (node) node.textContent = String(value);
  }

  function setDelta(id, text, tone) {
    var node = byId(id);
    if (!node) return;
    node.textContent = text;
    node.className = 'kpi-delta ' + (tone || 'neutral');
  }

  function setTone(id, tone) {
    var node = byId(id);
    if (node) node.setAttribute('data-tone', tone);
  }

  function sparkline(node, values) {
    if (!node) return;
    var points = [];
    for (var index = 0; index < values.length; index++) {
      var value = values[index];
      if (typeof value === 'number' && isFinite(value)) points.push({ index: index, value: value });
    }
    if (!points.length) {
      node.innerHTML = '';
      return;
    }
    var numbers = points.map(function (point) { return point.value; });
    var max = Math.max.apply(null, numbers);
    var min = Math.min.apply(null, numbers);
    var span = max - min;
    var width = 100;
    var height = 30;
    var step = values.length > 1 ? (width - 4) / (values.length - 1) : 0;
    var coords = points.map(function (point) {
      var x = 2 + point.index * step;
      var y = span ? 26 - ((point.value - min) / span) * 22 : 15;
      return { x: x, y: y };
    });
    var line = 'M' + coords[0].x.toFixed(1) + ' ' + coords[0].y.toFixed(1);
    for (var pointIndex = 1; pointIndex < coords.length; pointIndex++) {
      line += ' L' + coords[pointIndex].x.toFixed(1) + ' ' + coords[pointIndex].y.toFixed(1);
    }
    if (coords.length === 1) line += ' L' + (coords[0].x + 1).toFixed(1) + ' ' + coords[0].y.toFixed(1);
    var area = line + ' L' + coords[coords.length - 1].x.toFixed(1) + ' ' + (height - 1) + ' L' + coords[0].x.toFixed(1) + ' ' + (height - 1) + ' Z';
    node.innerHTML = '<path class="spark-area" d="' + area + '"></path><path class="spark-line" d="' + line + '"></path>';
  }

  function renderKPIs(db) {
    var inventory = (db && db.inventory) || [];
    var tickets = readTickets(db);
    var total = inventory.length;
    var active = inventory.filter(function (item) { return inventoryStatus(item) === 'em uso'; }).length;
    var maintenance = inventory.filter(function (item) { return inventoryStatus(item).indexOf('manut') !== -1; }).length;
    var open = openTicketsCount(db);
    var urgent = tickets.filter(function (ticket) {
      return !ticketClosed(ticket) && norm(ticket && ticket.prioridade).indexOf('urgent') !== -1;
    }).length;
    var rated = rateInfo(db);
    var cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    var newItems = inventory.filter(function (item) {
      var date = inventoryDate(item);
      return date && date.getTime() >= cutoff;
    }).length;
    var activePercent = total ? Math.round(active * 100 / total) : 0;
    var maintenancePercent = total ? Math.round(maintenance * 100 / total) : 0;

    setText('kpiTotal', total);
    setText('kpiAtivos', active);
    setText('kpiManut', maintenance);
    setText('kpiChamados', open);

    setDelta('kpiTotalDelta', newItems ? '+' + newItems + ' em 30 dias' : 'Base atual', 'neutral');
    setDelta('kpiAtivosDelta', total ? activePercent + '% do parque' : 'Sem equipamentos', total ? 'good' : 'neutral');
    setDelta('kpiManutDelta', maintenance ? maintenancePercent + '% do parque' : 'Nenhum parado', maintenance ? 'bad' : 'good');
    if (!open) {
      setDelta('kpiChamadosDelta', 'Sem pendências', 'good');
    } else if (urgent) {
      setDelta('kpiChamadosDelta', urgent + (urgent === 1 ? ' urgente' : ' urgentes'), 'bad');
    } else {
      setDelta('kpiChamadosDelta', open + (open === 1 ? ' aguardando' : ' aguardando atendimento'), 'bad');
    }

    setTone('kpiCardTotal', 'blue');
    setTone('kpiCardAtivos', 'green');
    setTone('kpiCardManut', maintenance ? 'red' : 'green');
    setTone('kpiCardChamados', open ? 'red' : 'green');

    var satisfaction = byId('kpiSatisfacao');
    if (satisfaction) {
      if (rated.count) {
        satisfaction.innerHTML = rated.average.toFixed(1).replace('.', ',') + '<small>/10</small>';
        setDelta('kpiSatisfacaoDelta', rated.count + (rated.count === 1 ? ' avaliação' : ' avaliações'), 'neutral');
      } else {
        satisfaction.textContent = '—';
        setDelta('kpiSatisfacaoDelta', 'Sem avaliações', 'neutral');
      }
    }
    setTone('kpiCardSatisfacao', !rated.count ? 'neutral' : rated.average >= 7 ? 'green' : rated.average >= 5 ? 'blue' : 'red');
  }

  function cumulativeSeries(inventory, predicate, weeks) {
    var baseline = 0;
    var dated = [];
    inventory.forEach(function (item) {
      if (!predicate(item)) return;
      var date = inventoryDate(item);
      if (!date) baseline++;
      else dated.push(date);
    });
    return weeks.map(function (week) {
      var count = baseline;
      for (var index = 0; index < dated.length; index++) {
        if (dated[index] <= week.end) count++;
      }
      return count;
    });
  }

  function renderSparklines(db, tickets, rated, weeks) {
    var inventory = (db && db.inventory) || [];
    sparkline(byId('kpiTotalSpark'), cumulativeSeries(inventory, function () { return true; }, weeks));
    sparkline(byId('kpiAtivosSpark'), cumulativeSeries(inventory, function (item) { return inventoryStatus(item) === 'em uso'; }, weeks));
    sparkline(byId('kpiManutSpark'), cumulativeSeries(inventory, function (item) { return inventoryStatus(item).indexOf('manut') !== -1; }, weeks));

    var weeklyTickets = weeks.map(function (week) {
      return tickets.filter(function (ticket) {
        var date = parseDate(ticket && ticket.criadoEm);
        return date && date >= week.start && date <= week.end;
      }).length;
    });
    sparkline(byId('kpiChamadosSpark'), weeklyTickets);

    var ratingValues;
    if (!rated.count) {
      ratingValues = weeks.map(function () { return null; });
    } else if (!rated.list.some(function (item) { return item.date; })) {
      ratingValues = weeks.map(function () { return rated.average; });
    } else {
      ratingValues = weeks.map(function (week) {
        var values = rated.list.filter(function (item) { return item.date && item.date <= week.end; });
        if (!values.length) return null;
        var sum = values.reduce(function (total, item) { return total + item.value; }, 0);
        return sum / values.length;
      });
    }
    sparkline(byId('kpiSatisfacaoSpark'), ratingValues);
  }

  function renderWeekChart(db, tickets, weeks) {
    var chart = byId('dashWeekChart');
    if (!chart) return;
    var counts = weeks.map(function (week) {
      return tickets.filter(function (ticket) {
        var date = parseDate(ticket && ticket.criadoEm);
        return date && date >= week.start && date <= week.end;
      }).length;
    });
    var max = Math.max.apply(null, counts.concat([1]));
    var total = counts.reduce(function (sum, count) { return sum + count; }, 0);
    chart.innerHTML = weeks.map(function (week, index) {
      var count = counts[index];
      var height = Math.round(count * 100 / max);
      var range = 'Semana de ' + shortDate(week.start) + ' a ' + shortDate(week.end);
      var label = week.current ? 'Atual' : shortDate(week.start);
      return '<div class="week-col' + (week.current ? ' current' : '') + '" title="' + esc(range + ': ' + count + ' chamado(s)') + '">' +
        '<div class="week-val">' + count + '</div>' +
        '<div class="week-bar-track"><div class="week-bar" style="height:' + height + '%"></div></div>' +
        '<div class="week-lab">' + esc(label) + '</div>' +
        '</div>';
    }).join('');
    chart.setAttribute('aria-label', 'Chamados por semana. Oito semanas, ' + total + ' chamados no período.');

    var note = byId('dashPendingNote');
    if (!note) return;
    var open = openTicketsCount(db);
    note.className = 'dash-note' + (open ? ' warn' : '');
    note.innerHTML = open
      ? ICON_ALERT + '<span>' + open + (open === 1 ? ' chamado aguardando atendimento.' : ' chamados aguardando atendimento.') + '</span>'
      : ICON_CHECK + '<span>Nenhum chamado pendente. Todos os atendimentos estão em dia.</span>';
  }

  function renderStatusChart(db) {
    var list = byId('dashStatusChart');
    var note = byId('dashStatusNote');
    if (!list) return;
    var inventory = (db && db.inventory) || [];
    var total = inventory.length;
    if (!total) {
      list.innerHTML = '<div class="empty-state"><div class="empty-icon">' + ICON_BOX + '</div><b>Nenhum equipamento</b><span>Cadastre itens no inventário para ver a distribuição.</span></div>';
      if (note) {
        note.className = 'status-note';
        note.textContent = '';
        note.style.display = 'none';
      }
      return;
    }
    var groups = [
      { label: 'Em uso', tone: 'green', count: 0 },
      { label: 'Manutenção', tone: 'red', count: 0 },
      { label: 'Estoque', tone: 'blue', count: 0 },
      { label: 'Baixado', tone: 'neutral', count: 0 }
    ];
    var other = 0;
    inventory.forEach(function (item) {
      var status = inventoryStatus(item);
      if (status === 'em uso') groups[0].count++;
      else if (status.indexOf('manut') !== -1) groups[1].count++;
      else if (status === 'estoque') groups[2].count++;
      else if (status === 'baixado') groups[3].count++;
      else other++;
    });
    if (other) groups.push({ label: 'Outros', tone: 'neutral', count: other });
    list.innerHTML = groups.map(function (group) {
      var percent = total ? Math.round(group.count * 100 / total) : 0;
      return '<div class="status-row" data-tone="' + group.tone + '">' +
        '<div class="status-top"><span>' + esc(group.label) + '</span><b>' + group.count + ' · ' + percent + '%</b></div>' +
        '<div class="status-track"><div class="status-fill" style="width:' + percent + '%"></div></div>' +
        '</div>';
    }).join('');
    if (!note) return;
    note.style.display = '';
    var maintenance = groups[1].count;
    note.className = 'status-note' + (maintenance ? ' bad' : '');
    note.innerHTML = maintenance
      ? ICON_ALERT + '<span>' + maintenance + (maintenance === 1 ? ' equipamento em manutenção.' : ' equipamentos em manutenção.') + '</span>'
      : ICON_CHECK + '<span>Nenhum equipamento parado.</span>';
  }

  function renderTickets(db) {
    var container = byId('dashTickets');
    if (!container) return;
    var tickets = readTickets(db).slice().sort(function (a, b) { return ticketSortDate(b) - ticketSortDate(a); }).slice(0, 5);
    if (!tickets.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">' + ICON_CHECK + '</div><b>Nenhum chamado recente</b><span>Os chamados aparecerão aqui assim que forem abertos.</span></div>';
      return;
    }
    container.innerHTML = tickets.map(function (ticket) {
      var status = ticketStatus(ticket);
      var priority = ticketPriority(ticket);
      var when = timePhrase('finalizado', parseDate(ticket.finalizadoEm)) ||
        timePhrase('atendido', parseDate(ticket.atendidoEm)) ||
        timePhrase('aberto', parseDate(ticket.criadoEm)) ||
        'sem data';
      var meta = [ticket.id || '-', when];
      if (ticket.categoria) meta.push(ticket.categoria);
      return '<div class="ticket-row">' +
        '<div class="ticket-avatar">' + esc(initials(ticket.solicitante)) + '</div>' +
        '<div class="ticket-main">' +
        '<div class="ticket-title"><b>' + esc(ticket.solicitante || 'Sem solicitante') + '</b> · ' + esc(ticket.assunto || 'Sem assunto') + '</div>' +
        '<div class="ticket-meta">' + meta.map(function (item) { return '<span>' + esc(item) + '</span>'; }).join('<span>·</span>') + '</div>' +
        '</div>' +
        '<div class="ticket-tags">' + tag(status.label, status.tone) + (priority ? tag(priority.label, priority.tone) : '') + '</div>' +
        '</div>';
    }).join('');
  }

  function activityInfo(action) {
    var key = norm(action);
    var verbs = {
      create: 'criou',
      update: 'atualizou',
      delete: 'excluiu',
      login: 'entrou no sistema',
      logout: 'saiu do sistema',
      rating: 'avaliou',
      export: 'exportou',
      pdf: 'gerou um PDF',
      token: 'gerou um token',
      backup: 'fez backup',
      restore: 'restaurou',
      approve: 'aprovou',
      reject: 'rejeitou',
      access: 'acessou',
      ouvidoria: 'registrou uma manifestação'
    };
    var tone = 'blue';
    if (/delete|exclu|security|seguranca|block|bloque|revoke|revog/.test(key)) tone = 'red';
    else if (/create|novo|criad|approve|aprov|rating|avali|conclu|finaliz/.test(key)) tone = 'green';
    else if (/logout|saiu/.test(key)) tone = 'neutral';
    return { verb: verbs[key] || String(action || 'registrou uma atividade'), tone: tone };
  }

  function renderActivity(db) {
    var container = byId('dashActivity');
    if (!container) return;
    var logs = ((db && db.Logs) || []).filter(Boolean).slice(0, 18);
    var groups = [];
    logs.forEach(function (log) {
      var user = String(log.user || 'Sistema');
      var action = String(log.action || '');
      var key = user + '|' + action;
      var time = parseDate(log.time);
      var last = groups[groups.length - 1];
      if (last && last.key === key && (!last.time || !time || Math.abs(last.time.getTime() - time.getTime()) <= 30 * 60 * 1000)) {
        last.count++;
      } else {
        groups.push({ key: key, user: user, action: action, time: time, detail: log.detail, count: 1 });
      }
    });
    groups = groups.slice(0, 6);
    if (!groups.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">' + ICON_CLOCK + '</div><b>Nenhuma atividade recente</b><span>Os eventos do sistema aparecerão aqui.</span></div>';
      return;
    }
    container.innerHTML = groups.map(function (group) {
      var info = activityInfo(group.action);
      var detail = truncate(group.detail, 105);
      var suffix = detail ? ' · ' + esc(detail) : '';
      if (group.count > 1) suffix += ' <span class="activity-count">+' + (group.count - 1) + '</span>';
      return '<div class="activity-row" data-tone="' + info.tone + '">' +
        '<span class="activity-dot"></span>' +
        '<div class="activity-body">' +
        '<div class="activity-text"><b>' + esc(group.user) + '</b> ' + esc(info.verb) + suffix + '</div>' +
        '<span class="activity-time">' + esc(timeLabel(group.time)) + '</span>' +
        '</div>' +
        '</div>';
    }).join('');
  }

  function renderOverview(db) {
    try {
      var data = db || readDB();
      var weeks = getWeeks();
      var tickets = readTickets(data);
      var rated = rateInfo(data);
      renderKPIs(data);
      renderSparklines(data, tickets, rated, weeks);
      renderWeekChart(data, tickets, weeks);
      renderStatusChart(data);
      renderTickets(data);
      renderActivity(data);
      var updated = byId('dashUpdated');
      if (updated) {
        var now = new Date();
        updated.textContent = 'hoje, ' + pad2(now.getHours()) + ':' + pad2(now.getMinutes());
      }
    } catch (error) {
      if (window.console && console.error) console.error('uiRefreshOverview', error);
    }
  }

  function installDashboard() {
    window.uiRefreshOverview = renderOverview;
    window.renderDashTickets = renderTickets;
    window.renderDashActivity = renderActivity;
    var map = window._sectionRenderMap;
    if (!map || !Array.isArray(map.Dashboard)) return;
    map.Dashboard = map.Dashboard.filter(function (name) {
      return name !== 'renderDashTickets' && name !== 'renderDashActivity';
    });
    if (map.Dashboard.indexOf('uiRefreshOverview') === -1) map.Dashboard.push('uiRefreshOverview');
  }

  function readGroupState() {
    try {
      var state = JSON.parse(localStorage.getItem(GROUP_KEY) || '{}');
      return state && typeof state === 'object' ? state : {};
    } catch (error) {
      return {};
    }
  }

  function writeGroupState(state) {
    try { localStorage.setItem(GROUP_KEY, JSON.stringify(state)); } catch (error) {}
  }

  function setGroupOpen(group, open, persist) {
    if (!group) return;
    group.classList.toggle('open', !!open);
    var header = group.querySelector('.ng-head');
    var plus = group.querySelector('.ng-plus');
    if (header) header.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (plus) plus.textContent = open ? '\u2212' : '+';
    if (persist) {
      var state = readGroupState();
      state[group.getAttribute('data-group') || ''] = !!open;
      writeGroupState(state);
    }
  }

  function activeGroup(section) {
    var items = document.querySelectorAll('.ni[data-s]');
    for (var index = 0; index < items.length; index++) {
      if (items[index].getAttribute('data-s') === section) {
        return items[index].closest('.ng');
      }
    }
    return null;
  }

  function initGroups() {
    var saved = readGroupState();
    document.querySelectorAll('.ng').forEach(function (group) {
      var key = group.getAttribute('data-group') || '';
      var open = !!saved[key];
      if (group.querySelector('.ni.active')) open = true;
      setGroupOpen(group, open, false);
      var header = group.querySelector('.ng-head');
      if (header) {
        header.addEventListener('click', function () {
          setGroupOpen(group, !group.classList.contains('open'), true);
          syncGroupVisibility();
        });
      }
    });
  }

  function syncGroupVisibility() {
    document.querySelectorAll('.ng').forEach(function (group) {
      if (group.id === 'adminSection' && group.style.display === 'none') {
        group.classList.remove('ng-empty');
        return;
      }
      var items = group.querySelectorAll('.ni[data-s]');
      var visible = false;
      for (var index = 0; index < items.length; index++) {
        if (items[index].style.display !== 'none') {
          visible = true;
          break;
        }
      }
      group.classList.toggle('ng-empty', !visible);
    });
  }

  function syncBadges() {
    document.querySelectorAll('.sidebar-nav .nb').forEach(function (badge) {
      var value = String(badge.textContent || '').replace(/\s+/g, '');
      if (!value || /^0+$/.test(value)) badge.setAttribute('data-zero', '1');
      else badge.removeAttribute('data-zero');
    });
  }

  function initNavObserver() {
    var nav = document.querySelector('.sidebar-nav');
    if (!nav) return;
    var queued = false;
    var run = function () {
      if (queued) return;
      queued = true;
      setTimeout(function () {
        queued = false;
        syncBadges();
        syncGroupVisibility();
      }, 30);
    };
    syncBadges();
    syncGroupVisibility();
    if (!window.MutationObserver) return;
    new MutationObserver(run).observe(nav, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['style']
    });
  }

  function applyThemeUI() {
    var current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    var button = byId('themeToggle');
    if (button) {
      button.setAttribute('aria-label', current === 'light' ? 'Ativar tema escuro' : 'Ativar tema claro');
      button.setAttribute('title', current === 'light' ? 'Mudar para tema escuro' : 'Mudar para tema claro');
    }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', current === 'light' ? '#f4f7fb' : '#0a0e17');
  }

  function persistTheme() {
    var current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, current); } catch (error) {}
    applyThemeUI();
  }

  function initTheme() {
    applyThemeUI();
    if (!window.MutationObserver) return;
    new MutationObserver(function (mutations) {
      for (var index = 0; index < mutations.length; index++) {
        if (mutations[index].attributeName === 'data-theme') {
          persistTheme();
          return;
        }
      }
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  function wireDataNav() {
    document.querySelectorAll('[data-nav]').forEach(function (button) {
      button.addEventListener('click', function () {
        var section = button.getAttribute('data-nav');
        if (section && typeof window.showSec === 'function') window.showSec(section);
      });
    });
  }

  function initShowSec() {
    if (typeof window.showSec !== 'function' || window.showSec.__uiRefreshWrapped) return;
    var original = window.showSec;
    var wrapped = function (section) {
      var result = original.apply(this, arguments);
      try {
        if (window._activeSec === section) {
          var group = activeGroup(section);
          if (group && !group.classList.contains('open')) setGroupOpen(group, true, true);
          syncGroupVisibility();
        }
      } catch (error) {}
      return result;
    };
    wrapped.__uiRefreshWrapped = true;
    window.showSec = wrapped;
  }

  function init() {
    initGroups();
    initNavObserver();
    installDashboard();
    wireDataNav();
    initShowSec();
    initTheme();
    renderOverview();
    setTimeout(function () {
      syncBadges();
      syncGroupVisibility();
    }, 700);
  }

  init();
})();
