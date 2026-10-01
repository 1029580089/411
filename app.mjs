import {plan, toCsv} from './planner.mjs';
const $ = id => document.getElementById(id);
let sample, current;
const labels = {'on-time': '按期', late: '延期', blocked: '不可排'};
const element = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
function invalidate(message, error = false) {
  current = undefined; $('export').disabled = true;
  for (const key of ['total', 'onTime', 'late', 'blocked']) $(key).textContent = '—';
  for (const key of ['orders', 'load', 'stock']) $(key).replaceChildren();
  $('utilization').textContent = ''; $('period').textContent = '尚无有效计划';
  $('notice').textContent = message; $('notice').className = error ? 'error' : '';
}
function reason(order) {
  if (order.reason === 'material') return order.shortages.map(s => `${s.material} 缺 ${s.required - s.available}（需 ${s.required} / 余 ${s.available}）`).join('；');
  if (order.reason === 'dependency') return `前置工单不可排：${order.blockedBy.join('、')}`;
  if (order.reason === 'capacity') return '计划窗口内无法容纳全部工序，未占用库存或产能';
  return order.lateDays ? `晚于交期 ${order.lateDays} 天` : '物料齐套，产能可用';
}
function render(result, input) {
  for (const key of ['total', 'onTime', 'late', 'blocked']) $(key).textContent = result.summary[key];
  $('period').textContent = `${input.startDate} 起 · ${input.horizonDays} 天计划 · ${input.machines.length} 台设备`;
  $('utilization').textContent = `综合产能利用率 ${result.summary.utilization}%`;
  const rows = result.orders.map(order => {
    const tr = element('tr'); const identity = element('td');
    identity.append(element('strong', order.id), element('small', `${order.quantity} 件 · P${order.priority}`));
    const status = element('td'); status.append(element('span', labels[order.status], `badge ${order.status}`));
    tr.append(identity, status, element('td', order.dueDate), element('td', order.startDate ? `${order.startDate.slice(5)} → ${order.finishDate.slice(5)}` : '—'), element('td', reason(order)));
    return tr;
  });
  $('orders').replaceChildren(...rows);
  if (!rows.length) { const tr = element('tr'); const td = element('td', '暂无工单', 'empty'); td.colSpan = 5; tr.append(td); $('orders').append(tr); }
  const table = element('table'), head = element('thead'), header = element('tr');
  header.append(element('th', '设备'));
  const dates = [...new Set(result.load.map(item => item.date))];
  dates.forEach(date => header.append(element('th', date.slice(5)))); head.append(header); table.append(head);
  const body = element('tbody');
  for (const machine of input.machines) {
    const row = element('tr'); row.append(element('td', machine.id));
    for (const item of result.load.filter(item => item.machine === machine.id)) {
      row.append(element('td', item.available ? `${item.used} / ${item.available}` : '停机', `load-cell ${!item.available ? 'stopped' : item.used === item.available ? 'full' : item.used ? 'partial' : ''}`));
    }
    body.append(row);
  }
  table.append(body); $('load').replaceChildren(table);
  $('stock').replaceChildren(...Object.entries(result.stockRemaining).map(([key, amount]) => { const row = element('div', undefined, 'stock-row'); row.append(element('span', key), element('strong', amount)); return row; }));
}
function run() {
  invalidate('正在校验…');
  try {
    const input = JSON.parse($('input').value); const result = plan(input);
    render(result, input); current = result; $('export').disabled = false;
    $('notice').textContent = `排程完成。${result.summary.blocked ? '请先处理不可排工单，再评估交期。' : '所有工单已纳入计划。'}`;
  } catch (error) { invalidate(error instanceof SyntaxError ? 'JSON 格式有误，请检查引号、逗号和括号。' : error.message, true); }
}
$('run').addEventListener('click', run);
$('input').addEventListener('input', () => invalidate('输入已修改，请重新排程。'));
$('reset').addEventListener('click', () => { if (!sample) return; $('input').value = JSON.stringify(sample, null, 2); run(); });
$('export').addEventListener('click', () => {
  if (!current) return;
  const url = URL.createObjectURL(new Blob([toCsv(current)], {type: 'text/csv;charset=utf-8'}));
  const link = element('a'); link.href = url; link.download = 'workshop-plan.csv'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
try {
  const response = await fetch('./sample.json');
  if (!response.ok) throw new Error('样例加载失败，请检查本地服务。');
  sample = await response.json(); $('input').value = JSON.stringify(sample, null, 2); run();
} catch (error) { invalidate(error.message, true); }
