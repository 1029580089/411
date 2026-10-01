/** A deterministic, day-bucket heuristic. All quantities and capacities are integers. */
export class InputError extends Error {
  constructor(message) { super(message); this.name = 'InputError'; }
}
const fail = message => { throw new InputError(message); };
const DAY = 86400000;
const own = (object, key) => Object.hasOwn(object, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value, min, max, label) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${label}必须是 ${min}～${max} 的整数`);
};
function day(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`${label}必须使用 YYYY-MM-DD`);
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) fail(`${label}不是有效日期`);
  return parsed / DAY;
}
const date = value => new Date(value * DAY).toISOString().slice(0, 10);
function id(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(value)) fail(`${label}须为 1～40 位字母、数字、下划线或短横线`);
}

export function validate(input) {
  if (!object(input)) fail('输入必须是 JSON 对象');
  const start = day(input.startDate, '计划起始日');
  integer(input.horizonDays, 1, 90, '计划天数');
  if (start + input.horizonDays > day('9999-12-31', '日期上限')) fail('计划日期超出支持范围');
  if (!Array.isArray(input.machines) || input.machines.length < 1 || input.machines.length > 20) fail('设备数量必须为 1～20');
  const machines = new Set();
  for (const machine of input.machines) {
    if (!object(machine)) fail('设备必须是对象');
    id(machine.id, '设备 ID');
    if (machines.has(machine.id)) fail(`设备 ID 重复：${machine.id}`);
    machines.add(machine.id);
    integer(machine.dailyMinutes, 1, 1440, `${machine.id} 日产能`);
    if (machine.downtime !== undefined && !Array.isArray(machine.downtime)) fail('停机日期必须是数组');
    for (const entry of machine.downtime ?? []) day(entry, '停机日期');
  }
  if (!object(input.stock) || Object.keys(input.stock).length > 100) fail('库存必须是最多 100 项的对象');
  for (const [key, amount] of Object.entries(input.stock)) { id(key, '物料 ID'); integer(amount, 0, 1000000000, `${key} 库存`); }
  if (!Array.isArray(input.orders) || input.orders.length > 200) fail('工单必须是最多 200 项的数组');
  const orders = new Map();
  for (const order of input.orders) {
    if (!object(order)) fail('工单必须是对象');
    id(order.id, '工单 ID');
    if (orders.has(order.id)) fail(`工单 ID 重复：${order.id}`);
    orders.set(order.id, order);
    integer(order.quantity, 1, 100000, `${order.id} 数量`);
    integer(order.priority, 1, 3, `${order.id} 优先级`);
    day(order.dueDate, `${order.id} 交期`);
    if (order.releaseDate !== undefined) day(order.releaseDate, `${order.id} 可开工日期`);
    if (!object(order.bom) || Object.keys(order.bom).length > 100) fail(`${order.id} BOM 必须是最多 100 项的对象`);
    for (const [material, units] of Object.entries(order.bom)) {
      id(material, 'BOM 物料 ID');
      if (!own(input.stock, material)) fail(`${order.id} 引用了未定义物料 ${material}`);
      integer(units, 1, 10000, `${material} 单件用量`);
    }
    if (!Array.isArray(order.route) || order.route.length < 1 || order.route.length > 10) fail(`${order.id} 必须包含 1～10 道工序`);
    for (const step of order.route) {
      if (!object(step) || !machines.has(step.machine)) fail(`${order.id} 工序引用了未定义设备`);
      integer(step.minutesPerUnit, 1, 1440, `${order.id} 单件工时`);
    }
    if (!Array.isArray(order.dependsOn) || order.dependsOn.length > 200) fail(`${order.id} dependsOn 必须为数组`);
    if (new Set(order.dependsOn).size !== order.dependsOn.length) fail(`${order.id} 依赖重复`);
  }
  const visiting = new Set(), visited = new Set();
  function visit(key) {
    if (visiting.has(key)) fail(`工单依赖存在环：${key}`);
    if (visited.has(key)) return;
    visiting.add(key);
    for (const dependency of orders.get(key).dependsOn) {
      if (!orders.has(dependency)) fail(`${key} 依赖不存在的工单 ${dependency}`);
      visit(dependency);
    }
    visiting.delete(key); visited.add(key);
  }
  for (const key of orders.keys()) visit(key);
  return input;
}

export function plan(input) {
  validate(input);
  const start = day(input.startDate, '起始日');
  const stock = new Map(Object.entries(input.stock));
  const capacity = new Map(input.machines.map(machine => {
    const stops = new Set(machine.downtime ?? []);
    return [machine.id, Array.from({length: input.horizonDays}, (_, index) => stops.has(date(start + index)) ? 0 : machine.dailyMinutes)];
  }));
  const initialCapacity = new Map([...capacity].map(([key, values]) => [key, [...values]]));
  const pending = new Map(input.orders.map(order => [order.id, order]));
  const completed = new Map();
  const compare = (a, b) => b.priority - a.priority || a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id, 'en');
  while (pending.size) {
    const ready = [...pending.values()].filter(order => order.dependsOn.every(key => completed.has(key))).sort(compare);
    const order = ready[0];
    if (!order) throw new Error('Invalid dependency graph');
    pending.delete(order.id);
    const base = {id: order.id, quantity: order.quantity, dueDate: order.dueDate, priority: order.priority};
    const blockedBy = order.dependsOn.filter(key => completed.get(key).status === 'blocked');
    if (blockedBy.length) {
      completed.set(order.id, {...base, status: 'blocked', reason: 'dependency', blockedBy, allocations: []});
      continue;
    }
    const shortages = Object.entries(order.bom).map(([material, units]) => ({material, required: units * order.quantity, available: stock.get(material)})).filter(item => item.required > item.available);
    if (shortages.length) {
      completed.set(order.id, {...base, status: 'blocked', reason: 'material', shortages, allocations: []});
      continue;
    }
    // Trial reservations are committed only when every operation fits the horizon.
    const trial = new Map([...capacity].map(([key, values]) => [key, [...values]]));
    let earliest = Math.max(0, order.releaseDate ? day(order.releaseDate, '可开工日') - start : 0,
      ...order.dependsOn.map(key => day(completed.get(key).finishDate, '完工日') - start + 1));
    const allocations = [];
    let fits = true;
    for (let operation = 0; operation < order.route.length; operation++) {
      const step = order.route[operation];
      let remaining = order.quantity * step.minutesPerUnit;
      let last = earliest;
      for (let index = earliest; index < input.horizonDays && remaining > 0; index++) {
        const minutes = Math.min(remaining, trial.get(step.machine)[index]);
        if (minutes === 0) continue;
        trial.get(step.machine)[index] -= minutes;
        remaining -= minutes;
        last = index;
        allocations.push({operation: operation + 1, machine: step.machine, date: date(start + index), minutes});
      }
      if (remaining > 0) { fits = false; break; }
      earliest = last + 1;
    }
    if (!fits) {
      completed.set(order.id, {...base, status: 'blocked', reason: 'capacity', allocations: []});
      continue;
    }
    for (const [key, values] of trial) capacity.set(key, values);
    for (const [key, units] of Object.entries(order.bom)) stock.set(key, stock.get(key) - units * order.quantity);
    const finishDate = allocations.at(-1).date;
    const lateDays = Math.max(0, day(finishDate, '完工日') - day(order.dueDate, '交期'));
    completed.set(order.id, {...base, status: lateDays ? 'late' : 'on-time', startDate: allocations[0].date, finishDate, lateDays, allocations});
  }
  const orders = [...completed.values()];
  const load = [...capacity].flatMap(([machine, values]) => values.map((remaining, index) => ({machine, date: date(start + index), available: initialCapacity.get(machine)[index], used: initialCapacity.get(machine)[index] - remaining})));
  const totalCapacity = load.reduce((sum, item) => sum + item.available, 0);
  return {
    orders, stockRemaining: Object.fromEntries(stock), load,
    summary: {total: orders.length, onTime: orders.filter(o => o.status === 'on-time').length, late: orders.filter(o => o.status === 'late').length, blocked: orders.filter(o => o.status === 'blocked').length,
      utilization: totalCapacity ? Math.round(load.reduce((sum, item) => sum + item.used, 0) / totalCapacity * 1000) / 10 : 0}
  };
}

export function toCsv(result) {
  const cell = value => {
    let text = String(value ?? '');
    if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const rows = [['工单', '状态', '数量', '交期', '开工', '完工', '延期天数', '阻塞原因'], ...result.orders.map(o => [o.id, o.status, o.quantity, o.dueDate, o.startDate, o.finishDate, o.lateDays, o.reason])];
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n');
}
